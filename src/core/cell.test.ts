import { describe, expect, it } from 'vitest'
import {
  processSpectrum,
  processC64Multicolour,
  processNesAttributes,
  processApple2Hires,
  processMsxScreen2,
  processGbcTiles,
  spectrumBitmapOffset
} from './cell'

describe('cell mode processing', () => {
  it('ZX Spectrum respects 1 ink + 1 paper per 8×8 cell', () => {
    // 16×8 test image (2 cells wide, 1 cell high)
    const w = 16
    const h = 8
    const rgb = new Float32Array(w * h * 3)

    // Fill left cell with red/blue, right cell with green/yellow
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        // Red
        rgb[(y * w + x) * 3] = 1.0
      }
      for (let x = 8; x < 16; x++) {
        // Green
        rgb[(y * w + x) * 3 + 1] = 1.0
      }
    }

    const res = processSpectrum(rgb, w, h)
    expect(res.indices.length).toBe(w * h)
    expect(res.rgb.length).toBe(w * h * 3)
    expect(res.attributes.length).toBe(32 * 24)
    expect(res.bitmap.length).toBe(6144)

    // Check that each 8×8 cell has at most 2 distinct colours
    const cell0Colours = new Set<number>()
    const cell1Colours = new Set<number>()
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) cell0Colours.add(res.indices[y * w + x])
      for (let x = 8; x < 16; x++) cell1Colours.add(res.indices[y * w + x])
    }
    expect(cell0Colours.size).toBeLessThanOrEqual(2)
    expect(cell1Colours.size).toBeLessThanOrEqual(2)
  })

  it('computes correct Spectrum memory addresses', () => {
    // Top-left line 0
    expect(spectrumBitmapOffset(0, 0)).toBe(0)
    // Line 1 of same character row is +256 (0x100)
    expect(spectrumBitmapOffset(0, 1)).toBe(256)
    // Row 1 (y=8) of block 0 is +32 (0x20)
    expect(spectrumBitmapOffset(0, 8)).toBe(32)
    // Block 1 (y=64) starts at 2048 (0x800)
    expect(spectrumBitmapOffset(0, 64)).toBe(2048)
  })

  it('C64 Multicolour produces valid Koala format with 4 colours per cell', () => {
    const w = 160
    const h = 200
    const rgb = new Float32Array(w * h * 3)

    // Gradient
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3
        rgb[i] = x / w
        rgb[i + 1] = y / h
        rgb[i + 2] = 0.5
      }
    }

    const res = processC64Multicolour(rgb, w, h, 0)
    expect(res.koalaData.length).toBe(10003)
    // Load address is $6000
    expect(res.koalaData[0]).toBe(0x00)
    expect(res.koalaData[1]).toBe(0x60)
    // Background byte at end is 0
    expect(res.koalaData[10002]).toBe(0)

    // In any 4×8 cell, at most 4 colours are used
    const cellColours = new Set<number>()
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 4; x++) {
        cellColours.add(res.indices[y * w + x])
      }
    }
    expect(cellColours.size).toBeLessThanOrEqual(4)
  })

  it('NES Attribute mode maps 16×16 blocks to 4-colour sub-palettes', () => {
    const w = 32
    const h = 32
    const rgb = new Float32Array(w * h * 3)
    for (let i = 0; i < w * h * 3; i++) rgb[i] = 0.5

    const res = processNesAttributes(rgb, w, h)
    expect(res.indices.length).toBe(w * h)
    expect(res.rgb.length).toBe(w * h * 3)

    // For any 16×16 block, at most 4 distinct colours
    const block0 = new Set<number>()
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        block0.add(res.indices[y * w + x])
      }
    }
    expect(block0.size).toBeLessThanOrEqual(4)
  })

  it('Apple II Hi-Res respects 7-pixel byte rule', () => {
    const w = 28
    const h = 4
    const rgb = new Float32Array(w * h * 3)
    for (let i = 0; i < w * h * 3; i++) rgb[i] = 0.8

    const res = processApple2Hires(rgb, w, h)
    expect(res.indices.length).toBe(w * h)
    expect(res.rgb.length).toBe(w * h * 3)
    for (let i = 0; i < w * h; i++) {
      expect(res.indices[i]).toBeGreaterThanOrEqual(0)
      expect(res.indices[i]).toBeLessThanOrEqual(7)
    }
  })

  it('MSX Screen 2 enforces max 2 colours per 8×1 horizontal pixel row', () => {
    const w = 16
    const h = 8
    const rgb = new Float32Array(w * h * 3)
    // Put different colours across each row
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3
        rgb[i] = (x % 3 === 0) ? 1.0 : 0.0
        rgb[i + 1] = (x % 3 === 1) ? 1.0 : 0.0
        rgb[i + 2] = (x % 3 === 2) ? 1.0 : 0.0
      }
    }

    const res = processMsxScreen2(rgb, w, h)
    expect(res.indices.length).toBe(w * h)
    expect(res.rgb.length).toBe(w * h * 3)

    // Check each 8×1 row
    for (let y = 0; y < h; y++) {
      for (let bx = 0; bx < w; bx += 8) {
        const rowColours = new Set<number>()
        for (let x = 0; x < 8 && bx + x < w; x++) {
          rowColours.add(res.indices[y * w + (bx + x)])
        }
        expect(rowColours.size).toBeLessThanOrEqual(2)
      }
    }
  })

  it('Game Boy Color per-tile mode clusters into 8 palettes of 4 colors', () => {
    const w = 160
    const h = 144
    const rgb = new Float32Array(w * h * 3)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3
        rgb[i] = x / w
        rgb[i + 1] = y / h
        rgb[i + 2] = (x + y) / (w + h)
      }
    }

    const res = processGbcTiles(rgb, w, h)
    expect(res.indices.length).toBe(w * h)
    expect(res.rgb.length).toBe(w * h * 3)
    expect(res.palette.length).toBe(96) // 32 colors * 3 sRGB

    // Check that each 8×8 tile uses at most 4 colors
    for (let ty = 0; ty < 18; ty++) {
      for (let tx = 0; tx < 20; tx++) {
        const tileColours = new Set<number>()
        for (let py = 0; py < 8; py++) {
          for (let px = 0; px < 8; px++) {
            tileColours.add(res.indices[(ty * 8 + py) * w + (tx * 8 + px)])
          }
        }
        expect(tileColours.size).toBeLessThanOrEqual(4)
      }
    }
  })
})

describe('NES attributes keep each pixel\'s place in its sub-palette', () => {
  it('colour numbers point into the block\'s sub-palette, and 0 is the shared backdrop', () => {
    const w = 64
    const h = 48
    const rgb = new Float32Array(w * h * 3)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3
        rgb[i] = x / w
        rgb[i + 1] = y / h
        rgb[i + 2] = ((x + y) % 7) / 7
      }
    }
    const res = processNesAttributes(rgb, w, h)
    const across = Math.ceil(w / 16)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const pal = res.subPalettes[res.blockPalettes[(y >> 4) * across + (x >> 4)]]
        expect(res.colourNumbers[i]).toBeLessThan(4)
        expect(pal[res.colourNumbers[i]]).toBe(res.indices[i])
      }
    }
    const backdrop = res.subPalettes[0][0]
    for (const pal of res.subPalettes) expect(pal[0]).toBe(backdrop)
  })
})
