import { describe, expect, it } from 'vitest'
import {
  detectFormat,
  formatGpsDecimal,
  formatGpsDms,
  getMetadataNarrative,
  inspectMetadata,
  type ImageMetadata
} from './exif'
import { buildMinimalOrientationApp1 } from './scrub'

describe('exif parser & inspector', () => {
  it('formats GPS coordinates into DMS strings correctly', () => {
    const coords = {
      latitude: 37.774929,
      longitude: -122.419416,
      altitude: 42.5,
      latRef: 'N',
      lonRef: 'W'
    }
    const dms = formatGpsDms(coords)
    expect(dms).toContain('37°46\'29.7" N')
    expect(dms).toContain('122°25\'9.9" W')
    expect(dms).toContain('(alt 43m)')
  })

  it('formats GPS coordinates into decimal string for 1-click copy', () => {
    const coords = {
      latitude: 37.774929,
      longitude: -122.419416,
      latRef: 'N',
      lonRef: 'W'
    }
    const dec = formatGpsDecimal(coords)
    expect(dec).toBe('37.774929, -122.419416')
  })

  it('generates a human-friendly plain-English narrative', () => {
    const meta: ImageMetadata = {
      format: 'jpeg',
      make: 'Apple',
      model: 'iPhone 15 Pro',
      dateTime: '2026:10:03 16:12:00',
      gps: {
        latitude: 37.7749,
        longitude: -122.4194,
        latRef: 'N',
        lonRef: 'W'
      },
      focalLength: 24,
      fNumber: 1.78,
      exposureTime: '1/120s',
      iso: 64,
      hasIccProfile: true,
      hasThumbnail: false,
      trailerBytes: 0,
      rawTagCount: 12
    }

    const narrative = getMetadataNarrative(meta)
    expect(narrative).toContain('Taken on a Apple iPhone 15 Pro')
    expect(narrative).toContain('on 2026:10:03 16:12:00')
    expect(narrative).toContain('at coordinates 37.774900, -122.419400')
    expect(narrative).toContain('(24mm, f/1.78, 1/120s, ISO 64)')
  })

  it('detects file formats from headers accurately', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
    expect(detectFormat(jpeg)).toBe('jpeg')

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
    expect(detectFormat(png)).toBe('png')

    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20
    ])
    expect(detectFormat(webp)).toBe('webp')

    const heic = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
      0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00
    ])
    expect(detectFormat(heic)).toBe('heic')

    const unknown = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04])
    expect(detectFormat(unknown)).toBe('unknown')
  })

  it('parses minimal orientation TIFF block', () => {
    // Prepend a dummy JPEG header so inspectMetadata reads it
    const jpeg = new Uint8Array(2 + 36 + 2)
    jpeg[0] = 0xff
    jpeg[1] = 0xd8
    jpeg.set(buildMinimalOrientationApp1(6), 2)
    jpeg[38] = 0xff
    jpeg[39] = 0xd9

    const meta = inspectMetadata(jpeg)
    expect(meta.format).toBe('jpeg')
    expect(meta.orientation).toBe(6)
    expect(meta.rawTagCount).toBe(1)
    expect(meta.gps).toBeUndefined()
  })

  it('detects trailer bytes past JPEG EOI', () => {
    const jpegWithTrailer = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
      0x12, 0x34,
      0xff, 0xd9,
      // 10 bytes trailer (e.g. motion video)
      0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x11, 0x22, 0x33, 0x44
    ])

    const meta = inspectMetadata(jpegWithTrailer)
    expect(meta.format).toBe('jpeg')
    expect(meta.trailerBytes).toBe(10)
  })

  it('detects ICC profiles in JPEG APP2 segment', () => {
    const iccHeader = [
      0xff, 0xd8,
      // APP2 with ICC_PROFILE\0
      0xff, 0xe2, 0x00, 0x12,
      0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00,
      0x01, 0x01,
      0xff, 0xd9
    ]
    const data = new Uint8Array(iccHeader)
    const meta = inspectMetadata(data)
    expect(meta.hasIccProfile).toBe(true)
  })
})
