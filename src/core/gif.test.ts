import { describe, expect, it } from 'vitest'
import { encodeGif, encodeRgbGif, NearestColour } from './gif'

/**
 * Reference GIF LZW decompressor used to verify compressed frame data.
 */
function decodeGifLzw(subblocks: Uint8Array, minCodeSize: number, expectedCount: number): Uint8Array {
  // Extract linear LZW bytes from 255-byte sub-blocks
  const bytes: number[] = []
  let o = 0
  while (o < subblocks.length) {
    const len = subblocks[o++]
    if (len === 0) break
    for (let i = 0; i < len; i++) bytes.push(subblocks[o++])
  }

  let byteIdx = 0
  let accum = 0
  let accumBits = 0

  function readBits(bits: number): number {
    while (accumBits < bits) {
      if (byteIdx >= bytes.length) return -1
      accum |= bytes[byteIdx++] << accumBits
      accumBits += 8
    }
    const val = accum & ((1 << bits) - 1)
    accum >>>= bits
    accumBits -= bits
    return val
  }

  const clearCode = 1 << minCodeSize
  const eoiCode = clearCode + 1
  let codeSize = minCodeSize + 1
  let nextCode = clearCode + 2
  let table: number[][] = []

  function resetTable() {
    codeSize = minCodeSize + 1
    nextCode = clearCode + 2
    table = []
    for (let i = 0; i < clearCode; i++) table[i] = [i]
    table[clearCode] = []
    table[eoiCode] = []
  }

  resetTable()
  const out: number[] = []

  let code = readBits(codeSize)
  if (code === clearCode) {
    resetTable()
    code = readBits(codeSize)
  }
  if (code === eoiCode || code === -1) return new Uint8Array(out)

  out.push(...table[code])
  let oldCode = code

  while (out.length < expectedCount) {
    code = readBits(codeSize)
    if (code === -1 || code === eoiCode) break
    if (code === clearCode) {
      resetTable()
      code = readBits(codeSize)
      if (code === -1 || code === eoiCode) break
      out.push(...table[code])
      oldCode = code
      continue
    }

    let entry: number[]
    if (code < nextCode) {
      entry = table[code]
    } else if (code === nextCode) {
      entry = [...table[oldCode], table[oldCode][0]]
    } else {
      throw new Error(`Invalid GIF code: ${code}`)
    }

    for (let j = 0; j < entry.length; j++) out.push(entry[j])
    const k = entry[0]
    if (nextCode < 4096) {
      table[nextCode] = [...table[oldCode], k]
      nextCode++
      if (nextCode === (1 << codeSize) && codeSize < 12) {
        codeSize++
      }
    }
    oldCode = code
  }

  return new Uint8Array(out)
}

describe('gif encoder', () => {
  it('creates valid animated GIF89a with Netscape 2.0 loop extension and lossless LZW frames', () => {
    const width = 4
    const height = 4
    const palette = Uint8Array.of(
      0, 0, 0,        // 0: black
      255, 0, 0,      // 1: red
      0, 255, 0,      // 2: green
      0, 0, 255       // 3: blue
    )

    const frame0 = new Uint8Array([
      1, 1, 0, 0,
      1, 1, 0, 0,
      0, 0, 2, 2,
      0, 0, 2, 2
    ])

    const frame1 = new Uint8Array([
      3, 3, 3, 3,
      3, 0, 0, 3,
      3, 0, 0, 3,
      3, 3, 3, 3
    ])

    const gifBytes = encodeGif([
      { width, height, delayMs: 150, indices: frame0 },
      { width, height, delayMs: 150, indices: frame1 }
    ], { palette, loop: 0 })

    expect(gifBytes.length).toBeGreaterThan(0)

    // Check GIF89a header
    const headerStr = String.fromCharCode(...gifBytes.subarray(0, 6))
    expect(headerStr).toBe('GIF89a')

    // Check Logical Screen Descriptor
    const view = new DataView(gifBytes.buffer, gifBytes.byteOffset, gifBytes.byteLength)
    expect(view.getUint16(6, true)).toBe(width)
    expect(view.getUint16(8, true)).toBe(height)

    // Netscape 2.0 loop extension check
    let foundNetscape = false
    for (let i = 0; i < gifBytes.length - 14; i++) {
      if (
        gifBytes[i] === 0x21 &&
        gifBytes[i + 1] === 0xff &&
        gifBytes[i + 2] === 0x0b &&
        String.fromCharCode(...gifBytes.subarray(i + 3, i + 14)) === 'NETSCAPE2.0'
      ) {
        foundNetscape = true
        // Loop count 0 in subblock
        expect(gifBytes[i + 16]).toBe(0x00)
        expect(gifBytes[i + 17]).toBe(0x00)
        break
      }
    }
    expect(foundNetscape).toBe(true)

    // Check trailer 0x3B
    expect(gifBytes[gifBytes.length - 1]).toBe(0x3b)

    // Parse GIF sequentially
    const framesFound: { minCodeSize: number; dataOffset: number }[] = []
    const gctDepth = (gifBytes[10] & 7) + 1
    let cursor = 13 + (1 << gctDepth) * 3 // Skip header + LSD + GCT

    while (cursor < gifBytes.length && gifBytes[cursor] !== 0x3b) {
      const b = gifBytes[cursor]
      if (b === 0x21) {
        // Extension
        cursor += 2 // skip 0x21 and label
        // Read subblocks until 0x00
        while (cursor < gifBytes.length) {
          const subLen = gifBytes[cursor++]
          if (subLen === 0) break
          cursor += subLen
        }
      } else if (b === 0x2c) {
        // Image Descriptor
        const packed = gifBytes[cursor + 9]
        cursor += 10
        if (packed & 0x80) {
          const lctDepth = (packed & 7) + 1
          cursor += (1 << lctDepth) * 3
        }
        const minCodeSize = gifBytes[cursor++]
        const dataOffset = cursor
        framesFound.push({ minCodeSize, dataOffset })
        // Skip subblocks
        while (cursor < gifBytes.length) {
          const subLen = gifBytes[cursor++]
          if (subLen === 0) break
          cursor += subLen
        }
      } else {
        cursor++
      }
    }

    expect(framesFound.length).toBe(2)

    // Verify frame 0 decompress
    const f0Data = decodeGifLzw(gifBytes.subarray(framesFound[0].dataOffset), framesFound[0].minCodeSize, 16)
    expect(Array.from(f0Data)).toEqual(Array.from(frame0))

    // Verify frame 1 decompress
    const f1Data = decodeGifLzw(gifBytes.subarray(framesFound[1].dataOffset), framesFound[1].minCodeSize, 16)
    expect(Array.from(f1Data)).toEqual(Array.from(frame1))
  })

  it('encodes RGB frames using encodeRgbGif with quantization', () => {
    const width = 2
    const height = 2
    const rgb0 = new Uint8Array([
      255, 0, 0,    0, 255, 0,
      0, 0, 255,    255, 255, 255
    ])
    const rgb1 = new Uint8Array([
      0, 0, 0,      255, 255, 0,
      255, 0, 255,  0, 255, 255
    ])

    const gifBytes = encodeRgbGif([
      { width, height, delayMs: 100, rgb: rgb0 },
      { width, height, delayMs: 100, rgb: rgb1 }
    ])

    expect(gifBytes.length).toBeGreaterThan(0)
    expect(String.fromCharCode(...gifBytes.subarray(0, 6))).toBe('GIF89a')
    expect(gifBytes[gifBytes.length - 1]).toBe(0x3b)
  })

  it('handles large multi-block frames with subblock splitting and table expansion', () => {
    const width = 64
    const height = 64
    const palette = new Uint8Array(256 * 3)
    for (let i = 0; i < 256; i++) {
      palette[i * 3] = i
      palette[i * 3 + 1] = 255 - i
      palette[i * 3 + 2] = (i * 7) & 255
    }

    const frame0 = new Uint8Array(width * height)
    for (let i = 0; i < frame0.length; i++) {
      frame0[i] = (i ^ (i >> 3)) & 255
    }

    const gifBytes = encodeGif([{ width, height, indices: frame0, delayMs: 100 }], { palette })
    expect(gifBytes.length).toBeGreaterThan(500)

    // Decompress and verify all 4,096 pixels match identically
    const framesFound: { minCodeSize: number; dataOffset: number }[] = []
    const gctDepth = (gifBytes[10] & 7) + 1
    let cursor = 13 + (1 << gctDepth) * 3

    while (cursor < gifBytes.length && gifBytes[cursor] !== 0x3b) {
      const b = gifBytes[cursor]
      if (b === 0x21) {
        cursor += 2
        while (cursor < gifBytes.length) {
          const subLen = gifBytes[cursor++]
          if (subLen === 0) break
          cursor += subLen
        }
      } else if (b === 0x2c) {
        cursor += 10
        const minCodeSize = gifBytes[cursor++]
        framesFound.push({ minCodeSize, dataOffset: cursor })
        while (cursor < gifBytes.length) {
          const subLen = gifBytes[cursor++]
          if (subLen === 0) break
          cursor += subLen
        }
      } else {
        cursor++
      }
    }

    expect(framesFound.length).toBe(1)
    const decompressed = decodeGifLzw(gifBytes.subarray(framesFound[0].dataOffset), framesFound[0].minCodeSize, width * height)
    expect(decompressed.length).toBe(width * height)
    expect(Array.from(decompressed)).toEqual(Array.from(frame0))
  })

  it('throws for empty frames or missing palette', () => {
    expect(() => encodeGif([])).toThrow('GIF requires at least one frame')
    expect(() => encodeGif([{ width: 2, height: 2, indices: new Uint8Array(4) }])).toThrow('GIF requires a color palette')
  })
})

describe('RGB GIF colour lookup', () => {
  it('gives exactly the nearest palette colour for every pixel (the cache changes nothing)', () => {
    const palette = new Uint8Array(Array.from({ length: 16 * 3 }, (_, i) => (i * 53) % 256))
    const w = 37
    const h = 23
    const frames = [0, 1, 2].map((f) => {
      const rgb = new Uint8Array(w * h * 3)
      // Repeating colours (the cache is used) and one-offs.
      for (let i = 0; i < rgb.length; i++) rgb[i] = i % 5 === 0 ? (i * 31 + f * 7) % 256 : (Math.floor(i / 9) * 17) % 256
      return { width: w, height: h, delayMs: 100, rgb }
    })
    const nearest = (r: number, g: number, b: number) => {
      let best = 0
      let bestD = Infinity
      for (let i = 0; i < 16; i++) {
        const d = (r - palette[i * 3]) ** 2 + (g - palette[i * 3 + 1]) ** 2 + (b - palette[i * 3 + 2]) ** 2
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      return best
    }
    const expected = encodeGif(
      frames.map((f) => ({
        width: w,
        height: h,
        delayMs: 100,
        indices: Uint8Array.from({ length: w * h }, (_, p) => nearest(f.rgb[p * 3], f.rgb[p * 3 + 1], f.rgb[p * 3 + 2]))
      })),
      { loop: 0, palette }
    )
    expect(Buffer.from(encodeRgbGif(frames, { loop: 0, palette })).equals(Buffer.from(expected))).toBe(true)
  })

  it('moves to a new palette and forgets what it remembered from the old one', () => {
    const colours = new NearestColour(Uint8Array.of(0, 0, 0, 255, 255, 255))
    const rgb = Uint8Array.of(250, 250, 250, 10, 10, 10, 250, 250, 250)
    expect([...colours.map(rgb)]).toEqual([1, 0, 1])
    // Same pixels, a palette in the other order: the remembered answers are gone.
    colours.setPalette(Uint8Array.of(255, 255, 255, 0, 0, 0, 128, 128, 128))
    expect([...colours.map(rgb)]).toEqual([0, 1, 0])
    expect([...colours.map(Uint8Array.of(120, 130, 125))]).toEqual([2])
  })
})
