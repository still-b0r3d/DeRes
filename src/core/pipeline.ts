import { applyAdjust, edgeBoost, toGrey, type Adjust } from './adjust'
import { BYTE_TO_LINEAR, hexToRgb, luminance, toSrgb } from './color'
import { dither, PS1_DITHER_TABLE, type DitherId } from './dither'
import type { Fx } from './fx'
import { planGeometry, type Fit, type Geometry } from './geometry'
import { PaletteMatcher } from './matcher'
import { DEFAULT_PROFILE, profileById, representativePalette, type Profile } from './profiles'
import { quantizeRgb, snapToBits } from './quantize'
import { resampleArea } from './resample'
import { YliluomaPlanner } from './yliluoma'

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
      return {
        width,
        height,
        indices,
        palette: palBytes,
        rgb: out,
        used,
        geometry: g,
        paper: [255, 255, 255]
      }
    }

    let pal: PaletteState
    if (profile.palette.kind === 'fixed') {
      pal = this.palette(profile)
    } else {
      let display: Uint8Array
      if (s.customPalette && s.customPalette.length > 0) {
        display = Uint8Array.from(s.customPalette.map(hexToRgb).flat())
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
    const l = pal.lightest * 3
    return {
      width,
      height,
      indices,
      palette: pal.display,
      rgb: out,
      used,
      geometry: g,
      paper: [pal.display[l], pal.display[l + 1], pal.display[l + 2]]
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
