import { describe, expect, it } from 'vitest'
import {
  detectFormat,
  formatGpsDecimal,
  formatGpsDms,
  getMetadataNarrative,
  inspectMetadata,
  MAX_LISTED_TAGS,
  type ImageMetadata
} from './exif'
import { buildMinimalOrientationApp1, scrubImage } from './scrub'
import { fakeHeif, tinyJpegBody } from '../test/fake-exif'
import { bytesFor, exifApp1, rawTiff } from '../test/fake-tiff'

describe('HEIC and AVIF are told apart by their brands', () => {
  const exif = { make: 'FakeCam', gps: { lat: 0, lon: 0 } }

  it('HEIC files, also with the generic mif1 major brand', () => {
    expect(detectFormat(fakeHeif('heic', ['mif1', 'heic'], exif))).toBe('heic')
    expect(detectFormat(fakeHeif('mif1', ['mif1', 'heic'], exif))).toBe('heic')
  })

  it('AVIF files are not HEIC, whichever brand comes first', () => {
    expect(detectFormat(fakeHeif('avif', ['mif1', 'avif', 'miaf'], exif))).toBe('avif')
    expect(detectFormat(fakeHeif('avis', ['avis', 'msf1'], exif))).toBe('avif')
    expect(detectFormat(fakeHeif('mif1', ['avif', 'mif1', 'miaf'], exif))).toBe('avif')
  })

  it('both can be inspected, neither can be scrubbed, and the message names the right format', () => {
    for (const [file, name] of [
      [fakeHeif('heic', ['mif1', 'heic'], exif), 'HEIC'],
      [fakeHeif('avif', ['mif1', 'avif'], exif), 'AVIF']
    ] as const) {
      const meta = inspectMetadata(file)
      expect(meta.make).toBe('FakeCam')
      expect(meta.gps).toBeDefined()
      expect(() => scrubImage(file)).toThrow(new RegExp(`^${name} files`))
    }
  })
})

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
      rawTagCount: 12,
      allTags: []
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

  it('records full tag tree with category, hex ID, and formatted display values', () => {
    const jpeg = new Uint8Array(2 + 36 + 2)
    jpeg[0] = 0xff
    jpeg[1] = 0xd8
    jpeg.set(buildMinimalOrientationApp1(6), 2)
    jpeg[38] = 0xff
    jpeg[39] = 0xd9

    const meta = inspectMetadata(jpeg)
    expect(meta.allTags).toBeDefined()
    expect(meta.allTags.length).toBe(1)
    expect(meta.allTags[0].tagHex).toBe('0x0112')
    expect(meta.allTags[0].name).toBe('Orientation')
    expect(meta.allTags[0].category).toBe('IFD0')
    expect(meta.allTags[0].displayValue).toContain('Rotate 90° CW')
  })

  it('includes aiDetection report in inspected metadata', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    const meta = inspectMetadata(jpeg)
    expect(meta.aiDetection).toBeDefined()
    expect(meta.aiDetection?.detected).toBe(false)
  })
})

describe('file types the inspector cannot read', () => {
  it("say so, instead of claiming there's no location", () => {
    // A 1×1 BMP: it opens in browsers, but the inspector doesn't read BMP.
    const bmp = new Uint8Array([
      0x42, 0x4d, 58, 0, 0, 0, 0, 0, 0, 0, 54, 0, 0, 0, 40, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 24, 0,
      0, 0, 0, 0, 4, 0, 0, 0, 0x13, 0x0b, 0, 0, 0x13, 0x0b, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x20, 0x40, 0x80, 0
    ])
    const meta = inspectMetadata(bmp)
    expect(meta.format).toBe('unknown')
    const text = getMetadataNarrative(meta)
    expect(text).not.toMatch(/no GPS/i)
    expect(text).toMatch(/can't be read/i)
  })
})

describe('the All Tags list shows every value in full', () => {
  const jpeg = (tiff: Uint8Array) => new Uint8Array([0xff, 0xd8, ...exifApp1(tiff), ...tinyJpegBody()])
  const shown = (meta: ImageMetadata) => Object.fromEntries(meta.allTags.map((t) => [t.name, t.displayValue]))

  for (const le of [true, false]) {
    it(`multi-value, signed and byte tags (${le ? 'little' : 'big'}-endian)`, () => {
      const b = bytesFor(le)
      const xp = [...'Hi there'].flatMap((c) => [c.charCodeAt(0), 0])
      const { tiff } = rawTiff(
        [b.ascii(0x010f, 'Cañon ©'), { tag: 0x9c9c, type: 1, count: xp.length, bytes: xp }, b.short(0x4321, 1, 2, 3)],
        [
          b.undefinedBytes(0x9000, [...'0232'].map((c) => c.charCodeAt(0))),
          b.undefinedBytes(0x9101, [1, 2, 3, 0]),
          b.srational(0x9204, [-1, 3]),
          b.srational(0x9201, [8, 1]),
          b.undefinedBytes(0x927c, Array.from({ length: 300 }, (_, i) => i & 0xff)),
          b.rational(0xa432, [24, 1], [70, 1], [28, 10], [4, 1]),
          b.undefinedBytes(0x9286, [...'ASCII\0\0\0hello'].map((c) => c.charCodeAt(0)))
        ],
        [
          b.byteList(0x0000, [2, 3, 0, 0]),
          b.ascii(0x0001, 'N'),
          b.rational(0x0002, [41, 1], [52, 1], [4121, 100]),
          b.rational(0x0007, [14, 1], [5, 1], [9, 1])
        ],
        le
      )
      const meta = inspectMetadata(jpeg(tiff))
      const s = shown(meta)
      expect(meta.make).toBe('Cañon ©')
      expect(s.Make).toBe('Cañon ©')
      expect(s.XPComment).toBe('Hi there')
      expect(s['Unknown Tag (0x4321)']).toBe('1, 2, 3')
      expect(s.ExifVersion).toBe('2.32')
      expect(s.ComponentsConfiguration).toBe('Y, Cb, Cr, -')
      expect(s.ExposureBiasValue).toBe('-0.33 EV')
      expect(s.ShutterSpeedValue).toBe('1/256s')
      expect(s.MakerNote).toBe("300 bytes (the camera maker's own data)")
      expect(s.LensSpecification).toBe('24–70 mm f/2.8–4')
      expect(s.UserComment).toBe('hello')
      expect(s.GPSVersionID).toBe('2.3.0.0')
      expect(s.GPSLatitude).toBe(`41° 52' 41.21"`)
      expect(s.GPSTimeStamp).toBe('14:05:09 UTC')
      expect(s.ExifIFDPointer).toMatch(/^Exif block at byte \d+$/)
    })
  }

  it('a damaged block claiming thousands of tags lists a bounded number, quickly', () => {
    const b = bytesFor(true)
    const tags = Array.from({ length: 5000 }, (_, i) => b.ascii(0x1000 + i, 'some text value'))
    const { tiff } = rawTiff(tags)
    const start = performance.now()
    const meta = inspectMetadata(jpeg(tiff))
    expect(meta.allTags.length).toBe(MAX_LISTED_TAGS)
    expect(meta.rawTagCount).toBe(5000)
    expect(performance.now() - start).toBeLessThan(1000)
  })
})
