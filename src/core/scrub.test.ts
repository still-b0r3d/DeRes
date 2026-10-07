import { describe, expect, it } from 'vitest'
import {
  buildMinimalOrientationApp1,
  buildMinimalOrientationPngChunk,
  buildMinimalOrientationTiff,
  scrubImage,
  scrubJpeg,
  scrubPng,
  scrubWebp,
  verifyScrubbed
} from './scrub'
import { inspectMetadata } from './exif'

describe('exif & metadata scrubber', () => {
  it('constructs valid minimal orientation structures', () => {
    const tiff = buildMinimalOrientationTiff(6)
    expect(tiff.byteLength).toBe(26)
    // Little-endian header
    expect(tiff[0]).toBe(0x49)
    expect(tiff[1]).toBe(0x49)
    // Orientation tag 0x0112 value 6
    expect(tiff[18]).toBe(6)

    const app1 = buildMinimalOrientationApp1(6)
    expect(app1.byteLength).toBe(36)
    expect(app1[0]).toBe(0xff)
    expect(app1[1]).toBe(0xe1)
    expect(app1[2]).toBe(0x00)
    expect(app1[3]).toBe(0x22) // 34 bytes

    const pngChunk = buildMinimalOrientationPngChunk(6)
    expect(pngChunk.byteLength).toBe(38)
    // Chunk type 'eXIf'
    expect(String.fromCharCode(pngChunk[4], pngChunk[5], pngChunk[6], pngChunk[7])).toBe('eXIf')
  })

  it('strips JPEG metadata at the byte level while preserving ICC profile and orientation', () => {
    // Construct synthetic JPEG with:
    // - SOI
    // - APP0 JFIF
    // - APP1 Exif (with Orientation 6)
    // - APP2 ICC Profile
    // - APP13 Photoshop IRB
    // - COM Comment
    // - SOS Scan data
    // - EOI
    // - 16 bytes trailer (e.g. motion photo trailer)
    const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]
    const app1Exif = Array.from(buildMinimalOrientationApp1(6))
    const app2Icc = [
      0xff, 0xe2, 0x00, 0x12,
      0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00,
      0x01, 0x01
    ]
    const app13 = [0xff, 0xed, 0x00, 0x06, 0x38, 0x42, 0x49, 0x4d]
    const com = [0xff, 0xfe, 0x00, 0x08, 0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x21]
    const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]
    const scanData = [0x11, 0x22, 0x33, 0x44]
    const eoi = [0xff, 0xd9]
    const trailer = [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99]

    const fullJpeg = new Uint8Array([
      0xff, 0xd8,
      ...app0,
      ...app1Exif,
      ...app2Icc,
      ...app13,
      ...com,
      ...sos,
      ...scanData,
      ...eoi,
      ...trailer
    ])

    const originalMeta = inspectMetadata(fullJpeg)
    expect(originalMeta.orientation).toBe(6)
    expect(originalMeta.hasIccProfile).toBe(true)
    expect(originalMeta.trailerBytes).toBe(16)

    // Scrub
    const scrubbed = scrubJpeg(fullJpeg, { mode: 'all', preserveOrientation: true })
    const scrubbedMeta = inspectMetadata(scrubbed)

    // Verify properties
    expect(scrubbedMeta.format).toBe('jpeg')
    expect(scrubbedMeta.orientation).toBe(6) // Preserved
    expect(scrubbedMeta.hasIccProfile).toBe(true) // Kept
    expect(scrubbedMeta.trailerBytes).toBe(0) // Truncated

    // Self-check
    const check = verifyScrubbed(originalMeta, fullJpeg.length, scrubbed, { mode: 'all', preserveOrientation: true })
    expect(check.gpsRemoved).toBe(true)
    expect(check.cameraRemoved).toBe(true)
    expect(check.trailersRemoved).toBe(true)
    expect(check.orientationPreserved).toBe(true)
    expect(check.iccPreserved).toBe(true)
    expect(check.isClean).toBe(true)
    expect(check.summary).toContain('Checked: 0 GPS coordinates, 0 camera tags found')
    expect(check.summary).toContain('colour profile')
    expect(check.summary).toContain('orientation')
  })

  it('omits orientation tag when original orientation is standard 1', () => {
    const fullJpeg = new Uint8Array([
      0xff, 0xd8,
      ...Array.from(buildMinimalOrientationApp1(1)),
      0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
      0x11, 0x22,
      0xff, 0xd9
    ])

    const scrubbed = scrubJpeg(fullJpeg, { mode: 'all', preserveOrientation: true })
    const meta = inspectMetadata(scrubbed)
    expect(meta.rawTagCount).toBe(0)
    expect(meta.orientation).toBeUndefined()
  })

  it('removes location only while preserving camera settings in location_only mode', () => {
    // Build a TIFF block that has Make, Model, and a GPS SubIFD
    // TIFF header: II, 42, offset 8
    // IFD0: 3 entries:
    // 1) Tag 0x010f (Make): "Acme" (stored at offset 46)
    // 2) Tag 0x0112 (Orientation): 3
    // 3) Tag 0x8825 (GPSInfo): offset 54
    // GPS IFD (at offset 54): 1 entry
    // Tag 0x0002 (GPSLatitude): value offset 72
    const seg = new Uint8Array(120)
    seg[0] = 0xff
    seg[1] = 0xe1
    seg[2] = 0x00
    seg[3] = 118 // Length = 118
    // "Exif\0\0"
    seg[4] = 0x45; seg[5] = 0x78; seg[6] = 0x69; seg[7] = 0x66; seg[8] = 0x00; seg[9] = 0x00

    // TIFF Header at offset 10
    const to = 10
    seg[to] = 0x49; seg[to + 1] = 0x49; seg[to + 2] = 0x2a; seg[to + 3] = 0x00
    seg[to + 4] = 0x08; seg[to + 5] = 0x00; seg[to + 6] = 0x00; seg[to + 7] = 0x00 // IFD0 at 8

    // IFD0 at offset to + 8 = 18
    const ifd0 = to + 8
    seg[ifd0] = 0x03; seg[ifd0 + 1] = 0x00 // 3 tags

    // Entry 1: Make 0x010f, ASCII (2), count 5, offset 46
    const e1 = ifd0 + 2
    seg[e1] = 0x0f; seg[e1 + 1] = 0x01; seg[e1 + 2] = 0x02; seg[e1 + 3] = 0x00
    seg[e1 + 4] = 0x05; seg[e1 + 5] = 0x00; seg[e1 + 6] = 0x00; seg[e1 + 7] = 0x00
    seg[e1 + 8] = 46; seg[e1 + 9] = 0x00; seg[e1 + 10] = 0x00; seg[e1 + 11] = 0x00

    // Entry 2: Orientation 0x0112, SHORT (3), count 1, value 3
    const e2 = e1 + 12
    seg[e2] = 0x12; seg[e2 + 1] = 0x01; seg[e2 + 2] = 0x03; seg[e2 + 3] = 0x00
    seg[e2 + 4] = 0x01; seg[e2 + 5] = 0x00; seg[e2 + 6] = 0x00; seg[e2 + 7] = 0x00
    seg[e2 + 8] = 0x03; seg[e2 + 9] = 0x00; seg[e2 + 10] = 0x00; seg[e2 + 11] = 0x00

    // Entry 3: GPSInfo 0x8825, LONG (4), count 1, offset 54
    const e3 = e2 + 12
    seg[e3] = 0x25; seg[e3 + 1] = 0x88; seg[e3 + 2] = 0x04; seg[e3 + 3] = 0x00
    seg[e3 + 4] = 0x01; seg[e3 + 5] = 0x00; seg[e3 + 6] = 0x00; seg[e3 + 7] = 0x00
    seg[e3 + 8] = 54; seg[e3 + 9] = 0x00; seg[e3 + 10] = 0x00; seg[e3 + 11] = 0x00

    // String "Acme\0" at to + 46 = 56
    const strOff = to + 46
    seg[strOff] = 0x41; seg[strOff + 1] = 0x63; seg[strOff + 2] = 0x6d; seg[strOff + 3] = 0x65; seg[strOff + 4] = 0x00

    // GPS IFD at to + 54 = 64
    const gpsIfd = to + 54
    seg[gpsIfd] = 0x01; seg[gpsIfd + 1] = 0x00 // 1 tag
    const g1 = gpsIfd + 2
    // Tag 0x0002 (GPSLatitude), RATIONAL (5), count 3, offset 72
    seg[g1] = 0x02; seg[g1 + 1] = 0x00; seg[g1 + 2] = 0x05; seg[g1 + 3] = 0x00
    seg[g1 + 4] = 0x03; seg[g1 + 5] = 0x00; seg[g1 + 6] = 0x00; seg[g1 + 7] = 0x00
    seg[g1 + 8] = 72; seg[g1 + 9] = 0x00; seg[g1 + 10] = 0x00; seg[g1 + 11] = 0x00

    const jpeg = new Uint8Array([
      0xff, 0xd8,
      ...Array.from(seg),
      0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
      0x55, 0xaa,
      0xff, 0xd9
    ])

    const originalMeta = inspectMetadata(jpeg)
    expect(originalMeta.make).toBe('Acme')
    expect(originalMeta.orientation).toBe(3)

    // Scrub location only
    const scrubbed = scrubJpeg(jpeg, { mode: 'location_only' })
    const scrubbedMeta = inspectMetadata(scrubbed)

    expect(scrubbedMeta.make).toBe('Acme') // Kept!
    expect(scrubbedMeta.orientation).toBe(3) // Kept!
    expect(scrubbedMeta.gps).toBeUndefined() // Wiped!

    const check = verifyScrubbed(originalMeta, jpeg.length, scrubbed, { mode: 'location_only' })
    expect(check.gpsRemoved).toBe(true)
    expect(check.cameraRemoved).toBe(false)
    expect(check.isClean).toBe(true)
    expect(check.summary).toContain('camera (Acme)')
  })

  it('strips metadata from PNG files and truncates after IEND', () => {
    // 8-byte PNG signature
    // IHDR chunk (13 bytes payload + 12 chunk wrapper = 25 bytes)
    const ihdr = [
      0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x08, 0x02, 0x00, 0x00, 0x00,
      0xfd, 0xd4, 0x9a, 0x73
    ]
    // tEXt chunk
    const text = [
      0x00, 0x00, 0x00, 0x08,
      0x74, 0x45, 0x58, 0x74,
      0x43, 0x6f, 0x70, 0x79, 0x00, 0x32, 0x30, 0x32,
      0x11, 0x22, 0x33, 0x44
    ]
    // IDAT chunk (dummy)
    const idat = [
      0x00, 0x00, 0x00, 0x04,
      0x49, 0x44, 0x41, 0x54,
      0x78, 0x9c, 0x63, 0x00,
      0x55, 0x66, 0x77, 0x88
    ]
    // IEND chunk
    const iend = [
      0x00, 0x00, 0x00, 0x00,
      0x49, 0x45, 0x4e, 0x44,
      0xae, 0x42, 0x60, 0x82
    ]
    // Trailing junk
    const junk = [0x99, 0x88, 0x77]

    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...ihdr,
      ...text,
      ...idat,
      ...iend,
      ...junk
    ])

    const originalMeta = inspectMetadata(png)
    expect(originalMeta.format).toBe('png')
    expect(originalMeta.trailerBytes).toBe(3)
    expect(originalMeta.rawTagCount).toBe(1)

    const scrubbed = scrubPng(png)
    const scrubbedMeta = inspectMetadata(scrubbed)

    expect(scrubbedMeta.trailerBytes).toBe(0)
    expect(scrubbedMeta.rawTagCount).toBe(0)
  })

  it('strips EXIF and XMP from WebP and clears VP8X flags', () => {
    // Construct synthetic WebP with VP8X, EXIF, VP8
    // VP8X payload: 10 bytes. Flag byte = 0x08 (EXIF present)
    const vp8x = [
      0x56, 0x50, 0x38, 0x58, // 'VP8X'
      0x0a, 0x00, 0x00, 0x00, // size 10
      0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00 // flags & dimensions
    ]
    const exifChunk = [
      0x45, 0x58, 0x49, 0x46, // 'EXIF'
      0x06, 0x00, 0x00, 0x00, // size 6
      0x11, 0x22, 0x33, 0x44, 0x55, 0x66 // dummy exif data
    ]
    const vp8Chunk = [
      0x56, 0x50, 0x38, 0x20, // 'VP8 '
      0x04, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00
    ]

    const webpBody = [...vp8x, ...exifChunk, ...vp8Chunk]
    const riffLen = 4 + webpBody.length
    const riffHeader = [
      0x52, 0x49, 0x46, 0x46, // 'RIFF'
      riffLen & 0xff, (riffLen >> 8) & 0xff, (riffLen >> 16) & 0xff, (riffLen >> 24) & 0xff,
      0x57, 0x45, 0x42, 0x50 // 'WEBP'
    ]

    const webp = new Uint8Array([...riffHeader, ...webpBody])

    const scrubbed = scrubWebp(webp)
    const scrubbedMeta = inspectMetadata(scrubbed)

    expect(scrubbedMeta.format).toBe('webp')
    // EXIF chunk should be removed
    let hasExifFourCC = false
    for (let i = 0; i < scrubbed.length - 4; i++) {
      if (
        scrubbed[i] === 0x45 &&
        scrubbed[i + 1] === 0x58 &&
        scrubbed[i + 2] === 0x49 &&
        scrubbed[i + 3] === 0x46
      ) {
        hasExifFourCC = true
      }
    }
    expect(hasExifFourCC).toBe(false)
  })

  it('rejects HEIC scrubbing with a friendly informational error', () => {
    const heic = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
      0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00
    ])

    expect(() => scrubImage(heic)).toThrow(/HEIC files cannot be safely scrubbed/)
  })
})
