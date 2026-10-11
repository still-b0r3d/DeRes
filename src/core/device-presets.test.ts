import { describe, expect, it } from 'vitest'
import { DEVICE_PRESETS, formShowsPreset, presetById, presetExtras, PRESET_FIELD_KEYS } from './device-presets'
import { inspectMetadata } from './exif'
import { editsFromFields, EMPTY_FIELDS, injectExif, readInjectorFields } from './inject'
import { tinyJpegBody } from '../test/fake-exif'
import { bytesFor, exifApp1, rawTiff } from '../test/fake-tiff'

const bareJpeg = () => new Uint8Array([0xff, 0xd8, ...tinyJpegBody()])
const jpegWith = (segment: number[]) => new Uint8Array([0xff, 0xd8, ...segment, ...tinyJpegBody()])
const tag = (file: Uint8Array, id: number) => inspectMetadata(file).allTags.find((t) => t.tagId === id)

/** What injecting a preset writes, the way the form does it (preset fields, then the extras). */
function injectPreset(photo: Uint8Array, id: string, loaded = readInjectorFields(photo)) {
  const p = presetById(id)!
  const { edits, error } = editsFromFields({ ...loaded, ...p.fields }, loaded)
  if (error) throw new Error(error.message)
  return injectExif(photo, { ...edits, ...presetExtras(p) })
}

describe('device presets', () => {
  it('each has its own id and fills every camera, lens and exposure field', () => {
    expect(new Set(DEVICE_PRESETS.map((p) => p.id)).size).toBe(DEVICE_PRESETS.length)
    for (const p of DEVICE_PRESETS) {
      expect(Object.keys(p.fields).sort(), p.id).toEqual([...PRESET_FIELD_KEYS].sort())
      expect(p.fields.make, p.id).not.toBe('')
      expect(p.fields.model, p.id).not.toBe('')
    }
  })

  it('every preset passes the form check and reads back exactly as written', () => {
    for (const p of DEVICE_PRESETS) {
      const out = injectPreset(bareJpeg(), p.id)
      expect(readInjectorFields(out), p.id).toMatchObject(p.fields)
      const meta = inspectMetadata(out)
      expect(meta.make, p.id).toBe(p.fields.make)
      expect(meta.model, p.id).toBe(p.fields.model)
    }
  })

  it('writes the phone details the form does not show: LensMake and the 35 mm focal length', () => {
    const out = injectPreset(bareJpeg(), 'iphone-15-pro')
    expect(tag(out, 0xa433)?.displayValue).toBe('Apple')
    expect(tag(out, 0xa405)?.rawValue).toBe(24)
    const meta = inspectMetadata(out)
    expect(meta.lensModel).toBe('iPhone 15 Pro back triple camera 6.765mm f/1.78')
    expect(meta.software).toBe('17.4.1')
    // Thousandths kept, as the phone writes it.
    expect(readInjectorFields(out).focal).toBe('6.765')
  })

  it("forgets the old camera: its maker data, serial numbers and lens make go; the date, rotation and place stay", () => {
    const b = bytesFor(true)
    const { tiff } = rawTiff(
      [b.ascii(0x010f, 'Google'), b.ascii(0x0110, 'Pixel 7'), b.short(0x0112, 6), b.ascii(0x0132, '2024:05:01 10:00:00')],
      [
        b.undefinedBytes(0x927c, Array.from({ length: 40 }, (_, i) => i)),
        b.ascii(0xa431, 'SERIAL123'),
        b.ascii(0xa433, 'Google'),
        b.ascii(0xa434, 'Pixel 7 back camera 6.81mm f/1.85'),
        b.short(0xa405, 25)
      ],
      [b.ascii(0x0001, 'N'), b.rational(0x0002, [10, 1], [0, 1], [0, 1]), b.ascii(0x0003, 'E'), b.rational(0x0004, [20, 1], [0, 1], [0, 1])]
    )
    const out = injectPreset(jpegWith(exifApp1(tiff)), 'coolpix-990')
    const names = inspectMetadata(out).allTags.map((t) => t.name)
    for (const gone of ['MakerNote', 'BodySerialNumber', 'LensMake', 'LensModel', 'FocalLengthIn35mmFilm']) {
      expect(names, gone).not.toContain(gone)
    }
    const meta = inspectMetadata(out)
    expect(meta.make).toBe('NIKON')
    expect(meta.model).toBe('E990')
    expect(meta.software).toBe('E990v1.0')
    expect(meta.orientation).toBe(6)
    expect(meta.dateTime).toBe('2024:05:01 10:00:00')
    expect(meta.gps?.latitude).toBeCloseTo(10, 6)
  })

  it('a handheld with no lens or exposure details removes the old ones', () => {
    const before = injectPreset(bareJpeg(), 'iphone-15-pro')
    const out = injectPreset(before, 'game-boy-camera')
    const meta = inspectMetadata(out)
    expect(meta.make).toBe('Nintendo')
    expect(meta.model).toBe('Game Boy Camera')
    for (const k of ['lensModel', 'fNumber', 'exposureTime', 'iso', 'focalLength', 'software'] as const) {
      expect(meta[k], k).toBeUndefined()
    }
    expect(tag(out, 0xa433)).toBeUndefined()
  })

  it('the extras only apply while the form still names the preset camera', () => {
    const p = presetById('pixel-8-pro')!
    expect(formShowsPreset(p, { make: 'Google', model: 'Pixel 8 Pro' })).toBe(true)
    expect(formShowsPreset(p, { make: ' Google ', model: 'Pixel 8 Pro ' })).toBe(true)
    expect(formShowsPreset(p, { make: 'Google', model: 'Pixel 9' })).toBe(false)
    expect(formShowsPreset(p, { ...EMPTY_FIELDS })).toBe(false)
  })
})
