import { luminance, toLinear, toSrgb } from './color'

// Pre-filters, run on the small output-sized image before dithering. Photos
// are low in contrast next to a 4- or 16-colour palette; a push here is what
// turns mud into crisp retro art. They work on sRGB values (how the sliders
// feel in every photo editor) and hand back linear light.

export interface Adjust {
  /** -0.5 … 0.5, added. */
  brightness: number
  /** 0 … 2, around mid-grey. */
  contrast: number
  /** 0 (grey) … 2. */
  saturation: number
  /** 0.4 … 2.5; above 1 lifts the shadows. */
  gamma: number
}

export const NEUTRAL: Adjust = { brightness: 0, contrast: 1, saturation: 1, gamma: 1 }

export function isNeutral(a: Adjust): boolean {
  return a.brightness === 0 && a.contrast === 1 && a.saturation === 1 && a.gamma === 1
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Applies the pre-filters to linear-light RGB, in place. */
export function applyAdjust(rgb: Float32Array, a: Adjust): void {
  if (isNeutral(a)) return
  const { brightness, contrast, saturation } = a
  const inv = 1 / a.gamma
  // Gamma as a table, so the loop has no pow().
  const gammaTable = new Float32Array(1025)
  for (let i = 0; i <= 1024; i++) gammaTable[i] = (i / 1024) ** inv
  const gamma =
    a.gamma === 1
      ? (v: number) => v
      : (v: number) => {
          const f = v * 1024
          const i = f | 0
          return i >= 1024 ? gammaTable[1024] : gammaTable[i] + (gammaTable[i + 1] - gammaTable[i]) * (f - i)
        }
  for (let i = 0; i < rgb.length; i += 3) {
    let r = toSrgb(rgb[i])
    let g = toSrgb(rgb[i + 1])
    let b = toSrgb(rgb[i + 2])
    if (saturation !== 1) {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
      r = l + (r - l) * saturation
      g = l + (g - l) * saturation
      b = l + (b - l) * saturation
    }
    r = clamp01((r - 0.5) * contrast + 0.5 + brightness)
    g = clamp01((g - 0.5) * contrast + 0.5 + brightness)
    b = clamp01((b - 0.5) * contrast + 0.5 + brightness)
    rgb[i] = toLinear(gamma(r))
    rgb[i + 1] = toLinear(gamma(g))
    rgb[i + 2] = toLinear(gamma(b))
  }
}

/** Turns linear-light RGB to grey (its luminance), in place. */
export function toGrey(rgb: Float32Array): void {
  for (let i = 0; i < rgb.length; i += 3) {
    const y = luminance(rgb[i], rgb[i + 1], rgb[i + 2])
    rgb[i] = rgb[i + 1] = rgb[i + 2] = y
  }
}

/**
 * Sharpens a grey image (unsharp mask against its 4 neighbours, in sRGB), in
 * place: the Game Boy Camera's edge boost.
 */
export function edgeBoost(rgb: Float32Array, width: number, height: number, amount: number): void {
  if (amount <= 0) return
  const v = new Float32Array(width * height)
  for (let i = 0; i < v.length; i++) v[i] = toSrgb(rgb[i * 3])
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const n = v[y > 0 ? i - width : i]
      const s = v[y < height - 1 ? i + width : i]
      const w = v[x > 0 ? i - 1 : i]
      const e = v[x < width - 1 ? i + 1 : i]
      const sharp = clamp01(v[i] + amount * 2 * (v[i] - (n + s + w + e) / 4))
      rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = toLinear(sharp)
    }
  }
}
