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
import { resampleArea } from './resample'
import { analyzeTileFit, encodeGbChr, type HardwareFitReport } from './tiles'
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

export interface DeresSettings {
  profileId: string
  fit: Fit
  resolution: 'native' | 'custom'
  block: number
  /** What shows through transparent parts of the photo. */
  background: 'white' | 'black'
  adjust: Adjust
  dither: DitherId
  fx: Fx
  /** Raw square pixels, or the machine's pixel shape (as on a TV). */
  pixelShape: 'raw' | 'tv'
  /** For custom N colours or range custom count */
  customCount?: number
  /** For loaded custom palette files */
  customPalette?: readonly string[]
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
  private resized: { key: string; rgb: Float32Array } | null = null
  private readonly palettes = new Map<string, PaletteState>()

  /** Takes the decoded working copy (sRGB bytes, r, g, b, a per pixel). */
  setSource(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, origW: number, origH: number) {
    const data = new Float32Array(width * height * 4)
    let hasAlpha = false
    for (let i = 0; i < width * height; i++) {
      const a = rgba[i * 4 + 3] / 255
      if (a < 1) hasAlpha = true
      data[i * 4] = BYTE_TO_LINEAR[rgba[i * 4]] * a
      data[i * 4 + 1] = BYTE_TO_LINEAR[rgba[i * 4 + 1]] * a
      data[i * 4 + 2] = BYTE_TO_LINEAR[rgba[i * 4 + 2]] * a
      data[i * 4 + 3] = a
    }
    this.source = { width, height, origW, origH, data }
    this.resized = null
    return { hasAlpha }
  }

  get hasSource(): boolean {
    return this.source !== null
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
    const part = this.resize(src, g, s.background)
    const rgb = new Float32Array(width * height * 3)
    const bars = dst.w !== width || dst.h !== height
    for (let y = 0; y < dst.h; y++) {
      rgb.set(part.subarray(y * dst.w * 3, (y + 1) * dst.w * 3), ((dst.y + y) * width + dst.x) * 3)
    }

    applyAdjust(rgb, s.adjust)
    if (profile.mono) {
      toGrey(rgb)
      if (profile.edgeBoost) edgeBoost(rgb, width, height, profile.edgeBoost)
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
          if (bars && (y < dst.y || y >= dst.y + dst.h || x < dst.x || x >= dst.x + dst.w)) {
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
      const tileFit = profile.limits ? analyzeTileFit(indices, width, height, profile.limits) : undefined
      return {
        width,
        height,
        indices,
        palette: palBytes,
        rgb: out,
        used,
        geometry: g,
        paper: [255, 255, 255],
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
          emuData = encodeGbChr(cellIndices, width, height)
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
          emuData = encodeGbChr(cellIndices, width, height)
          emuFormat = 'chr'
        }
      } else {
        const a2 = processApple2Hires(rgb, width, height)
        cellIndices = a2.indices
        cellLinearRgb = a2.rgb
      }

      if (bars) {
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            if (y < dst.y || y >= dst.y + dst.h || x < dst.x || x >= dst.x + dst.w) {
              const i = y * width + x
              cellIndices[i] = 0
              cellLinearRgb[i * 3] = 0
              cellLinearRgb[i * 3 + 1] = 0
              cellLinearRgb[i * 3 + 2] = 0
            }
          }
        }
      }

      const out = new Uint8Array(width * height * 3)
      for (let i = 0; i < width * height * 3; i++) {
        out[i] = linearToByte(cellLinearRgb[i])
      }

      const palBytes = cellPalBytes ?? paletteBytes(profile)
      const seen = new Uint8Array(Math.max(256, palBytes.length / 3))
      let used = 0
      for (let i = 0; i < cellIndices.length; i++) {
        const idx = cellIndices[i]
        if (!seen[idx]) {
          seen[idx] = 1
          used++
        }
      }

      const tileFit = profile.limits ? analyzeTileFit(cellIndices, width, height, profile.limits) : undefined
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
        tileFit,
        emulatorData: emu
      }
    }

    // Amiga HAM6
    if (profile.palette.kind === 'ham') {
      const ham = processAmigaHam6(rgb, width, height)
      if (bars) {
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

      const tileFit = profile.limits ? analyzeTileFit(ham.indices, width, height, profile.limits) : undefined

      return {
        width,
        height,
        indices: ham.indices,
        palette: ham.palette,
        rgb: out,
        used: ham.usedColours,
        geometry: g,
        paper: findLightest(ham.palette),
        tileFit
      }
    }

    // Nintendo 64 3-point sample + VI blur
    if (profile.palette.kind === 'n64') {
      const n64 = processN64(rgb, width, height)
      if (bars) {
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
        const key = (r << 16) | (g << 8) | b
        if (!seen.has(key)) {
          seen.add(key)
          if (palList.length < 256 * 3) {
            palList.push(r, g, b)
          }
        }
      }

      const palBytes = Uint8Array.from(palList.length > 0 ? palList : [0, 0, 0])
      const tileFit = profile.limits ? analyzeTileFit(n64.indices, width, height, profile.limits) : undefined

      return {
        width,
        height,
        indices: n64.indices,
        palette: palBytes,
        rgb: out,
        used: seen.size,
        geometry: g,
        paper: [255, 255, 255],
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

      if (bars) {
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
        const key = (r << 16) | (g << 8) | b
        if (!seen.has(key)) {
          seen.add(key)
          if (palList.length < 256 * 3) {
            palList.push(r, g, b)
          }
        }
      }

      const palBytes = Uint8Array.from(palList.length > 0 ? palList : [0, 0, 0])
      const tileFit = profile.limits ? analyzeTileFit(res.indices, width, height, profile.limits) : undefined

      return {
        width,
        height,
        indices: res.indices,
        palette: palBytes,
        rgb: out,
        used: seen.size,
        geometry: g,
        paper: res.paper,
        tileFit
      }
    }

    let pal: PaletteState
    if (profile.palette.kind === 'fixed') {
      pal = this.palette(profile)
    } else {
      let display: Uint8Array
      if (s.customPalette && s.customPalette.length > 0) {
        display = Uint8Array.from(s.customPalette.map(hexToRgb).flat())
      } else if (profile.palette.kind === 'pool') {
        const count = s.customCount ?? profile.palette.count
        display = quantizeFromPool(rgb, profile.palette.pool, count)
        if (display.length === 0) display = paletteBytes(profile)
      } else {
        const count = s.customCount ?? ('count' in profile.palette ? profile.palette.count : 16)
        const bits = profile.palette.kind === 'range' ? profile.palette.bitsPerChannel : 8
        display = quantizeRgb(rgb, count, bits)
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
        planner: () => (pal.planner ??= new YliluomaPlanner(pal.matcher))
      },
      indices
    )
    if (bars) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (y < dst.y || y >= dst.y + dst.h || x < dst.x || x >= dst.x + dst.w) {
            indices[y * width + x] = pal.darkest
          }
        }
      }
    }

    const out = new Uint8Array(width * height * 3)
    const seen = new Uint8Array(256)
    let used = 0
    for (let i = 0; i < indices.length; i++) {
      const k = indices[i]
      if (!seen[k]) {
        seen[k] = 1
        used++
      }
      out[i * 3] = pal.display[k * 3]
      out[i * 3 + 1] = pal.display[k * 3 + 1]
      out[i * 3 + 2] = pal.display[k * 3 + 2]
    }

    const tileFit = profile.limits ? analyzeTileFit(indices, width, height, profile.limits) : undefined
    let emu: { format: 'scr' | 'koa' | 'chr'; data: Uint8Array; defaultName: string } | undefined
    if (profile.limits?.emulatorFormats?.includes('chr')) {
      emu = {
        format: 'chr',
        data: encodeGbChr(indices, width, height),
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
      used,
      geometry: g,
      paper: [pal.display[l], pal.display[l + 1], pal.display[l + 2]],
      tileFit,
      emulatorData: emu
    }
  }

  private resize(src: Source, g: Geometry, background: 'white' | 'black'): Float32Array {
    const { src: r, dst } = g
    const key = [r.x, r.y, r.w, r.h, dst.w, dst.h, background].join('|')
    if (this.resized?.key === key) return this.resized.rgb
    const premul = resampleArea(src.data, src.width, src.height, r, dst.w, dst.h, 4)
    const bg = background === 'white' ? 1 : 0
    const rgb = new Float32Array(dst.w * dst.h * 3)
    for (let i = 0; i < dst.w * dst.h; i++) {
      const under = bg * (1 - premul[i * 4 + 3])
      rgb[i * 3] = premul[i * 4] + under
      rgb[i * 3 + 1] = premul[i * 4 + 1] + under
      rgb[i * 3 + 2] = premul[i * 4 + 2] + under
    }
    this.resized = { key, rgb }
    return rgb
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

/** Exports above this many pixels are refused (phones can't hold them). */
export const MAX_EXPORT_PIXELS = 4096 * 4096
