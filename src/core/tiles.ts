// "Would it fit?" hardware tile analysis and Game Boy 2BPP tile encoder.
// Slices converted images into 8×8 pixel tiles, hashes unique patterns,
// and compares tile and colour budgets against real vintage consoles and computers.

export interface HardwareFitReport {
  totalTiles: number
  uniqueTiles: number
  maxTiles?: number
  tilesFit: boolean
  uniqueColours: number
  maxColours?: number
  coloursFit: boolean
  ratio: number // 0..1+ (percentage of tile limit used)
  summary: string
}

/**
 * Analyzes an indexed pixel buffer into 8×8 tiles, finding unique tile count
 * and evaluating against machine hardware limits.
 */
export function analyzeTileFit(
  indices: Uint8Array,
  width: number,
  height: number,
  limits?: { maxTiles?: number; maxColours?: number }
): HardwareFitReport {
  const tilesX = Math.floor(width / 8)
  const tilesY = Math.floor(height / 8)
  const totalTiles = tilesX * tilesY

  const uniqueTileHashes = new Set<string>()
  const uniqueColours = new Set<number>()

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      let hash = ''
      for (let py = 0; py < 8; py++) {
        const rowStart = (ty * 8 + py) * width + tx * 8
        for (let px = 0; px < 8; px++) {
          const val = indices[rowStart + px]
          uniqueColours.add(val)
          hash += val.toString(16).padStart(2, '0')
        }
      }
      uniqueTileHashes.add(hash)
    }
  }

  const uniqueTiles = uniqueTileHashes.size
  const maxTiles = limits?.maxTiles
  const maxColours = limits?.maxColours

  const tilesFit = maxTiles !== undefined ? uniqueTiles <= maxTiles : true
  const coloursFit = maxColours !== undefined ? uniqueColours.size <= maxColours : true

  const ratio = maxTiles ? uniqueTiles / maxTiles : 0
  let summary = `${uniqueTiles} unique 8×8 tiles`
  if (maxTiles) {
    if (tilesFit) {
      summary = `${uniqueTiles} / ${maxTiles} tiles (fits in VRAM)`
    } else {
      summary = `${uniqueTiles} / ${maxTiles} tiles (+${uniqueTiles - maxTiles} over limit)`
    }
  }

  return {
    totalTiles,
    uniqueTiles,
    maxTiles,
    tilesFit,
    uniqueColours: uniqueColours.size,
    maxColours,
    coloursFit,
    ratio,
    summary
  }
}

/**
 * Encodes an 8×8 tile of 2-bit color indices (0..3) into 16 bytes of Game Boy 2BPP planar format.
 * Each row of 8 pixels produces 2 bytes:
 * - Byte 0: Low bits of pixels 0..7
 * - Byte 1: High bits of pixels 0..7
 */
export function encodeGbTile(tilePixels: Uint8Array | number[]): Uint8Array {
  const out = new Uint8Array(16)
  for (let row = 0; row < 8; row++) {
    let lowByte = 0
    let highByte = 0
    for (let col = 0; col < 8; col++) {
      const val = tilePixels[row * 8 + col] & 3
      const bit = 7 - col
      if (val & 1) lowByte |= 1 << bit
      if (val & 2) highByte |= 1 << bit
    }
    out[row * 2] = lowByte
    out[row * 2 + 1] = highByte
  }
  return out
}

/**
 * Encodes an entire image's unique 8×8 tiles into a Game Boy `.chr` / `.bin` tile sheet.
 * If deduplicate is true (default), identical tiles are merged.
 */
export function encodeGbChr(
  indices: Uint8Array,
  width: number,
  height: number,
  deduplicate = true
): Uint8Array {
  const tilesX = Math.floor(width / 8)
  const tilesY = Math.floor(height / 8)

  const encodedTiles: Uint8Array[] = []
  const seenHashes = new Set<string>()

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const tile = new Uint8Array(64)
      let hash = ''
      for (let py = 0; py < 8; py++) {
        const rowStart = (ty * 8 + py) * width + tx * 8
        for (let px = 0; px < 8; px++) {
          const val = indices[rowStart + px] & 3
          tile[py * 8 + px] = val
          hash += String(val)
        }
      }

      if (!deduplicate || !seenHashes.has(hash)) {
        if (deduplicate) seenHashes.add(hash)
        encodedTiles.push(encodeGbTile(tile))
      }
    }
  }

  const result = new Uint8Array(encodedTiles.length * 16)
  for (let i = 0; i < encodedTiles.length; i++) {
    result.set(encodedTiles[i], i * 16)
  }
  return result
}

/**
 * Encodes an image's 8×8 tiles as a NES CHR (pattern table) sheet. Each
 * pixel is its 2-bit colour number inside its tile's sub-palette (0 is the
 * backdrop). Per tile: 8 bytes of low bits (plane 0, one per row), then 8
 * bytes of high bits (plane 1); bit 7 is the leftmost pixel. Identical tiles
 * are kept once, in reading order, unless deduplicate is false.
 */
export function encodeNesChr(colourNumbers: Uint8Array, width: number, height: number, deduplicate = true): Uint8Array {
  const tilesX = Math.floor(width / 8)
  const tilesY = Math.floor(height / 8)
  const tiles: Uint8Array[] = []
  const seen = new Set<string>()
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const tile = new Uint8Array(16)
      for (let row = 0; row < 8; row++) {
        let lo = 0
        let hi = 0
        for (let col = 0; col < 8; col++) {
          const v = colourNumbers[(ty * 8 + row) * width + tx * 8 + col] & 3
          if (v & 1) lo |= 0x80 >> col
          if (v & 2) hi |= 0x80 >> col
        }
        tile[row] = lo
        tile[row + 8] = hi
      }
      const key = tile.join(',')
      if (!deduplicate || !seen.has(key)) {
        seen.add(key)
        tiles.push(tile)
      }
    }
  }
  const out = new Uint8Array(tiles.length * 16)
  tiles.forEach((t, i) => out.set(t, i * 16))
  return out
}
