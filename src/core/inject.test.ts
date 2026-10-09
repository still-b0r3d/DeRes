import { describe, expect, it } from 'vitest'
import {
  buildExifTiff,
  editsFromFields,
  EMPTY_FIELDS,
  formatShutter,
  injectExif,
  injectExifJpeg,
  injectExifPng,
  normalizeExifDate,
  parseExifDate,
  parseShutter,
  readInjectorFields,
  xmpCopies,
  type ExifInjectOptions,
  type InjectorFields
} from './inject'
import { inspectMetadata } from './exif'
import { chunk, crc32, PNG_SIGNATURE } from './png'
import { jpegMarkers, phoneStyleJpeg, tinyJpegBody } from '../test/fake-exif'
import { bytesFor, exifApp1, rawTiff, xmpApp1 } from '../test/fake-tiff'

describe('EXIF Injector', () => {
  it('normalizes dates into standard EXIF format YYYY:MM:DD HH:MM:SS', () => {
    expect(normalizeExifDate('2026-10-08 14:30:00')).toBe('2026:10:08 14:30:00')
    expect(normalizeExifDate('2026-10-08T14:30:00Z')).toBe('2026:10:08 14:30:00')
    expect(normalizeExifDate('2026-10-08')).toBe('2026:10:08 00:00:00')
    const d = new Date(2026, 9, 8, 12, 0, 0)
    expect(normalizeExifDate(d)).toBe('2026:10:08 12:00:00')
  })

  it('builds specification-compliant TIFF bytes that parse cleanly', () => {
    const opts: ExifInjectOptions = {
      make: 'Nikon',
      model: 'Z8',
      artist: 'still_b0r3d',
      copyright: '2026 still_b0r3d',
      software: 'b0r3d DeRes',
      dateTime: '2026:10:08 12:00:00',
      description: 'A retro computer on a desk',
      orientation: 6,
      gps: {
        latitude: 37.774929,
        longitude: -122.419416,
        altitude: 42
      }
    }

    const tiff = buildExifTiff(opts)
    expect(tiff.length).toBeGreaterThan(50)
    expect(tiff[0]).toBe(0x49) // II
    expect(tiff[1]).toBe(0x49)
    expect(tiff[2]).toBe(0x2a) // 42
    expect(tiff[3]).toBe(0x00)

    // Wrap in dummy JPEG to test with inspectMetadata
    const dummyJpeg = new Uint8Array(2 + 10 + tiff.length + 2)
    dummyJpeg[0] = 0xff
    dummyJpeg[1] = 0xd8
    // APP1
    dummyJpeg[2] = 0xff
    dummyJpeg[3] = 0xe1
    const segLen = 2 + 6 + tiff.length
    dummyJpeg[4] = (segLen >> 8) & 0xff
    dummyJpeg[5] = segLen & 0xff
    dummyJpeg.set(new TextEncoder().encode('Exif\0\0'), 6)
    dummyJpeg.set(tiff, 12)
    dummyJpeg[dummyJpeg.length - 2] = 0xff
    dummyJpeg[dummyJpeg.length - 1] = 0xd9

    const meta = inspectMetadata(dummyJpeg)
    expect(meta.format).toBe('jpeg')
    expect(meta.make).toBe('Nikon')
    expect(meta.model).toBe('Z8')
    expect(meta.artist).toBe('still_b0r3d')
    expect(meta.copyright).toBe('2026 still_b0r3d')
    expect(meta.software).toBe('b0r3d DeRes')
    expect(meta.dateTime).toBe('2026:10:08 12:00:00')
    expect(meta.orientation).toBe(6)
    expect(meta.gps).toBeDefined()
    expect(meta.gps!.latitude).toBeCloseTo(37.774929, 4)
    expect(meta.gps!.longitude).toBeCloseTo(-122.419416, 4)
    expect(meta.gps!.altitude).toBeCloseTo(42, 0)
    expect(meta.gps!.latRef).toBe('N')
    expect(meta.gps!.lonRef).toBe('W')
  })

  it('injects EXIF tags into a raw JPEG and round-trips through inspectMetadata', () => {
    // Synthetic JPEG without EXIF
    const rawJpeg = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
      0x12, 0x34,
      0xff, 0xd9
    ])

    const initialMeta = inspectMetadata(rawJpeg)
    expect(initialMeta.make).toBeUndefined()
    expect(initialMeta.gps).toBeUndefined()

    const injected = injectExifJpeg(rawJpeg, {
      make: 'Fujifilm',
      model: 'X100VI',
      artist: 'b0r3d photographer',
      copyright: 'b0r3d.org',
      orientation: 1,
      gps: {
        latitude: 51.5074,
        longitude: -0.1278
      }
    })

    const newMeta = inspectMetadata(injected)
    expect(newMeta.format).toBe('jpeg')
    expect(newMeta.make).toBe('Fujifilm')
    expect(newMeta.model).toBe('X100VI')
    expect(newMeta.artist).toBe('b0r3d photographer')
    expect(newMeta.copyright).toBe('b0r3d.org')
    expect(newMeta.gps).toBeDefined()
    expect(newMeta.gps!.latitude).toBeCloseTo(51.5074, 3)
    expect(newMeta.gps!.longitude).toBeCloseTo(-0.1278, 3)
    expect(newMeta.gps!.latRef).toBe('N')
    expect(newMeta.gps!.lonRef).toBe('W')
  })

  it('replaces existing EXIF in JPEG without duplicating APP1 segments', () => {
    // Initial JPEG with camera Make 'OldMake'
    const initialJpeg = injectExifJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
      make: 'OldMake',
      model: 'OldModel'
    })
    expect(inspectMetadata(initialJpeg).make).toBe('OldMake')

    // Overwrite / edit tags
    const editedJpeg = injectExifJpeg(initialJpeg, {
      make: 'NewMake',
      model: 'NewModel',
      artist: 'NewArtist'
    })
    const editedMeta = inspectMetadata(editedJpeg)
    expect(editedMeta.make).toBe('NewMake')
    expect(editedMeta.model).toBe('NewModel')
    expect(editedMeta.artist).toBe('NewArtist')

    // Count APP1 segments
    let app1Count = 0
    for (let i = 0; i < editedJpeg.length - 1; i++) {
      if (editedJpeg[i] === 0xff && editedJpeg[i + 1] === 0xe1) app1Count++
    }
    expect(app1Count).toBe(1)
  })

  it('injects EXIF tags into a raw PNG via eXIf chunk and round-trips', () => {
    // Minimal valid 1x1 PNG
    const pngHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const ihdr = [
      0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00,
      0x90, 0x77, 0x53, 0xde
    ]
    const idat = [
      0x00, 0x00, 0x00, 0x02,
      0x49, 0x44, 0x41, 0x54,
      0x78, 0x9c,
      0x05, 0xb9, 0x41, 0x02
    ]
    const iend = [
      0x00, 0x00, 0x00, 0x00,
      0x49, 0x45, 0x4e, 0x44,
      0xae, 0x42, 0x60, 0x82
    ]
    const rawPng = new Uint8Array([...pngHeader, ...ihdr, ...idat, ...iend])

    expect(inspectMetadata(rawPng).make).toBeUndefined()

    const injectedPng = injectExifPng(rawPng, {
      make: 'Canon',
      model: 'EOS R5',
      artist: 'Pixel Artist',
      orientation: 3
    })

    const meta = inspectMetadata(injectedPng)
    expect(meta.format).toBe('png')
    expect(meta.make).toBe('Canon')
    expect(meta.model).toBe('EOS R5')
    expect(meta.artist).toBe('Pixel Artist')
    expect(meta.orientation).toBe(3)
  })

  it('injectExif auto-dispatches by file format', () => {
    const rawJpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xff, 0xd9
    ])
    const out = injectExif(rawJpeg, { make: 'Sony' })
    expect(inspectMetadata(out).make).toBe('Sony')
  })

  it('rejects unreadable file formats with a clear error', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    expect(() => injectExif(gif, { make: 'Test' })).toThrow(/supported for JPEG and PNG/i)
  })
})

const w = bytesFor(true)
const enc = (s: string) => new TextEncoder().encode(s)
const jpegWith = (...segments: number[][]) => new Uint8Array([0xff, 0xd8, ...segments.flat(), ...tinyJpegBody()])
/** Where a byte string starts in a file, or -1. */
function find(file: Uint8Array, text: string, from = 0): number {
  const t = enc(text)
  outer: for (let i = from; i + t.length <= file.length; i++) {
    for (let j = 0; j < t.length; j++) if (file[i + j] !== t[j]) continue outer
    return i
  }
  return -1
}
const tiffOf = (file: Uint8Array) => file.subarray(find(file, 'Exif\0\0') + 6)
const tagNames = (file: Uint8Array) => inspectMetadata(file).allTags.map((t) => t.name)

// A phone-like block: camera, rotation, exposure details the form doesn't
// show, a maker note, a serial number, GPS with a compass direction.
const MAKER_NOTE = Array.from({ length: 40 }, (_, i) => i)
function phoneBlock(le = true) {
  const b = bytesFor(le)
  return rawTiff(
    [b.ascii(0x010f, 'FakeCam'), b.ascii(0x0110, 'Test 1'), b.short(0x0112, 6), b.ascii(0x0132, '2000:01:01 00:00:00')],
    [
      b.short(0x8822, 2),
      b.rational(0x829a, [1, 250]),
      b.rational(0x829d, [178, 100]),
      b.ascii(0x9010, '+02:00'),
      b.rational(0x9202, [166, 100]),
      b.rational(0x920a, [425, 100]),
      b.undefinedBytes(0x927c, MAKER_NOTE),
      b.ascii(0xa431, 'SERIAL123')
    ],
    [
      b.byteList(0x0000, [2, 3, 0, 0]),
      b.ascii(0x0001, 'S'),
      b.rational(0x0002, [10, 1], [30, 1], [0, 1]),
      b.ascii(0x0003, 'W'),
      b.rational(0x0004, [20, 1], [15, 1], [0, 1]),
      b.byteList(0x0005, [1]),
      b.rational(0x0006, [550, 100]),
      b.rational(0x0007, [12, 1], [0, 1], [0, 1]),
      b.rational(0x0011, [90, 1])
    ],
    le
  )
}

describe('the injector edits, it does not replace', () => {
  it('typing only an Artist keeps the rotation, camera, date, GPS and every other tag', () => {
    const { tiff, valueAt } = phoneBlock()
    const out = injectExif(jpegWith(exifApp1(tiff)), { artist: 'me' })
    const meta = inspectMetadata(out)
    expect(meta.artist).toBe('me')
    expect(meta.orientation).toBe(6)
    expect(meta.make).toBe('FakeCam')
    expect(meta.model).toBe('Test 1')
    expect(meta.dateTime).toBe('2000:01:01 00:00:00')
    expect(meta.gps?.latitude).toBeCloseTo(-10.5, 6)
    expect(meta.gps?.longitude).toBeCloseTo(-20.25, 6)
    expect(meta.gps?.altitude).toBeCloseTo(-5.5, 6)
    expect(tagNames(out)).toEqual(
      expect.arrayContaining(['ExposureProgram', 'OffsetTime', 'ApertureValue', 'MakerNote', 'BodySerialNumber', 'GPSImgDirection'])
    )
    // Exact values survive: nothing was rounded and written back.
    expect(readInjectorFields(out)).toMatchObject({ aperture: '1.78', focal: '4.25', shutter: '1/250', alt: '-5.5' })
    // Some makers point inside their MakerNote from the block's start, so it stays put.
    const mnAt = valueAt.get(0x927c)!
    expect([...tiffOf(out).subarray(mnAt, mnAt + MAKER_NOTE.length)]).toEqual(MAKER_NOTE)
  })

  it('keeps a big-endian block big-endian', () => {
    const { tiff } = phoneBlock(false)
    const out = injectExif(jpegWith(exifApp1(tiff)), { copyright: '© b0r3d' })
    expect([...tiffOf(out).subarray(0, 2)]).toEqual([0x4d, 0x4d])
    const meta = inspectMetadata(out)
    expect(meta.copyright).toBe('© b0r3d')
    expect(meta.orientation).toBe(6)
    expect(meta.gps?.latitude).toBeCloseTo(-10.5, 6)
  })

  it('keeps the thumbnail', () => {
    const thumb = Uint8Array.from([0xff, 0xd8, 1, 2, 3, 4, 5, 0xff, 0xd9])
    const photo = phoneStyleJpeg(new Uint8Array([0xff, 0xd8, ...tinyJpegBody()]), { make: 'FakeCam', thumbnail: thumb })
    const meta = inspectMetadata(injectExif(photo, { artist: 'me' }))
    expect(meta.thumbnail?.data).toEqual(thumb)
    expect(meta.make).toBe('FakeCam')
  })

  it('an emptied field removes its tag, and removing everything removes the block', () => {
    const { tiff } = phoneBlock()
    const photo = jpegWith(exifApp1(tiff))
    const noGps = inspectMetadata(injectExif(photo, { gps: null, orientation: null, make: '' }))
    expect(noGps.gps).toBeUndefined()
    expect(noGps.orientation).toBeUndefined()
    expect(noGps.make).toBeUndefined()
    expect(noGps.model).toBe('Test 1')

    const small = jpegWith(exifApp1(rawTiff([w.ascii(0x010f, 'FakeCam'), w.short(0x0112, 6)]).tiff))
    const none = injectExif(small, { make: null, orientation: null })
    expect(jpegMarkers(none)).not.toContain(0xe1)
    expect(inspectMetadata(none).rawTagCount).toBe(0)
  })

  it('a changed date drops the old time zone and GPS clock; a changed f-number drops its APEX copy', () => {
    const { tiff } = phoneBlock()
    const out = injectExif(jpegWith(exifApp1(tiff)), { dateTime: '2026:10:08 14:30:00', fNumber: 2.8 })
    const names = tagNames(out)
    expect(names).not.toContain('OffsetTime')
    expect(names).not.toContain('GPSTimeStamp')
    expect(names).not.toContain('ApertureValue')
    expect(names).toEqual(expect.arrayContaining(['DateTime', 'DateTimeOriginal', 'DateTimeDigitized', 'GPSImgDirection']))
    expect(inspectMetadata(out).fNumber).toBe(2.8)
  })

  it('a new location replaces the whole GPS block', () => {
    const { tiff } = phoneBlock()
    const out = injectExif(jpegWith(exifApp1(tiff)), { gps: { latitude: 41.878113, longitude: -87.629799, altitude: 182 } })
    const meta = inspectMetadata(out)
    expect(meta.gps?.latitude).toBeCloseTo(41.878113, 6)
    expect(meta.gps?.longitude).toBeCloseTo(-87.629799, 6)
    expect(meta.gps?.altitude).toBe(182)
    expect(tagNames(out)).not.toContain('GPSImgDirection')
  })

  it('never writes 60 seconds into a coordinate', () => {
    const out = injectExif(jpegWith(), { gps: { latitude: 10.99999999, longitude: 0 } })
    const lat = inspectMetadata(out).allTags.find((t) => t.name === 'GPSLatitude')!.displayValue
    expect(lat).toBe(`11° 0' 0"`)
  })

  it('removes the XMP block only when asked', () => {
    const { tiff } = phoneBlock()
    const xmp = '<x:xmpmeta><rdf:Description exif:GPSLatitude="10,30S"/></x:xmpmeta>'
    const photo = jpegWith(exifApp1(tiff), xmpApp1(xmp))
    expect(inspectMetadata(injectExif(photo, { artist: 'me' })).xmpText).toContain('GPSLatitude')
    expect(inspectMetadata(injectExif(photo, { artist: 'me' }, { removeXmp: true })).xmpText).toBeUndefined()
    expect(xmpCopies(xmp)).toEqual(['location'])
    expect(xmpCopies('<x:xmpmeta xmp:CreateDate="2020" tiff:Make="X"/>')).toEqual(['date', 'camera'])
  })

  it('puts a new block after the JFIF header, or right after SOI on a phone-style JPEG, and keeps what follows the picture', () => {
    const app0 = [0xff, 0xe0, 0x00, 0x10, ...enc('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]
    const trailer = [...enc('MOTIONPHOTO')]
    const jfif = new Uint8Array([0xff, 0xd8, ...app0, ...tinyJpegBody(), ...trailer])
    const out = injectExif(jfif, { make: 'X' })
    expect(jpegMarkers(out).slice(0, 2)).toEqual([0xe0, 0xe1])
    expect([...out.subarray(-trailer.length)]).toEqual(trailer)
    expect(jpegMarkers(injectExif(jpegWith(), { make: 'X' }))[0]).toBe(0xe1)
  })

  it('JPEG EXIF over 64 KB is refused with a clear message', () => {
    expect(() => injectExif(jpegWith(), { description: 'x'.repeat(70000) })).toThrow(/at most 64 KB/)
  })
})

describe('PNG editing', () => {
  const IHDR = chunk('IHDR', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]))
  const ICCP = chunk('iCCP', new Uint8Array([...enc('sRGB'), 0, 0, 0x78, 0x9c, 3, 0, 0, 0, 0, 1]))
  const IDAT = chunk('IDAT', new Uint8Array([0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0, 0, 0, 4, 0, 1]))
  const IEND = chunk('IEND', new Uint8Array(0))
  /** Chunk types in order, checking every CRC on the way. */
  const types = (png: Uint8Array) => {
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
    const out: string[] = []
    for (let p = 8; p + 12 <= png.length; ) {
      const len = view.getUint32(p)
      out.push(String.fromCharCode(...png.subarray(p + 4, p + 8)))
      expect(view.getUint32(p + 8 + len)).toBe(crc32(png.subarray(p + 4, p + 8 + len)))
      p += 12 + len
    }
    return out
  }

  it('edits the eXIf chunk where it is, and leaves the colour profile, XMP and anything after IEND alone', () => {
    const exif = chunk('eXIf', phoneBlock().tiff)
    const xmp = chunk('iTXt', new Uint8Array([...enc('XML:com.adobe.xmp'), 0, 0, 0, 0, 0, ...enc('<x:xmpmeta/>')]))
    const png = new Uint8Array([...PNG_SIGNATURE, ...IHDR, ...ICCP, ...exif, ...xmp, ...IDAT, ...IEND, ...enc('TAIL')])
    const out = injectExif(png, { artist: 'me' })
    expect(types(out.subarray(0, out.length - 4))).toEqual(['IHDR', 'iCCP', 'eXIf', 'iTXt', 'IDAT', 'IEND'])
    expect([...out.subarray(-4)]).toEqual([...enc('TAIL')])
    const meta = inspectMetadata(out)
    expect(meta.artist).toBe('me')
    expect(meta.orientation).toBe(6)
    expect(meta.hasIccProfile).toBe(true)
    const noXmp = injectExif(png, { artist: 'me' }, { removeXmp: true })
    expect(types(noXmp.subarray(0, noXmp.length - 4))).not.toContain('iTXt')
  })

  it('a new eXIf chunk goes right after IHDR', () => {
    const png = new Uint8Array([...PNG_SIGNATURE, ...IHDR, ...IDAT, ...IEND])
    expect(types(injectExif(png, { make: 'X' }))).toEqual(['IHDR', 'eXIf', 'IDAT', 'IEND'])
  })
})

describe('the form', () => {
  const photo = () => jpegWith(exifApp1(phoneBlock().tiff))
  const loaded = () => readInjectorFields(photo())

  it('starts with exactly what the photo has', () => {
    expect(loaded()).toEqual({
      ...EMPTY_FIELDS,
      make: 'FakeCam',
      model: 'Test 1',
      orientation: '6',
      dateTime: '2000:01:01 00:00:00',
      aperture: '1.78',
      shutter: '1/250',
      focal: '4.25',
      lat: '-10.5',
      lon: '-20.25',
      alt: '-5.5'
    })
    expect(readInjectorFields(jpegWith())).toEqual(EMPTY_FIELDS)
  })

  it('unchanged fields are left alone; changed ones are written; emptied ones removed', () => {
    const before = loaded()
    expect(editsFromFields(before, before)).toEqual({ edits: {} })
    const now: InjectorFields = { ...before, artist: 'me', model: '', shutter: '1/500s', lat: '1', lon: '2', alt: '' }
    expect(editsFromFields(now, before).edits).toEqual({
      artist: 'me',
      model: null,
      exposureTime: [1, 500],
      gps: { latitude: 1, longitude: 2, altitude: undefined }
    })
    expect(editsFromFields({ ...before, lat: '', lon: '', alt: '' }, before).edits).toEqual({ gps: null })
  })

  it('refuses what is not a real value, saying which field and why', () => {
    const before = loaded()
    const error = (patch: Partial<InjectorFields>) => editsFromFields({ ...before, ...patch }, before).error
    expect(error({ shutter: 'abc' })).toMatchObject({ field: 'shutter', message: expect.stringContaining('Shutter speed') })
    expect(error({ shutter: '0' })?.field).toBe('shutter')
    expect(error({ iso: '70000' })?.message).toContain('1 to 65535')
    expect(error({ iso: '100.5' })?.field).toBe('iso')
    expect(error({ aperture: '-2' })?.field).toBe('aperture')
    expect(error({ focal: '0' })?.field).toBe('focal')
    expect(error({ lat: '200' })?.message).toContain('-90 to 90')
    expect(error({ lon: '-181' })?.field).toBe('lon')
    expect(error({ lon: '' })?.message).toContain('both latitude and longitude')
    expect(error({ lat: '', lon: '', alt: '5' })?.field).toBe('alt')
    expect(error({ dateTime: 'yesterday' })?.field).toBe('dateTime')
    expect(error({ dateTime: '2026:02:30 10:00:00' })?.field).toBe('dateTime')
  })
})

describe('reading typed values', () => {
  it('dates in the spellings people use', () => {
    expect(parseExifDate('2026:10:08 14:30:00')).toBe('2026:10:08 14:30:00')
    expect(parseExifDate('2026-10-08T14:30')).toBe('2026:10:08 14:30:00')
    expect(parseExifDate('2026-10-08 9:05')).toBe('2026:10:08 09:05:00')
    expect(parseExifDate('2026-10-08')).toBe('2026:10:08 00:00:00')
    expect(parseExifDate('2024-02-29 12:00:00')).toBe('2024:02:29 12:00:00')
    expect(parseExifDate('2023-02-29 12:00:00')).toBeNull()
    expect(parseExifDate('2026-10-08 24:00')).toBeNull()
    expect(parseExifDate('yesterday')).toBeNull()
    expect(() => normalizeExifDate('yesterday')).toThrow()
  })

  it('shutter speeds', () => {
    expect(parseShutter('1/250')).toEqual([1, 250])
    expect(parseShutter('1/250s')).toEqual([1, 250])
    expect(parseShutter('0.004')).toEqual([1, 250])
    expect(parseShutter('2')).toEqual([2, 1])
    expect(parseShutter('30"')).toEqual([30, 1])
    expect(parseShutter('0.8')).toEqual([4, 5])
    expect(parseShutter('abc')).toBeNull()
    expect(parseShutter('0')).toBeNull()
    expect(parseShutter('1/0')).toBeNull()
    expect(formatShutter([1, 250])).toBe('1/250')
    expect(formatShutter([4, 5])).toBe('0.8')
    expect(formatShutter([10, 2500])).toBe('1/250')
    expect(formatShutter([2, 1])).toBe('2')
  })
})
