// Colour maths shared by every stage: sRGB <-> linear light, and OKLab
// (Björn Ottosson's perceptual colour space) for comparing colours.
//
// Pixels are stored and mixed in linear light (that's how light adds up, so
// dithering keeps the right brightness), and compared in OKLab (that's how
// different two colours look).

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
}

/** sRGB byte (0–255) to linear light (0–1). */
export const BYTE_TO_LINEAR = new Float32Array(256)
for (let i = 0; i < 256; i++) BYTE_TO_LINEAR[i] = srgbToLinear(i / 255)

// Linear light in 1/4096 steps to an sRGB byte. Fine enough that
// byte -> linear -> byte comes back exact for every byte.
const STEPS = 4096
const LINEAR_TO_BYTE = new Uint8Array(STEPS + 1)
for (let i = 0; i <= STEPS; i++) LINEAR_TO_BYTE[i] = Math.round(linearToSrgb(i / STEPS) * 255)

/** Linear light (any value, clamped to 0–1) to an sRGB byte. */
export function linearToByte(v: number): number {
  if (!(v > 0)) return 0
  if (v >= 1) return 255
  return LINEAR_TO_BYTE[(v * STEPS + 0.5) | 0]
}

// Tables with linear interpolation for the two curves, for the per-pixel
// adjustments (they keep more than 8 bits, which a byte table wouldn't).
function curveTable(fn: (x: number) => number): (x: number) => number {
  const t = new Float32Array(STEPS + 2)
  for (let i = 0; i <= STEPS; i++) t[i] = fn(i / STEPS)
  t[STEPS + 1] = t[STEPS]
  return (x) => {
    if (!(x > 0)) return t[0]
    if (x >= 1) return t[STEPS]
    const f = x * STEPS
    const i = f | 0
    return t[i] + (t[i + 1] - t[i]) * (f - i)
  }
}

/** Fast linearToSrgb for 0–1 (clamped). */
export const toSrgb = curveTable(linearToSrgb)
/** Fast srgbToLinear for 0–1 (clamped). */
export const toLinear = curveTable(srgbToLinear)

/** Linear-light RGB to OKLab, written to out[o], out[o+1], out[o+2]. */
export function linearToOklab(
  r: number,
  g: number,
  b: number,
  out: Float32Array | Float64Array | number[],
  o = 0
): void {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  out[o] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  out[o + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  out[o + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
}

/** Relative luminance (Rec. 709 / sRGB primaries) of a linear-light colour. */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** '#rrggbb' to [r, g, b] bytes. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`Not a colour: ${hex}`)
  const n = parseInt(m[1], 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)
}
