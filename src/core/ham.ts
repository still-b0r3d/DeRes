import { srgbToLinear, linearToByte } from './color'
import { quantizeRgb } from './quantize'

// Amiga HAM6 (Hold-And-Modify) simulation.
// 320×200, 12-bit hardware colour (4 bits / 16 levels per channel).
// Uses 16 base palette colours, and for each subsequent pixel across a scanline,
// either selects a base colour, or holds two channels and modifies the third (R, G, or B).
// This creates authentic horizontal transition fringing.

export interface Ham6Result {
  indices: Uint8Array
  rgb: Float32Array
  palette: Uint8Array // 16 base colours (48 bytes)
  usedColours: number
}

function distSq4(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const dr = r1 - r2
  const dg = g1 - g2
  const db = b1 - b2
  // Weighted RGB for perceptual sensitivity (2:4:1 approx)
  return 2 * dr * dr + 4 * dg * dg + db * db
}

/**
 * Encodes an image using Amiga HAM6 mode.
 */
export function processAmigaHam6(
  linearRgb: Float32Array,
  width: number,
  height: number,
  customBasePalette?: Uint8Array
): Ham6Result {
  const indices = new Uint8Array(width * height)
  const outRgb = new Float32Array(width * height * 3)
  const seenColours = new Set<number>()

  // 1. Determine the 16 base palette colours (4 bits per channel)
  let basePalette: Uint8Array
  if (customBasePalette && customBasePalette.length >= 48) {
    basePalette = customBasePalette.subarray(0, 48)
  } else {
    basePalette = quantizeRgb(linearRgb, 16, 4)
    if (basePalette.length < 48) {
      // Pad to 16 colours if image had fewer
      const padded = new Uint8Array(48)
      padded.set(basePalette)
      basePalette = padded
    }
  }

  // Pre-convert 16 base palette colours to 4-bit space (0..15)
  const baseR4 = new Uint8Array(16)
  const baseG4 = new Uint8Array(16)
  const baseB4 = new Uint8Array(16)
  for (let i = 0; i < 16; i++) {
    baseR4[i] = Math.round((basePalette[i * 3] * 15) / 255)
    baseG4[i] = Math.round((basePalette[i * 3 + 1] * 15) / 255)
    baseB4[i] = Math.round((basePalette[i * 3 + 2] * 15) / 255)
  }

  // 2. Scanline-by-scanline Hold-And-Modify
  for (let y = 0; y < height; y++) {
    let curR4 = 0
    let curG4 = 0
    let curB4 = 0

    for (let x = 0; x < width; x++) {
      const pIdx = y * width + x
      const i = pIdx * 3

      const tr8 = linearToByte(linearRgb[i])
      const tg8 = linearToByte(linearRgb[i + 1])
      const tb8 = linearToByte(linearRgb[i + 2])

      const tr4 = Math.round((tr8 * 15) / 255)
      const tg4 = Math.round((tg8 * 15) / 255)
      const tb4 = Math.round((tb8 * 15) / 255)

      if (x === 0) {
        // First pixel of each scanline must use a base palette colour
        let bestBase = 0
        let minD = Infinity
        for (let b = 0; b < 16; b++) {
          const d = distSq4(tr4, tg4, tb4, baseR4[b], baseG4[b], baseB4[b])
          if (d < minD) {
            minD = d
            bestBase = b
          }
        }
        curR4 = baseR4[bestBase]
        curG4 = baseG4[bestBase]
        curB4 = baseB4[bestBase]
        indices[pIdx] = bestBase
      } else {
        // Choice 0: Base palette
        let bestBase = 0
        let minBaseD = Infinity
        for (let b = 0; b < 16; b++) {
          const d = distSq4(tr4, tg4, tb4, baseR4[b], baseG4[b], baseB4[b])
          if (d < minBaseD) {
            minBaseD = d
            bestBase = b
          }
        }

        // Choice 1: Modify Blue (keep R, G)
        const dModB = distSq4(tr4, tg4, tb4, curR4, curG4, tb4)

        // Choice 2: Modify Red (keep G, B)
        const dModR = distSq4(tr4, tg4, tb4, tr4, curG4, curB4)

        // Choice 3: Modify Green (keep R, B)
        const dModG = distSq4(tr4, tg4, tb4, curR4, tg4, curB4)

        const bestErr = Math.min(minBaseD, dModB, dModR, dModG)

        if (bestErr === minBaseD) {
          curR4 = baseR4[bestBase]
          curG4 = baseG4[bestBase]
          curB4 = baseB4[bestBase]
          indices[pIdx] = bestBase
        } else if (bestErr === dModB) {
          curB4 = tb4
          indices[pIdx] = 16 + tb4 // control 01 (Modify Blue)
        } else if (bestErr === dModR) {
          curR4 = tr4
          indices[pIdx] = 32 + tr4 // control 10 (Modify Red)
        } else {
          curG4 = tg4
          indices[pIdx] = 48 + tg4 // control 11 (Modify Green)
        }
      }

      // 4-bit to 8-bit sRGB
      const r8 = Math.round((curR4 * 255) / 15)
      const g8 = Math.round((curG4 * 255) / 15)
      const b8 = Math.round((curB4 * 255) / 15)

      seenColours.add((curR4 << 8) | (curG4 << 4) | curB4)

      outRgb[i] = srgbToLinear(r8)
      outRgb[i + 1] = srgbToLinear(g8)
      outRgb[i + 2] = srgbToLinear(b8)
    }
  }

  return {
    indices,
    rgb: outRgb,
    palette: basePalette,
    usedColours: seenColours.size
  }
}
