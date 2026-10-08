import { describe, expect, it } from 'vitest'
import { inspectMetadata } from './exif'
import { crc32 } from './png'
import { scrubImage, scrubJpeg, scrubPng } from './scrub'
import { fakeExifApp1, tinyJpegBody } from '../test/fake-exif'
import { withinMs } from '../test/time-limit'

// Damaged files must never freeze the page: every byte walker has to keep
// moving forward and stop at the end of the data.

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
function chunk(type: string, body: number[]): number[] {
  const t = [...type].map((c) => c.charCodeAt(0))
  const n = body.length
  const crc = crc32(new Uint8Array([...t, ...body]))
  return [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, ...t, ...body, crc >>> 24, (crc >> 16) & 0xff, (crc >> 8) & 0xff, crc & 0xff]
}
const IHDR = chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])

describe('damaged files', () => {
  it('a PNG chunk length with the top bit set neither hangs the inspector nor the scrubber', () => {
    // Length 0xFFFFFFF4 read as signed is -12: the walker used to land on the same chunk forever.
    const bad = new Uint8Array([...SIG, ...IHDR, 0xff, 0xff, 0xff, 0xf4, 0x74, 0x45, 0x58, 0x74, 1, 2, 3, 4, 5, 6, 7, 8])
    const meta = withinMs(1000, () => inspectMetadata(bad))
    expect(meta.format).toBe('png')
    // The bytes it couldn't walk count as data after the picture.
    expect(meta.trailerBytes).toBe(16)
    const out = withinMs(1000, () => scrubPng(bad))
    expect([...out]).toEqual([...SIG, ...IHDR])
  })

  it('a PNG chunk that runs past the end stops the walk', () => {
    const bad = new Uint8Array([...SIG, ...IHDR, 0x00, 0x10, 0x00, 0x00, 0x74, 0x45, 0x58, 0x74, 1, 2, 3])
    expect(withinMs(1000, () => inspectMetadata(bad)).trailerBytes).toBe(11)
    expect([...withinMs(1000, () => scrubPng(bad))]).toEqual([...SIG, ...IHDR])
  })

  it('JPEG fill bytes (0xFF 0xFF) before a marker are skipped, not read as a segment', () => {
    const app1 = fakeExifApp1({ make: 'FakeCam', gps: { lat: 0, lon: 0 } })
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xff, ...app1, ...tinyJpegBody()])
    const meta = withinMs(1000, () => inspectMetadata(jpeg))
    expect(meta.make).toBe('FakeCam')
    expect(meta.gps).toBeDefined()
    const out = withinMs(1000, () => scrubJpeg(jpeg))
    expect(inspectMetadata(out).make).toBeUndefined()
  })

  it('a JPEG segment longer than the file stops the walk', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xf0, 0x45, 0x78, 0x69, 0x66, 0, 0])
    expect(withinMs(1000, () => inspectMetadata(jpeg)).format).toBe('jpeg')
    expect(() => withinMs(1000, () => scrubImage(jpeg))).not.toThrow(/timed out/)
  })

  it('a HEIC full of TIFF-header lookalikes is inspected quickly', () => {
    const ftyp = [0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]
    const junk = new Uint8Array(4 * 1024 * 1024)
    for (let i = 0; i < junk.length; i += 4) junk.set([0x49, 0x49, 0x2a, 0x00], i)
    const heic = new Uint8Array(ftyp.length + junk.length)
    heic.set(ftyp)
    heic.set(junk, ftyp.length)
    expect(withinMs(2000, () => inspectMetadata(heic)).format).toBe('heic')
  })

  it('an EXIF text field without an end is read only so far', () => {
    // A 1 MB ASCII value with no terminating zero, 2000 times over.
    const n = 2000
    const tiff = new Uint8Array(8 + 2 + n * 12 + 4 + 1024 * 1024).fill(0x41)
    const v = new DataView(tiff.buffer)
    tiff.set([0x49, 0x49, 0x2a, 0x00], 0)
    v.setUint32(4, 8, true)
    v.setUint16(8, n, true)
    for (let i = 0; i < n; i++) {
      const e = 10 + i * 12
      v.setUint16(e, 0x9000 + i, true)
      v.setUint16(e + 2, 2, true)
      v.setUint32(e + 4, 1024 * 1024, true)
      v.setUint32(e + 8, 8 + 2 + n * 12 + 4, true)
    }
    v.setUint32(10 + n * 12, 0, true)
    const app1 = new Uint8Array([0xff, 0xe1, 0, 0, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff.subarray(0, 0)])
    const jpeg = new Uint8Array(2 + app1.length + tiff.length + tinyJpegBody().length)
    jpeg.set([0xff, 0xd8])
    jpeg.set(app1, 2)
    jpeg.set(tiff, 2 + app1.length)
    jpeg.set(tinyJpegBody(), 2 + app1.length + tiff.length)
    // The segment length field can't hold this much, so it says 0xFFFF; the TIFF reader goes past it.
    jpeg.set([0xff, 0xff], 4)
    expect(withinMs(2000, () => inspectMetadata(jpeg)).format).toBe('jpeg')
  })
})
