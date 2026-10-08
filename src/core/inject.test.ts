import { describe, expect, it } from 'vitest'
import {
  buildExifTiff,
  injectExif,
  injectExifJpeg,
  injectExifPng,
  normalizeExifDate,
  type ExifInjectOptions
} from './inject'
import { inspectMetadata } from './exif'

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
