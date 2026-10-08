// Test helper: builds made-up EXIF blocks the way phones write them, so the
// scrubber can be tested without real photos. Nothing here ships in the app.
// Only fake data goes in (a fake camera, coordinates 0,0).

export interface FakeExif {
  make?: string
  model?: string
  orientation?: number
  dateTime?: string
  /** Decimal degrees. */
  gps?: { lat: number; lon: number }
  /** A JPEG thumbnail stored in IFD1. */
  thumbnail?: Uint8Array
  bigEndian?: boolean
}

interface Entry {
  tag: number
  type: number
  count: number
  bytes: Uint8Array
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }

function ascii(tag: number, text: string): Entry {
  const bytes = new Uint8Array(text.length + 1)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0x7f
  return { tag, type: 2, count: bytes.length, bytes }
}

/** Builds a TIFF block (the part after "Exif\0\0") holding the given tags. */
export function buildFakeTiff(f: FakeExif): Uint8Array {
  const le = !f.bigEndian
  const u16 = (v: number) => (le ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff])
  const u32 = (v: number) =>
    le ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24] : [v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
  const short = (tag: number, v: number): Entry => ({ tag, type: 3, count: 1, bytes: new Uint8Array(u16(v)) })
  const long = (tag: number, v: number): Entry => ({ tag, type: 4, count: 1, bytes: new Uint8Array(u32(v)) })
  const dms = (tag: number, deg: number): Entry => {
    const a = Math.abs(deg)
    const d = Math.floor(a)
    const m = Math.floor((a - d) * 60)
    const s = Math.round(((a - d) * 60 - m) * 60 * 100)
    return { tag, type: 5, count: 3, bytes: new Uint8Array([...u32(d), ...u32(1), ...u32(m), ...u32(1), ...u32(s), ...u32(100)]) }
  }

  const ifd0: Entry[] = []
  if (f.make) ifd0.push(ascii(0x010f, f.make))
  if (f.model) ifd0.push(ascii(0x0110, f.model))
  if (f.orientation) ifd0.push(short(0x0112, f.orientation))
  if (f.dateTime) ifd0.push(ascii(0x0132, f.dateTime))
  const gpsIfd: Entry[] = []
  if (f.gps) {
    ifd0.push(long(0x8825, 0)) // patched below
    gpsIfd.push({ tag: 0x0000, type: 1, count: 4, bytes: new Uint8Array([2, 3, 0, 0]) })
    gpsIfd.push(ascii(0x0001, f.gps.lat < 0 ? 'S' : 'N'))
    gpsIfd.push(dms(0x0002, f.gps.lat))
    gpsIfd.push(ascii(0x0003, f.gps.lon < 0 ? 'W' : 'E'))
    gpsIfd.push(dms(0x0004, f.gps.lon))
  }
  const ifd1: Entry[] = []
  if (f.thumbnail) {
    ifd1.push(long(0x0201, 0)) // patched below
    ifd1.push(long(0x0202, f.thumbnail.length))
  }

  const ifdSize = (n: number) => 2 + n * 12 + 4
  const extra = (list: Entry[]) => list.reduce((s, e) => s + (e.bytes.length > 4 ? e.bytes.length + (e.bytes.length & 1) : 0), 0)
  const ifd0At = 8
  const ifd0Data = ifd0At + ifdSize(ifd0.length)
  const gpsAt = ifd0Data + extra(ifd0)
  const gpsData = gpsAt + (gpsIfd.length ? ifdSize(gpsIfd.length) : 0)
  const ifd1At = gpsData + extra(gpsIfd)
  const thumbAt = ifd1At + (ifd1.length ? ifdSize(ifd1.length) : 0)
  const total = thumbAt + (f.thumbnail?.length ?? 0)

  if (f.gps) ifd0.find((e) => e.tag === 0x8825)!.bytes = new Uint8Array(u32(gpsAt))
  if (f.thumbnail) ifd1[0].bytes = new Uint8Array(u32(thumbAt))

  const out = new Uint8Array(total)
  out.set(le ? [0x49, 0x49, 0x2a, 0x00] : [0x4d, 0x4d, 0x00, 0x2a], 0)
  out.set(u32(ifd0At), 4)

  const writeIfd = (list: Entry[], at: number, dataAt: number, next: number) => {
    list.sort((a, b) => a.tag - b.tag)
    out.set(u16(list.length), at)
    let p = at + 2
    let d = dataAt
    for (const e of list) {
      out.set([...u16(e.tag), ...u16(e.type), ...u32(e.count)], p)
      if (e.count * TYPE_SIZE[e.type] <= 4) {
        out.set(e.bytes, p + 8)
      } else {
        out.set(u32(d), p + 8)
        out.set(e.bytes, d)
        d += e.bytes.length + (e.bytes.length & 1)
      }
      p += 12
    }
    out.set(u32(next), p)
  }
  writeIfd(ifd0, ifd0At, ifd0Data, ifd1.length ? ifd1At : 0)
  if (gpsIfd.length) writeIfd(gpsIfd, gpsAt, gpsData, 0)
  if (ifd1.length) writeIfd(ifd1, ifd1At, thumbAt, 0)
  if (f.thumbnail) out.set(f.thumbnail, thumbAt)
  return out
}

/** A JPEG APP1 "Exif" segment wrapping the given tags. */
export function fakeExifApp1(f: FakeExif): Uint8Array {
  const tiff = buildFakeTiff(f)
  const len = 2 + 6 + tiff.length
  return new Uint8Array([0xff, 0xe1, len >> 8, len & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff])
}

/**
 * Rebuilds a JPEG the way phones lay it out: SOI, then the Exif APP1 straight
 * away (no JFIF APP0), then the rest of the file's own segments. Any APPn or
 * COM segments in the input are dropped first.
 */
export function phoneStyleJpeg(jpeg: Uint8Array, f: FakeExif, trailer?: Uint8Array): Uint8Array {
  const kept: number[] = []
  let pos = 2
  while (pos + 4 <= jpeg.length) {
    const marker = jpeg[pos + 1]
    if (marker === 0xda) {
      kept.push(...jpeg.subarray(pos))
      break
    }
    const len = (jpeg[pos + 2] << 8) | jpeg[pos + 3]
    const isApp = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe
    if (!isApp) kept.push(...jpeg.subarray(pos, pos + 2 + len))
    pos += 2 + len
  }
  return new Uint8Array([0xff, 0xd8, ...fakeExifApp1(f), ...kept, ...(trailer ?? [])])
}

/**
 * A HEIF-family file (HEIC or AVIF) as far as the inspector reads it: an ftyp
 * box with the given brands, then an mdat box holding an Exif item. There is
 * no real picture in it, so no browser can show it.
 */
export function fakeHeif(major: string, compatible: string[], f: FakeExif): Uint8Array {
  const text = (s: string) => [...s].map((c) => c.charCodeAt(0))
  const box = (type: string, body: number[]) => {
    const n = 8 + body.length
    return [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, ...text(type), ...body]
  }
  const ftyp = box('ftyp', [...text(major), 0, 0, 0, 0, ...compatible.flatMap(text)])
  // An Exif item: 4-byte offset to the TIFF header, "Exif\0\0", the TIFF block.
  const mdat = box('mdat', [0, 0, 0, 6, ...text('Exif'), 0, 0, ...buildFakeTiff(f)])
  return new Uint8Array([...ftyp, ...mdat])
}

/** The smallest JPEG-shaped byte stream the scrubber walks: tables are fake, no decoder will open it. */
export function tinyJpegBody(): number[] {
  return [
    0xff, 0xdb, 0x00, 0x04, 0x00, 0x01, // DQT (fake)
    0xff, 0xc0, 0x00, 0x05, 0x08, 0x00, 0x01, // SOF0 (fake)
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, // SOS
    0x11, 0x22, 0xff, 0x00, 0x33, // scan data with a stuffed FF
    0xff, 0xd9 // EOI
  ]
}

/** Every JPEG segment marker in order (FFxx), up to and including SOS. */
export function jpegMarkers(jpeg: Uint8Array): number[] {
  const out: number[] = []
  let pos = 2
  while (pos + 4 <= jpeg.length) {
    const marker = jpeg[pos + 1]
    out.push(marker)
    if (marker === 0xda) break
    pos += 2 + ((jpeg[pos + 2] << 8) | jpeg[pos + 3])
  }
  return out
}
