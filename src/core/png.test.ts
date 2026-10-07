import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { crc32, decodePng, encodeIndexedPng, encodeRgbPng, indexDepth, zlib, zlibStored } from './png'

const palette = (n: number) => Uint8Array.from({ length: n * 3 }, (_, i) => (i * 37) & 255)

describe('PNG', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('picks the smallest index depth', () => {
    expect([2, 4, 16, 17, 256].map(indexDepth)).toEqual([1, 2, 4, 8, 8])
  })

  it.each([2, 4, 16, 55, 256])('round-trips an indexed image with %i colours', async (n) => {
    const w = 37
    const h = 11
    const indices = Uint8Array.from({ length: w * h }, (_, i) => (i * 7 + (i >> 3)) % n)
    const png = await encodeIndexedPng(w, h, palette(n), (y, out) => out.set(indices.subarray(y * w, (y + 1) * w)))
    const back = await decodePng(png)
    expect([back.width, back.height, back.colourType, back.bitDepth]).toEqual([w, h, 3, indexDepth(n)])
    expect(back.indices).toEqual(indices)
    expect(back.palette).toEqual(palette(n))
  })

  it('round-trips a full-colour image (every row filter in play)', async () => {
    const w = 50
    const h = 20
    const rgb = Uint8Array.from({ length: w * h * 3 }, (_, i) => (i % 3 === 0 ? i & 255 : (i * 13) >> 4) & 255)
    const png = await encodeRgbPng(w, h, (y, out) => out.set(rgb.subarray(y * w * 3, (y + 1) * w * 3)))
    const back = await decodePng(png)
    expect([back.width, back.height, back.colourType]).toEqual([w, h, 2])
    const again = new Uint8Array(w * h * 3)
    for (let i = 0; i < w * h; i++) again.set(back.rgba.subarray(i * 4, i * 4 + 3), i * 3)
    expect(again).toEqual(rgb)
  })

  it('writes nothing but the picture (no text, time or EXIF chunks)', async () => {
    const png = await encodeIndexedPng(4, 4, palette(2), (_y, out) => out.fill(1))
    const names: string[] = []
    for (let o = 8; o < png.length; ) {
      const len = new DataView(png.buffer).getUint32(o)
      names.push(String.fromCharCode(...png.subarray(o + 4, o + 8)))
      o += 12 + len
    }
    expect(names).toEqual(['IHDR', 'sRGB', 'PLTE', 'IDAT', 'IEND'])
  })

  it('makes valid zlib data both ways (compressed and the stored fallback)', async () => {
    const data = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 31) & 255)
    expect(new Uint8Array(inflateSync(await zlib(data)))).toEqual(data)
    expect(new Uint8Array(inflateSync(zlibStored(data)))).toEqual(data)
    expect(new Uint8Array(inflateSync(zlibStored(new Uint8Array(0))))).toEqual(new Uint8Array(0))
  })

  it('rejects files that are not PNGs or are damaged', async () => {
    await expect(decodePng(new Uint8Array(20))).rejects.toThrow('Not a PNG')
    const png = await encodeIndexedPng(4, 4, palette(2), (_y, out) => out.fill(0))
    png[20] ^= 0xff
    await expect(decodePng(png)).rejects.toThrow('CRC')
  })
})
