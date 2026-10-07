import { hexToRgb, srgbToLinear, linearToByte } from './color'

// Per-cell graphics constraints for authentic vintage hardware:
// 1. ZX Spectrum: 8×8 cells, 1 ink + 1 paper color per cell, both normal or both bright.
// 2. C64 Multicolour: 4×8 double-width cells, 1 shared background + 3 colors per cell.
// 3. NES Attributes: 16×16 blocks, 4 hardware palettes of 3 colors + 1 shared backdrop.
// 4. Apple II Hi-Res: 280×192, 7-pixel byte rule with high-bit palette select.

// --- ZX Spectrum ---

export const SPECTRUM_NORMAL: readonly string[] = [
  '#000000', // 0 Black
  '#0000d7', // 1 Blue
  '#d70000', // 2 Red
  '#d700d7', // 3 Magenta
  '#00d700', // 4 Green
  '#00d7d7', // 5 Cyan
  '#d7d700', // 6 Yellow
  '#d7d7d7'  // 7 White
]

export const SPECTRUM_BRIGHT: readonly string[] = [
  '#000000', // 0 Black
  '#0000ff', // 1 Blue
  '#ff0000', // 2 Red
  '#ff00ff', // 3 Magenta
  '#00ff00', // 4 Green
  '#00ffff', // 5 Cyan
  '#ffff00', // 6 Yellow
  '#ffffff'  // 7 White
]

// All 15 distinct ZX Spectrum colours
export const SPECTRUM_PALETTE: readonly string[] = [
  '#000000',
  '#0000d7', '#d70000', '#d700d7', '#00d700', '#00d7d7', '#d7d700', '#d7d7d7',
  '#0000ff', '#ff0000', '#ff00ff', '#00ff00', '#00ffff', '#ffff00', '#ffffff'
]

const SPECTRUM_NORMAL_RGB = SPECTRUM_NORMAL.map(hexToRgb)
const SPECTRUM_BRIGHT_RGB = SPECTRUM_BRIGHT.map(hexToRgb)

function colorDistSq(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const dr = r1 - r2
  const dg = g1 - g2
  const db = b1 - b2
  return dr * dr + dg * dg + db * db
}

export interface SpectrumCellResult {
  indices: Uint8Array
  rgb: Float32Array
  attributes: Uint8Array // 768 bytes (32×24)
  bitmap: Uint8Array     // 6144 bytes
}

/**
 * Applies ZX Spectrum attribute clash to a 256×192 image.
 * Each 8×8 cell selects an ink and paper color from either the Normal or Bright palette.
 */
export function processSpectrum(
  linearRgb: Float32Array,
  width: number,
  height: number
): SpectrumCellResult {
  const indices = new Uint8Array(width * height)
  const outRgb = new Float32Array(width * height * 3)
  const attributes = new Uint8Array(32 * 24)
  const bitmap = new Uint8Array(6144)

  const srgbBytes = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    srgbBytes[i * 3] = linearToByte(linearRgb[i * 3])
    srgbBytes[i * 3 + 1] = linearToByte(linearRgb[i * 3 + 1])
    srgbBytes[i * 3 + 2] = linearToByte(linearRgb[i * 3 + 2])
  }

  const cellsX = Math.floor(width / 8)
  const cellsY = Math.floor(height / 8)

  for (let cy = 0; cy < cellsY; cy++) {
    for (let cx = 0; cx < cellsX; cx++) {
      const cellIndex = cy * cellsX + cx

      // Find average luminance of cell to decide brightness bias
      let sumLum = 0
      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px++) {
          const pi = ((cy * 8 + py) * width + (cx * 8 + px)) * 3
          sumLum += 0.299 * srgbBytes[pi] + 0.587 * srgbBytes[pi + 1] + 0.114 * srgbBytes[pi + 2]
        }
      }
      const avgLum = sumLum / 64

      // Evaluate candidate ink/paper pairs for both normal and bright
      let bestBright = avgLum > 110 ? 1 : 0
      let bestInk = 0
      let bestPaper = 7
      let minErr = Infinity

      // Test candidate palettes: test both normal and bright
      for (const bright of [0, 1]) {
        const pal = bright ? SPECTRUM_BRIGHT_RGB : SPECTRUM_NORMAL_RGB
        for (let i = 0; i < 8; i++) {
          for (let p = i; p < 8; p++) {
            let err = 0
            const [ir, ig, ib] = pal[i]
            const [pr, pg, pb] = pal[p]

            for (let py = 0; py < 8; py++) {
              for (let px = 0; px < 8; px++) {
                const idx = ((cy * 8 + py) * width + (cx * 8 + px)) * 3
                const r = srgbBytes[idx]
                const g = srgbBytes[idx + 1]
                const b = srgbBytes[idx + 2]

                const dInk = colorDistSq(r, g, b, ir, ig, ib)
                const dPaper = colorDistSq(r, g, b, pr, pg, pb)
                err += Math.min(dInk, dPaper)
              }
            }

            if (err < minErr) {
              minErr = err
              bestBright = bright
              bestInk = i
              bestPaper = p
            }
          }
        }
      }

      const pal = bestBright ? SPECTRUM_BRIGHT_RGB : SPECTRUM_NORMAL_RGB
      const [ir, ig, ib] = pal[bestInk]
      const [pr, pg, pb] = pal[bestPaper]

      // Spectrum attribute byte: [flash:0][bright:1][paper:3][ink:3]
      attributes[cellIndex] = (bestBright << 6) | (bestPaper << 3) | bestInk

      // Map pixels in the cell to ink or paper
      for (let py = 0; py < 8; py++) {
        const y = cy * 8 + py
        let byteVal = 0

        for (let px = 0; px < 8; px++) {
          const x = cx * 8 + px
          const pIndex = y * width + x
          const idx = pIndex * 3

          const r = srgbBytes[idx]
          const g = srgbBytes[idx + 1]
          const b = srgbBytes[idx + 2]

          const dInk = colorDistSq(r, g, b, ir, ig, ib)
          const dPaper = colorDistSq(r, g, b, pr, pg, pb)

          const isInk = dInk <= dPaper
          if (isInk) {
            byteVal |= 1 << (7 - px)
            indices[pIndex] = bestBright ? (bestInk === 0 ? 0 : bestInk + 7) : bestInk
            outRgb[idx] = srgbToLinear(ir)
            outRgb[idx + 1] = srgbToLinear(ig)
            outRgb[idx + 2] = srgbToLinear(ib)
          } else {
            indices[pIndex] = bestBright ? (bestPaper === 0 ? 0 : bestPaper + 7) : bestPaper
            outRgb[idx] = srgbToLinear(pr)
            outRgb[idx + 1] = srgbToLinear(pg)
            outRgb[idx + 2] = srgbToLinear(pb)
          }
        }

        // Spectrum screen memory interleaving for bitmap
        if (xWithinSpectrum(cx, y)) {
          const addr = spectrumBitmapOffset(cx, y)
          bitmap[addr] = byteVal
        }
      }
    }
  }

  return { indices, rgb: outRgb, attributes, bitmap }
}

function xWithinSpectrum(cx: number, y: number): boolean {
  return cx >= 0 && cx < 32 && y >= 0 && y < 192
}

/** Computes the authentic ZX Spectrum bitmap memory offset for (cellX, scanlineY). */
export function spectrumBitmapOffset(cx: number, y: number): number {
  const block = Math.floor(y / 64)       // 0..2
  const lineInRow = y % 8               // 0..7
  const rowInBlock = Math.floor((y % 64) / 8) // 0..7
  return (block << 11) | (lineInRow << 8) | (rowInBlock << 5) | cx
}

// --- Commodore 64 Multicolour ---

export const C64_PALETTE: readonly string[] = [
  '#000000', '#ffffff', '#813338', '#75cec8', '#8e3c97', '#56ac4d', '#2e2c9b', '#edf171',
  '#8e5029', '#553800', '#c46c71', '#4a4a4a', '#7b7b7b', '#a9ff9f', '#706deb', '#b2b2b2'
]

const C64_RGB = C64_PALETTE.map(hexToRgb)

export interface C64McResult {
  indices: Uint8Array
  rgb: Float32Array
  koalaData: Uint8Array // 10,003 bytes
}

/**
 * Applies C64 Multicolour mode (160×200, 2:1 pixels, 4×8 double-width cells).
 * 1 shared background color + 3 cell colors per 4×8 cell.
 */
export function processC64Multicolour(
  linearRgb: Float32Array,
  width: number,
  height: number,
  forcedBackground = 0 // 0 = Black
): C64McResult {
  const indices = new Uint8Array(width * height)
  const outRgb = new Float32Array(width * height * 3)

  // Koala Painter format:
  // 2 bytes load addr ($6000 = 0x00, 0x60)
  // 8000 bytes bitmap
  // 1000 bytes screen RAM
  // 1000 bytes color RAM
  // 1 byte background color
  const koala = new Uint8Array(10003)
  koala[0] = 0x00
  koala[1] = 0x60
  const bgCol = Math.max(0, Math.min(15, forcedBackground))
  koala[10002] = bgCol

  const srgbBytes = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    srgbBytes[i * 3] = linearToByte(linearRgb[i * 3])
    srgbBytes[i * 3 + 1] = linearToByte(linearRgb[i * 3 + 1])
    srgbBytes[i * 3 + 2] = linearToByte(linearRgb[i * 3 + 2])
  }

  const cellsX = Math.floor(width / 4) // 40
  const cellsY = Math.floor(height / 8) // 25

  for (let cy = 0; cy < cellsY; cy++) {
    for (let cx = 0; cx < cellsX; cx++) {
      const cellIdx = cy * cellsX + cx

      // Count color affinity in the 4×8 cell
      const colorCounts = new Float32Array(16)
      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 4; px++) {
          const idx = ((cy * 8 + py) * width + (cx * 4 + px)) * 3
          const r = srgbBytes[idx]
          const g = srgbBytes[idx + 1]
          const b = srgbBytes[idx + 2]

          let nearest = 0
          let minD = Infinity
          for (let c = 0; c < 16; c++) {
            const [cr, cg, cb] = C64_RGB[c]
            const d = colorDistSq(r, g, b, cr, cg, cb)
            if (d < minD) {
              minD = d
              nearest = c
            }
          }
          colorCounts[nearest]++
        }
      }

      // Pick top 3 colors distinct from background
      const nonBg: { color: number; count: number }[] = []
      for (let c = 0; c < 16; c++) {
        if (c !== bgCol && colorCounts[c] > 0) {
          nonBg.push({ color: c, count: colorCounts[c] })
        }
      }
      nonBg.sort((a, b) => b.count - a.count)

      const c1 = nonBg[0]?.color ?? (bgCol === 1 ? 0 : 1)
      const c2 = nonBg[1]?.color ?? (bgCol === 2 ? 0 : 2)
      const c3 = nonBg[2]?.color ?? (bgCol === 7 ? 0 : 7)

      // Koala screen RAM: high nibble = c1, low nibble = c2
      koala[8002 + cellIdx] = ((c1 & 0x0f) << 4) | (c2 & 0x0f)
      // Koala color RAM: low nibble = c3
      koala[9002 + cellIdx] = c3 & 0x0f

      const cellPalette = [bgCol, c1, c2, c3]
      const cellRgb = cellPalette.map((c) => C64_RGB[c])

      // Render pixels in 4×8 cell
      for (let py = 0; py < 8; py++) {
        const y = cy * 8 + py
        let byteVal = 0

        for (let px = 0; px < 4; px++) {
          const x = cx * 4 + px
          const pIndex = y * width + x
          const idx = pIndex * 3

          const r = srgbBytes[idx]
          const g = srgbBytes[idx + 1]
          const b = srgbBytes[idx + 2]

          let bestPattern = 0
          let minD = Infinity
          for (let p = 0; p < 4; p++) {
            const [cr, cg, cb] = cellRgb[p]
            const d = colorDistSq(r, g, b, cr, cg, cb)
            if (d < minD) {
              minD = d
              bestPattern = p
            }
          }

          byteVal |= (bestPattern & 3) << ((3 - px) * 2)
          indices[pIndex] = cellPalette[bestPattern]
          const [cr, cg, cb] = cellRgb[bestPattern]
          outRgb[idx] = srgbToLinear(cr)
          outRgb[idx + 1] = srgbToLinear(cg)
          outRgb[idx + 2] = srgbToLinear(cb)
        }

        const bitmapOffset = 2 + (cellIdx * 8 + py)
        if (bitmapOffset < 8002) {
          koala[bitmapOffset] = byteVal
        }
      }
    }
  }

  return { indices, rgb: outRgb, koalaData: koala }
}

// --- NES Attribute Mode ---

export const NES_PALETTE: readonly string[] = [
  '#7c7c7c', '#0000fc', '#0000bc', '#4428bc', '#940084', '#a80020', '#a81000', '#881400',
  '#503000', '#007800', '#006800', '#005800', '#004058', '#000000',
  '#bcbcbc', '#0078f8', '#0058f8', '#6844fc', '#d800cc', '#e40058', '#f83800', '#e45c10',
  '#ac7c00', '#00b800', '#00a800', '#00a844', '#008888',
  '#f8f8f8', '#3cbcfc', '#6888fc', '#9878f8', '#f878f8', '#f85898', '#f87858', '#fca044',
  '#f8b800', '#b8f818', '#58d854', '#58f898', '#00e8d8', '#787878',
  '#fcfcfc', '#a4e4fc', '#b8b8f8', '#d8b8f8', '#f8b8f8', '#f8a4c0', '#f0d0b0', '#fce0a8',
  '#f8d878', '#d8f878', '#b8f8b8', '#b8f8d8', '#00fcfc', '#f8d8f8'
]

const NES_RGB = NES_PALETTE.map(hexToRgb)

/**
 * Applies NES attribute constraints: 16×16 blocks, 4 sub-palettes of 3 colours + 1 shared backdrop.
 */
export function processNesAttributes(
  linearRgb: Float32Array,
  width: number,
  height: number
): { indices: Uint8Array; rgb: Float32Array } {
  const indices = new Uint8Array(width * height)
  const outRgb = new Float32Array(width * height * 3)

  const srgbBytes = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    srgbBytes[i * 3] = linearToByte(linearRgb[i * 3])
    srgbBytes[i * 3 + 1] = linearToByte(linearRgb[i * 3 + 1])
    srgbBytes[i * 3 + 2] = linearToByte(linearRgb[i * 3 + 2])
  }

  // 1 shared backdrop colour (NES entry 13 is Black '#000000')
  const backdropIndex = 13

  // Four classic NES 3-colour sets:
  // Palette 0: Cool / Blue (#0078f8, #6888fc, #f8f8f8)
  // Palette 1: Warm / Red-Orange (#e40058, #f87858, #fce0a8)
  // Palette 2: Nature / Green (#00a800, #b8f818, #f8d878)
  // Palette 3: Earth / Neutral (#503000, #ac7c00, #bcbcbc)
  const subPalettes = [
    [backdropIndex, 15, 29, 27],
    [backdropIndex, 19, 34, 47],
    [backdropIndex, 24, 36, 48],
    [backdropIndex, 8, 22, 14]
  ]

  const blocksX = Math.ceil(width / 16)
  const blocksY = Math.ceil(height / 16)

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      // Find best sub-palette for this 16×16 area
      let bestPal = 0
      let minErr = Infinity

      for (let p = 0; p < 4; p++) {
        let err = 0
        const pColors = subPalettes[p].map((idx) => NES_RGB[idx])
        for (let py = 0; py < 16; py++) {
          const y = by * 16 + py
          if (y >= height) continue
          for (let px = 0; px < 16; px++) {
            const x = bx * 16 + px
            if (x >= width) continue

            const i = (y * width + x) * 3
            const r = srgbBytes[i]
            const g = srgbBytes[i + 1]
            const b = srgbBytes[i + 2]

            let dMin = Infinity
            for (let c = 0; c < 4; c++) {
              const [cr, cg, cb] = pColors[c]
              const d = colorDistSq(r, g, b, cr, cg, cb)
              if (d < dMin) dMin = d
            }
            err += dMin
          }
        }

        if (err < minErr) {
          minErr = err
          bestPal = p
        }
      }

      const activePal = subPalettes[bestPal]
      const activeRgb = activePal.map((idx) => NES_RGB[idx])

      // Render pixels in 16×16 area
      for (let py = 0; py < 16; py++) {
        const y = by * 16 + py
        if (y >= height) continue
        for (let px = 0; px < 16; px++) {
          const x = bx * 16 + px
          if (x >= width) continue

          const pIdx = y * width + x
          const i = pIdx * 3

          const r = srgbBytes[i]
          const g = srgbBytes[i + 1]
          const b = srgbBytes[i + 2]

          let bestC = 0
          let minD = Infinity
          for (let c = 0; c < 4; c++) {
            const [cr, cg, cb] = activeRgb[c]
            const d = colorDistSq(r, g, b, cr, cg, cb)
            if (d < minD) {
              minD = d
              bestC = c
            }
          }

          indices[pIdx] = activePal[bestC]
          const [cr, cg, cb] = activeRgb[bestC]
          outRgb[i] = srgbToLinear(cr)
          outRgb[i + 1] = srgbToLinear(cg)
          outRgb[i + 2] = srgbToLinear(cb)
        }
      }
    }
  }

  return { indices, rgb: outRgb }
}

// --- Apple II Hi-Res ---

export const APPLE2_HIRES_PALETTE: readonly string[] = [
  '#000000', // 0 Black
  '#14f53c', // 1 Green (odd, bit 7=0)
  '#e31e60', // 2 Violet (even, bit 7=0)
  '#ffffff', // 3 White
  '#000000', // 4 Black
  '#ff6a3c', // 5 Orange (odd, bit 7=1)
  '#14cffd', // 6 Blue (even, bit 7=1)
  '#ffffff'  // 7 White
]

const A2_PAL0 = ['#000000', '#14f53c', '#e31e60', '#ffffff'].map(hexToRgb)
const A2_PAL1 = ['#000000', '#ff6a3c', '#14cffd', '#ffffff'].map(hexToRgb)

/**
 * Applies Apple II Hi-Res 7-pixel byte rule (280×192, 40 bytes per line).
 * High bit selects Green/Violet or Orange/Blue palette.
 */
export function processApple2Hires(
  linearRgb: Float32Array,
  width: number,
  height: number
): { indices: Uint8Array; rgb: Float32Array } {
  const indices = new Uint8Array(width * height)
  const outRgb = new Float32Array(width * height * 3)

  const srgbBytes = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    srgbBytes[i * 3] = linearToByte(linearRgb[i * 3])
    srgbBytes[i * 3 + 1] = linearToByte(linearRgb[i * 3 + 1])
    srgbBytes[i * 3 + 2] = linearToByte(linearRgb[i * 3 + 2])
  }

  const bytesX = Math.floor(width / 7)

  for (let y = 0; y < height; y++) {
    for (let bx = 0; bx < bytesX; bx++) {
      // Evaluate palette 0 (Green/Violet) vs palette 1 (Orange/Blue)
      let err0 = 0
      let err1 = 0

      for (let px = 0; px < 7; px++) {
        const x = bx * 7 + px
        const i = (y * width + x) * 3
        const r = srgbBytes[i]
        const g = srgbBytes[i + 1]
        const b = srgbBytes[i + 2]

        const isOdd = x % 2 === 1
        // Allowed in Pal 0: Black, White, and (Green if odd, Violet if even)
        const cColor0 = isOdd ? A2_PAL0[1] : A2_PAL0[2]
        const d0 = Math.min(
          colorDistSq(r, g, b, A2_PAL0[0][0], A2_PAL0[0][1], A2_PAL0[0][2]),
          colorDistSq(r, g, b, A2_PAL0[3][0], A2_PAL0[3][1], A2_PAL0[3][2]),
          colorDistSq(r, g, b, cColor0[0], cColor0[1], cColor0[2])
        )
        err0 += d0

        // Allowed in Pal 1: Black, White, and (Orange if odd, Blue if even)
        const cColor1 = isOdd ? A2_PAL1[1] : A2_PAL1[2]
        const d1 = Math.min(
          colorDistSq(r, g, b, A2_PAL1[0][0], A2_PAL1[0][1], A2_PAL1[0][2]),
          colorDistSq(r, g, b, A2_PAL1[3][0], A2_PAL1[3][1], A2_PAL1[3][2]),
          colorDistSq(r, g, b, cColor1[0], cColor1[1], cColor1[2])
        )
        err1 += d1
      }

      const usePal1 = err1 < err0
      const activePal = usePal1 ? A2_PAL1 : A2_PAL0

      for (let px = 0; px < 7; px++) {
        const x = bx * 7 + px
        const pIdx = y * width + x
        const i = pIdx * 3

        const r = srgbBytes[i]
        const g = srgbBytes[i + 1]
        const b = srgbBytes[i + 2]

        const isOdd = x % 2 === 1
        const chromatic = isOdd ? activePal[1] : activePal[2]
        const chromaticIdx = usePal1 ? (isOdd ? 5 : 6) : (isOdd ? 1 : 2)

        const dBlack = colorDistSq(r, g, b, activePal[0][0], activePal[0][1], activePal[0][2])
        const dWhite = colorDistSq(r, g, b, activePal[3][0], activePal[3][1], activePal[3][2])
        const dChrom = colorDistSq(r, g, b, chromatic[0], chromatic[1], chromatic[2])

        let chosenIdx = 0
        let [cr, cg, cb] = activePal[0]
        if (dWhite <= dBlack && dWhite <= dChrom) {
          chosenIdx = usePal1 ? 7 : 3
          ;[cr, cg, cb] = activePal[3]
        } else if (dChrom <= dBlack && dChrom <= dWhite) {
          chosenIdx = chromaticIdx
          ;[cr, cg, cb] = chromatic
        }

        indices[pIdx] = chosenIdx
        outRgb[i] = srgbToLinear(cr)
        outRgb[i + 1] = srgbToLinear(cg)
        outRgb[i + 2] = srgbToLinear(cb)
      }
    }
  }

  return { indices, rgb: outRgb }
}
