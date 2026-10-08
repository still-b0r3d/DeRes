// EXIF Metadata Injector
// Client-side byte-level insertion and editing of EXIF/TIFF tags for JPEG and PNG images.
// Compliant with TIFF 6.0 and EXIF 2.32 specifications:
// - Little-endian (II) TIFF header
// - Ascending tag order per IFD
// - Standard SubIFD pointers (Exif SubIFD 0x8769, GPS SubIFD 0x8825)
// - Word-aligned data pool offsets
// - Clean APP1 embedding for JPEG (following SOI or APP0)
// - Standard eXIf chunk embedding for PNG (following IHDR)

import { crc32 } from './png'
import { detectFormat } from './exif'

export interface ExifInjectOptions {
  make?: string
  model?: string
  artist?: string
  copyright?: string
  software?: string
  dateTime?: string // YYYY:MM:DD HH:MM:SS
  description?: string
  orientation?: number // 1..8
  gps?: {
    latitude: number
    longitude: number
    altitude?: number
  }
}

/**
 * Normalizes input date string or Date object into standard EXIF format:
 * "YYYY:MM:DD HH:MM:SS" (19 chars)
 */
export function normalizeExifDate(d?: string | Date): string {
  if (!d) {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${now.getFullYear()}:${pad(now.getMonth() + 1)}:${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  }
  if (d instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }
  let s = d.trim().replace(/-/g, ':').replace('T', ' ')
  if (s.length === 10) s += ' 00:00:00'
  return s.slice(0, 19)
}

/**
 * Converts decimal degrees into 3 RATIONAL values (degrees, minutes, seconds)
 * formatted as 24 little-endian bytes.
 */
function toDmsRationals(val: number): Uint8Array {
  const abs = Math.abs(val)
  const deg = Math.floor(abs)
  const remMinutes = (abs - deg) * 60
  const min = Math.floor(remMinutes)
  const remSec = (remMinutes - min) * 60
  const secNum = Math.round(remSec * 10000)
  const secDen = 10000

  const buf = new Uint8Array(24)
  const view = new DataView(buf.buffer)
  view.setUint32(0, deg, true)
  view.setUint32(4, 1, true)
  view.setUint32(8, min, true)
  view.setUint32(12, 1, true)
  view.setUint32(16, secNum, true)
  view.setUint32(20, secDen, true)
  return buf
}

interface TagEntry {
  tag: number
  type: number // 1: BYTE, 2: ASCII, 3: SHORT, 4: LONG, 5: RATIONAL
  count: number
  inlineVal?: number
  inlineBytes?: Uint8Array
  data?: Uint8Array
  offset?: number
}

function makeAsciiTag(tag: number, str: string): TagEntry {
  const raw = new TextEncoder().encode(str)
  const data = new Uint8Array(raw.length + 1)
  data.set(raw, 0)
  data[raw.length] = 0 // null terminator
  const count = data.length

  if (count <= 4) {
    const inlineBytes = new Uint8Array(4)
    inlineBytes.set(data, 0)
    return { tag, type: 2, count, inlineBytes }
  }
  return { tag, type: 2, count, data }
}

/**
 * Builds a specification-compliant TIFF EXIF byte buffer from given options.
 */
export function buildExifTiff(options: ExifInjectOptions): Uint8Array {
  const ifd0Tags: TagEntry[] = []
  const exifSubIfdTags: TagEntry[] = []
  const gpsSubIfdTags: TagEntry[] = []

  // IFD0 entries
  if (options.description) ifd0Tags.push(makeAsciiTag(0x010e, options.description))
  if (options.make) ifd0Tags.push(makeAsciiTag(0x010f, options.make))
  if (options.model) ifd0Tags.push(makeAsciiTag(0x0110, options.model))
  if (options.orientation && options.orientation >= 1 && options.orientation <= 8) {
    ifd0Tags.push({ tag: 0x0112, type: 3, count: 1, inlineVal: options.orientation })
  }
  if (options.software) ifd0Tags.push(makeAsciiTag(0x0131, options.software))
  if (options.dateTime) {
    const dt = normalizeExifDate(options.dateTime)
    ifd0Tags.push(makeAsciiTag(0x0132, dt))
    // Also record in Exif SubIFD as DateTimeOriginal & DateTimeDigitized
    exifSubIfdTags.push(makeAsciiTag(0x9003, dt))
    exifSubIfdTags.push(makeAsciiTag(0x9004, dt))
  }
  if (options.artist) ifd0Tags.push(makeAsciiTag(0x013b, options.artist))
  if (options.copyright) ifd0Tags.push(makeAsciiTag(0x8298, options.copyright))

  // GPS SubIFD entries
  if (options.gps) {
    const { latitude, longitude, altitude } = options.gps
    const latRef = latitude >= 0 ? 'N' : 'S'
    const lonRef = longitude >= 0 ? 'E' : 'W'

    // GPSVersionID (0x0000): BYTE count 4: [2, 3, 0, 0]
    gpsSubIfdTags.push({ tag: 0x0000, type: 1, count: 4, inlineBytes: new Uint8Array([2, 3, 0, 0]) })

    // GPSLatitudeRef (0x0001): ASCII count 2: 'N\0' or 'S\0'
    const latRefBytes = new Uint8Array([latRef.charCodeAt(0), 0, 0, 0])
    gpsSubIfdTags.push({ tag: 0x0001, type: 2, count: 2, inlineBytes: latRefBytes })

    // GPSLatitude (0x0002): RATIONAL count 3: 24 bytes
    gpsSubIfdTags.push({ tag: 0x0002, type: 5, count: 3, data: toDmsRationals(latitude) })

    // GPSLongitudeRef (0x0003): ASCII count 2: 'E\0' or 'W\0'
    const lonRefBytes = new Uint8Array([lonRef.charCodeAt(0), 0, 0, 0])
    gpsSubIfdTags.push({ tag: 0x0003, type: 2, count: 2, inlineBytes: lonRefBytes })

    // GPSLongitude (0x0004): RATIONAL count 3: 24 bytes
    gpsSubIfdTags.push({ tag: 0x0004, type: 5, count: 3, data: toDmsRationals(longitude) })

    // GPSAltitude (optional)
    if (altitude !== undefined && !Number.isNaN(altitude)) {
      const altRef = altitude >= 0 ? 0 : 1
      gpsSubIfdTags.push({ tag: 0x0005, type: 1, count: 1, inlineBytes: new Uint8Array([altRef, 0, 0, 0]) })

      const altData = new Uint8Array(8)
      const altView = new DataView(altData.buffer)
      altView.setUint32(0, Math.round(Math.abs(altitude) * 100), true)
      altView.setUint32(4, 100, true)
      gpsSubIfdTags.push({ tag: 0x0006, type: 5, count: 1, data: altData })
    }
  }

  // Fallback: If no tags were specified at all, add standard Orientation 1 so TIFF is valid
  if (ifd0Tags.length === 0 && exifSubIfdTags.length === 0 && gpsSubIfdTags.length === 0) {
    ifd0Tags.push({ tag: 0x0112, type: 3, count: 1, inlineVal: 1 })
  }

  // Pointer entries in IFD0
  let exifPointerEntry: TagEntry | undefined
  if (exifSubIfdTags.length > 0) {
    exifPointerEntry = { tag: 0x8769, type: 4, count: 1, inlineVal: 0 }
    ifd0Tags.push(exifPointerEntry)
  }

  let gpsPointerEntry: TagEntry | undefined
  if (gpsSubIfdTags.length > 0) {
    gpsPointerEntry = { tag: 0x8825, type: 4, count: 1, inlineVal: 0 }
    ifd0Tags.push(gpsPointerEntry)
  }

  // Sort IFD entries strictly ascending by tag ID per TIFF 6.0 spec
  ifd0Tags.sort((a, b) => a.tag - b.tag)
  exifSubIfdTags.sort((a, b) => a.tag - b.tag)
  gpsSubIfdTags.sort((a, b) => a.tag - b.tag)

  // Layout calculation
  const tiffHeaderSize = 8
  const ifd0Offset = tiffHeaderSize
  const ifd0Size = 2 + ifd0Tags.length * 12 + 4
  let currentOffset = ifd0Offset + ifd0Size

  let exifSubIfdOffset = 0
  if (exifSubIfdTags.length > 0 && exifPointerEntry) {
    exifSubIfdOffset = currentOffset
    exifPointerEntry.inlineVal = exifSubIfdOffset
    const exifSize = 2 + exifSubIfdTags.length * 12 + 4
    currentOffset += exifSize
  }

  let gpsSubIfdOffset = 0
  if (gpsSubIfdTags.length > 0 && gpsPointerEntry) {
    gpsSubIfdOffset = currentOffset
    gpsPointerEntry.inlineVal = gpsSubIfdOffset
    const gpsSize = 2 + gpsSubIfdTags.length * 12 + 4
    currentOffset += gpsSize
  }

  // Assign offsets for data pool
  const allTagsWithData = [...ifd0Tags, ...exifSubIfdTags, ...gpsSubIfdTags].filter((t) => t.data)
  for (const t of allTagsWithData) {
    t.offset = currentOffset
    currentOffset += t.data!.length
    if (currentOffset % 2 !== 0) currentOffset++ // 16-bit word alignment
  }

  const totalTiffSize = currentOffset
  const tiff = new Uint8Array(totalTiffSize)
  const view = new DataView(tiff.buffer)

  // Header: II (little-endian), 42, IFD0 offset
  tiff[0] = 0x49
  tiff[1] = 0x49
  view.setUint16(2, 42, true)
  view.setUint32(4, ifd0Offset, true)

  function writeIfd(offset: number, tags: TagEntry[]): void {
    view.setUint16(offset, tags.length, true)
    let cur = offset + 2
    for (const entry of tags) {
      view.setUint16(cur, entry.tag, true)
      view.setUint16(cur + 2, entry.type, true)
      view.setUint32(cur + 4, entry.count, true)

      if (entry.data) {
        view.setUint32(cur + 8, entry.offset!, true)
      } else if (entry.inlineBytes) {
        tiff.set(entry.inlineBytes, cur + 8)
      } else if (entry.inlineVal !== undefined) {
        if (entry.type === 3) {
          view.setUint16(cur + 8, entry.inlineVal, true)
          view.setUint16(cur + 10, 0, true)
        } else {
          view.setUint32(cur + 8, entry.inlineVal, true)
        }
      }
      cur += 12
    }
    // Next IFD offset = 0
    view.setUint32(cur, 0, true)
  }

  writeIfd(ifd0Offset, ifd0Tags)
  if (exifSubIfdTags.length > 0) writeIfd(exifSubIfdOffset, exifSubIfdTags)
  if (gpsSubIfdTags.length > 0) writeIfd(gpsSubIfdOffset, gpsSubIfdTags)

  // Write data pool
  for (const t of allTagsWithData) {
    if (t.data && t.offset !== undefined) {
      tiff.set(t.data, t.offset)
    }
  }

  return tiff
}

/**
 * Injects a new EXIF APP1 segment into a JPEG buffer, replacing any existing Exif APP1.
 */
export function injectExifJpeg(jpegBytes: Uint8Array, options: ExifInjectOptions): Uint8Array {
  if (jpegBytes.length < 2 || jpegBytes[0] !== 0xff || jpegBytes[1] !== 0xd8) {
    throw new Error('Not a valid JPEG image: missing SOI marker (0xFFD8)')
  }

  const tiff = buildExifTiff(options)
  const app1PayloadLen = 2 + 6 + tiff.length
  if (app1PayloadLen > 65535) {
    throw new Error(`EXIF data exceeds maximum JPEG segment size (${app1PayloadLen} > 65535)`)
  }

  const newApp1 = new Uint8Array(2 + app1PayloadLen)
  newApp1[0] = 0xff
  newApp1[1] = 0xe1
  newApp1[2] = (app1PayloadLen >> 8) & 0xff
  newApp1[3] = app1PayloadLen & 0xff
  // "Exif\0\0"
  newApp1[4] = 0x45
  newApp1[5] = 0x78
  newApp1[6] = 0x69
  newApp1[7] = 0x66
  newApp1[8] = 0x00
  newApp1[9] = 0x00
  newApp1.set(tiff, 10)

  // Split JPEG into segments, dropping existing Exif APP1 segments
  const segments: Uint8Array[] = []
  let pos = 2
  let inserted = false

  while (pos < jpegBytes.length) {
    if (jpegBytes[pos] !== 0xff) {
      pos++
      continue
    }

    const marker = jpegBytes[pos + 1]

    // Standalone markers
    if (marker === 0xd9) {
      // EOI
      segments.push(jpegBytes.subarray(pos, pos + 2))
      break
    }
    if (marker === 0xda) {
      // SOS (Start of Scan): remainder of the stream until EOI is image data
      let eoiPos = jpegBytes.length - 2
      while (eoiPos > pos && !(jpegBytes[eoiPos] === 0xff && jpegBytes[eoiPos + 1] === 0xd9)) {
        eoiPos--
      }
      if (eoiPos > pos) {
        segments.push(jpegBytes.subarray(pos, eoiPos))
        segments.push(new Uint8Array([0xff, 0xd9]))
      } else {
        segments.push(jpegBytes.subarray(pos))
      }
      break
    }

    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2
      continue
    }

    if (pos + 4 > jpegBytes.length) break
    const len = (jpegBytes[pos + 2] << 8) | jpegBytes[pos + 3]
    const segEnd = pos + 2 + len
    if (segEnd > jpegBytes.length) break

    // Check if it is an existing Exif APP1 segment
    const isExifApp1 =
      marker === 0xe1 &&
      segEnd - pos >= 10 &&
      jpegBytes[pos + 4] === 0x45 &&
      jpegBytes[pos + 5] === 0x78 &&
      jpegBytes[pos + 6] === 0x69 &&
      jpegBytes[pos + 7] === 0x66 &&
      jpegBytes[pos + 8] === 0x00 &&
      jpegBytes[pos + 9] === 0x00

    if (isExifApp1) {
      // Replace with newApp1
      if (!inserted) {
        segments.push(newApp1)
        inserted = true
      }
    } else {
      segments.push(jpegBytes.subarray(pos, segEnd))
      if (marker === 0xe0) {
        // If we haven't inserted yet, insert directly after APP0
        if (!inserted) {
          segments.push(newApp1)
          inserted = true
        }
      }
    }

    pos = segEnd
  }

  // If not inserted yet (no APP0 and no previous Exif APP1), insert right after SOI
  if (!inserted) {
    const totalLen = 2 + newApp1.length + segments.reduce((sum, s) => sum + s.length, 0)
    const out = new Uint8Array(totalLen)
    out[0] = 0xff
    out[1] = 0xd8
    out.set(newApp1, 2)
    let cur = 2 + newApp1.length
    for (const seg of segments) {
      out.set(seg, cur)
      cur += seg.length
    }
    return out
  }

  const totalLen = 2 + segments.reduce((sum, s) => sum + s.length, 0)
  const out = new Uint8Array(totalLen)
  out[0] = 0xff
  out[1] = 0xd8
  let cur = 2
  for (const seg of segments) {
    out.set(seg, cur)
    cur += seg.length
  }
  return out
}

/**
 * Injects a new eXIf chunk into a PNG buffer, replacing any existing eXIf chunk.
 */
export function injectExifPng(pngBytes: Uint8Array, options: ExifInjectOptions): Uint8Array {
  if (
    pngBytes.length < 8 ||
    pngBytes[0] !== 0x89 ||
    pngBytes[1] !== 0x50 ||
    pngBytes[2] !== 0x4e ||
    pngBytes[3] !== 0x47 ||
    pngBytes[4] !== 0x0d ||
    pngBytes[5] !== 0x0a ||
    pngBytes[6] !== 0x1a ||
    pngBytes[7] !== 0x0a
  ) {
    throw new Error('Not a valid PNG image: missing PNG 8-byte signature')
  }

  const tiff = buildExifTiff(options)
  const newChunk = new Uint8Array(4 + 4 + tiff.length + 4)
  const newChunkView = new DataView(newChunk.buffer)
  newChunkView.setUint32(0, tiff.length, false)
  newChunk[4] = 0x65 // 'e'
  newChunk[5] = 0x58 // 'X'
  newChunk[6] = 0x49 // 'I'
  newChunk[7] = 0x66 // 'f'
  newChunk.set(tiff, 8)
  const crc = crc32(newChunk.subarray(4, 8 + tiff.length))
  newChunkView.setUint32(8 + tiff.length, crc, false)

  const chunks: Uint8Array[] = []
  let pos = 8
  let inserted = false

  while (pos + 8 <= pngBytes.length) {
    const len =
      ((pngBytes[pos] << 24) |
        (pngBytes[pos + 1] << 16) |
        (pngBytes[pos + 2] << 8) |
        pngBytes[pos + 3]) >>>
      0
    const chunkType = String.fromCharCode(
      pngBytes[pos + 4],
      pngBytes[pos + 5],
      pngBytes[pos + 6],
      pngBytes[pos + 7]
    )
    const chunkEnd = pos + 12 + len
    if (chunkEnd > pngBytes.length) break

    if (chunkType === 'eXIf') {
      // Replace existing eXIf
      if (!inserted) {
        chunks.push(newChunk)
        inserted = true
      }
    } else {
      chunks.push(pngBytes.subarray(pos, chunkEnd))
      // Insert after IHDR
      if (chunkType === 'IHDR' && !inserted) {
        chunks.push(newChunk)
        inserted = true
      }
    }

    if (chunkType === 'IEND') break
    pos = chunkEnd
  }

  const totalLen = 8 + chunks.reduce((sum, c) => sum + c.length, 0)
  const out = new Uint8Array(totalLen)
  out.set(pngBytes.subarray(0, 8), 0)
  let cur = 8
  for (const c of chunks) {
    out.set(c, cur)
    cur += c.length
  }
  return out
}

/**
 * Injects EXIF metadata tags into an image buffer (JPEG or PNG).
 */
export function injectExif(imageBytes: Uint8Array, options: ExifInjectOptions): Uint8Array {
  const format = detectFormat(imageBytes)
  if (format === 'jpeg') return injectExifJpeg(imageBytes, options)
  if (format === 'png') return injectExifPng(imageBytes, options)
  throw new Error(`EXIF injection is supported for JPEG and PNG images (got ${format.toUpperCase()})`)
}
