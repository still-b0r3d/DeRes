import { BYTE_TO_LINEAR, linearToByte, luminance } from './color'

// Screen effects: what the picture looked like on the machine's screen. They
// need more pixels than the picture has (a scanline is a part of a pixel), so
// they render an enlarged copy. Preview-only by default; the export can keep
// them from 3× up. Nothing here moves or flickers.

export type Screen = 'off' | 'crt' | 'lcd'
export type Mask = 'none' | 'shadow' | 'grille'

export interface Fx {
  screen: Screen
  /** CRT phosphor mask. */
  mask: Mask
  /** CRT, 0 … 1. */
  scanlines: number
  curve: number
  bloom: number
  /** LCD, 0 … 1: the gaps between pixels. */
  grid: number
  /** LCD, 0 … 1: the shadow each dark pixel casts. */
  ghost: number
}

export const DEFAULT_FX: Fx = {
  screen: 'off',
  mask: 'grille',
  scanlines: 0.7,
  curve: 0.3,
  bloom: 0.3,
  grid: 0.5,
  ghost: 0.4
}

export interface FxSource {
  /** The finished picture, sRGB bytes, 3 per pixel. */
  rgb: Uint8Array
  width: number
  height: number
  /** The lightest palette colour: an LCD's "off" pixels and the gaps between pixels. */
  paper: readonly [number, number, number]
}

// The electron beam across one pixel row: a soft line that is thin where the
// picture is dark and spreads where it's bright, so dark areas show clear
// gaps and highlights stay bright (as on a real tube). A table by brightness
// (16 steps) and position across the row (64 steps).
const BEAM_LEVELS = 16
const BEAM_STEPS = 64
const BEAM = new Float32Array(BEAM_LEVELS * (BEAM_STEPS + 1))
for (let l = 0; l < BEAM_LEVELS; l++) {
  const sigma = 0.12 + 0.18 * ((l + 0.5) / BEAM_LEVELS)
  for (let i = 0; i <= BEAM_STEPS; i++) {
    const d = i / BEAM_STEPS - 0.5
    BEAM[l * (BEAM_STEPS + 1) + i] = Math.exp(-(d * d) / (2 * sigma * sigma))
  }
}
// The middle of each line is driven a little brighter than the picture.
const BEAM_PEAK = 1.2
const MASK_DIM = 0.45

/**
 * Sets up rendering the picture at outW×outH with the screen effect. The
 * returned function fills one output row (3 bytes per pixel), in any order,
 * so an export can be encoded row by row without the whole image in memory.
 */
export function fxRenderer(
  src: FxSource,
  outW: number,
  outH: number,
  fx: Fx
): (oy: number, row: Uint8Array) => void {
  const { width: w, height: h } = src
  const lin = new Float32Array(w * h * 3)
  for (let i = 0; i < lin.length; i++) lin[i] = BYTE_TO_LINEAR[src.rgb[i]]
  const sx = outW / w
  const sy = outH / h
  const crt = fx.screen === 'crt'
  const lcd = fx.screen === 'lcd'

  // Scanlines need at least 2 output rows per picture row to show.
  const scan = crt ? fx.scanlines * clamp01(sy - 1) : 0
  const curve = crt ? fx.curve : 0
  const k = curve * 0.08
  const glow = crt && fx.bloom > 0 ? blur(lin, w, h) : null
  const bloom = glow ? fx.bloom * 0.7 : 0
  const mask = crt ? fx.mask : 'none'
  // Wins back the brightness the mask's dark stripes cost.
  const gain = mask !== 'none' ? 3 / (1 + 2 * MASK_DIM) : 1

  // LCD gaps are one output pixel wide, fading in from 2× to 3×.
  const grid = lcd ? fx.grid * 0.65 * clamp01(Math.min(sx, sy) - 2) : 0
  const ghost = lcd ? fx.ghost * 0.45 : 0
  const paper = src.paper.map((b) => BYTE_TO_LINEAR[b])
  const gapU = 1 / sx
  const gapV = 1 / sy

  const c = new Float32Array(3)
  return (oy, row) => {
    const ny = ((oy + 0.5) / outH) * 2 - 1
    for (let ox = 0; ox < outW; ox++) {
      let u: number
      let v: number
      let fade = 1
      if (curve > 0) {
        const nx = ((ox + 0.5) / outW) * 2 - 1
        const cx = nx * (1 + k * ny * ny)
        const cy = ny * (1 + k * nx * nx)
        const edge = Math.min(1 - Math.abs(cx), 1 - Math.abs(cy))
        if (edge <= 0) {
          row[ox * 3] = row[ox * 3 + 1] = row[ox * 3 + 2] = 0
          continue
        }
        // Soft corners and a gentle vignette.
        fade = Math.min(1, edge * 60) * (1 - curve * 0.25 * (cx * cx + cy * cy) * 0.5)
        u = ((cx + 1) / 2) * w
        v = ((cy + 1) / 2) * h
      } else {
        u = (ox + 0.5) / sx
        v = (oy + 0.5) / sy
      }
      const px = Math.min(w - 1, Math.floor(u))
      const py = Math.min(h - 1, Math.floor(v))
      const p = (py * w + px) * 3
      c[0] = lin[p]
      c[1] = lin[p + 1]
      c[2] = lin[p + 2]

      if (lcd) {
        if (ghost > 0) {
          const qx = Math.max(0, Math.floor(u - 0.35))
          const qy = Math.max(0, Math.floor(v - 0.35))
          const q = (qy * w + qx) * 3
          if (luminance(lin[q], lin[q + 1], lin[q + 2]) < luminance(c[0], c[1], c[2])) {
            for (let j = 0; j < 3; j++) c[j] += (lin[q + j] - c[j]) * ghost
          }
        }
        if (grid > 0 && (u - px < gapU || v - py < gapV)) {
          for (let j = 0; j < 3; j++) c[j] += (paper[j] - c[j]) * grid
        }
      } else if (crt) {
        let beam = 1
        if (scan > 0) {
          const level = Math.min(BEAM_LEVELS - 1, (Math.sqrt(luminance(c[0], c[1], c[2])) * BEAM_LEVELS) | 0)
          const across = Math.min(BEAM_STEPS, ((v - py) * BEAM_STEPS + 0.5) | 0)
          beam = 1 - scan + scan * BEAM_PEAK * BEAM[level * (BEAM_STEPS + 1) + across]
        }
        let mr = 1
        let mg = 1
        let mb = 1
        if (mask !== 'none') {
          const phase = ox % 3
          // Slot mask: the grille plus gaps, staggered from triad to triad.
          const dark = mask === 'shadow' && (oy + (Math.floor(ox / 3) & 1) * 2) % 4 === 0
          mr = phase === 0 ? 1 : MASK_DIM
          mg = phase === 1 ? 1 : MASK_DIM
          mb = phase === 2 ? 1 : MASK_DIM
          if (dark) {
            mr *= MASK_DIM
            mg *= MASK_DIM
            mb *= MASK_DIM
          }
        }
        const f = beam * gain * fade
        c[0] *= f * mr
        c[1] *= f * mg
        c[2] *= f * mb
        if (glow) {
          sampleBilinear(glow, w, h, u - 0.5, v - 0.5, c, bloom * fade)
        }
      }
      row[ox * 3] = linearToByte(c[0])
      row[ox * 3 + 1] = linearToByte(c[1])
      row[ox * 3 + 2] = linearToByte(c[2])
    }
  }
}

/** The screen-effect image as RGBA, for showing on a canvas. */
export function renderFxRgba(src: FxSource, outW: number, outH: number, fx: Fx): Uint8ClampedArray {
  const out = new Uint8ClampedArray(outW * outH * 4)
  const render = fxRenderer(src, outW, outH, fx)
  const row = new Uint8Array(outW * 3)
  for (let y = 0; y < outH; y++) {
    render(y, row)
    let o = y * outW * 4
    for (let i = 0; i < row.length; i += 3) {
      out[o] = row[i]
      out[o + 1] = row[i + 1]
      out[o + 2] = row[i + 2]
      out[o + 3] = 255
      o += 4
    }
  }
  return out
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

// A soft blur of the picture at its own size (box blur, 3 taps, twice each
// way), for the bloom. Cheap because the picture is small.
function blur(lin: Float32Array, w: number, h: number): Float32Array {
  let a = Float32Array.from(lin)
  let b = new Float32Array(lin.length)
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const l = Math.max(0, x - 1)
        const r = Math.min(w - 1, x + 1)
        for (let j = 0; j < 3; j++) {
          b[(y * w + x) * 3 + j] =
            (a[(y * w + l) * 3 + j] + a[(y * w + x) * 3 + j] + a[(y * w + r) * 3 + j]) / 3
        }
      }
    }
    ;[a, b] = [b, a]
    for (let y = 0; y < h; y++) {
      const u = Math.max(0, y - 1)
      const d = Math.min(h - 1, y + 1)
      for (let x = 0; x < w; x++) {
        for (let j = 0; j < 3; j++) {
          b[(y * w + x) * 3 + j] =
            (a[(u * w + x) * 3 + j] + a[(y * w + x) * 3 + j] + a[(d * w + x) * 3 + j]) / 3
        }
      }
    }
    ;[a, b] = [b, a]
  }
  return a
}

function sampleBilinear(
  img: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
  into: Float32Array,
  amount: number
): void {
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)))
  const x1 = Math.min(w - 1, x0 + 1)
  const y1 = Math.min(h - 1, y0 + 1)
  const fx = clamp01(x - x0)
  const fy = clamp01(y - y0)
  for (let j = 0; j < 3; j++) {
    const top = img[(y0 * w + x0) * 3 + j] * (1 - fx) + img[(y0 * w + x1) * 3 + j] * fx
    const bot = img[(y1 * w + x0) * 3 + j] * (1 - fx) + img[(y1 * w + x1) * 3 + j] * fx
    into[j] += (top * (1 - fy) + bot * fy) * amount
  }
}
