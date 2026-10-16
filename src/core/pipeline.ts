import { applyAdjust, edgeBoost, toGrey, type Adjust } from './adjust'
import {
  processSpectrum,
  processC64Multicolour,
  processNesAttributes,
  processApple2Hires,
  processMsxScreen2,
  processGbcTiles
} from './cell'
import { BYTE_TO_LINEAR, hexToRgb, linearToByte, luminance, toSrgb } from './color'
import { dither, PS1_DITHER_TABLE, type DitherId } from './dither'
import type { Fx } from './fx'
import { planGeometry, type Fit, type Geometry } from './geometry'
import { processAmigaHam6 } from './ham'
import { PaletteMatcher } from './matcher'
import { processN64 } from './n64'
import { DEFAULT_PROFILE, profileById, representativePalette, type Profile } from './profiles'
import { quantizeRgb, snapToBits, quantizeFromPool } from './quantize'
import { resampleArea, type Rect } from './resample'
import type { SignalSettings } from './signal'
import { analyzeTileFit, encodeGbChr, encodeNesChr, type HardwareFitReport } from './tiles'
import { YliluomaPlanner } from './yliluoma'
import {
  processEarlyCcd,
  processDeepFry,
  processNewspaperHalftone,
  processRisograph,
  processFax,
  type AnalogResult
} from './analog'

// The DeRes pipeline: working copy -> crop and area-average to the machine's
// resolution -> pre-filters -> dither to its palette. It keeps the working
// copy (linear light) and the last resize, so moving a slider only redoes the
// cheap steps on a few thousand pixels.
//
// Transparent parts of the photo either sit on white or black, or stay
// see-through ('transparent'). Then a machine pixel shows when at least half
// of it was covered, and the rest are hidden: the machines had no
// half-transparent pixels, and GIF and indexed PNG can't hold them either.
// Under the hidden pixels the picture's own edge colours carry on outward,
// so the dither, the per-cell colour picking and every effect that blurs or
// bleeds see more of the picture there, never a fill colour: the edge gets
// no light or dark fringe. The mask (Rendered.alpha) then cuts the result.

export type Background = 'white' | 'black' | 'transparent'

/** Coverage from which a machine pixel shows, with the background 'transparent'. */
export const ALPHA_THRESHOLD = 0.5

export interface DeresSettings {
  profileId: string
  fit: Fit
  resolution: 'native' | 'custom'
  block: number
  /** What shows through transparent parts of the photo; 'transparent' keeps them see-through. */
  background: Background
  adjust: Adjust
  dither: DitherId
  fx: Fx
  /** Raw square pixels, or the machine's pixel shape (as on a TV). */
  pixelShape: 'raw' | 'tv'
  /** For custom N colours or range custom count */
  customCount?: number
  /** For loaded custom palette files */
  customPalette?: readonly string[]
  /** Dither coordinate offsets for animation cycles */
  ditherOffset?: readonly [number, number]
  /** The analog signal between the picture and the screen (off when missing). */
  signal?: SignalSettings
  /**
   * Replaces a fixed palette, entry for entry: the colours the signal really
   * makes from CGA composite's bit patterns, so the dither aims at what the TV
   * will show (set by the worker, never saved).
   */
  fixedPalette?: readonly string[]
}

export interface Rendered {
  width: number
  height: number
  /** One palette index per pixel. */
  indices: Uint8Array
  /** The machine's colours, r, g, b per entry (what the indices point at). */
  palette: Uint8Array
  /** The picture, r, g, b per pixel. */
  rgb: Uint8Array
  /** How many of the palette's colours the picture uses. */
  used: number
  geometry: Geometry
  /** The palette's lightest colour (LCD screens show it between pixels). */
  paper: [number, number, number]
  /**
   * Which pixels show (255) and which are see-through (0), with the
   * background 'transparent'; missing or null when every pixel shows.
   */
  alpha?: Uint8Array | null
  tileFit?: HardwareFitReport
  emulatorData?: {
    format: 'scr' | 'koa' | 'chr'
    data: Uint8Array
    defaultName: string
  }
}

interface Source {
  width: number
  height: number
  origW: number
  origH: number
  /** Linear light, premultiplied by alpha: r, g, b, a per pixel. */
  data: Float32Array
  /** It has see-through parts (an animated GIF: any of its frames does). */
  hasAlpha: boolean
}

interface PaletteState {
  /** Shown colours (for grey-level machines: darkest first). */
  display: Uint8Array
  /** Matched colours; for grey-level machines, even grey steps in the same order. */
  matcher: PaletteMatcher
  planner: YliluomaPlanner | null
  /** Index of the darkest entry (the bars in "fit"). */
  darkest: number
  lightest: number
}

/** The most colours the colours slider can ask for on a machine (null: no slider). */
export function maxColourCount(profile: Profile): number | null {
  if (profile.palette.kind === 'range' || profile.palette.kind === 'pool') return profile.palette.count
  if (profile.palette.kind === 'custom') return 256
  return null
}

/**
 * How many colours a range, pool or Custom machine picks from the photo: the
 * machine's own count, or fewer when the colours slider asks (customCount),
 * never more than the machine had and never fewer than 2. Null for machines
 * with a fixed palette or their own colour rules.
 */
export function colourCount(profile: Profile, customCount?: number): number | null {
  const max = maxColourCount(profile)
  if (max === null || !('count' in profile.palette)) return null
  const want = typeof customCount === 'number' && Number.isFinite(customCount) ? Math.round(customCount) : profile.palette.count
  return Math.min(max, Math.max(2, want))
}

/**
 * The "of N" in "N of M colours used": how many colours the machine's list
 * holds. Null for machines with no list (15-bit direct colour, HAM, the N64
 * filter, the analog looks), whose palette is just the first colours seen.
 */
export function colourTotal(profile: Profile, palette: Uint8Array): number | null {
  const k = profile.palette.kind
  if (k === 'direct' || k === 'ham' || k === 'n64' || k === 'analog') return null
  return palette.length / 3
}

/**
 * Whether a dither choice changes the picture on a machine. Machines with
 * their own colour rules (per-cell clash, HAM, the N64 filter, the analog
 * looks) never dither; the PlayStation has only its own hardware dither.
 */
export function ditherApplies(profile: Profile, id: DitherId): boolean {
  const kind = profile.palette.kind
  if (kind === 'cell' || kind === 'ham' || kind === 'n64' || kind === 'analog') return false
  if (kind === 'direct') return id === 'none' || id === 'ps1'
  return true
}

/** One line saying why some dithers are greyed out on a machine, or null. */
export function ditherNote(profile: Profile): string | null {
  const kind = profile.palette.kind
  if (kind === 'cell') return 'This machine picks its colours cell by cell, so dithering doesn’t apply.'
  if (kind === 'ham' || kind === 'n64' || kind === 'analog') return 'This look makes its own colours, so dithering doesn’t apply.'
  if (kind === 'direct') return 'The PlayStation has only its own hardware dither (or none).'
  return null
}

export function paletteBytes(profile: Profile, customPalette?: readonly string[]): Uint8Array {
  const hexes =
    profile.palette.kind === 'custom' && customPalette && customPalette.length > 0
      ? customPalette
      : representativePalette(profile.palette)
  const colours = hexes.map(hexToRgb)
  if (profile.mono) {
    colours.sort((a, b) => lum(a) - lum(b))
  }
  return Uint8Array.from(colours.flat())
}

function lum([r, g, b]: readonly number[]): number {
  return luminance(BYTE_TO_LINEAR[r], BYTE_TO_LINEAR[g], BYTE_TO_LINEAR[b])
}

/**
 * Gives every hidden pixel the colour of the nearest shown one (a flood
 * outward from the edge, a step at a time), so the picture carries on under
 * them. With nothing shown they stay black.
 */
function spreadEdges(rgb: Float32Array, alpha: Uint8Array, w: number, h: number): void {
  const n = w * h
  const queue = new Int32Array(n)
  const reached = new Uint8Array(n)
  let tail = 0
  for (let i = 0; i < n; i++) {
    if (alpha[i]) {
      reached[i] = 1
      queue[tail++] = i
    }
  }
  for (let head = 0; head < tail; head++) {
    const i = queue[head]
    const x = i % w
    for (let k = 0; k < 4; k++) {
      const j = k === 0 ? (x > 0 ? i - 1 : -1) : k === 1 ? (x < w - 1 ? i + 1 : -1) : k === 2 ? i - w : i + w
      if (j < 0 || j >= n || reached[j]) continue
      reached[j] = 1
      rgb[j * 3] = rgb[i * 3]
      rgb[j * 3 + 1] = rgb[i * 3 + 1]
      rgb[j * 3 + 2] = rgb[i * 3 + 2]
      queue[tail++] = j
    }
  }
}

/** Each pixel of the "fit" bars takes the colour of the picture's nearest pixel. */
function extendIntoBars(rgb: Float32Array, width: number, height: number, dst: Rect): void {
  for (let y = 0; y < height; y++) {
    const sy = Math.min(dst.y + dst.h - 1, Math.max(dst.y, y))
    for (let x = 0; x < width; x++) {
      if (y >= dst.y && y < dst.y + dst.h && x >= dst.x && x < dst.x + dst.w) continue
      const s = (sy * width + Math.min(dst.x + dst.w - 1, Math.max(dst.x, x))) * 3
      rgb.copyWithin((y * width + x) * 3, s, s + 3)
    }
  }
}

/** Only the pixels that show, 3 floats each. */
function shownPixels(rgb: Float32Array, alpha: Uint8Array): Float32Array {
  let n = 0
  for (let i = 0; i < alpha.length; i++) if (alpha[i]) n++
  const out = new Float32Array(n * 3)
  for (let i = 0, o = 0; i < alpha.length; i++) {
    if (!alpha[i]) continue
    out.set(rgb.subarray(i * 3, i * 3 + 3), o)
    o += 3
  }
  return out
}

/** How many different indices the shown pixels use. */
function usedIndices(indices: Uint8Array, alpha: Uint8Array | null): number {
  const seen = new Uint8Array(256)
  let used = 0
  for (let i = 0; i < indices.length; i++) {
    if ((alpha && !alpha[i]) || seen[indices[i]]) continue
    seen[indices[i]] = 1
    used++
  }
  return used
}

/** How many different colours the shown pixels have (r, g, b bytes). */
function usedColours(rgb: Uint8Array, alpha: Uint8Array): number {
  const seen = new Set<number>()
  for (let i = 0; i < alpha.length; i++) if (alpha[i]) seen.add((rgb[i * 3] << 16) | (rgb[i * 3 + 1] << 8) | rgb[i * 3 + 2])
  return seen.size
}

/** Tile colour numbers with the hidden pixels as colour 0, which sprites show as see-through. */
function hiddenAsZero(numbers: Uint8Array, alpha: Uint8Array | null): Uint8Array {
  return alpha ? numbers.map((v, i) => (alpha[i] ? v : 0)) : numbers
}

function findLightest(display: Uint8Array): [number, number, number] {
  if (display.length < 3) return [255, 255, 255]
  let best = 0
  let maxLum = -1
  for (let i = 0; i < display.length / 3; i++) {
    const y = lum([display[i * 3], display[i * 3 + 1], display[i * 3 + 2]])
    if (y > maxLum) {
      maxLum = y
      best = i
    }
  }
  return [display[best * 3], display[best * 3 + 1], display[best * 3 + 2]]
}

export class Deres {
  private source: Source | null = null
  private resized: { key: string; rgb: Float32Array; alpha: Uint8Array | null } | null = null
  private readonly palettes = new Map<string, PaletteState>()

  /**
   * Takes the decoded working copy (sRGB bytes, r, g, b, a per pixel).
   * `animationHasAlpha`: it's a frame of an animation with see-through parts
   * somewhere, so kept transparency applies to it even if it has none.
   */
  setSource(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, origW: number, origH: number, animationHasAlpha = false) {
    // The frames of an animated GIF come through here one after another, all
    // the same size: they reuse one buffer rather than leave a new one behind each time.
    const old = this.source?.data
    const data = old && old.length === width * height * 4 ? old : new Float32Array(width * height * 4)
    let hasAlpha = false
    for (let i = 0; i < width * height; i++) {
      const a = rgba[i * 4 + 3] / 255
      if (a < 1) hasAlpha = true
      data[i * 4] = BYTE_TO_LINEAR[rgba[i * 4]] * a
      data[i * 4 + 1] = BYTE_TO_LINEAR[rgba[i * 4 + 1]] * a
      data[i * 4 + 2] = BYTE_TO_LINEAR[rgba[i * 4 + 2]] * a
      data[i * 4 + 3] = a
    }
    this.source = { width, height, origW, origH, data, hasAlpha: hasAlpha || animationHasAlpha }
    this.resized = null
    return { hasAlpha }
  }

  get hasSource(): boolean {
    return this.source !== null
  }

  /** The picture has see-through parts, which the background 'transparent' keeps. */
  get hasAlpha(): boolean {
    return !!this.source?.hasAlpha
  }

  render(s: DeresSettings): Rendered {
    const src = this.source
    if (!src) throw new Error('No picture loaded')
    const profile = profileById(s.profileId) ?? profileById(DEFAULT_PROFILE)!
    const g = planGeometry({
      srcW: src.width,
      srcH: src.height,
      origW: src.origW,
      origH: src.origH,
      profile,
      resolution: s.resolution,
      block: s.block,
      fit: s.fit
    })
    const { width, height, dst } = g

    // Resize (cached until the framing changes), then lay it on the frame.
    // A picture with nothing see-through (the choice is hidden then) comes
    // out as it always did, black bars included.
    const background = s.background === 'transparent' && !src.hasAlpha ? 'white' : s.background
    const part = this.resize(src, g, background)
    const rgb = new Float32Array(width * height * 3)
    const bars = dst.w !== width || dst.h !== height
    for (let y = 0; y < dst.h; y++) {
      rgb.set(part.rgb.subarray(y * dst.w * 3, (y + 1) * dst.w * 3), ((dst.y + y) * width + dst.x) * 3)
    }
    // Kept transparency: the "fit" bars are see-through too, and the
    // picture's edge carries on into them like everywhere else.
    const keep = background === 'transparent'
    let alpha: Uint8Array | null = null
    if (keep && (bars || part.alpha)) {
      alpha = new Uint8Array(width * height)
      for (let y = 0; y < dst.h; y++) {
        const o = (dst.y + y) * width + dst.x
        if (part.alpha) alpha.set(part.alpha.subarray(y * dst.w, (y + 1) * dst.w), o)
        else alpha.fill(255, o, o + dst.w)
      }
      if (bars) extendIntoBars(rgb, width, height, dst)
    }
    const blackBars = bars && !keep

    applyAdjust(rgb, s.adjust)
    if (profile.mono) {
      toGrey(rgb)
      if (profile.edgeBoost) edgeBoost(rgb, width, height, profile.edgeBoost)
    }
    // "Fit" bars go in pure black (the adjustments above would have tinted
    // them), so a machine's own file (.scr, .koa, .chr) holds them as shown.
    if (blackBars) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (y < dst.y || y >= dst.y + dst.h || x < dst.x || x >= dst.x + dst.w) rgb.fill(0, (y * width + x) * 3, (y * width + x) * 3 + 3)
        }
      }
    }

    // Direct PlayStation 15-bit hardware dither
    if (profile.palette.kind === 'direct' && (s.dither === 'ps1' || profile.dither === 'ps1')) {
      const out = new Uint8Array(width * height * 3)
      const indices = new Uint8Array(width * height)
      const seen = new Map<number, number>()
      const palList: number[] = []
      let used = 0

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x
          let r = 0, g = 0, b = 0
          if (blackBars && (y < dst.y || y >= dst.y + dst.h || x < dst.x || x >= dst.x + dst.w)) {
            r = 0; g = 0; b = 0
          } else {
            const d = s.dither === 'ps1' ? PS1_DITHER_TABLE[(y & 3) * 4 + (x & 3)] : 0
            const r8 = Math.min(255, Math.max(0, Math.round(toSrgb(rgb[i * 3]) * 255 + d)))
            const g8 = Math.min(255, Math.max(0, Math.round(toSrgb(rgb[i * 3 + 1]) * 255 + d)))
            const b8 = Math.min(255, Math.max(0, Math.round(toSrgb(rgb[i * 3 + 2]) * 255 + d)))
            r = snapToBits(r8, 5)
            g = snapToBits(g8, 5)
            b = snapToBits(b8, 5)
          }
          out[i * 3] = r
          out[i * 3 + 1] = g
          out[i * 3 + 2] = b
          // A hidden pixel's colour doesn't count as used.
          if (alpha && !alpha[i]) continue

          const key = (r << 16) | (g << 8) | b
          let idx = seen.get(key)
          if (idx === undefined) {
            idx = seen.size
            seen.set(key, idx)
            used++
            if (palList.length < 256 * 3) {
              palList.push(r, g, b)
            }
          }
          indices[i] = idx < 256 ? idx : 0
        }
      }
      const palBytes = Uint8Array.from(palList.length > 0 ? palList : [0, 0, 0])
      const tileFit = profile.limits ? analyzeTileFit(indices, width, height, profile.limits, alpha) : undefined
      return {
        width,
        height,
        indices,
        palette: palBytes,
        rgb: out,
        used,
        geometry: g,
        paper: [255, 255, 255],
        alpha,
        tileFit
      }
    }

    // Per-cell vintage hardware constraints
    if (profile.palette.kind === 'cell') {
      const mode = profile.palette.mode
      let cellIndices: Uint8Array
      let cellLinearRgb: Float32Array
      let emuData: Uint8Array | undefined
      let emuFormat: 'scr' | 'koa' | 'chr' | undefined

      let cellPalBytes: Uint8Array | undefined

      if (mode === 'spectrum') {
        const spec = processSpectrum(rgb, width, height)
        cellIndices = spec.indices
        cellLinearRgb = spec.rgb
        const scr = new Uint8Array(6912)
        scr.set(spec.bitmap, 0)
        scr.set(spec.attributes, 6144)
        emuData = scr
        emuFormat = 'scr'
      } else if (mode === 'c64-mc') {
        const mc = processC64Multicolour(rgb, width, height)
        cellIndices = mc.indices
        cellLinearRgb = mc.rgb
        emuData = mc.koalaData
        emuFormat = 'koa'
      } else if (mode === 'nes-attr') {
        const na = processNesAttributes(rgb, width, height)
        cellIndices = na.indices
        cellLinearRgb = na.rgb
        if (profile.limits?.emulatorFormats?.includes('chr')) {
          // NES tiles hold each pixel's number in its sub-palette, not the colour.
          emuData = encodeNesChr(hiddenAsZero(na.colourNumbers, alpha), width, height)
          emuFormat = 'chr'
        }
      } else if (mode === 'msx-screen2') {
        const msx = processMsxScreen2(rgb, width, height)
        cellIndices = msx.indices
        cellLinearRgb = msx.rgb
      } else if (mode === 'gbc-tile') {
        const gbc = processGbcTiles(rgb, width, height)
        cellIndices = gbc.indices
        cellLinearRgb = gbc.rgb
        cellPalBytes = gbc.palette
        if (profile.limits?.emulatorFormats?.includes('chr')) {
          emuData = encodeGbChr(hiddenAsZero(cellIndices, alpha), width, height)
          emuFormat = 'chr'
        }
      } else {
        const a2 = processApple2Hires(rgb, width, height)
        cellIndices = a2.indices
        cellLinearRgb = a2.rgb
      }

      // No repainting of the bars here: they went in black (or carry on the
      // edge, when they're see-through), and the machine's file must show
      // exactly what the preview shows.
      const out = new Uint8Array(width * height * 3)
      for (let i = 0; i < width * height * 3; i++) {
        out[i] = linearToByte(cellLinearRgb[i])
      }

      const palBytes = cellPalBytes ?? paletteBytes(profile)
      const used = usedIndices(cellIndices, alpha)

      const tileFit = profile.limits ? analyzeTileFit(cellIndices, width, height, profile.limits, alpha) : undefined
      const emu =
        emuData && emuFormat
          ? { format: emuFormat, data: emuData, defaultName: `${profile.id}.${emuFormat}` }
          : undefined

      return {
        width,
        height,
        indices: cellIndices,
        palette: palBytes,
        rgb: out,
        used,
        geometry: g,
        paper: findLightest(palBytes),
        alpha,
        tileFit,
        emulatorData: emu
      }
    }

    // Amiga HAM6
    if (profile.palette.kind === 'ham') {
      const ham = processAmigaHam6(rgb, width, height)
      if (blackBars) {
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (y < dst.y || y >= dst.y + dst.h || x < dst.x || x >= dst.x + dst.w) {
              const i = y * width + x
              ham.indices[i] = 0
              ham.rgb[i * 3] = 0
              ham.rgb[i * 3 + 1] = 0
              ham.rgb[i * 3 + 2] = 0
            }
          }
        }
      }

      const out = new Uint8Array(width * height * 3)
      for (let i = 0; i < width * height * 3; i++) {
        out[i] = linearToByte(ham.rgb[i])
      }

      const tileFit = profile.limits ? analyzeTileFit(ham.indices, width, height, profile.limits, alpha) : undefined

      return {
        width,
        height,
        indices: ham.indices,
        palette: ham.palette,
        rgb: out,
        used: alpha ? usedColours(out, alpha) : ham.usedColours,
        geometry: g,
        paper: findLightest(ham.palette),
        alpha,
        tileFit
      }
    }

    // Nintendo 64 3-point sample + VI blur
    if (profile.palette.kind === 'n64') {
      const n64 = processN64(rgb, width, height)
      if (blackBars) {
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (y < dst.y || y >= dst.y + dst.h || x < dst.x || x >= dst.x + dst.w) {
              const i = y * width + x
              n64.indices[i] = 0
              n64.rgb[i * 3] = 0
              n64.rgb[i * 3 + 1] = 0
              n64.rgb[i * 3 + 2] = 0
            }
          }
        }
      }

      const out = new Uint8Array(width * height * 3)
      const seen = new Set<number>()
      const palList: number[] = []
      for (let i = 0; i < width * height; i++) {
        const r = linearToByte(n64.rgb[i * 3])
        const g = linearToByte(n64.rgb[i * 3 + 1])
        const b = linearToByte(n64.rgb[i * 3 + 2])
        out[i * 3] = r
        out[i * 3 + 1] = g
        out[i * 3 + 2] = b
        if (alpha && !alpha[i]) continue
        const key = (r << 16) | (g << 8) | b
        if (!seen.has(key)) {
          seen.add(key)
          if (palList.length < 256 * 3) {
            palList.push(r, g, b)
          }
        }
      }

      const palBytes = Uint8Array.from(palList.length > 0 ? palList : [0, 0, 0])
      const tileFit = profile.limits ? analyzeTileFit(n64.indices, width, height, profile.limits, alpha) : undefined

      return {
        width,
        height,
        indices: n64.indices,
        palette: palBytes,
        rgb: out,
        used: seen.size,
        geometry: g,
        paper: [255, 255, 255],
        alpha,
        tileFit
      }
    }

    // Analog, print & video aesthetics (CCD, Deep Fry, Newspaper, Risograph, Fax)
    if (profile.palette.kind === 'analog') {
      let res: AnalogResult
      if (profile.palette.mode === 'ccd') {
        res = processEarlyCcd(rgb, width, height)
      } else if (profile.palette.mode === 'deepfry') {
        res = processDeepFry(rgb, width, height)
      } else if (profile.palette.mode === 'newspaper') {
        res = processNewspaperHalftone(rgb, width, height)
      } else if (profile.palette.mode === 'risograph') {
        res = processRisograph(rgb, width, height)
      } else {
        res = processFax(rgb, width, height)
      }

      if (blackBars) {
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (y < dst.y || y >= dst.y + dst.h || x < dst.x || x >= dst.x + dst.w) {
              const i = y * width + x
              res.indices[i] = 0
              res.rgb[i * 3] = 0
              res.rgb[i * 3 + 1] = 0
              res.rgb[i * 3 + 2] = 0
            }
          }
        }
      }

      const out = new Uint8Array(width * height * 3)
      const seen = new Set<number>()
      const palList: number[] = []
      for (let i = 0; i < width * height; i++) {
        const r = linearToByte(res.rgb[i * 3])
        const g = linearToByte(res.rgb[i * 3 + 1])
        const b = linearToByte(res.rgb[i * 3 + 2])
        out[i * 3] = r
        out[i * 3 + 1] = g
        out[i * 3 + 2] = b
        if (alpha && !alpha[i]) continue
        const key = (r << 16) | (g << 8) | b
        if (!seen.has(key)) {
          seen.add(key)
          if (palList.length < 256 * 3) {
            palList.push(r, g, b)
          }
        }
      }

      const palBytes = Uint8Array.from(palList.length > 0 ? palList : [0, 0, 0])
      const tileFit = profile.limits ? analyzeTileFit(res.indices, width, height, profile.limits, alpha) : undefined

      return {
        width,
        height,
        indices: res.indices,
        palette: palBytes,
        rgb: out,
        used: seen.size,
        geometry: g,
        paper: res.paper,
        alpha,
        tileFit
      }
    }

    let pal: PaletteState
    if (profile.palette.kind === 'fixed') {
      const own = profile.palette.colours.length
      pal = s.fixedPalette?.length === own ? this.paletteFrom(profile, s.fixedPalette) : this.palette(profile)
    } else {
      let display: Uint8Array
      // The colours are picked from the pixels that show.
      const picked = alpha ? shownPixels(rgb, alpha) : rgb
      // A grabbed or loaded palette belongs to the Custom machine only.
      if (profile.palette.kind === 'custom' && s.customPalette && s.customPalette.length > 0) {
        display = Uint8Array.from(s.customPalette.map(hexToRgb).flat())
      } else if (profile.palette.kind === 'pool') {
        const count = colourCount(profile, s.customCount)!
        display = quantizeFromPool(picked, profile.palette.pool, count)
        if (display.length === 0) display = paletteBytes(profile)
      } else {
        const count = colourCount(profile, s.customCount) ?? 16
        const bits = profile.palette.kind === 'range' ? profile.palette.bitsPerChannel : 8
        display = quantizeRgb(picked, count, bits)
        if (display.length === 0) display = paletteBytes(profile)
      }
      pal = this.createPaletteState(display, !!profile.mono)
    }

    // A machine's own dither only applies to that machine.
    const ditherId =
      (s.dither === 'gbcam' && profile.nativeDither !== 'gbcam') ||
      (s.dither === 'ps1' && profile.nativeDither !== 'ps1')
        ? profile.dither
        : s.dither

    const indices = new Uint8Array(width * height)
    dither(
      ditherId,
      {
        rgb,
        width,
        height,
        matcher: pal.matcher,
        mono: !!profile.mono,
        planner: () => (pal.planner ??= new YliluomaPlanner(pal.matcher)),
        offsetX: s.ditherOffset?.[0],
        offsetY: s.ditherOffset?.[1]
      },
      indices
    )
    if (blackBars) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (y < dst.y || y >= dst.y + dst.h || x < dst.x || x >= dst.x + dst.w) {
            indices[y * width + x] = pal.darkest
          }
        }
      }
    }

    const out = new Uint8Array(width * height * 3)
    for (let i = 0; i < indices.length; i++) {
      const k = indices[i]
      out[i * 3] = pal.display[k * 3]
      out[i * 3 + 1] = pal.display[k * 3 + 1]
      out[i * 3 + 2] = pal.display[k * 3 + 2]
    }

    const tileFit = profile.limits ? analyzeTileFit(indices, width, height, profile.limits, alpha) : undefined
    let emu: { format: 'scr' | 'koa' | 'chr'; data: Uint8Array; defaultName: string } | undefined
    if (profile.limits?.emulatorFormats?.includes('chr')) {
      // Grey-level indices count darkest first; a Game Boy's colour 0 is the
      // lightest (with the usual palette register), so they are turned round.
      const n = pal.display.length / 3
      const numbers = profile.mono ? indices.map((v) => n - 1 - v) : indices
      emu = {
        format: 'chr',
        data: encodeGbChr(hiddenAsZero(numbers, alpha), width, height),
        defaultName: `${profile.id}.chr`
      }
    }

    const l = pal.lightest * 3
    return {
      width,
      height,
      indices,
      palette: pal.display,
      rgb: out,
      used: usedIndices(indices, alpha),
      geometry: g,
      paper: [pal.display[l], pal.display[l + 1], pal.display[l + 2]],
      alpha,
      tileFit,
      emulatorData: emu
    }
  }

  /**
   * The cropped part at the frame's size, linear light, 3 per pixel. On white
   * or black, the transparent parts are laid on it. Kept transparent, `alpha`
   * says which pixels show (null: all of them), each shown pixel has its own
   * colour (not darkened by the part of it that was see-through), and the
   * hidden ones carry on the colours of the nearest shown ones.
   */
  private resize(src: Source, g: Geometry, background: Background): { rgb: Float32Array; alpha: Uint8Array | null } {
    const { src: r, dst } = g
    const key = [r.x, r.y, r.w, r.h, dst.w, dst.h, background].join('|')
    if (this.resized?.key === key) return this.resized
    const premul = resampleArea(src.data, src.width, src.height, r, dst.w, dst.h, 4)
    const n = dst.w * dst.h
    const rgb = new Float32Array(n * 3)
    let alpha: Uint8Array | null = null
    if (background === 'transparent') {
      alpha = new Uint8Array(n)
      let hidden = 0
      for (let i = 0; i < n; i++) {
        const a = premul[i * 4 + 3]
        if (a >= ALPHA_THRESHOLD) {
          alpha[i] = 255
          rgb[i * 3] = premul[i * 4] / a
          rgb[i * 3 + 1] = premul[i * 4 + 1] / a
          rgb[i * 3 + 2] = premul[i * 4 + 2] / a
        } else hidden++
      }
      if (hidden === 0) alpha = null
      else spreadEdges(rgb, alpha, dst.w, dst.h)
    } else {
      const bg = background === 'white' ? 1 : 0
      for (let i = 0; i < n; i++) {
        const under = bg * (1 - premul[i * 4 + 3])
        rgb[i * 3] = premul[i * 4] + under
        rgb[i * 3 + 1] = premul[i * 4 + 1] + under
        rgb[i * 3 + 2] = premul[i * 4 + 2] + under
      }
    }
    this.resized = { key, rgb, alpha }
    return this.resized
  }

  private createPaletteState(display: Uint8Array, mono: boolean): PaletteState {
    const n = display.length / 3
    let match = display
    if (mono) {
      // Even grey steps: the machine's levels 0 … n-1, whatever their tint.
      match = new Uint8Array(n * 3)
      for (let i = 0; i < n; i++) match.fill(n === 1 ? 255 : Math.round((255 * i) / (n - 1)), i * 3, i * 3 + 3)
    }
    const matcher = new PaletteMatcher(match)
    let darkest = 0
    let lightest = 0
    for (let i = 0; i < n; i++) {
      const y = lum([display[i * 3], display[i * 3 + 1], display[i * 3 + 2]])
      if (y < lum([display[darkest * 3], display[darkest * 3 + 1], display[darkest * 3 + 2]])) darkest = i
      if (y > lum([display[lightest * 3], display[lightest * 3 + 1], display[lightest * 3 + 2]])) lightest = i
    }
    return { display, matcher, planner: null, darkest, lightest }
  }

  private palette(profile: Profile): PaletteState {
    const hit = this.palettes.get(profile.id)
    if (hit) return hit
    const display = paletteBytes(profile)
    const state = this.createPaletteState(display, !!profile.mono)
    this.palettes.set(profile.id, state)
    return state
  }

  /** A fixed palette with its colours replaced (same order), cached like the machine's own. */
  private paletteFrom(profile: Profile, colours: readonly string[]): PaletteState {
    const key = `${profile.id}:${colours.join('')}`
    const hit = this.palettes.get(key)
    if (hit) return hit
    if (this.palettes.size > 64) this.palettes.clear()
    const state = this.createPaletteState(Uint8Array.from(colours.map(hexToRgb).flat()), !!profile.mono)
    this.palettes.set(key, state)
    return state
  }
}

/** Size of an export at `multiplier`, optionally stretched to the pixel shape. */
export function exportSize(
  width: number,
  height: number,
  par: readonly [number, number],
  multiplier: number,
  tv: boolean
): [number, number] {
  const w = tv && par[0] !== par[1] ? Math.round((width * multiplier * par[0]) / par[1]) : width * multiplier
  return [w, height * multiplier]
}

/** The screen-effect preview's size at an enlargement, which can be in between whole sizes (while a GIF plays). */
export function previewFxSize(
  width: number,
  height: number,
  par: readonly [number, number],
  scale: number,
  tv: boolean
): [number, number] {
  const [w, h] = exportSize(width, height, par, scale, tv)
  return [Math.round(w), Math.round(h)]
}

/** Exports above this many pixels are refused (phones can't hold them). */
export const MAX_EXPORT_PIXELS = 4096 * 4096
