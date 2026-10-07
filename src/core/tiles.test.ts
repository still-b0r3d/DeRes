import { describe, expect, it } from 'vitest'
import { analyzeTileFit, encodeGbChr, encodeGbTile } from './tiles'

describe('tile analysis and Game Boy CHR encoding', () => {
  it('counts unique tiles and flags VRAM limits', () => {
    // 16×16 image = 4 tiles total
    const w = 16
    const h = 16
    const indices = new Uint8Array(w * h)

    // Make 2 identical tiles and 2 different tiles
    // Tile 0: all 0s
    // Tile 1: all 0s (identical to 0)
    // Tile 2: all 1s
    // Tile 3: checkerboard
    for (let y = 8; y < 16; y++) {
      for (let x = 0; x < 8; x++) indices[y * w + x] = 1
      for (let x = 8; x < 16; x++) indices[y * w + x] = (x + y) % 2
    }

    const report = analyzeTileFit(indices, w, h, { maxTiles: 2, maxColours: 4 })
    expect(report.totalTiles).toBe(4)
    expect(report.uniqueTiles).toBe(3)
    expect(report.maxTiles).toBe(2)
    expect(report.tilesFit).toBe(false) // 3 > 2
    expect(report.summary).toContain('3 / 2 tiles (+1 over limit)')
  })

  it('correctly encodes a Game Boy 8×8 tile into 2BPP planar format', () => {
    const tile = new Uint8Array(64)
    // Row 0: pixel 0 is colour 3 (binary 11), pixel 1 is colour 2 (binary 10), pixel 2 is colour 1 (binary 01)
    tile[0] = 3
    tile[1] = 2
    tile[2] = 1

    const bytes = encodeGbTile(tile)
    expect(bytes.length).toBe(16)
    // Row 0 low byte: bit 7 (col 0) = 1, bit 6 (col 1) = 0, bit 5 (col 2) = 1 -> 0b10100000 = 0xa0
    expect(bytes[0]).toBe(0xa0)
    // Row 0 high byte: bit 7 (col 0) = 1, bit 6 (col 1) = 1, bit 5 (col 2) = 0 -> 0b11000000 = 0xc0
    expect(bytes[1]).toBe(0xc0)
  })

  it('encodes deduplicated CHR bank', () => {
    const w = 16
    const h = 8 // 2 tiles
    const indices = new Uint8Array(w * h) // Both tiles identical (all 0s)

    const chrDeduplicated = encodeGbChr(indices, w, h, true)
    expect(chrDeduplicated.length).toBe(16) // Only 1 unique tile

    const chrRaw = encodeGbChr(indices, w, h, false)
    expect(chrRaw.length).toBe(32) // Both tiles kept
  })
})
