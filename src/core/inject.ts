// EXIF injector
// Edits a JPEG's or PNG's EXIF in place, byte by byte, without touching the
// pixels. Only the fields asked for change; every other tag the photo has
// (exposure program, flash, serial numbers, the maker's own data, the
// thumbnail ...) is copied across as it was, in the photo's own byte order.
//
// An edit is `undefined` (keep what the photo has), `null` or '' (remove the
// tag) or a value (write it).

import { crc32 } from './png'
import {
  detectFormat,
  PNG_XMP_KEYWORD,
  startsWithText,
  TYPE_SIZE,
  XMP_EXTENSION_SIG,
  XMP_SIG
} from './exif'

export interface ExifEdits {
  make?: string | null
  model?: string | null
  lensModel?: string | null
  artist?: string | null
  copyright?: string | null
  software?: string | null
  description?: string | null
  /** "YYYY:MM:DD HH:MM:SS"; other spellings go through parseExifDate. */
  dateTime?: string | null
  /** 1–8. */
  orientation?: number | null
  iso?: number | null
  fNumber?: number | null
  /** Seconds, "1/250", or an exact [numerator, denominator]. */
  exposureTime?: string | number | [number, number] | null
  /** Millimetres. */
  focalLength?: number | null
  /** Writing a location replaces the whole GPS block; null removes it. */
  gps?: { latitude: number; longitude: number; altitude?: number } | null
  /** A JPEG thumbnail for IFD1; null removes the thumbnail. */
  thumbnail?: Uint8Array | null
}

/** The older name, kept for callers that build EXIF from scratch. */
export type ExifInjectOptions = ExifEdits

export interface InjectOptions {
  /** Also drop the photo's XMP block (it can hold its own copy of the location, date and camera). */
  removeXmp?: boolean
}

// ---------------------------------------------------------------------------
// Dates, shutter speeds and other input

const pad2 = (n: number) => String(n).padStart(2, '0')

function exifDateOf(d: Date): string {
  return `${d.getFullYear()}:${pad2(d.getMonth() + 1)}:${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

/**
 * Reads a date the way people type it (2026:10:08 14:30:00, 2026-10-08
 * 14:30, 2026-10-08T14:30:00Z, 2026-10-08) and returns EXIF's
 * "YYYY:MM:DD HH:MM:SS", or null when it isn't a real date and time.
 */
export function parseExifDate(text: string): string | null {
  const m = /^(\d{4})[:\-/.](\d{1,2})[:\-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(?:Z|[+-]\d{2}:?\d{2})?$/i.exec(
    text.trim()
  )
  if (!m) return null
  const [y, mo, d, h = 0, mi = 0, s = 0] = m.slice(1).map((v) => (v === undefined ? undefined : Number(v))) as number[]
  const daysInMonth = new Date(y, mo, 0).getDate()
  if (y < 1000 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth || h > 23 || mi > 59 || s > 59) return null
  return `${y}:${pad2(mo)}:${pad2(d)} ${pad2(h)}:${pad2(mi)}:${pad2(s)}`
}

/** EXIF's date format for now (no argument), a Date, or typed text (which must be a real date). */
export function normalizeExifDate(d?: string | Date): string {
  if (d === undefined) return exifDateOf(new Date())
  if (d instanceof Date) return exifDateOf(d)
  const parsed = parseExifDate(d)
  if (!parsed) throw new Error(`Not a date and time: "${d}"`)
  return parsed
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b]
  return a
}

/** x as a fraction with the given denominator, reduced: 1.4 → [7, 5]. */
function toRational(x: number, den: number): [number, number] {
  const num = Math.round(x * den)
  const g = gcd(num, den) || 1
  return [num / g, den / g]
}

/**
 * A shutter speed as typed (1/250, 1/250s, 0.004, 2, 2s, 30") as an exact
 * fraction of a second, or null when it isn't one.
 */
export function parseShutter(text: string): [number, number] | null {
  const t = text.trim().replace(/\s*(s|sec|"|″)$/i, '')
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t)
  if (frac) {
    const num = Number(frac[1])
    const den = Number(frac[2])
    if (num <= 0 || den <= 0 || num > 0xffffffff || den > 0xffffffff) return null
    return [num, den]
  }
  if (!/^\d*\.?\d+$/.test(t)) return null
  const x = Number(t)
  if (!(x > 0) || x > 86400) return null
  if (x < 1) {
    const inv = 1 / x
    if (Math.abs(inv - Math.round(inv)) < 1e-6 * inv) return [1, Math.round(inv)]
  }
  return toRational(x, 10000)
}

/** A shutter fraction the way a camera writes it: 1/250, 2, 0.8. */
export function formatShutter([num, den]: [number, number]): string {
  if (den === 0) return ''
  if (num === 1) return `1/${den}`
  if (den === 1) return String(num)
  if (num < den && den % num === 0) return `1/${den / num}`
  return String(Number((num / den).toFixed(4)))
}

const trimNum = (x: number, places: number) => String(Number(x.toFixed(places)))

// ---------------------------------------------------------------------------
// The EXIF block as a set of tags

interface Entry {
  type: number
  count: number
  /** The value's bytes, in the block's byte order. */
  bytes: Uint8Array
}

interface ExifModel {
  le: boolean
  ifd0: Map<number, Entry>
  exif: Map<number, Entry>
  gps: Map<number, Entry>
  interop: Map<number, Entry>
  ifd1: Map<number, Entry>
  thumbnail?: Uint8Array
  /** Where the MakerNote sat in the photo's block. */
  makerNoteAt?: number
}

const IFD0_EXIF = 0x8769
const IFD0_GPS = 0x8825
const EXIF_INTEROP = 0xa005
const IFD1_THUMB_AT = 0x0201
const IFD1_THUMB_LEN = 0x0202
const MAKER_NOTE = 0x927c
/** More tags than this in one block means it's damaged. */
const MAX_ENTRIES = 1000

function emptyModel(le = true): ExifModel {
  return { le, ifd0: new Map(), exif: new Map(), gps: new Map(), interop: new Map(), ifd1: new Map() }
}

/** Reads a TIFF block into tags. Anything that can't be read is left out. */
function parseExifBlock(tiff: Uint8Array): ExifModel | null {
  if (tiff.length < 8) return null
  const le = tiff[0] === 0x49 && tiff[1] === 0x49
  if (!le && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return null
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)
  const u16 = (at: number) => (at + 2 <= tiff.length ? view.getUint16(at, le) : 0)
  const u32 = (at: number) => (at + 4 <= tiff.length ? view.getUint32(at, le) : 0)
  if (u16(2) !== 42) return null

  const model = emptyModel(le)
  const offsets = new Map<number, number>()

  const readIfd = (at: number, into: Map<number, Entry>, keepOffsetsOf: number[] = []): number => {
    if (at < 8 || at + 2 > tiff.length) return 0
    const n = Math.min(u16(at), MAX_ENTRIES)
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12
      if (e + 12 > tiff.length) break
      const tag = u16(e)
      const type = u16(e + 2)
      const count = u32(e + 4)
      const size = TYPE_SIZE[type]
      if (!size) continue
      const total = count * size
      if (keepOffsetsOf.includes(tag)) offsets.set(tag, u32(e + 8))
      let start = e + 8
      if (total > 4) {
        start = u32(e + 8)
        if (start + total > tiff.length) continue
        if (tag === MAKER_NOTE) model.makerNoteAt = start
      }
      into.set(tag, { type, count, bytes: tiff.slice(start, start + total) })
    }
    return u32(at + 2 + n * 12)
  }

  const ifd1At = readIfd(u32(4), model.ifd0, [IFD0_EXIF, IFD0_GPS])
  if (offsets.has(IFD0_EXIF)) readIfd(offsets.get(IFD0_EXIF)!, model.exif, [EXIF_INTEROP])
  if (offsets.has(IFD0_GPS)) readIfd(offsets.get(IFD0_GPS)!, model.gps)
  if (offsets.has(EXIF_INTEROP)) readIfd(offsets.get(EXIF_INTEROP)!, model.interop)
  if (ifd1At) {
    readIfd(ifd1At, model.ifd1, [IFD1_THUMB_AT, IFD1_THUMB_LEN])
    const at = offsets.get(IFD1_THUMB_AT)
    const len = offsets.get(IFD1_THUMB_LEN)
    if (at !== undefined && len !== undefined && len > 0 && at + len <= tiff.length) {
      model.thumbnail = tiff.slice(at, at + len)
    } else {
      // A thumbnail kept as strips (not seen in phone photos) can't be moved
      // safely, so that IFD goes.
      model.ifd1.clear()
    }
  }
  // Pointers are written fresh. SubIFDs (0x014a) point at blocks this
  // doesn't copy, so a stale pointer to them would be worse than none.
  for (const tag of [IFD0_EXIF, IFD0_GPS, 0x014a]) model.ifd0.delete(tag)
  model.exif.delete(EXIF_INTEROP)
  model.ifd1.delete(IFD1_THUMB_AT)
  model.ifd1.delete(IFD1_THUMB_LEN)
  return model
}

/** Builds the TIFF block, or null when no tag is left. */
function serializeExif(model: ExifModel): Uint8Array | null {
  const { le } = model
  const ifd1 = new Map(model.ifd1)
  if (model.thumbnail) {
    ifd1.set(IFD1_THUMB_AT, { type: 4, count: 1, bytes: new Uint8Array(4) })
    ifd1.set(IFD1_THUMB_LEN, { type: 4, count: 1, bytes: new Uint8Array(4) })
  } else {
    ifd1.clear()
  }
  const exif = new Map(model.exif)
  if (model.interop.size) exif.set(EXIF_INTEROP, { type: 4, count: 1, bytes: new Uint8Array(4) })
  const ifd0 = new Map(model.ifd0)
  if (exif.size) ifd0.set(IFD0_EXIF, { type: 4, count: 1, bytes: new Uint8Array(4) })
  if (model.gps.size) ifd0.set(IFD0_GPS, { type: 4, count: 1, bytes: new Uint8Array(4) })
  if (!ifd0.size && !ifd1.size) return null

  const ifds: { name: string; tags: Map<number, Entry> }[] = [
    { name: 'ifd0', tags: ifd0 },
    { name: 'exif', tags: exif },
    { name: 'interop', tags: model.interop },
    { name: 'gps', tags: model.gps },
    { name: 'ifd1', tags: ifd1 }
  ].filter((d) => d.name === 'ifd0' || d.tags.size > 0)

  // Tables first, then the values that don't fit in their 4-byte slot.
  const at = new Map<string, number>()
  let cursor = 8
  for (const d of ifds) {
    at.set(d.name, cursor)
    cursor += 2 + d.tags.size * 12 + 4
  }
  const tablesEnd = cursor
  const where = new Map<Entry, number>()
  const big: Entry[] = []
  let makerNote: Entry | undefined
  for (const d of ifds) {
    for (const [tag, e] of d.tags) {
      if (e.bytes.length <= 4) continue
      if (d.name === 'exif' && tag === MAKER_NOTE) makerNote = e
      else big.push(e)
    }
  }
  const align = (n: number) => n + (n % 2)
  // Some makers (Canon, Sony …) point inside their MakerNote from the start
  // of the block, so it stays at the same place when it can.
  const mnAt =
    makerNote && model.makerNoteAt !== undefined && model.makerNoteAt >= tablesEnd && model.makerNoteAt % 2 === 0
      ? model.makerNoteAt
      : undefined
  const later: Entry[] = []
  for (const e of big) {
    if (mnAt !== undefined && cursor + e.bytes.length > mnAt) {
      later.push(e)
      continue
    }
    where.set(e, cursor)
    cursor = align(cursor + e.bytes.length)
  }
  if (makerNote) {
    const mnStart = mnAt ?? cursor
    where.set(makerNote, mnStart)
    cursor = align(mnStart + makerNote.bytes.length)
  }
  for (const e of later) {
    where.set(e, cursor)
    cursor = align(cursor + e.bytes.length)
  }
  const thumbAt = cursor
  if (model.thumbnail) cursor = align(cursor + model.thumbnail.length)

  const out = new Uint8Array(cursor)
  const view = new DataView(out.buffer)
  out[0] = out[1] = le ? 0x49 : 0x4d
  view.setUint16(2, 42, le)
  view.setUint32(4, 8, le)

  const pointerTo: Record<number, number> = {
    [IFD0_EXIF]: at.get('exif') ?? 0,
    [IFD0_GPS]: at.get('gps') ?? 0,
    [EXIF_INTEROP]: at.get('interop') ?? 0
  }
  for (const d of ifds) {
    const start = at.get(d.name)!
    const tags = [...d.tags.entries()].sort((a, b) => a[0] - b[0])
    view.setUint16(start, tags.length, le)
    tags.forEach(([tag, e], i) => {
      const p = start + 2 + i * 12
      view.setUint16(p, tag, le)
      view.setUint16(p + 2, e.type, le)
      view.setUint32(p + 4, e.count, le)
      if (d.name === 'ifd1' && tag === IFD1_THUMB_AT) view.setUint32(p + 8, thumbAt, le)
      else if (d.name === 'ifd1' && tag === IFD1_THUMB_LEN) view.setUint32(p + 8, model.thumbnail!.length, le)
      else if ((d.name === 'ifd0' && (tag === IFD0_EXIF || tag === IFD0_GPS)) || (d.name === 'exif' && tag === EXIF_INTEROP)) {
        view.setUint32(p + 8, pointerTo[tag], le)
      } else if (e.bytes.length <= 4) out.set(e.bytes, p + 8)
      else view.setUint32(p + 8, where.get(e)!, le)
    })
    const next = d.name === 'ifd0' && at.has('ifd1') ? at.get('ifd1')! : 0
    view.setUint32(start + 2 + tags.length * 12, next, le)
  }
  for (const [e, p] of where) out.set(e.bytes, p)
  if (model.thumbnail) out.set(model.thumbnail, thumbAt)
  return out
}

// ---------------------------------------------------------------------------
// Writing values in the block's byte order

function ascii(text: string): Entry {
  const raw = new TextEncoder().encode(text)
  const bytes = new Uint8Array(raw.length + 1)
  bytes.set(raw)
  return { type: 2, count: bytes.length, bytes }
}

function short(n: number, le: boolean): Entry {
  const bytes = new Uint8Array(2)
  new DataView(bytes.buffer).setUint16(0, n, le)
  return { type: 3, count: 1, bytes }
}

function rationals(values: [number, number][], le: boolean): Entry {
  const bytes = new Uint8Array(values.length * 8)
  const view = new DataView(bytes.buffer)
  values.forEach(([num, den], i) => {
    view.setUint32(i * 8, num, le)
    view.setUint32(i * 8 + 4, den, le)
  })
  return { type: 5, count: values.length, bytes }
}

/** Decimal degrees as degrees, minutes and seconds (to 1/10000 of a second). */
function dms(value: number, le: boolean): Entry {
  const tenThousandths = Math.round(Math.abs(value) * 3600 * 10000)
  const deg = Math.floor(tenThousandths / 36_000_000)
  const min = Math.floor((tenThousandths % 36_000_000) / 600_000)
  const sec = tenThousandths % 600_000
  const [sNum, sDen] = sec % 10000 === 0 ? [sec / 10000, 1] : toRational(sec / 10000, 10000)
  return rationals([[deg, 1], [min, 1], [sNum, sDen]], le)
}

/** Tags worked out from another tag; they'd contradict an edit, so they go with it. */
const DERIVED = {
  iso: [0x8830, 0x8832, 0x8833, 0x8834, 0x8835],
  fNumber: [0x9202],
  exposureTime: [0x9201],
  focalLength: [0xa405],
  // Time zone and sub-second parts of the old date, and the GPS clock.
  dateExif: [0x9010, 0x9011, 0x9012, 0x9290, 0x9291, 0x9292],
  dateGps: [0x0007, 0x001d]
}

function applyEdits(model: ExifModel, edits: ExifEdits): void {
  const { le } = model
  const exifWasEmpty = model.exif.size === 0
  const text = (ifd: Map<number, Entry>, tag: number, value: string | null | undefined) => {
    if (value === undefined) return
    if (value === null || value.trim() === '') ifd.delete(tag)
    else ifd.set(tag, ascii(value.trim()))
  }
  const drop = (ifd: Map<number, Entry>, tags: number[]) => tags.forEach((t) => ifd.delete(t))

  text(model.ifd0, 0x010f, edits.make)
  text(model.ifd0, 0x0110, edits.model)
  text(model.ifd0, 0x0131, edits.software)
  text(model.ifd0, 0x013b, edits.artist)
  text(model.ifd0, 0x8298, edits.copyright)
  text(model.ifd0, 0x010e, edits.description)
  text(model.exif, 0xa434, edits.lensModel)

  if (edits.orientation !== undefined) {
    if (edits.orientation === null) model.ifd0.delete(0x0112)
    else model.ifd0.set(0x0112, short(edits.orientation, le))
  }

  if (edits.dateTime !== undefined) {
    drop(model.exif, DERIVED.dateExif)
    drop(model.gps, DERIVED.dateGps)
    if (edits.dateTime === null || edits.dateTime.trim() === '') {
      model.ifd0.delete(0x0132)
      drop(model.exif, [0x9003, 0x9004])
    } else {
      const dt = normalizeExifDate(edits.dateTime)
      model.ifd0.set(0x0132, ascii(dt))
      model.exif.set(0x9003, ascii(dt))
      model.exif.set(0x9004, ascii(dt))
    }
  }

  const rational = (tag: number, value: number | [number, number] | null | undefined, derived: number[], den: number) => {
    if (value === undefined) return
    drop(model.exif, derived)
    if (value === null) model.exif.delete(tag)
    else model.exif.set(tag, rationals([Array.isArray(value) ? value : toRational(value, den)], le))
  }
  if (edits.iso !== undefined) {
    drop(model.exif, DERIVED.iso)
    if (edits.iso === null) model.exif.delete(0x8827)
    else model.exif.set(0x8827, short(Math.round(edits.iso), le))
  }
  rational(0x829d, edits.fNumber, DERIVED.fNumber, 100)
  rational(0x920a, edits.focalLength, DERIVED.focalLength, 100)
  if (edits.exposureTime !== undefined) {
    let value: [number, number] | null = null
    if (edits.exposureTime !== null) {
      value =
        typeof edits.exposureTime === 'string'
          ? parseShutter(edits.exposureTime)
          : Array.isArray(edits.exposureTime)
            ? edits.exposureTime
            : parseShutter(String(edits.exposureTime))
      if (!value) throw new Error(`Not a shutter speed: "${edits.exposureTime}"`)
    }
    rational(0x829a, value, DERIVED.exposureTime, 1)
  }

  if (edits.gps !== undefined) {
    // A new place replaces every GPS tag: the old block's destination,
    // direction and clock describe where the photo really was.
    model.gps.clear()
    if (edits.gps) {
      const { latitude, longitude, altitude } = edits.gps
      if (!(Math.abs(latitude) <= 90) || !(Math.abs(longitude) <= 180)) {
        throw new Error(`Not a place on Earth: ${latitude}, ${longitude}`)
      }
      model.gps.set(0x0000, { type: 1, count: 4, bytes: Uint8Array.of(2, 3, 0, 0) })
      model.gps.set(0x0001, ascii(latitude >= 0 ? 'N' : 'S'))
      model.gps.set(0x0002, dms(latitude, le))
      model.gps.set(0x0003, ascii(longitude >= 0 ? 'E' : 'W'))
      model.gps.set(0x0004, dms(longitude, le))
      if (altitude !== undefined && Number.isFinite(altitude)) {
        model.gps.set(0x0005, { type: 1, count: 1, bytes: Uint8Array.of(altitude < 0 ? 1 : 0) })
        model.gps.set(0x0006, rationals([toRational(Math.abs(altitude), 100)], le))
      }
    }
  }

  if (edits.thumbnail !== undefined) {
    if (edits.thumbnail && edits.thumbnail.length > 0) {
      model.thumbnail = edits.thumbnail
      model.ifd1.set(0x0103, short(6, le)) // JPEG
    } else {
      model.thumbnail = undefined
      model.ifd1.clear()
    }
  }

  // A brand-new Exif block says which Exif version it follows.
  if (exifWasEmpty && model.exif.size > 0 && !model.exif.has(0x9000)) {
    model.exif.set(0x9000, { type: 7, count: 4, bytes: new TextEncoder().encode('0232') })
  }
}

/** A TIFF block holding just these fields (for tests and new files). */
export function buildExifTiff(edits: ExifEdits): Uint8Array {
  const model = emptyModel()
  applyEdits(model, edits)
  const tiff = serializeExif(model)
  if (!tiff) throw new Error('There are no EXIF fields to write')
  return tiff
}

// ---------------------------------------------------------------------------
// Finding and replacing the block in a file

interface JpegSegment {
  marker: number
  bytes: Uint8Array
}

/** The segments before the first scan, and everything from the scan on. */
function splitJpeg(jpeg: Uint8Array): { segments: JpegSegment[]; tail: Uint8Array } {
  const segments: JpegSegment[] = []
  let pos = 2
  while (pos + 1 < jpeg.length) {
    if (jpeg[pos] !== 0xff) break
    const marker = jpeg[pos + 1]
    if (marker === 0xff) {
      pos++ // fill byte
      continue
    }
    if (marker === 0xda || marker === 0xd9) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      segments.push({ marker, bytes: jpeg.subarray(pos, pos + 2) })
      pos += 2
      continue
    }
    if (pos + 4 > jpeg.length) break
    const len = (jpeg[pos + 2] << 8) | jpeg[pos + 3]
    if (len < 2 || pos + 2 + len > jpeg.length) break
    segments.push({ marker, bytes: jpeg.subarray(pos, pos + 2 + len) })
    pos += 2 + len
  }
  // The scan, the end marker and anything after it are copied as they are.
  return { segments, tail: jpeg.subarray(pos) }
}

const isExifApp1 = (s: JpegSegment) => s.marker === 0xe1 && startsWithText(s.bytes, 4, 'Exif\0\0')
const isXmpApp1 = (s: JpegSegment) =>
  s.marker === 0xe1 && (startsWithText(s.bytes, 4, XMP_SIG) || startsWithText(s.bytes, 4, XMP_EXTENSION_SIG))

interface PngChunk {
  type: string
  bytes: Uint8Array
}

function splitPng(png: Uint8Array): { chunks: PngChunk[]; tail: Uint8Array } {
  const chunks: PngChunk[] = []
  let pos = 8
  while (pos + 12 <= png.length) {
    const len = ((png[pos] << 24) | (png[pos + 1] << 16) | (png[pos + 2] << 8) | png[pos + 3]) >>> 0
    const end = pos + 12 + len
    if (end > png.length) break
    const type = String.fromCharCode(png[pos + 4], png[pos + 5], png[pos + 6], png[pos + 7])
    chunks.push({ type, bytes: png.subarray(pos, end) })
    pos = end
    if (type === 'IEND') break
  }
  return { chunks, tail: png.subarray(pos) }
}

const isPngXmp = (c: PngChunk) => c.type === 'iTXt' && startsWithText(c.bytes, 8, `${PNG_XMP_KEYWORD}\0`)

/** The photo's EXIF TIFF block (JPEG APP1 or PNG eXIf), or null. */
function findExifBlock(bytes: Uint8Array): Uint8Array | null {
  const format = detectFormat(bytes)
  if (format === 'jpeg') {
    const seg = splitJpeg(bytes).segments.find(isExifApp1)
    return seg ? seg.bytes.subarray(10) : null
  }
  if (format === 'png') {
    const chunk = splitPng(bytes).chunks.find((c) => c.type === 'eXIf')
    return chunk ? chunk.bytes.subarray(8, chunk.bytes.length - 4) : null
  }
  return null
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

function editedTiff(bytes: Uint8Array, edits: ExifEdits): Uint8Array | null {
  const old = findExifBlock(bytes)
  const model = (old && parseExifBlock(old)) || emptyModel()
  applyEdits(model, edits)
  return serializeExif(model)
}

/** Edits a JPEG's EXIF. The scan data and anything after it are untouched. */
export function injectExifJpeg(jpeg: Uint8Array, edits: ExifEdits, options: InjectOptions = {}): Uint8Array {
  if (jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new Error('Not a valid JPEG image: missing SOI marker (0xFFD8)')
  }
  const tiff = editedTiff(jpeg, edits)
  let app1: Uint8Array | null = null
  if (tiff) {
    const len = 2 + 6 + tiff.length
    if (len > 0xffff) {
      throw new Error(`The EXIF would be ${Math.ceil(len / 1024)} KB, but a JPEG can hold at most 64 KB of it.`)
    }
    app1 = concat([Uint8Array.of(0xff, 0xe1, len >> 8, len & 0xff), new TextEncoder().encode('Exif\0\0'), tiff])
  }

  const { segments, tail } = splitJpeg(jpeg)
  const out: Uint8Array[] = [Uint8Array.of(0xff, 0xd8)]
  let placed = false
  const hadExif = segments.some(isExifApp1)
  segments.forEach((s, i) => {
    if (isExifApp1(s)) {
      if (!placed && app1) out.push(app1)
      placed = true
      return
    }
    if (options.removeXmp && isXmpApp1(s)) return
    out.push(s.bytes)
    // A new block goes after the JFIF header(s), which must come first.
    const nextIsApp0 = segments[i + 1]?.marker === 0xe0
    if (!hadExif && !placed && app1 && s.marker === 0xe0 && !nextIsApp0) {
      out.push(app1)
      placed = true
    }
  })
  if (!placed && app1) out.splice(1, 0, app1)
  out.push(tail)
  return concat(out)
}

/** Edits a PNG's eXIf chunk. Pixels, colour profile and other chunks are untouched. */
export function injectExifPng(png: Uint8Array, edits: ExifEdits, options: InjectOptions = {}): Uint8Array {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (png.length < 8 || signature.some((b, i) => png[i] !== b)) {
    throw new Error('Not a valid PNG image: missing PNG 8-byte signature')
  }
  const tiff = editedTiff(png, edits)
  let exifChunk: Uint8Array | null = null
  if (tiff) {
    exifChunk = new Uint8Array(12 + tiff.length)
    const view = new DataView(exifChunk.buffer)
    view.setUint32(0, tiff.length)
    exifChunk.set(new TextEncoder().encode('eXIf'), 4)
    exifChunk.set(tiff, 8)
    view.setUint32(8 + tiff.length, crc32(exifChunk.subarray(4, 8 + tiff.length)))
  }

  const { chunks, tail } = splitPng(png)
  const hadExif = chunks.some((c) => c.type === 'eXIf')
  const out: Uint8Array[] = [png.subarray(0, 8)]
  let placed = false
  for (const c of chunks) {
    if (c.type === 'eXIf') {
      if (!placed && exifChunk) out.push(exifChunk)
      placed = true
      continue
    }
    if (options.removeXmp && isPngXmp(c)) continue
    out.push(c.bytes)
    // eXIf has to come before the picture data; right after IHDR is safe.
    if (!hadExif && !placed && exifChunk && c.type === 'IHDR') {
      out.push(exifChunk)
      placed = true
    }
  }
  out.push(tail)
  return concat(out)
}

/** Edits the EXIF of a JPEG or PNG. Other formats are refused. */
export function injectExif(bytes: Uint8Array, edits: ExifEdits, options: InjectOptions = {}): Uint8Array {
  const format = detectFormat(bytes)
  if (format === 'jpeg') return injectExifJpeg(bytes, edits, options)
  if (format === 'png') return injectExifPng(bytes, edits, options)
  throw new Error(`EXIF injection is supported for JPEG and PNG images (got ${format.toUpperCase()})`)
}

/** Whether the injector can write into this file. */
export const canInject = (format: string) => format === 'jpeg' || format === 'png'

// ---------------------------------------------------------------------------
// The injector's form

/** The form's fields, as text. */
export interface InjectorFields {
  make: string
  model: string
  lens: string
  artist: string
  copyright: string
  software: string
  /** '' (no tag) or '1'–'8'. */
  orientation: string
  aperture: string
  shutter: string
  iso: string
  focal: string
  dateTime: string
  description: string
  lat: string
  lon: string
  alt: string
}

export const EMPTY_FIELDS: InjectorFields = {
  make: '',
  model: '',
  lens: '',
  artist: '',
  copyright: '',
  software: '',
  orientation: '',
  aperture: '',
  shutter: '',
  iso: '',
  focal: '',
  dateTime: '',
  description: '',
  lat: '',
  lon: '',
  alt: ''
}

function entryText(e: Entry | undefined): string {
  if (!e || e.type !== 2) return ''
  const end = e.bytes.indexOf(0)
  const raw = e.bytes.subarray(0, end < 0 ? e.bytes.length : end)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw).trim()
  } catch {
    return new TextDecoder('latin1').decode(raw).trim()
  }
}

function entryNumbers(e: Entry | undefined, le: boolean): number[] {
  if (!e) return []
  const view = new DataView(e.bytes.buffer, e.bytes.byteOffset, e.bytes.byteLength)
  const out: number[] = []
  for (let i = 0; i < e.count; i++) {
    if (e.type === 3 && (i + 1) * 2 <= e.bytes.length) out.push(view.getUint16(i * 2, le))
    else if (e.type === 4 && (i + 1) * 4 <= e.bytes.length) out.push(view.getUint32(i * 4, le))
    else if (e.type === 1) out.push(e.bytes[i])
  }
  return out
}

function entryRationals(e: Entry | undefined, le: boolean): [number, number][] {
  if (!e || (e.type !== 5 && e.type !== 10)) return []
  const view = new DataView(e.bytes.buffer, e.bytes.byteOffset, e.bytes.byteLength)
  const out: [number, number][] = []
  for (let i = 0; (i + 1) * 8 <= e.bytes.length; i++) {
    out.push(
      e.type === 5
        ? [view.getUint32(i * 8, le), view.getUint32(i * 8 + 4, le)]
        : [view.getInt32(i * 8, le), view.getInt32(i * 8 + 4, le)]
    )
  }
  return out
}

/** The photo's own values for the form, exactly as stored (nothing rounded for show). */
export function readInjectorFields(bytes: Uint8Array): InjectorFields {
  const block = findExifBlock(bytes)
  const model = block && parseExifBlock(block)
  if (!model) return { ...EMPTY_FIELDS }
  const { le } = model
  const ratio = (r: [number, number] | undefined) => (r && r[1] ? r[0] / r[1] : NaN)
  const decimal = (x: number, places: number) => (Number.isFinite(x) ? trimNum(x, places) : '')

  const fields: InjectorFields = { ...EMPTY_FIELDS }
  fields.make = entryText(model.ifd0.get(0x010f))
  fields.model = entryText(model.ifd0.get(0x0110))
  fields.artist = entryText(model.ifd0.get(0x013b))
  fields.copyright = entryText(model.ifd0.get(0x8298))
  fields.software = entryText(model.ifd0.get(0x0131))
  fields.description = entryText(model.ifd0.get(0x010e))
  fields.lens = entryText(model.exif.get(0xa434))
  fields.dateTime = entryText(model.ifd0.get(0x0132)) || entryText(model.exif.get(0x9003))
  const orientation = entryNumbers(model.ifd0.get(0x0112), le)[0]
  fields.orientation = orientation >= 1 && orientation <= 8 ? String(orientation) : ''
  const iso = entryNumbers(model.exif.get(0x8827), le)[0]
  fields.iso = iso ? String(iso) : ''
  fields.aperture = decimal(ratio(entryRationals(model.exif.get(0x829d), le)[0]), 2)
  fields.focal = decimal(ratio(entryRationals(model.exif.get(0x920a), le)[0]), 2)
  const exposure = entryRationals(model.exif.get(0x829a), le)[0]
  fields.shutter = exposure ? formatShutter(exposure) : ''

  const lat = entryRationals(model.gps.get(0x0002), le)
  const lon = entryRationals(model.gps.get(0x0004), le)
  if (lat.length >= 3 && lon.length >= 3) {
    const deg = (r: [number, number][]) => ratio(r[0]) + ratio(r[1]) / 60 + ratio(r[2]) / 3600
    const latSign = entryText(model.gps.get(0x0001)).toUpperCase() === 'S' ? -1 : 1
    const lonSign = entryText(model.gps.get(0x0003)).toUpperCase() === 'W' ? -1 : 1
    fields.lat = decimal(latSign * deg(lat), 6)
    fields.lon = decimal(lonSign * deg(lon), 6)
    const alt = ratio(entryRationals(model.gps.get(0x0006), le)[0])
    if (Number.isFinite(alt)) {
      const below = entryNumbers(model.gps.get(0x0005), le)[0] === 1
      fields.alt = decimal(below ? -alt : alt, 2)
    }
  }
  return fields
}

export interface FieldError {
  field: keyof InjectorFields
  message: string
}

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)$/

/**
 * Turns the form into edits. A field still showing what the photo has is
 * left alone (so nothing is rounded or rewritten); a changed field is
 * checked and written; a cleared one is removed.
 */
export function editsFromFields(
  now: InjectorFields,
  loaded: InjectorFields
): { edits: ExifEdits; error?: FieldError } {
  const edits: ExifEdits = {}
  const changed = (k: keyof InjectorFields) => now[k].trim() !== loaded[k].trim()
  const fail = (field: keyof InjectorFields, message: string) => ({ edits, error: { field, message } })
  const num = (k: keyof InjectorFields): number | null => {
    const t = now[k].trim()
    return NUMBER.test(t) ? Number(t) : null
  }

  if (changed('make')) edits.make = now.make.trim() || null
  if (changed('model')) edits.model = now.model.trim() || null
  if (changed('lens')) edits.lensModel = now.lens.trim() || null
  if (changed('artist')) edits.artist = now.artist.trim() || null
  if (changed('copyright')) edits.copyright = now.copyright.trim() || null
  if (changed('software')) edits.software = now.software.trim() || null
  if (changed('description')) edits.description = now.description.trim() || null
  if (changed('orientation')) edits.orientation = now.orientation ? Number(now.orientation) : null

  if (changed('dateTime')) {
    if (!now.dateTime.trim()) edits.dateTime = null
    else {
      const dt = parseExifDate(now.dateTime)
      if (!dt) return fail('dateTime', 'Date & time: use YYYY:MM:DD HH:MM:SS, like 2026:10:08 14:30:00.')
      edits.dateTime = dt
    }
  }
  if (changed('aperture')) {
    if (!now.aperture.trim()) edits.fNumber = null
    else {
      const f = num('aperture')
      if (f === null || !(f > 0) || f > 1000) return fail('aperture', 'Aperture: an f-number like 1.4 or 2.8.')
      edits.fNumber = f
    }
  }
  if (changed('shutter')) {
    if (!now.shutter.trim()) edits.exposureTime = null
    else {
      const s = parseShutter(now.shutter)
      if (!s) return fail('shutter', 'Shutter speed: a time in seconds like 1/250, 0.5 or 2.')
      edits.exposureTime = s
    }
  }
  if (changed('iso')) {
    if (!now.iso.trim()) edits.iso = null
    else {
      const iso = num('iso')
      if (iso === null || !Number.isInteger(iso) || iso < 1 || iso > 65535) {
        return fail('iso', 'ISO: a whole number from 1 to 65535.')
      }
      edits.iso = iso
    }
  }
  if (changed('focal')) {
    if (!now.focal.trim()) edits.focalLength = null
    else {
      const mm = num('focal')
      if (mm === null || !(mm > 0) || mm > 10000) return fail('focal', 'Focal length: millimetres, like 28 or 4.25.')
      edits.focalLength = mm
    }
  }

  if (changed('lat') || changed('lon') || changed('alt')) {
    const hasLat = now.lat.trim() !== ''
    const hasLon = now.lon.trim() !== ''
    if (!hasLat && !hasLon) {
      if (now.alt.trim()) return fail('alt', 'Altitude needs a latitude and longitude too, or clear it.')
      edits.gps = null
    } else if (!hasLat || !hasLon) {
      return fail(hasLat ? 'lon' : 'lat', 'GPS: fill in both latitude and longitude, or clear both.')
    } else {
      const lat = num('lat')
      const lon = num('lon')
      if (lat === null || lat < -90 || lat > 90) return fail('lat', 'Latitude: a number from -90 to 90.')
      if (lon === null || lon < -180 || lon > 180) return fail('lon', 'Longitude: a number from -180 to 180.')
      let altitude: number | undefined
      if (now.alt.trim()) {
        const a = num('alt')
        if (a === null || a < -11000 || a > 100000) return fail('alt', 'Altitude: metres, like 182 or -5.')
        altitude = a
      }
      edits.gps = { latitude: lat, longitude: lon, altitude }
    }
  }
  return { edits }
}

/** What an XMP block holds its own copy of, in words ("location", "date" ...). */
export function xmpCopies(xmp: string): string[] {
  const found: string[] = []
  if (/GPSLatitude|GPSLongitude/.test(xmp)) found.push('location')
  if (/CreateDate|DateTimeOriginal|DateCreated|ModifyDate/.test(xmp)) found.push('date')
  if (/tiff:Make|tiff:Model|LensModel|aux:Lens|SerialNumber/.test(xmp)) found.push('camera')
  if (/dc:creator|dc:rights|Iptc4xmpCore:Creator/.test(xmp)) found.push('creator')
  return found
}
