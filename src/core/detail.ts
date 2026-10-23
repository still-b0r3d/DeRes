import { toLinear, toSrgb } from './color'

// "Detail": shrinking makes each machine pixel the average of the photo
// pixels it covers. That's right for light, but the thin lines a small
// picture lives on (eyes, outlines, stripes) are a sliver of each block and
// fade into it. An unsharp mask on the shrunk picture brings their contrast
// back. It works in sRGB: in linear light it darkens the dark lines far more
// than it lightens the light ones. It also fades out as the shrink does,
// because a picture that isn't shrunk has nothing lost to bring back.

/** Sharpening strength at Detail 100% (50%, the default, is 1). */
export const MAX_DETAIL = 2
/** The Detail setting a fresh page starts with. */
export const DEFAULT_DETAIL = 0.5

/**
 * The strength for a Detail setting (0–1) when each output pixel covers
 * `cover` photo pixels across and down: full from a 2× shrink, nothing at 1×.
 */
export function detailAmount(detail: number, cover: readonly [number, number]): number {
  const shrink = Math.sqrt(cover[0] * cover[1])
  const ramp = Math.min(1, Math.max(0, shrink - 1))
  return MAX_DETAIL * Math.min(1, Math.max(0, detail)) * ramp
}

/**
 * Sharpens a linear-light picture (r, g, b per pixel) against the mean of
 * each pixel's 3×3 neighbourhood (edges repeat). Returns a new buffer.
 */
export function keepDetail(rgb: Float32Array, w: number, h: number, amount: number): Float32Array {
  const n = w * h * 3
  const s = new Float32Array(n)
  for (let i = 0; i < n; i++) s[i] = toSrgb(rgb[i])
  // Sums of three across, then of three of those down.
  const across = new Float32Array(n)
  for (let y = 0; y < h; y++) {
    const row = y * w * 3
    for (let x = 0; x < w; x++) {
      const l = row + Math.max(0, x - 1) * 3
      const m = row + x * 3
      const r = row + Math.min(w - 1, x + 1) * 3
      for (let c = 0; c < 3; c++) across[m + c] = s[l + c] + s[m + c] + s[r + c]
    }
  }
  const out = new Float32Array(n)
  for (let y = 0; y < h; y++) {
    const up = Math.max(0, y - 1) * w * 3
    const row = y * w * 3
    const down = Math.min(h - 1, y + 1) * w * 3
    for (let k = 0; k < w * 3; k++) {
      const v = s[row + k]
      const mean = (across[up + k] + across[row + k] + across[down + k]) / 9
      out[row + k] = toLinear(v + amount * (v - mean))
    }
  }
  return out
}
