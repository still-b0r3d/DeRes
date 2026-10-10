// EXIF & Metadata Parser
// Extracts camera, GPS coordinates, timestamps, exposure settings, thumbnails,
// and trailer data across JPEG, PNG, WebP, and HEIC files without external
// dependencies. GIFs hold no EXIF, but their comments, XMP and other blocks
// are read too.

import { decodeCharsetText, formatTagValue, getTagName, type TagCategory, type TagValue } from './exif-dictionary'
import { detectAiMarkers, findContentCredentials, type AiMarkerReport } from './ai-detect'

export interface GpsCoordinates {
  latitude: number
  longitude: number
  altitude?: number
  latRef: string
  lonRef: string
}

export interface ParsedExifTag {
  tagId: number
  tagHex: string
  name: string
  category: TagCategory | 'XMP' | 'Text' | 'C2PA' | 'GIF'
  /** The decoded value (read when first asked for). */
  rawValue: unknown
  displayValue: string
}

/**
 * The All Tags list stops here. A damaged file can claim tens of thousands of
 * tags; the summary still counts them, the list doesn't try to show them.
 */
export const MAX_LISTED_TAGS = 2000

/** A tag whose value is only read and formatted when the list shows it. */
function lazyTag(
  base: Omit<ParsedExifTag, 'rawValue' | 'displayValue'>,
  read: () => unknown,
  format: (value: unknown) => string
): ParsedExifTag {
  let value: unknown
  let read_ = false
  let text: string | undefined
  const get = () => {
    if (!read_) {
      value = read()
      read_ = true
    }
    return value
  }
  return {
    ...base,
    get rawValue() {
      return get()
    },
    get displayValue() {
      return (text ??= format(get()))
    }
  }
}

function addTag(meta: ImageMetadata, tag: ParsedExifTag): void {
  if (meta.allTags.length < MAX_LISTED_TAGS) meta.allTags.push(tag)
}

export interface ImageMetadata {
  format: 'jpeg' | 'png' | 'webp' | 'heic' | 'avif' | 'gif' | 'unknown'
  make?: string
  model?: string
  lensModel?: string
  dateTime?: string
  orientation?: number
  gps?: GpsCoordinates
  iso?: number
  fNumber?: number
  exposureTime?: string
  focalLength?: number
  software?: string
  artist?: string
  copyright?: string
  /** ImageDescription (0x010e). */
  description?: string
  hasIccProfile: boolean
  hasThumbnail: boolean
  thumbnail?: {
    mimeType: string
    data: Uint8Array
  }
  trailerBytes: number
  rawTagCount: number
  allTags: ParsedExifTag[]
  aiDetection?: AiMarkerReport
  xmpText?: string
  textChunks?: Record<string, string>
  /** EXIF text that can carry an AI prompt (description, software, comments). */
  exifText?: string[]
  /** A GIF's own details. */
  gif?: GifDetails
}

export interface GifDetails {
  version: '87a' | '89a'
  width: number
  height: number
  frames: number
  /** NETSCAPE2.0 loop count: 0 = forever, n = n more times; null = no loop block (plays once). */
  loopCount: number | null
  comments: number
}

/** Formats decimal GPS coordinates to human-readable DMS text. */
export function formatGpsDms(coords: GpsCoordinates): string {
  const formatCoord = (val: number, posRef: string, negRef: string) => {
    const ref = val >= 0 ? posRef : negRef
    const abs = Math.abs(val)
    const deg = Math.floor(abs)
    const minFloat = (abs - deg) * 60
    const min = Math.floor(minFloat)
    const sec = ((minFloat - min) * 60).toFixed(1)
    return `${deg}°${min}'${sec}" ${ref}`
  }

  const latStr = formatCoord(coords.latitude, 'N', 'S')
  const lonStr = formatCoord(coords.longitude, 'E', 'W')
  const altStr = coords.altitude !== undefined ? ` (alt ${Math.round(coords.altitude)}m)` : ''
  return `${latStr}, ${lonStr}${altStr}`
}

/** Formats decimal coordinates as plain numbers for easy copying (e.g. 37.7749, -122.4194). */
export function formatGpsDecimal(coords: GpsCoordinates): string {
  const lat = coords.latitude.toFixed(6)
  const lon = coords.longitude.toFixed(6)
  return `${lat}, ${lon}`
}

/** Generates a plain-English narrative summary of the image's metadata. */
export function getMetadataNarrative(meta: ImageMetadata): string {
  // GIF, BMP, TIFF and the like: nothing was checked, so claim nothing.
  if (meta.format === 'unknown') {
    return "This kind of file can't be read here, so its details (camera, date, location) are unknown."
  }
  if (meta.gif) return gifNarrative(meta, meta.gif)
  const parts: string[] = []

  // Device
  if (meta.make || meta.model) {
    const dev = [meta.make, meta.model].filter(Boolean).join(' ')
    parts.push(`Taken on a ${dev}`)
  } else {
    parts.push('Camera details not recorded')
  }

  // Date
  if (meta.dateTime) {
    parts.push(`on ${meta.dateTime}`)
  }

  // Location
  if (meta.gps) {
    parts.push(`at coordinates ${formatGpsDecimal(meta.gps)}`)
  } else {
    parts.push('with no GPS location')
  }

  // Settings
  const settings: string[] = []
  if (meta.focalLength) settings.push(`${meta.focalLength}mm`)
  if (meta.fNumber) settings.push(`f/${meta.fNumber}`)
  if (meta.exposureTime) settings.push(meta.exposureTime)
  if (meta.iso) settings.push(`ISO ${meta.iso}`)
  if (settings.length > 0) {
    parts.push(`(${settings.join(', ')})`)
  }

  return parts.join(' ') + '.'
}

/** Detects container image format from binary signature. */
export function detectFormat(data: Uint8Array): ImageMetadata['format'] {
  if (data.length < 12) return 'unknown'
  if (startsWithText(data, 0, 'GIF87a') || startsWithText(data, 0, 'GIF89a')) return 'gif'
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg'
  if (
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  )
    return 'png'
  if (
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  )
    return 'webp'
  if (
    data[4] === 0x66 &&
    data[5] === 0x74 &&
    data[6] === 0x79 &&
    data[7] === 0x70
  ) {
    // ftyp box: major brand, minor version, then compatible brands to the
    // end of the box. AVIF files often name the generic HEIF brands (mif1,
    // msf1) too, so any AVIF brand makes it AVIF.
    const boxEnd = Math.min(data.length, ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0)
    const brands = [String.fromCharCode(data[8], data[9], data[10], data[11]).toLowerCase()]
    for (let p = 16; p + 4 <= boxEnd; p += 4) {
      brands.push(String.fromCharCode(data[p], data[p + 1], data[p + 2], data[p + 3]).toLowerCase())
    }
    if (brands.some((b) => b === 'avif' || b === 'avis')) return 'avif'
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brands[0])) return 'heic'
  }
  return 'unknown'
}

/** Bytes per value for each TIFF type (1 BYTE … 12 DOUBLE, 13 IFD). */
export const TYPE_SIZE: Record<number, number> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
  13: 4
}

interface IfdEntry {
  type: number
  count: number
  value: unknown
  valOffset: number
}

// TIFF parser helper
class TiffReader {
  private le: boolean

  constructor(
    private readonly data: Uint8Array,
    private readonly baseOffset: number
  ) {
    // 0..1: "II" (little-endian) or "MM" (big-endian)
    this.le = data[baseOffset] === 0x49 && data[baseOffset + 1] === 0x49
  }

  getUint16(offset: number): number {
    const pos = this.baseOffset + offset
    if (pos + 2 > this.data.length) return 0
    return this.le
      ? this.data[pos] | (this.data[pos + 1] << 8)
      : (this.data[pos] << 8) | this.data[pos + 1]
  }

  getUint32(offset: number): number {
    const pos = this.baseOffset + offset
    if (pos + 4 > this.data.length) return 0
    return this.le
      ? (this.data[pos] |
          (this.data[pos + 1] << 8) |
          (this.data[pos + 2] << 16) |
          (this.data[pos + 3] << 24)) >>>
          0
      : ((this.data[pos] << 24) |
          (this.data[pos + 1] << 16) |
          (this.data[pos + 2] << 8) |
          this.data[pos + 3]) >>>
          0
  }

  getRational(offset: number): number {
    const num = this.getUint32(offset)
    const den = this.getUint32(offset + 4)
    if (den === 0) return 0
    return num / den
  }

  getString(offset: number, length: number): string {
    const pos = this.baseOffset + offset
    if (pos >= this.data.length) return ''
    // Text fields are short; a damaged count must not make this read megabytes.
    const end = Math.min(this.data.length, pos + Math.min(length, 1024))
    let stop = pos
    while (stop < end && this.data[stop] !== 0) stop++
    const bytes = this.data.subarray(pos, stop)
    // EXIF text is meant to be ASCII, but phones and editors write UTF-8
    // ("©", accents); anything that isn't valid UTF-8 is read byte by byte.
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim()
    } catch {
      return new TextDecoder('latin1').decode(bytes).trim()
    }
  }

  /**
   * Every value of a tag, for the All Tags list: text as a string, one number
   * as a number, several as number[] (rationals divided out, signed types
   * signed), UNDEFINED as bytes. Long lists stop at 64 numbers or 4 KB.
   */
  readTagValue(type: number, count: number, valOffset: number, maxBytes = 4096): TagValue {
    if (type === 2) return this.getString(valOffset, count)
    const size = TYPE_SIZE[type] ?? 1
    const pos = this.baseOffset + valOffset
    const room = Math.max(0, Math.floor((this.data.length - pos) / size))
    if (type === 1 || type === 6 || type === 7) {
      const n = Math.min(count, room, maxBytes)
      const bytes = this.data.slice(pos, pos + n)
      if (type === 7) return bytes
      const nums = Array.from(bytes, (b) => (type === 6 ? (b << 24) >> 24 : b))
      return count === 1 ? nums[0] : nums
    }
    const n = Math.min(count, room, 64)
    const view = new DataView(this.data.buffer, this.data.byteOffset + pos, n * size)
    const le = this.le
    const out: number[] = []
    for (let i = 0; i < n; i++) {
      const at = i * size
      switch (type) {
        case 3:
          out.push(view.getUint16(at, le))
          break
        case 8:
          out.push(view.getInt16(at, le))
          break
        case 4:
        case 13:
          out.push(view.getUint32(at, le))
          break
        case 9:
          out.push(view.getInt32(at, le))
          break
        case 5: {
          const den = view.getUint32(at + 4, le)
          out.push(den === 0 ? 0 : view.getUint32(at, le) / den)
          break
        }
        case 10: {
          const den = view.getInt32(at + 4, le)
          out.push(den === 0 ? 0 : view.getInt32(at, le) / den)
          break
        }
        case 11:
          out.push(view.getFloat32(at, le))
          break
        case 12:
          out.push(view.getFloat64(at, le))
          break
        default:
          return `${count} values of an unknown type (${type})`
      }
    }
    return count === 1 ? out[0] : out
  }

  readIfd(offset: number): Map<number, IfdEntry> {
    const entries = new Map<number, IfdEntry>()
    if (offset + 2 > this.data.length - this.baseOffset) return entries
    const numTags = this.getUint16(offset)
    let cur = offset + 2

    for (let i = 0; i < numTags; i++) {
      if (cur + 12 > this.data.length - this.baseOffset) break
      const tag = this.getUint16(cur)
      const type = this.getUint16(cur + 2)
      const count = this.getUint32(cur + 4)
      const typeSize = TYPE_SIZE[type] ?? 1
      const totalSize = count * typeSize

      let value: unknown
      let valOffset: number

      if (totalSize <= 4) {
        valOffset = cur + 8
        switch (type) {
          case 1: // BYTE
            value = this.data[this.baseOffset + cur + 8]
            break
          case 2: // ASCII, read when asked for (below)
            break
          case 3: // SHORT
            value = this.getUint16(cur + 8)
            break
          case 4: // LONG
            value = this.getUint32(cur + 8)
            break
          case 9: // SLONG
            value = (this.getUint32(cur + 8) | 0)
            break
          default:
            value = this.getUint32(cur + 8)
        }
      } else {
        valOffset = this.getUint32(cur + 8)
        switch (type) {
          case 2: // ASCII, read when asked for (below)
            break
          case 5: // RATIONAL
          case 10: // SRATIONAL
            value = this.getRational(valOffset)
            break
          default:
            value = valOffset
        }
      }

      if (type === 2) {
        // Text is only read for the few tags shown, so a damaged block with
        // thousands of long text tags costs nothing.
        const at = valOffset
        const text = () => this.getString(at, count)
        entries.set(tag, {
          type,
          count,
          valOffset,
          get value() {
            return text()
          }
        })
      } else {
        entries.set(tag, { type, count, value, valOffset })
      }
      cur += 12
    }

    return entries
  }

  getNextIfdOffset(offset: number): number {
    const numTags = this.getUint16(offset)
    const nextPtrPos = offset + 2 + numTags * 12
    return this.getUint32(nextPtrPos)
  }
}

/** Parses EXIF metadata from a TIFF block. */
export function parseTiffBlock(data: Uint8Array, tiffStart: number, meta: ImageMetadata): void {
  if (tiffStart + 8 > data.length) return
  const isLe = data[tiffStart] === 0x49 && data[tiffStart + 1] === 0x49
  const isBe = data[tiffStart] === 0x4d && data[tiffStart + 1] === 0x4d
  if (!isLe && !isBe) return

  const reader = new TiffReader(data, tiffStart)
  const magic = reader.getUint16(2)
  if (magic !== 42) return

  const ifd0Offset = reader.getUint32(4)
  if (ifd0Offset === 0) return

  const recordIfdTags = (ifd: Map<number, IfdEntry>, category: TagCategory) => {
    for (const [tagId, entry] of ifd.entries()) {
      if (meta.allTags.length >= MAX_LISTED_TAGS) return
      addTag(
        meta,
        lazyTag(
          { tagId, tagHex: `0x${tagId.toString(16).padStart(4, '0')}`, name: getTagName(category, tagId), category },
          () => reader.readTagValue(entry.type, entry.count, entry.valOffset),
          (v) => formatTagValue(category, tagId, v as TagValue, entry.count)
        )
      )
    }
  }
  // Text an AI tool may leave its prompt in (Stable Diffusion writes UserComment).
  const keepText = (ifd: Map<number, IfdEntry>, tag: number, decode: (v: TagValue) => string) => {
    const entry = ifd.get(tag)
    if (!entry) return
    // A prompt with its settings can run to many KB; read up to 64 KB.
    const text = decode(reader.readTagValue(entry.type, entry.count, entry.valOffset, 65536))
    if (text) (meta.exifText ??= []).push(text)
  }
  const asText = (v: TagValue) => (typeof v === 'string' ? v : '')
  const xpText = (v: TagValue) =>
    Array.isArray(v) ? new TextDecoder('utf-16le').decode(Uint8Array.from(v)).replace(/\0+$/, '') : ''

  const ifd0 = reader.readIfd(ifd0Offset)
  meta.rawTagCount += ifd0.size
  recordIfdTags(ifd0, 'IFD0')
  keepText(ifd0, 0x010e, asText)
  keepText(ifd0, 0x0131, asText)
  keepText(ifd0, 0x9c9c, xpText)

  // Standard tags in IFD0
  if (ifd0.has(0x010f)) meta.make = String(ifd0.get(0x010f)!.value)
  if (ifd0.has(0x0110)) meta.model = String(ifd0.get(0x0110)!.value)
  if (ifd0.has(0x0112)) meta.orientation = Number(ifd0.get(0x0112)!.value)
  if (ifd0.has(0x0132)) meta.dateTime = String(ifd0.get(0x0132)!.value)
  if (ifd0.has(0x0131)) meta.software = String(ifd0.get(0x0131)!.value)
  if (ifd0.has(0x013b)) meta.artist = String(ifd0.get(0x013b)!.value)
  if (ifd0.has(0x8298)) meta.copyright = String(ifd0.get(0x8298)!.value)
  if (ifd0.has(0x010e)) meta.description = String(ifd0.get(0x010e)!.value)

  // SubIFD Exif (0x8769)
  if (ifd0.has(0x8769)) {
    const exifOffset = Number(ifd0.get(0x8769)!.value)
    const exifIfd = reader.readIfd(exifOffset)
    meta.rawTagCount += exifIfd.size
    recordIfdTags(exifIfd, 'Exif')
    keepText(exifIfd, 0x9286, decodeCharsetText)

    if (exifIfd.has(0xa005)) {
      const interopOffset = Number(exifIfd.get(0xa005)!.value)
      if (interopOffset > 0 && interopOffset < data.length - tiffStart) {
        const interopIfd = reader.readIfd(interopOffset)
        meta.rawTagCount += interopIfd.size
        recordIfdTags(interopIfd, 'Interop')
      }
    }

    if (exifIfd.has(0x9003) && !meta.dateTime) meta.dateTime = String(exifIfd.get(0x9003)!.value)
    if (exifIfd.has(0xa434)) meta.lensModel = String(exifIfd.get(0xa434)!.value)
    if (exifIfd.has(0x8827)) meta.iso = Number(exifIfd.get(0x8827)!.value)
    if (exifIfd.has(0x829d)) meta.fNumber = Number(Number(exifIfd.get(0x829d)!.value).toFixed(1))
    if (exifIfd.has(0x920a)) meta.focalLength = Math.round(Number(exifIfd.get(0x920a)!.value))
    if (exifIfd.has(0x829a)) {
      const exp = Number(exifIfd.get(0x829a)!.value)
      if (exp > 0 && exp < 1) {
        meta.exposureTime = `1/${Math.round(1 / exp)}s`
      } else if (exp >= 1) {
        meta.exposureTime = `${exp.toFixed(1)}s`
      }
    }
  }

  // SubIFD GPS (0x8825)
  if (ifd0.has(0x8825)) {
    const gpsOffset = Number(ifd0.get(0x8825)!.value)
    const gpsIfd = reader.readIfd(gpsOffset)
    meta.rawTagCount += gpsIfd.size

    recordIfdTags(gpsIfd, 'GPS')

    const latRef = gpsIfd.has(0x0001) ? String(gpsIfd.get(0x0001)!.value).toUpperCase().trim() : 'N'
    const lonRef = gpsIfd.has(0x0003) ? String(gpsIfd.get(0x0003)!.value).toUpperCase().trim() : 'W'

    let latVal = 0
    if (gpsIfd.has(0x0002)) {
      const entry = gpsIfd.get(0x0002)!
      const off = entry.valOffset
      const deg = reader.getRational(off)
      const min = reader.getRational(off + 8)
      const sec = reader.getRational(off + 16)
      latVal = deg + min / 60 + sec / 3600
      if (latRef === 'S') latVal = -latVal
    }

    let lonVal = 0
    if (gpsIfd.has(0x0004)) {
      const entry = gpsIfd.get(0x0004)!
      const off = entry.valOffset
      const deg = reader.getRational(off)
      const min = reader.getRational(off + 8)
      const sec = reader.getRational(off + 16)
      lonVal = deg + min / 60 + sec / 3600
      if (lonRef === 'W') lonVal = -lonVal
    }

    let altitude: number | undefined
    if (gpsIfd.has(0x0006)) {
      altitude = Number(gpsIfd.get(0x0006)!.value)
      const altRef = gpsIfd.has(0x0005) ? Number(gpsIfd.get(0x0005)!.value) : 0
      if (altRef === 1) altitude = -altitude
    }

    if (gpsIfd.has(0x0002) && gpsIfd.has(0x0004)) {
      meta.gps = {
        latitude: latVal,
        longitude: lonVal,
        altitude,
        latRef,
        lonRef
      }
    }
  }

  // IFD1: Thumbnail detection (offset follows IFD0)
  const ifd1Offset = reader.getNextIfdOffset(ifd0Offset)
  if (ifd1Offset > 0 && ifd1Offset < data.length - tiffStart) {
    const ifd1 = reader.readIfd(ifd1Offset)
    meta.rawTagCount += ifd1.size
    recordIfdTags(ifd1, 'IFD1')
    if (ifd1.has(0x0201) && ifd1.has(0x0202)) {
      const thumbOffset = Number(ifd1.get(0x0201)!.value)
      const thumbLength = Number(ifd1.get(0x0202)!.value)
      const absThumbStart = tiffStart + thumbOffset
      if (thumbLength > 0 && absThumbStart + thumbLength <= data.length) {
        meta.hasThumbnail = true
        meta.thumbnail = {
          mimeType: 'image/jpeg',
          data: data.slice(absThumbStart, absThumbStart + thumbLength)
        }
      }
    }
  }
}

/**
 * Inspects all metadata embedded in an image buffer.
 */
export function inspectMetadata(data: Uint8Array): ImageMetadata {
  const format = detectFormat(data)
  const meta: ImageMetadata = {
    format,
    hasIccProfile: false,
    hasThumbnail: false,
    trailerBytes: 0,
    rawTagCount: 0,
    allTags: []
  }

  if (format === 'jpeg') {
    inspectJpeg(data, meta)
  } else if (format === 'png') {
    inspectPng(data, meta)
  } else if (format === 'webp') {
    inspectWebp(data, meta)
  } else if (format === 'heic' || format === 'avif') {
    // Both are HEIF files and keep Exif the same way.
    inspectHeic(data, meta)
  } else if (format === 'gif') {
    inspectGif(data, meta)
  }

  // A location kept only in XMP (no EXIF GPS) is still a location.
  if (!meta.gps && meta.xmpText) meta.gps = xmpGps(meta.xmpText)

  const textBlocks: string[] = []
  if (meta.xmpText) textBlocks.push(meta.xmpText)
  if (meta.textChunks) {
    for (const [k, v] of Object.entries(meta.textChunks)) {
      textBlocks.push(`${k}: ${v}`)
    }
  }
  textBlocks.push(...(meta.exifText ?? []))
  const credentials = findContentCredentials(data)
  meta.aiDetection = detectAiMarkers(textBlocks, meta.software, credentials)
  if (credentials) {
    addTag(meta, {
      tagId: 0,
      tagHex: 'C2PA',
      name: 'Content Credentials',
      category: 'C2PA',
      rawValue: credentials,
      displayValue: `${credentials.bytes.toLocaleString()} bytes in the ${credentials.where}${credentials.generator ? `, signed by ${credentials.generator}` : ''}`
    })
  }

  return meta
}

/** A text row in the All Tags list (XMP, PNG text, JUMBF data). */
function textRow(meta: ImageMetadata, tagHex: string, name: string, category: ParsedExifTag['category'], value: string, shown: string): void {
  addTag(meta, { tagId: 0, tagHex, name, category, rawValue: value, displayValue: shown })
}

const short = (text: string) => (text.length > 200 ? `${text.slice(0, 200)}…` : text)

/** How JPEG APP1 segments (and PNG iTXt keywords) say they hold XMP. */
export const XMP_SIG = 'http://ns.adobe.com/xap/1.0/\0'
export const XMP_EXTENSION_SIG = 'http://ns.adobe.com/xmp/extension/\0'
export const PNG_XMP_KEYWORD = 'XML:com.adobe.xmp'

/** Whether the bytes at `at` spell out `text` (ASCII). */
export function startsWithText(data: Uint8Array, at: number, text: string): boolean {
  if (at + text.length > data.length) return false
  for (let i = 0; i < text.length; i++) if (data[at + i] !== text.charCodeAt(i)) return false
  return true
}

/**
 * A PNG text chunk. tEXt is Latin-1; iTXt is UTF-8 (where XMP and most
 * non-English AI prompts go). Compressed text (zTXt, compressed iTXt) can't
 * be inflated here without waiting, so it's listed but not read.
 */
function readPngText(type: string, chunk: Uint8Array, meta: ImageMetadata): void {
  const keyEnd = chunk.indexOf(0)
  if (keyEnd <= 0) return
  const keyword = new TextDecoder('latin1').decode(chunk.subarray(0, keyEnd))
  let text: string | null = null
  if (type === 'tEXt') {
    text = new TextDecoder('latin1').decode(chunk.subarray(keyEnd + 1))
  } else if (type === 'iTXt') {
    const compressed = chunk[keyEnd + 1] === 1
    const langEnd = chunk.indexOf(0, keyEnd + 3)
    const transEnd = langEnd < 0 ? -1 : chunk.indexOf(0, langEnd + 1)
    if (!compressed && transEnd >= 0) text = new TextDecoder('utf-8').decode(chunk.subarray(transEnd + 1))
  }
  if (text === null) {
    textRow(meta, type, `PNG Text (${keyword})`, 'Text', '', `${chunk.length.toLocaleString()} bytes of compressed text (not read)`)
    return
  }
  if (type === 'iTXt' && keyword === PNG_XMP_KEYWORD) {
    meta.xmpText = (meta.xmpText ?? '') + text
    textRow(meta, 'XMP', 'XMP Metadata Packet', 'XMP', text, `${text.length.toLocaleString()} characters`)
    return
  }
  const chunks = (meta.textChunks ??= {})
  chunks[keyword] = chunks[keyword] ? `${chunks[keyword]}\n${text}` : text
  textRow(meta, type, `PNG Text (${keyword})`, 'Text', text, short(text))
}

function inspectJpeg(data: Uint8Array, meta: ImageMetadata): void {
  let pos = 2 // Skip SOI FF D8
  let eoiPos = -1

  while (pos < data.length) {
    if (data[pos] !== 0xff) {
      pos++
      continue
    }

    const marker = data[pos + 1]
    if (marker === 0xd9) {
      // EOI
      eoiPos = pos + 2
      break
    }

    // 0xFF fill bytes may come before any marker.
    if (marker === 0xff) {
      pos++
      continue
    }

    if (marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2
      continue
    }

    if (marker === 0xda) {
      // SOS: Start of scan (compressed image data follows)
      const len = (data[pos + 2] << 8) | data[pos + 3]
      pos += 2 + len
      // Scan entropy data until next marker
      while (pos < data.length - 1) {
        if (data[pos] === 0xff && data[pos + 1] !== 0x00 && !(data[pos + 1] >= 0xd0 && data[pos + 1] <= 0xd7)) {
          break
        }
        pos++
      }
      continue
    }

    const segLen = (data[pos + 2] << 8) | data[pos + 3]
    const segStart = pos + 4
    const segEnd = pos + 2 + segLen
    // A damaged length: stop here rather than read past the file.
    if (segLen < 2 || segEnd > data.length) break

    if (marker === 0xe1) {
      // APP1: Exif or XMP
      if (
        data[segStart] === 0x45 &&
        data[segStart + 1] === 0x78 &&
        data[segStart + 2] === 0x69 &&
        data[segStart + 3] === 0x66 &&
        data[segStart + 4] === 0x00 &&
        data[segStart + 5] === 0x00
      ) {
        // Exif TIFF block starts at segStart + 6
        parseTiffBlock(data, segStart + 6, meta)
      } else if (startsWithText(data, segStart, XMP_SIG)) {
        const xmp = new TextDecoder('utf-8').decode(data.subarray(segStart + XMP_SIG.length, segEnd))
        meta.xmpText = (meta.xmpText ?? '') + xmp
        meta.rawTagCount++
        textRow(meta, 'XMP', 'XMP Metadata Packet', 'XMP', xmp, `${xmp.length.toLocaleString()} characters`)
      } else if (startsWithText(data, segStart, XMP_EXTENSION_SIG)) {
        // Extended XMP: the rest of a packet too big for one segment.
        const xmp = new TextDecoder('utf-8').decode(data.subarray(segStart + XMP_EXTENSION_SIG.length + 40, segEnd))
        meta.xmpText = (meta.xmpText ?? '') + xmp
        meta.rawTagCount++
        textRow(meta, 'XMP', 'Extended XMP Packet', 'XMP', xmp, `${xmp.length.toLocaleString()} characters`)
      }
    } else if (marker === 0xeb) {
      // APP11: JUMBF boxes (Content Credentials live here, so do JPEG XT
      // extensions). What they hold is worked out once, in inspectMetadata.
      meta.rawTagCount++
      textRow(meta, 'APP11', 'APP11 segment (JUMBF data)', 'C2PA', '', `${segLen.toLocaleString()} bytes`)
    } else if (marker === 0xe2) {
      // APP2: ICC Profile or MPF
      if (
        data[segStart] === 0x49 &&
        data[segStart + 1] === 0x43 &&
        data[segStart + 2] === 0x43 &&
        data[segStart + 3] === 0x5f
      ) {
        meta.hasIccProfile = true
      }
    }

    pos = segEnd
  }

  if (eoiPos > 0 && eoiPos < data.length) {
    meta.trailerBytes = data.length - eoiPos
  }
}

function inspectPng(data: Uint8Array, meta: ImageMetadata): void {
  let pos = 8 // Skip 8-byte PNG header
  let iendEnd = -1

  while (pos + 8 <= data.length) {
    // Unsigned: a length with the top bit set used to read as negative and
    // send the walk backwards forever.
    const len =
      ((data[pos] << 24) |
        (data[pos + 1] << 16) |
        (data[pos + 2] << 8) |
        data[pos + 3]) >>>
      0
    const type = String.fromCharCode(
      data[pos + 4],
      data[pos + 5],
      data[pos + 6],
      data[pos + 7]
    )
    const chunkData = pos + 8
    const nextChunk = chunkData + len + 4
    if (nextChunk > data.length) {
      // A damaged chunk: whatever follows can't be read, so it counts as
      // data after the picture (the scrubber drops it).
      meta.trailerBytes = data.length - pos
      return
    }

    if (type === 'eXIf') {
      parseTiffBlock(data, chunkData, meta)
    } else if (type === 'iCCP') {
      meta.hasIccProfile = true
    } else if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      meta.rawTagCount++
      readPngText(type, data.subarray(chunkData, chunkData + len), meta)
    } else if (type === 'caBX') {
      meta.rawTagCount++
      textRow(meta, 'caBX', 'caBX chunk (JUMBF data)', 'C2PA', '', `${len.toLocaleString()} bytes`)
    } else if (type === 'IEND') {
      iendEnd = nextChunk
      break
    }

    pos = nextChunk
  }

  if (iendEnd > 0 && iendEnd < data.length) {
    meta.trailerBytes = data.length - iendEnd
  }
}

/** Where a WebP's RIFF data ends (its size field says), never past the file. */
export function webpRiffEnd(data: Uint8Array): number {
  const size = (data[4] | (data[5] << 8) | (data[6] << 16) | (data[7] << 24)) >>> 0
  return Math.min(data.length, 8 + size)
}

function inspectWebp(data: Uint8Array, meta: ImageMetadata): void {
  let pos = 12 // Skip "RIFF" + size + "WEBP"
  const end = webpRiffEnd(data)
  // Anything after the RIFF end is not part of the picture.
  meta.trailerBytes = data.length - end

  while (pos + 8 <= end) {
    const fourCC = String.fromCharCode(
      data[pos],
      data[pos + 1],
      data[pos + 2],
      data[pos + 3]
    )
    const size =
      (data[pos + 4] |
        (data[pos + 5] << 8) |
        (data[pos + 6] << 16) |
        (data[pos + 7] << 24)) >>>
      0
    const chunkData = pos + 8
    const paddedSize = size + (size % 2)
    const nextChunk = chunkData + paddedSize

    if (fourCC === 'EXIF') {
      let tiffOffset = chunkData
      // Some WebP files prepend "Exif\0\0"
      if (
        data[chunkData] === 0x45 &&
        data[chunkData + 1] === 0x78 &&
        data[chunkData + 2] === 0x69 &&
        data[chunkData + 3] === 0x66
      ) {
        tiffOffset += 6
      }
      parseTiffBlock(data, tiffOffset, meta)
    } else if (fourCC === 'ICCP') {
      meta.hasIccProfile = true
    } else if (fourCC === 'XMP ') {
      meta.rawTagCount++
      const xmpStr = new TextDecoder('utf-8').decode(data.subarray(pos + 8, pos + 8 + size))
      meta.xmpText = xmpStr
      textRow(meta, 'XMP', 'XMP Metadata Packet', 'XMP', xmpStr, `${xmpStr.length.toLocaleString()} characters`)
    } else if (fourCC === 'C2PA') {
      meta.rawTagCount++
      textRow(meta, 'C2PA', 'C2PA chunk (JUMBF data)', 'C2PA', '', `${size.toLocaleString()} bytes`)
    }

    pos = nextChunk
  }
}

function inspectHeic(data: Uint8Array, meta: ImageMetadata): void {
  // Search for TIFF header signature inside HEIC boxes
  for (let i = 0; i < data.length - 8; i++) {
    if (
      (data[i] === 0x49 && data[i + 1] === 0x49 && data[i + 2] === 0x2a && data[i + 3] === 0x00) ||
      (data[i] === 0x4d && data[i + 1] === 0x4d && data[i + 2] === 0x00 && data[i + 3] === 0x2a)
    ) {
      parseTiffBlock(data, i, meta)
      if (meta.rawTagCount > 0) break
    }
  }
}

/** "A GIF with 58 frames that loops forever. GIFs don't record a camera or date; …" */
function gifNarrative(meta: ImageMetadata, g: GifDetails): string {
  const frames = g.frames === 1 ? 'one frame' : `${g.frames} frames`
  const loop = g.frames < 2 ? '' : g.loopCount === 0 ? ' that loops forever' : g.loopCount === null ? ' that plays once' : ` that plays ${g.loopCount + 1} times`
  const where = meta.gps ? `its XMP gives a location: ${formatGpsDecimal(meta.gps)}` : 'no location found'
  const comments = g.comments > 0 ? `, and ${g.comments === 1 ? 'a comment' : `${g.comments} comments`}` : ''
  return `A GIF with ${frames}${loop}. GIFs don't record a camera or date; ${where}${comments}.`
}

/** The application blocks that hold a GIF's loop count. */
export const GIF_LOOP_APPS = ['NETSCAPE2.0', 'ANIMEXTS1.0']
/** How a GIF says an application block holds XMP. */
export const GIF_XMP_APP = 'XMP DataXMP'

/** Where a GIF's sub-blocks starting at `at` end (just past the 0 that ends them); -1 when the file ends first. */
export function gifSubBlocksEnd(data: Uint8Array, at: number): number {
  let p = at
  while (p < data.length) {
    const len = data[p++]
    if (len === 0) return p
    p += len
  }
  return -1
}

/** The data of a run of sub-blocks, joined. */
function gifSubBlockData(data: Uint8Array, at: number, end: number): Uint8Array {
  const parts: Uint8Array[] = []
  for (let p = at; p < end - 1; ) {
    const len = data[p++]
    parts.push(data.subarray(p, Math.min(end - 1, p + len)))
    p += len
  }
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0))
  let o = 0
  for (const x of parts) {
    out.set(x, o)
    o += x.length
  }
  return out
}

/**
 * The XMP packet in a GIF's "XMP DataXMP" block. It's written as raw text
 * straight after the name (not as sub-blocks), then a 257-byte "magic
 * trailer" (1, 255, 254 … 0) that brings a sub-block reader to the end.
 * `at` is the block's introducer (0x21), `end` where the block ends.
 */
export function gifXmpText(data: Uint8Array, at: number, end: number): string {
  const textStart = at + 14
  const trailer = end - 258
  const decoder = new TextDecoder('utf-8')
  if (trailer >= textStart && data[trailer] === 1 && data[trailer + 1] === 0xff && data[end - 2] === 0 && data[end - 1] === 0) {
    return decoder.decode(data.subarray(textStart, trailer))
  }
  // Not written the usual way: read it as ordinary sub-blocks.
  return decoder.decode(gifSubBlockData(data, at + 2, end).subarray(11))
}

/** Text from a GIF comment: meant to be ASCII, often UTF-8, sometimes Latin-1. */
function gifText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('latin1').decode(bytes)
  }
}

/** Whether an XMP packet says where the picture was taken (GPS, or a place name). */
export function xmpHasLocation(xmp: string): boolean {
  return /GPSLatitude|GPSLongitude|photoshop:City|photoshop:State|photoshop:Country|Iptc4xmpCore:Location|Iptc4xmpExt:Location/.test(xmp)
}

/** One XMP GPS coordinate ("41,52.8N", "41,52,48N", or plain decimal degrees). */
function xmpCoordinate(text: string, neg: string): number | undefined {
  const m = /^\s*(-?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?))?(?:,(\d+(?:\.\d+)?))?\s*([NSEW])?\s*$/i.exec(text)
  if (!m) return undefined
  const value = Math.abs(Number(m[1])) + (m[2] ? Number(m[2]) / 60 : 0) + (m[3] ? Number(m[3]) / 3600 : 0)
  const negative = (m[4] ?? '').toUpperCase() === neg || Number(m[1]) < 0
  return Number.isFinite(value) ? (negative ? -value : value) : undefined
}

/** The GPS position in an XMP packet (exif:GPSLatitude and exif:GPSLongitude), if it has one. */
export function xmpGps(xmp: string): GpsCoordinates | undefined {
  const field = (name: string) => {
    const m = new RegExp(`exif:${name}(?:\\s*=\\s*"([^"]*)"|>([^<]*)<)`).exec(xmp)
    return m ? (m[1] ?? m[2]) : undefined
  }
  const latText = field('GPSLatitude')
  const lonText = field('GPSLongitude')
  if (!latText || !lonText) return undefined
  const latitude = xmpCoordinate(latText, 'S')
  const longitude = xmpCoordinate(lonText, 'W')
  if (latitude === undefined || longitude === undefined) return undefined
  const coords: GpsCoordinates = { latitude, longitude, latRef: latitude < 0 ? 'S' : 'N', lonRef: longitude < 0 ? 'W' : 'E' }
  const alt = field('GPSAltitude')
  if (alt) {
    const [a, b] = alt.split('/').map(Number)
    const value = b ? a / b : a
    if (Number.isFinite(value)) coords.altitude = field('GPSAltitudeRef') === '1' ? -value : value
  }
  return coords
}

/**
 * A GIF: no EXIF, but comments, plain text, XMP and other application blocks
 * (a colour profile, Photoshop or IPTC data) can ride along with the frames.
 * The loop block is part of the animation, not metadata.
 */
function inspectGif(data: Uint8Array, meta: ImageMetadata): void {
  const n = data.length
  const version = data[4] === 0x37 ? '87a' : '89a'
  const width = data[6] | (data[7] << 8)
  const height = data[8] | (data[9] << 8)
  let p = 13
  if (data[10] & 0x80) p += 3 << ((data[10] & 7) + 1)
  const g: GifDetails = { version, width, height, frames: 0, loopCount: null, comments: 0 }
  const texts: string[] = []

  while (p < n) {
    const block = data[p]
    if (block === 0x3b) {
      p++
      break
    }
    if (block === 0x2c) {
      // An image: descriptor, its own colour table, LZW size, data.
      if (p + 10 > n) break
      const flags = data[p + 9]
      let q = p + 10
      if (flags & 0x80) q += 3 << ((flags & 7) + 1)
      const end = gifSubBlocksEnd(data, q + 1)
      if (end < 0) break
      g.frames++
      p = end
      continue
    }
    if (block !== 0x21) break
    const label = data[p + 1]
    const end = gifSubBlocksEnd(data, p + 2)
    if (end < 0) break
    if (label === 0xf9) {
      // Graphic control (delay, disposal, transparency): part of the animation.
    } else if (label === 0xfe) {
      const text = gifText(gifSubBlockData(data, p + 2, end))
      g.comments++
      texts.push(text)
      meta.rawTagCount++
      textRow(meta, 'Comment', 'GIF Comment', 'Text', text, short(text))
    } else if (label === 0x01) {
      // Plain text: a 12-byte grid header, then the text to draw.
      const text = gifText(gifSubBlockData(data, p + 2, end).subarray(12))
      texts.push(text)
      meta.rawTagCount++
      textRow(meta, 'PlainText', 'GIF Plain Text', 'Text', text, short(text))
    } else if (label === 0xff && data[p + 2] === 11) {
      const name = String.fromCharCode(...data.subarray(p + 3, p + 14))
      if (GIF_LOOP_APPS.includes(name)) {
        if (g.loopCount === null && data[p + 14] >= 3 && data[p + 15] === 1) g.loopCount = data[p + 16] | (data[p + 17] << 8)
      } else if (name === GIF_XMP_APP) {
        const xmp = gifXmpText(data, p, end)
        meta.xmpText = (meta.xmpText ?? '') + xmp
        meta.rawTagCount++
        textRow(meta, 'XMP', 'XMP Metadata Packet', 'XMP', xmp, `${xmp.length.toLocaleString()} characters`)
      } else {
        const bytes = end - p
        // A colour profile is part of how the picture looks (kept by the
        // scrubber, as in JPEG and PNG), so it doesn't count as a field.
        if (name.startsWith('ICCRGBG1')) meta.hasIccProfile = true
        else meta.rawTagCount++
        const what = name.startsWith('ICCRGBG1')
          ? 'colour profile'
          : name.startsWith('MGK8BIM')
            ? 'Photoshop data'
            : name.startsWith('MGKIPTC')
              ? 'IPTC data'
              : 'data'
        textRow(meta, 'App', `Application block (${name.replace(/[^\x20-\x7e]/g, '?')})`, 'GIF', '', `${what}, ${bytes.toLocaleString()} bytes`)
      }
    } else {
      meta.rawTagCount++
      textRow(meta, `0x${label.toString(16).padStart(2, '0')}`, 'Unknown GIF extension', 'GIF', '', `${(end - p).toLocaleString()} bytes`)
    }
    p = end
  }

  // After the end marker, or from damage on: not part of the picture.
  meta.trailerBytes = n - Math.min(p, n)
  meta.gif = g
  if (texts.length > 0) meta.textChunks = { Comment: texts.join('\n') }
  const loop = g.loopCount === null ? 'No loop block (plays once)' : g.loopCount === 0 ? 'Forever' : `${g.loopCount} more time${g.loopCount === 1 ? '' : 's'}`
  meta.allTags.unshift(
    { tagId: 0, tagHex: 'Version', name: 'GIF Version', category: 'GIF', rawValue: version, displayValue: version },
    { tagId: 0, tagHex: 'Screen', name: 'Size', category: 'GIF', rawValue: [width, height], displayValue: `${width}×${height}` },
    { tagId: 0, tagHex: 'Frames', name: 'Frames', category: 'GIF', rawValue: g.frames, displayValue: String(g.frames) },
    { tagId: 0, tagHex: 'Loop', name: 'Loop Count', category: 'GIF', rawValue: g.loopCount, displayValue: loop }
  )
}
