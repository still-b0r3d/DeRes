import { describe, expect, it } from 'vitest'
import { encodeApng } from './apng'
import { decodePng, PNG_SIGNATURE } from './png'

describe('apng encoder', () => {
  it('creates a valid animated PNG with acTL, fcTL, IDAT, and fdAT chunks', async () => {
    const width = 4
    const height = 4

    // Frame 0: all red [255, 0, 0]
    const rgb0 = new Uint8Array(width * height * 3)
    for (let i = 0; i < width * height; i++) {
      rgb0[i * 3] = 255
      rgb0[i * 3 + 1] = 0
      rgb0[i * 3 + 2] = 0
    }

    // Frame 1: all blue [0, 0, 255]
    const rgb1 = new Uint8Array(width * height * 3)
    for (let i = 0; i < width * height; i++) {
      rgb1[i * 3] = 0
      rgb1[i * 3 + 1] = 0
      rgb1[i * 3 + 2] = 255
    }

    const apngBytes = await encodeApng([
      { width, height, delayMs: 120, rgb: rgb0 },
      { width, height, delayMs: 120, rgb: rgb1 }
    ])

    expect(apngBytes.length).toBeGreaterThan(0)

    // Check PNG signature
    for (let i = 0; i < 8; i++) {
      expect(apngBytes[i]).toBe(PNG_SIGNATURE[i])
    }

    // Parse chunk types and order
    const view = new DataView(apngBytes.buffer, apngBytes.byteOffset, apngBytes.byteLength)
    const chunkNames: string[] = []
    const fctlSeqs: number[] = []
    const fdatSeqs: number[] = []

    let o = 8
    while (o < apngBytes.length) {
      const len = view.getUint32(o)
      const name = String.fromCharCode(...apngBytes.subarray(o + 4, o + 8))
      chunkNames.push(name)
      if (name === 'fcTL') {
        fctlSeqs.push(view.getUint32(o + 8))
      } else if (name === 'fdAT') {
        fdatSeqs.push(view.getUint32(o + 8))
      }
      o += 12 + len
    }

    expect(chunkNames).toEqual(['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'IEND'])
    // Frame 0 fcTL seq = 0, Frame 1 fcTL seq = 1, Frame 1 fdAT seq = 2
    expect(fctlSeqs).toEqual([0, 1])
    expect(fdatSeqs).toEqual([2])

    // Standard decodePng parses frame 0 from IDAT seamlessly
    const decoded = await decodePng(apngBytes)
    expect(decoded.width).toBe(width)
    expect(decoded.height).toBe(height)
    expect(decoded.rgba[0]).toBe(255) // Red channel of frame 0
    expect(decoded.rgba[1]).toBe(0)
    expect(decoded.rgba[2]).toBe(0)
  })

  it('encodes indexed APNG with shared palette', async () => {
    const width = 2
    const height = 2
    const palette = Uint8Array.of(
      0, 0, 0,       // index 0: black
      255, 255, 255  // index 1: white
    )

    const f0 = new Uint8Array([0, 1, 1, 0])
    const f1 = new Uint8Array([1, 0, 0, 1])

    const apngBytes = await encodeApng(
      [
        { width, height, delayMs: 80, indices: f0 },
        { width, height, delayMs: 80, indices: f1 }
      ],
      { palette }
    )

    const view = new DataView(apngBytes.buffer, apngBytes.byteOffset, apngBytes.byteLength)
    const chunkNames: string[] = []
    let o = 8
    while (o < apngBytes.length) {
      const len = view.getUint32(o)
      const name = String.fromCharCode(...apngBytes.subarray(o + 4, o + 8))
      chunkNames.push(name)
      o += 12 + len
    }

    expect(chunkNames).toEqual(['IHDR', 'acTL', 'PLTE', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'IEND'])

    const decoded = await decodePng(apngBytes)
    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(2)
    expect(decoded.indices).not.toBeNull()
    expect(Array.from(decoded.indices!)).toEqual([0, 1, 1, 0])
  })

  it('rejects empty frame lists', async () => {
    await expect(encodeApng([])).rejects.toThrow('APNG requires at least one frame')
  })
})
