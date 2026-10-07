import { linearToByte, srgbToLinear } from './color'
import { snapToBits } from './quantize'

// Nintendo 64 hardware emulation:
// 1. 16-bit colour quantization (RGBA5551: 5 bits per channel = 32 levels, 32,768 colours).
// 2. RDP 3-point triangular sample filter + VI horizontal smoothing (the iconic "N64 blur").
// 3. TMEM constraint calculation (4 KB hardware texture memory limit).

export const N64_TMEM_BYTES = 4096

/**
 * Checks whether a texture of width × height at a given bit depth fits in the 4 KB TMEM.
 */
export function checkN64Tmem(
  w: number,
  h: number,
  format: 'rgba16' | 'rgba32' | 'ci8' | 'ci4' | 'i8' | 'i4'
): { bytes: number; fits: boolean; maxBytes: number; summary: string } {
  let bpp = 16
  if (format === 'rgba32') bpp = 32
  else if (format === 'ci8' || format === 'i8') bpp = 8
  else if (format === 'ci4' || format === 'i4') bpp = 4

  const bytes = Math.ceil((w * h * bpp) / 8)
  const fits = bytes <= N64_TMEM_BYTES
  const summary = fits
    ? `${w}×${h} ${format.toUpperCase()} (${bytes} B) fits in 4 KB TMEM`
    : `${w}×${h} ${format.toUpperCase()} (${bytes} B) exceeds 4 KB TMEM (+${bytes - N64_TMEM_BYTES} B)`

  return { bytes, fits, maxBytes: N64_TMEM_BYTES, summary }
}

/**
 * Simulates the N64 RDP 3-point triangular filter combined with VI horizontal anti-aliasing,
 * quantized to 15-bit color (5 bits per channel).
 */
export function processN64(
  linearRgb: Float32Array,
  width: number,
  height: number
): { indices: Uint8Array; rgb: Float32Array } {
  const indices = new Uint8Array(width * height)
  const outRgb = new Float32Array(width * height * 3)

  // Step 1: Quantize to 15-bit color (5 bits per channel: snap to 32 levels)
  const qRgb = new Float32Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    const r8 = linearToByte(linearRgb[i * 3])
    const g8 = linearToByte(linearRgb[i * 3 + 1])
    const b8 = linearToByte(linearRgb[i * 3 + 2])

    const r5 = snapToBits(r8, 5)
    const g5 = snapToBits(g8, 5)
    const b5 = snapToBits(b8, 5)

    qRgb[i * 3] = srgbToLinear(r5)
    qRgb[i * 3 + 1] = srgbToLinear(g5)
    qRgb[i * 3 + 2] = srgbToLinear(b5)
  }

  // Step 2: RDP 3-point triangular filter + VI blur
  // Samples (x, y) with 0.5 weight, and right (x+1, y) and below (x, y+1) with 0.25 weight each.
  // Then applies VI 3-tap horizontal blend [0.2, 0.6, 0.2].
  const filtered = new Float32Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    const nextY = Math.min(height - 1, y + 1)
    for (let x = 0; x < width; x++) {
      const nextX = Math.min(width - 1, x + 1)

      const cIdx = (y * width + x) * 3
      const rIdx = (y * width + nextX) * 3
      const dIdx = (nextY * width + x) * 3

      for (let c = 0; c < 3; c++) {
        // 3-point triangular filter: 50% center, 25% right, 25% down
        filtered[cIdx + c] = 0.5 * qRgb[cIdx + c] + 0.25 * qRgb[rIdx + c] + 0.25 * qRgb[dIdx + c]
      }
    }
  }

  // VI horizontal smoothing
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const prevX = Math.max(0, x - 1)
      const nextX = Math.min(width - 1, x + 1)

      const pIdx = (y * width + x)
      const cIdx = pIdx * 3
      const lIdx = (y * width + prevX) * 3
      const rIdx = (y * width + nextX) * 3

      for (let c = 0; c < 3; c++) {
        const v = 0.2 * filtered[lIdx + c] + 0.6 * filtered[cIdx + c] + 0.2 * filtered[rIdx + c]
        outRgb[cIdx + c] = v
      }

      // 15-bit index (r5 << 10 | g5 << 5 | b5)
      const r5 = (linearToByte(outRgb[cIdx]) >> 3) & 0x1f
      const g5 = (linearToByte(outRgb[cIdx + 1]) >> 3) & 0x1f
      const b5 = (linearToByte(outRgb[cIdx + 2]) >> 3) & 0x1f
      indices[pIdx] = ((r5 << 10) | (g5 << 5) | b5) & 0xff
    }
  }

  return { indices, rgb: outRgb }
}
