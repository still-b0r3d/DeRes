import { bayerMatrix } from './bayer'
import { toSrgb } from './color'
import type { PaletteMatcher } from './matcher'
import { PLAN, type YliluomaPlanner } from './yliluoma'

// Turns a linear-light RGB image into palette indices. Every function here is
// deterministic: the same input always gives the same output.

export type DitherId =
  | 'none'
  | 'bayer2'
  | 'bayer4'
  | 'bayer8'
  | 'floyd'
  | 'atkinson'
  | 'yliluoma'
  | 'gbcam'
  | 'ps1'

export interface DitherInfo {
  id: DitherId
  name: string
  hint: string
  /** Only offered on machines that have it as their own. */
  native?: boolean
}

export const DITHERS: readonly DitherInfo[] = [
  { id: 'none', name: 'None', hint: 'Flat areas of colour' },
  { id: 'bayer2', name: 'Bayer 2×2', hint: 'Coarse crosshatch' },
  { id: 'bayer4', name: 'Bayer 4×4', hint: 'Classic crosshatch' },
  { id: 'bayer8', name: 'Bayer 8×8', hint: 'Fine crosshatch' },
  { id: 'floyd', name: 'Floyd–Steinberg', hint: 'Smooth, grainy' },
  { id: 'atkinson', name: 'Atkinson', hint: 'Crisp, Mac-style' },
  { id: 'yliluoma', name: 'Yliluoma', hint: 'Patterned, for uneven palettes' },
  { id: 'gbcam', name: 'Camera', hint: "The Game Boy Camera's own", native: true },
  { id: 'ps1', name: 'PS1 GPU', hint: "The PlayStation GPU's 4×4 dither", native: true }
]

export interface DitherInput {
  /** Linear-light RGB, 3 floats per pixel. Not modified. */
  rgb: Float32Array
  width: number
  height: number
  matcher: PaletteMatcher
  /**
   * Grey-level palette (Game Boy, Mac, receipt printer): the pixels are grey
   * and the matcher's colours are grey levels. Ordered dithers then pick
   * between the two levels around each pixel exactly.
   */
  mono: boolean
  /** Made on first use and kept by the caller, one per palette. */
  planner: () => YliluomaPlanner
}

export function dither(id: DitherId, input: DitherInput, out: Uint8Array): void {
  switch (id) {
    case 'none':
      return nearestOnly(input, out)
    case 'bayer2':
      return ordered(input, 2, out)
    case 'bayer4':
      return ordered(input, 4, out)
    case 'bayer8':
      return ordered(input, 8, out)
    case 'floyd':
      return floydSteinberg(input, out)
    case 'atkinson':
      return atkinson(input, out)
    case 'yliluoma':
      return yliluoma(input, out)
    case 'gbcam':
      return gameBoyCamera(input, out)
    case 'ps1':
      return ps1Dither(input, out)
  }
}

function nearestOnly({ rgb, width, height, matcher }: DitherInput, out: Uint8Array): void {
  for (let i = 0, n = width * height; i < n; i++) {
    out[i] = matcher.nearest(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2])
  }
}

// Classic ordered dithering for colour palettes: add the threshold (scaled
// to the palette's typical step) and take the nearest colour. Done in sRGB,
// where most hardware palettes are evenly spaced (the EGA's 0x55 steps, the
// web-safe cube's 0x33), so every step gets the full pattern. Uneven
// palettes do better with Yliluoma.
function ordered(input: DitherInput, n: number, out: Uint8Array): void {
  if (input.mono) return orderedLevels(input, n, false, out)
  const { rgb, width, height, matcher } = input
  const mat = bayerMatrix(n)
  const nn = n * n
  const spread = matcher.spread * 255
  const byte = (v: number) => (v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const d = ((mat[(y % n) * n + (x % n)] + 0.5) / nn - 0.5) * spread
      out[i] = matcher.nearestByte(
        byte(toSrgb(rgb[i * 3]) * 255 + d),
        byte(toSrgb(rgb[i * 3 + 1]) * 255 + d),
        byte(toSrgb(rgb[i * 3 + 2]) * 255 + d)
      )
    }
  }
}

// Ordered dithering over grey levels: find the two levels around the pixel
// and show the brighter one on the share of thresholds that matches where the
// pixel sits between them. In linear light (the right brightness) or, for the
// Game Boy Camera, in sRGB like its sensor's evenly spaced thresholds.
function orderedLevels(input: DitherInput, n: number, perceptual: boolean, out: Uint8Array): void {
  const { rgb, width, height, matcher } = input
  const mat = bayerMatrix(n)
  const nn = n * n
  const order = [...Array(matcher.size).keys()].sort(
    (a, b) => matcher.luma[a] - matcher.luma[b] || a - b
  )
  const curve = perceptual ? toSrgb : (v: number) => v
  const levels = order.map((i) => curve(matcher.luma[i]))
  const last = levels.length - 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const v = curve(rgb[i * 3])
      let k = 0
      while (k < last && v >= levels[k + 1]) k++
      if (k === last) {
        out[i] = order[last]
        continue
      }
      const lo = levels[k]
      const f = v <= lo ? 0 : (v - lo) / (levels[k + 1] - lo)
      const t = (mat[(y % n) * n + (x % n)] + 0.5) / nn
      out[i] = order[t < f ? k + 1 : k]
    }
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

// Serpentine Floyd–Steinberg: rows alternate direction, which stops the
// diagonal "worm" streaks. The error is carried in linear light.
function floydSteinberg({ rgb, width, height, matcher }: DitherInput, out: Uint8Array): void {
  const work = Float32Array.from(rgb)
  const lin = matcher.linear
  for (let y = 0; y < height; y++) {
    const ltr = (y & 1) === 0
    const dir = ltr ? 1 : -1
    for (let s = 0; s < width; s++) {
      const x = ltr ? s : width - 1 - s
      const i = y * width + x
      const r = clamp01(work[i * 3])
      const g = clamp01(work[i * 3 + 1])
      const b = clamp01(work[i * 3 + 2])
      const idx = matcher.nearest(r, g, b)
      out[i] = idx
      const er = r - lin[idx * 3]
      const eg = g - lin[idx * 3 + 1]
      const eb = b - lin[idx * 3 + 2]
      const xn = x + dir
      const xp = x - dir
      if (xn >= 0 && xn < width) spread(work, i + dir, er, eg, eb, 7 / 16)
      if (y + 1 < height) {
        const below = i + width
        if (xp >= 0 && xp < width) spread(work, below - dir, er, eg, eb, 3 / 16)
        spread(work, below, er, eg, eb, 5 / 16)
        if (xn >= 0 && xn < width) spread(work, below + dir, er, eg, eb, 1 / 16)
      }
    }
  }
}

// Atkinson (as in MacPaint): six neighbours get 1/8 each, so only 3/4 of the
// error is passed on. Highlights and shadows blow out; that's the look.
function atkinson({ rgb, width, height, matcher }: DitherInput, out: Uint8Array): void {
  const work = Float32Array.from(rgb)
  const lin = matcher.linear
  const taps: [number, number][] = [
    [1, 0],
    [2, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
    [0, 2]
  ]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const r = clamp01(work[i * 3])
      const g = clamp01(work[i * 3 + 1])
      const b = clamp01(work[i * 3 + 2])
      const idx = matcher.nearest(r, g, b)
      out[i] = idx
      const er = r - lin[idx * 3]
      const eg = g - lin[idx * 3 + 1]
      const eb = b - lin[idx * 3 + 2]
      for (const [dx, dy] of taps) {
        const nx = x + dx
        const ny = y + dy
        if (nx >= 0 && nx < width && ny < height) spread(work, ny * width + nx, er, eg, eb, 1 / 8)
      }
    }
  }
}

function spread(work: Float32Array, j: number, er: number, eg: number, eb: number, w: number) {
  work[j * 3] += er * w
  work[j * 3 + 1] += eg * w
  work[j * 3 + 2] += eb * w
}

function yliluoma(input: DitherInput, out: Uint8Array): void {
  const { rgb, width, height } = input
  const planner = input.planner()
  const mat = bayerMatrix(8)
  const scale = PLAN / 64
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const t = (mat[(y & 7) * 8 + (x & 7)] * scale) | 0
      out[i] = planner.pick(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], t)
    }
  }
}

// The Game Boy Camera's sensor dithers its 4 shades with a 4×4 threshold
// matrix, evenly spaced in its output (close to sRGB, not linear light), so
// mid-tones come out lighter and crunchier than a plain Bayer 4×4.
function gameBoyCamera(input: DitherInput, out: Uint8Array): void {
  if (!input.mono) return ordered(input, 4, out)
  orderedLevels(input, 4, true, out)
}

// The PlayStation GPU's 4×4 hardware dither table (from psx-spx).
export const PS1_DITHER_TABLE = [
  -4,  0, -3,  1,
   2, -2,  3, -1,
  -3,  1, -4,  0,
   3, -1,  2, -2
] as const

function ps1Dither(input: DitherInput, out: Uint8Array): void {
  const { rgb, width, height, matcher } = input
  const spread = matcher.spread * 255
  const byte = (v: number) => (v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const d = PS1_DITHER_TABLE[(y & 3) * 4 + (x & 3)]
      const offset = (d / 8) * spread
      out[i] = matcher.nearestByte(
        byte(toSrgb(rgb[i * 3]) * 255 + offset),
        byte(toSrgb(rgb[i * 3 + 1]) * 255 + offset),
        byte(toSrgb(rgb[i * 3 + 2]) * 255 + offset)
      )
    }
  }
}

