// EXIF & Metadata Scrubber
// Byte-level stripping without canvas re-encoding:
// - Bit-identical pixels, zero generational quality loss, preserves Display P3 / sRGB ICC profiles.
// - Strips APP1 (Exif, XMP), APP13 (Photoshop/IPTC), COM, APP2 MPF from JPEG; truncates after EOI (FF D9).
// - Preserves orientation by writing a clean, minimal 36-byte APP1 segment if orientation > 1.
// - Strips eXIf, tEXt, zTXt, iTXt, tIME from PNG; truncates after IEND.
// - Strips EXIF, XMP chunks from WebP; clears VP8X flags; updates RIFF size.
//   No orientation is kept for WebP: Chromium 147 and WebKit 26.4 both ignore
//   the EXIF Orientation of a WebP (checked 2026-10-07), so it changes nothing.
// - Zero network requests, 100% in-browser client-side execution.

import { crc32 } from './png'
import { detectFormat, inspectMetadata, webpRiffEnd, type ImageMetadata } from './exif'

export interface ScrubOptions {
  /** 'all' strips all metadata (camera, GPS, comments, trailers); 'location_only' preserves camera/settings while wiping GPS. Default 'all'. */
  mode?: 'all' | 'location_only'
  /** If true, ensures orientation tag is preserved so phone photos render correctly in viewers. Default true. */
  preserveOrientation?: boolean
}

export interface SelfCheckReport {
  format: ImageMetadata['format']
  originalSize: number
  scrubbedSize: number
  bytesSaved: number
  tagsRemovedCount: number
  gpsRemoved: boolean
  cameraRemoved: boolean
  trailersRemoved: boolean
  orientationPreserved: boolean
  iccPreserved: boolean
  isClean: boolean
  /** What the check still found in the saved file, in plain words (empty when clean). */
  leftovers: string[]
  summary: string
}

export interface ScrubResult {
  data: Uint8Array
  format: ImageMetadata['format']
  report: SelfCheckReport
}

/**
 * Builds a minimal standard 26-byte TIFF header containing only tag 0x0112 (Orientation).
 * Little-endian (II).
 */
export function buildMinimalOrientationTiff(orientation: number): Uint8Array {
  const tiff = new Uint8Array(26)
  // Header: II (0x49 0x49), 42 (0x2a 0x00), offset to IFD0 = 8 (0x08 0x00 0x00 0x00)
  tiff[0] = 0x49
  tiff[1] = 0x49
  tiff[2] = 0x2a
  tiff[3] = 0x00
  tiff[4] = 0x08
  tiff[5] = 0x00
  tiff[6] = 0x00
  tiff[7] = 0x00

  // IFD0: 1 tag entry
  tiff[8] = 0x01
  tiff[9] = 0x00

  // Entry: Tag 0x0112 (Orientation)
  tiff[10] = 0x12
  tiff[11] = 0x01
  // Type: SHORT = 3
  tiff[12] = 0x03
  tiff[13] = 0x00
  // Count: 1
  tiff[14] = 0x01
  tiff[15] = 0x00
  tiff[16] = 0x00
  tiff[17] = 0x00
  // Value (SHORT)
  tiff[18] = orientation & 0xff
  tiff[19] = (orientation >> 8) & 0xff
  tiff[20] = 0x00
  tiff[21] = 0x00

  // Next IFD offset: 0
  tiff[22] = 0x00
  tiff[23] = 0x00
  tiff[24] = 0x00
  tiff[25] = 0x00

  return tiff
}

/**
 * Builds a minimal 36-byte JPEG APP1 segment containing only tag 0x0112 (Orientation).
 */
export function buildMinimalOrientationApp1(orientation: number): Uint8Array {
  const seg = new Uint8Array(36)
  // Marker FF E1
  seg[0] = 0xff
  seg[1] = 0xe1
  // Length = 34 (0x0022), covers bytes 2..35
  seg[2] = 0x00
  seg[3] = 0x22
  // "Exif\0\0"
  seg[4] = 0x45
  seg[5] = 0x78
  seg[6] = 0x69
  seg[7] = 0x66
  seg[8] = 0x00
  seg[9] = 0x00

  seg.set(buildMinimalOrientationTiff(orientation), 10)
  return seg
}

/**
 * Builds a PNG eXIf chunk containing only tag 0x0112 (Orientation).
 */
export function buildMinimalOrientationPngChunk(orientation: number): Uint8Array {
  const tiff = buildMinimalOrientationTiff(orientation)
  const chunk = new Uint8Array(4 + 4 + tiff.length + 4)
  const view = new DataView(chunk.buffer)

  // Chunk length (26 bytes)
  view.setUint32(0, tiff.length, false)

  // Chunk type 'eXIf'
  chunk[4] = 0x65
  chunk[5] = 0x58
  chunk[6] = 0x49
  chunk[7] = 0x66

  // Data
  chunk.set(tiff, 8)

  // CRC32 over type + data
  const crc = crc32(chunk.subarray(4, 8 + tiff.length))
  view.setUint32(8 + tiff.length, crc, false)

  return chunk
}

/**
 * Zeroes out GPS SubIFD in an existing TIFF block in-place, leaving camera and orientation tags intact.
 */
function wipeGpsFromTiff(data: Uint8Array, tiffStart: number): void {
  if (tiffStart + 8 > data.length) return
  const isLe = data[tiffStart] === 0x49 && data[tiffStart + 1] === 0x49
  const isBe = data[tiffStart] === 0x4d && data[tiffStart + 1] === 0x4d
  if (!isLe && !isBe) return

  const readU16 = (off: number) => {
    const p = tiffStart + off
    if (p + 2 > data.length) return 0
    return isLe ? data[p] | (data[p + 1] << 8) : (data[p] << 8) | data[p + 1]
  }

  const readU32 = (off: number) => {
    const p = tiffStart + off
    if (p + 4 > data.length) return 0
    return isLe
      ? (data[p] | (data[p + 1] << 8) | (data[p + 2] << 16) | (data[p + 3] << 24)) >>> 0
      : ((data[p] << 24) | (data[p + 1] << 16) | (data[p + 2] << 8) | data[p + 3]) >>> 0
  }

  const ifd0Offset = readU32(4)
  if (ifd0Offset === 0 || tiffStart + ifd0Offset + 2 > data.length) return

  const numEntries = readU16(ifd0Offset)
  let gpsOffset = 0
  let gpsEntryOffset = 0

  for (let i = 0; i < numEntries; i++) {
    const entryOff = ifd0Offset + 2 + i * 12
    if (tiffStart + entryOff + 12 > data.length) break
    const tag = readU16(entryOff)
    if (tag === 0x8825) {
      gpsOffset = readU32(entryOff + 8)
      gpsEntryOffset = entryOff
      break
    }
  }

  if (gpsOffset > 0 && tiffStart + gpsOffset + 2 <= data.length) {
    const gpsEntries = readU16(gpsOffset)
    const typeSizes = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8]

    for (let i = 0; i < gpsEntries; i++) {
      const gEntry = gpsOffset + 2 + i * 12
      if (tiffStart + gEntry + 12 > data.length) break
      const gType = readU16(gEntry + 2)
      const gCount = readU32(gEntry + 4)
      const size = (typeSizes[gType] || 1) * gCount
      if (size > 4) {
        const valOff = readU32(gEntry + 8)
        const p = tiffStart + valOff
        const len = Math.min(size, data.length - p)
        if (p >= 0 && len > 0) {
          data.fill(0, p, p + len)
        }
      }
    }

    // Zero out the GPS IFD directory table
    const dirLen = Math.min(2 + gpsEntries * 12 + 4, data.length - (tiffStart + gpsOffset))
    if (dirLen > 0) {
      data.fill(0, tiffStart + gpsOffset, tiffStart + gpsOffset + dirLen)
    }
  }

  // Remove the 0x8825 entry from IFD0: move the later entries and the
  // next-IFD link up by one entry, lower the count, and zero the freed space.
  if (gpsEntryOffset > 0) {
    const entryAt = tiffStart + gpsEntryOffset
    const linkEnd = tiffStart + ifd0Offset + 2 + numEntries * 12 + 4
    if (linkEnd <= data.length) {
      data.copyWithin(entryAt, entryAt + 12, linkEnd)
      data.fill(0, linkEnd - 12, linkEnd)
      const n = numEntries - 1
      const countAt = tiffStart + ifd0Offset
      data[countAt] = isLe ? n & 0xff : n >> 8
      data[countAt + 1] = isLe ? n >> 8 : n & 0xff
    } else {
      data.fill(0, entryAt, Math.min(entryAt + 12, data.length))
    }
  }
}

/** Where a JPEG's first scan (SOS) starts, or its length if it has none. */
function jpegFirstScan(data: Uint8Array): number {
  let pos = 2
  while (pos + 4 <= data.length) {
    if (data[pos] !== 0xff) return data.length
    const marker = data[pos + 1]
    if (marker === 0xff) {
      pos++
      continue
    }
    if (marker === 0xda) return pos
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2
      continue
    }
    const len = (data[pos + 2] << 8) | data[pos + 3]
    if (len < 2) return data.length
    pos += 2 + len
  }
  return data.length
}

/**
 * Strips metadata from JPEG buffers at the byte level.
 */
export function scrubJpeg(data: Uint8Array, options?: ScrubOptions): Uint8Array {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    throw new Error('Not a valid JPEG image: missing SOI marker')
  }

  const mode = options?.mode ?? 'all'
  const preserveOrientation = options?.preserveOrientation ?? true

  // The orientation to keep is the one viewers act on: metadata before the
  // picture data. (A tag tucked in after it, which they never read, would
  // otherwise turn the clean copy round.)
  const originalMeta = inspectMetadata(data.subarray(0, jpegFirstScan(data)))
  const parts: Uint8Array[] = []
  let totalLen = 0

  function appendChunk(chunk: Uint8Array) {
    parts.push(chunk)
    totalLen += chunk.byteLength
  }

  // SOI
  appendChunk(data.subarray(0, 2))

  // If complete scrub and orientation needs preserving, inject a minimal APP1
  // where viewers look for it: right after a leading JFIF APP0 if there is
  // one, otherwise right after SOI (phones write Exif first and no APP0).
  let orientationInjected = false
  const injectOrientationIfNeeded = () => {
    if (
      !orientationInjected &&
      mode === 'all' &&
      preserveOrientation &&
      originalMeta.orientation &&
      originalMeta.orientation > 1 &&
      originalMeta.orientation <= 8
    ) {
      const seg = buildMinimalOrientationApp1(originalMeta.orientation)
      appendChunk(seg)
      orientationInjected = true
    }
  }

  const leadingApp0 = data[2] === 0xff && data[3] === 0xe0
  if (!leadingApp0) injectOrientationIfNeeded()

  let pos = 2
  let inScan = false

  while (pos < data.length) {
    if (inScan) {
      // Copy the entropy-coded data up to the next marker (a stuffed FF 00
      // and the restart markers FF D0..D7 belong to it), then go back to
      // walking segments: a progressive JPEG has more tables and scans
      // after this, and metadata tucked in between must be dropped too.
      let end = pos
      while (end < data.length - 1) {
        const next = data[end + 1]
        if (data[end] === 0xff && next !== 0x00 && (next < 0xd0 || next > 0xd7)) break
        end++
      }
      if (end >= data.length - 1) {
        // Malformed without explicit EOI; append remaining
        appendChunk(data.subarray(pos))
        break
      }
      appendChunk(data.subarray(pos, end))
      pos = end
      inScan = false
      continue
    }

    if (data[pos] !== 0xff) {
      pos++
      continue
    }

    const marker = data[pos + 1]

    // Fill bytes 0xFF 0xFF
    if (marker === 0xff || marker === 0x00) {
      pos++
      continue
    }

    // Standalone markers
    if (marker === 0xd8) {
      pos += 2
      continue
    }
    if (marker === 0xd9) {
      // EOI reached before scan
      appendChunk(data.subarray(pos, pos + 2))
      break
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      // Standalone RST marker
      appendChunk(data.subarray(pos, pos + 2))
      pos += 2
      continue
    }

    if (pos + 4 > data.length) break
    const segLen = (data[pos + 2] << 8) | data[pos + 3]
    const segEnd = pos + 2 + segLen
    if (segEnd > data.length) break

    const segData = data.subarray(pos, segEnd)

    if (marker === 0xda) {
      // SOS (Start of Scan) - decoding marker, always keep
      appendChunk(segData)
      pos = segEnd
      inScan = true
      continue
    }

    // Evaluate segment to keep or strip
    if (marker === 0xe0) {
      // APP0 (JFIF) - keep
      appendChunk(segData)
      injectOrientationIfNeeded()
    } else if (marker === 0xee) {
      // APP14 (Adobe) - keep
      appendChunk(segData)
    } else if (marker === 0xe2) {
      // APP2: keep if ICC profile, drop if MPF or unknown
      const isIcc =
        segLen >= 14 &&
        data[pos + 4] === 0x49 && // 'I'
        data[pos + 5] === 0x43 && // 'C'
        data[pos + 6] === 0x43 && // 'C'
        data[pos + 7] === 0x5f && // '_'
        data[pos + 8] === 0x50 && // 'P'
        data[pos + 9] === 0x52 && // 'R'
        data[pos + 10] === 0x4f && // 'O'
        data[pos + 11] === 0x46 && // 'F'
        data[pos + 12] === 0x49 && // 'I'
        data[pos + 13] === 0x4c && // 'L'
        data[pos + 14] === 0x45 && // 'E'
        data[pos + 15] === 0x00 // '\0'
      if (isIcc) {
        appendChunk(segData)
      }
    } else if (marker === 0xe1) {
      // APP1 (Exif or XMP)
      if (mode === 'location_only') {
        const isExif =
          segLen >= 8 &&
          data[pos + 4] === 0x45 &&
          data[pos + 5] === 0x78 &&
          data[pos + 6] === 0x69 &&
          data[pos + 7] === 0x66 &&
          data[pos + 8] === 0x00 &&
          data[pos + 9] === 0x00

        if (isExif) {
          // Copy segment and wipe GPS tags from it
          const scrubbedSeg = new Uint8Array(segData)
          wipeGpsFromTiff(scrubbedSeg, 10)
          appendChunk(scrubbedSeg)
        }
        // XMP segments are dropped to prevent GPS leakage
      }
      // In 'all' mode, all APP1 segments are dropped
    } else if (marker === 0xed) {
      // APP13 (Photoshop/IPTC) - drop
    } else if (marker === 0xfe) {
      // COM (Comment) - drop
    } else if (marker >= 0xe3 && marker <= 0xef) {
      // Other APP segments - drop
    } else {
      // DQT (0xDB), DHT (0xC4), SOF (0xC0..0xCF), DRI (0xDD), etc. - keep
      appendChunk(segData)
    }

    pos = segEnd
  }

  // Concatenate parts
  const result = new Uint8Array(totalLen)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }

  return result
}

/**
 * Strips metadata from PNG buffers at the byte level.
 */
export function scrubPng(data: Uint8Array, options?: ScrubOptions): Uint8Array {
  if (
    data.length < 8 ||
    data[0] !== 0x89 ||
    data[1] !== 0x50 ||
    data[2] !== 0x4e ||
    data[3] !== 0x47 ||
    data[4] !== 0x0d ||
    data[5] !== 0x0a ||
    data[6] !== 0x1a ||
    data[7] !== 0x0a
  ) {
    throw new Error('Not a valid PNG image: signature mismatch')
  }

  const mode = options?.mode ?? 'all'
  const preserveOrientation = options?.preserveOrientation ?? true

  const originalMeta = inspectMetadata(data)
  const parts: Uint8Array[] = []
  let totalLen = 0

  function appendChunk(chunk: Uint8Array) {
    parts.push(chunk)
    totalLen += chunk.byteLength
  }

  // 8-byte PNG signature
  appendChunk(data.subarray(0, 8))

  let orientationInjected = false
  const injectOrientationIfNeeded = () => {
    if (
      !orientationInjected &&
      mode === 'all' &&
      preserveOrientation &&
      originalMeta.orientation &&
      originalMeta.orientation > 1 &&
      originalMeta.orientation <= 8
    ) {
      const eXIfChunk = buildMinimalOrientationPngChunk(originalMeta.orientation)
      appendChunk(eXIfChunk)
      orientationInjected = true
    }
  }

  let pos = 8

  while (pos + 8 <= data.length) {
    // Unsigned, so a damaged length can't send the walk backwards.
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
    const chunkEnd = pos + 8 + len + 4
    if (chunkEnd > data.length) break

    const chunkData = data.subarray(pos, chunkEnd)

    if (type === 'IDAT') {
      injectOrientationIfNeeded()
      appendChunk(chunkData)
    } else if (type === 'eXIf') {
      if (mode === 'location_only') {
        const scrubbedChunk = new Uint8Array(chunkData)
        // eXIf chunk data starts at offset 8
        wipeGpsFromTiff(scrubbedChunk, 8)
        // Recalculate CRC32 over type + data
        const crc = crc32(scrubbedChunk.subarray(4, 8 + len))
        const view = new DataView(scrubbedChunk.buffer, scrubbedChunk.byteOffset, scrubbedChunk.byteLength)
        view.setUint32(8 + len, crc, false)
        appendChunk(scrubbedChunk)
      }
      // In 'all' mode, eXIf is dropped
    } else if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt' || type === 'tIME') {
      // Text and timestamp chunks are dropped
    } else if (type === 'IEND') {
      // Append IEND chunk and terminate immediately, truncating anything trailing
      appendChunk(chunkData)
      break
    } else {
      // IHDR, PLTE, IDAT, iCCP, sRGB, gAMA, cHRM, etc. - keep
      appendChunk(chunkData)
    }

    pos = chunkEnd
  }

  const result = new Uint8Array(totalLen)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }

  return result
}

/**
 * Strips metadata from WebP buffers at the byte level.
 */
export function scrubWebp(data: Uint8Array): Uint8Array {
  if (
    data.length < 12 ||
    data[0] !== 0x52 ||
    data[1] !== 0x49 ||
    data[2] !== 0x46 ||
    data[3] !== 0x46 ||
    data[8] !== 0x57 ||
    data[9] !== 0x45 ||
    data[10] !== 0x42 ||
    data[11] !== 0x50
  ) {
    throw new Error('Not a valid WebP image: RIFF/WEBP header mismatch')
  }

  const parts: Uint8Array[] = []
  let totalLen = 0

  function appendChunk(chunk: Uint8Array) {
    parts.push(chunk)
    totalLen += chunk.byteLength
  }

  // RIFF header placeholder (12 bytes)
  const header = new Uint8Array(12)
  header.set(data.subarray(0, 12), 0)
  appendChunk(header)

  let pos = 12
  // Stop at the RIFF end: anything after it is a trailer and is cut.
  const end = webpRiffEnd(data)

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
    const paddedSize = size + (size % 2)
    const chunkEnd = pos + 8 + paddedSize
    // A chunk's data must fit inside the RIFF; only its padding byte may be
    // missing (some writers leave it out of the size), and is put back.
    if (pos + 8 + size > end) break

    const chunkData =
      chunkEnd <= data.length ? data.subarray(pos, chunkEnd) : new Uint8Array([...data.subarray(pos, pos + 8 + size), 0])

    if (fourCC === 'EXIF' || fourCC === 'XMP ') {
      // Strip EXIF and XMP chunks
    } else if (fourCC === 'VP8X') {
      // Clear EXIF (bit 3: 0x08) and XMP (bit 2: 0x04) flags in VP8X chunk
      const vp8xCopy = new Uint8Array(chunkData)
      vp8xCopy[8] &= ~(0x04 | 0x08)
      appendChunk(vp8xCopy)
    } else {
      appendChunk(chunkData)
    }

    pos = chunkEnd
  }

  const result = new Uint8Array(totalLen)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }

  // Update RIFF file size in header (bytes 4..7) = totalLen - 8
  const view = new DataView(result.buffer)
  view.setUint32(4, totalLen - 8, true)

  return result
}

/**
 * Re-reads and self-verifies that metadata has been stripped and expectations are met.
 */
export function verifyScrubbed(
  originalMeta: ImageMetadata,
  originalSize: number,
  scrubbedData: Uint8Array,
  options?: ScrubOptions
): SelfCheckReport {
  const mode = options?.mode ?? 'all'
  const scrubbedMeta = inspectMetadata(scrubbedData)
  const scrubbedSize = scrubbedData.byteLength
  const bytesSaved = originalSize - scrubbedSize

  const gpsRemoved = !scrubbedMeta.gps
  const cameraRemoved = !scrubbedMeta.make && !scrubbedMeta.model
  const trailersRemoved = scrubbedMeta.trailerBytes === 0
  const iccPreserved = !originalMeta.hasIccProfile || scrubbedMeta.hasIccProfile
  const orientationPreserved =
    !originalMeta.orientation ||
    originalMeta.orientation <= 1 ||
    scrubbedMeta.orientation === originalMeta.orientation

  // In 'all' mode the only field allowed to stay is the orientation we wrote.
  const keptOrientation = scrubbedMeta.orientation !== undefined && scrubbedMeta.orientation > 1 ? 1 : 0
  const fieldsLeft = mode === 'all' ? Math.max(0, scrubbedMeta.rawTagCount - keptOrientation) : 0

  const leftovers: string[] = []
  if (!gpsRemoved) leftovers.push('GPS coordinates')
  if (mode === 'all' && !cameraRemoved) {
    leftovers.push(`camera tags (${[scrubbedMeta.make, scrubbedMeta.model].filter(Boolean).join(' ')})`)
  }
  if (fieldsLeft > 0) leftovers.push(`${fieldsLeft} metadata field${fieldsLeft === 1 ? '' : 's'} in all`)
  if (!trailersRemoved) leftovers.push(`${scrubbedMeta.trailerBytes.toLocaleString()} trailing bytes`)

  const isClean = leftovers.length === 0

  // Build plain-English summary
  const summaryParts: string[] = []
  if (!isClean) {
    summaryParts.push(`Still found: ${leftovers.join(', ')}.`)
  }
  if (mode === 'all') {
    if (isClean) summaryParts.push('Checked: 0 GPS coordinates, 0 camera tags, 0 trailing bytes found.')
    const kept: string[] = []
    if (scrubbedMeta.hasIccProfile) kept.push('colour profile')
    if (scrubbedMeta.orientation && scrubbedMeta.orientation > 1) kept.push('orientation')
    if (kept.length > 0) {
      summaryParts.push(`Kept: ${kept.join(', ')}.`)
    } else if (isClean) {
      summaryParts.push('Clean pixel stream.')
    }
  } else {
    if (isClean) summaryParts.push('Checked: 0 GPS coordinates, 0 trailing bytes found.')
    const kept: string[] = []
    if (scrubbedMeta.make || scrubbedMeta.model) {
      kept.push(`camera (${[scrubbedMeta.make, scrubbedMeta.model].filter(Boolean).join(' ')})`)
    }
    if (scrubbedMeta.dateTime) kept.push('date')
    if (scrubbedMeta.orientation && scrubbedMeta.orientation > 1) kept.push('orientation')
    if (scrubbedMeta.hasIccProfile) kept.push('colour profile')
    if (kept.length > 0) {
      summaryParts.push(`Kept: ${kept.join(', ')}.`)
    }
  }

  return {
    format: scrubbedMeta.format,
    originalSize,
    scrubbedSize,
    bytesSaved,
    tagsRemovedCount: Math.max(0, originalMeta.rawTagCount - scrubbedMeta.rawTagCount),
    gpsRemoved,
    cameraRemoved,
    trailersRemoved,
    orientationPreserved,
    iccPreserved,
    isClean,
    leftovers,
    summary: summaryParts.join(' ')
  }
}

/**
 * Main entry point: scrubs metadata from an image buffer at the byte level with self-check verification.
 */
export function scrubImage(data: Uint8Array, options?: ScrubOptions): ScrubResult {
  const format = detectFormat(data)
  const originalMeta = inspectMetadata(data)

  let scrubbedData: Uint8Array
  if (format === 'jpeg') {
    scrubbedData = scrubJpeg(data, options)
  } else if (format === 'png') {
    scrubbedData = scrubPng(data, options)
  } else if (format === 'webp') {
    scrubbedData = scrubWebp(data)
  } else if (format === 'heic') {
    throw new Error(
      'HEIC files cannot be safely scrubbed at the byte level in the browser without re-encoding. Convert to JPEG or WebP to scrub metadata.'
    )
  } else if (format === 'avif') {
    throw new Error(
      'AVIF files cannot be scrubbed here yet: only JPEG, PNG and WebP can. Convert to one of those to scrub metadata.'
    )
  } else {
    throw new Error('Unsupported image format. Supported formats: JPEG, PNG, WebP.')
  }

  const report = verifyScrubbed(originalMeta, data.byteLength, scrubbedData, options)

  return {
    data: scrubbedData,
    format,
    report
  }
}

export interface ScrubBatchItem {
  id: string
  name: string
  size: number
  format: ImageMetadata['format']
  hasGps: boolean
  trailerBytes: number
  rawBytes: Uint8Array
  meta: ImageMetadata
  cleanBytes?: Uint8Array
  cleanFilename?: string
  /** The self-check of the scrubbed file. */
  report?: SelfCheckReport
  status: 'pending' | 'scrubbed' | 'error'
  errorMessage?: string
}

export function createScrubBatchItem(fileBytes: Uint8Array, filename: string): ScrubBatchItem {
  const meta = inspectMetadata(fileBytes)
  return {
    id: `${filename}-${Math.random().toString(36).slice(2, 9)}`,
    name: filename,
    size: fileBytes.length,
    format: meta.format,
    hasGps: !!meta.gps,
    trailerBytes: meta.trailerBytes,
    rawBytes: fileBytes,
    meta,
    status: 'pending'
  }
}

export function scrubBatch(
  items: ScrubBatchItem[],
  options?: ScrubOptions
): { items: ScrubBatchItem[]; zipEntries: { name: string; data: Uint8Array }[] } {
  const zipEntries: { name: string; data: Uint8Array }[] = []
  // Names already in the ZIP, lower-cased: unzipping on Windows or a Mac
  // treats A.jpg and a.jpg as the same file.
  const used = new Set<string>()
  for (const item of items) {
    try {
      const res = scrubImage(item.rawBytes, options)
      item.cleanBytes = res.data
      item.report = res.report
      const ext = res.format === 'jpeg' ? 'jpg' : res.format
      const base = item.name.replace(/\.[^/.]+$/, '')
      let name = `${base}-clean.${ext}`
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}-clean-${n}.${ext}`
      used.add(name.toLowerCase())
      item.cleanFilename = name
      item.status = 'scrubbed'
      zipEntries.push({
        name: item.cleanFilename,
        data: item.cleanBytes
      })
    } catch (err) {
      item.status = 'error'
      item.errorMessage = (err as Error).message
    }
  }
  return { items, zipEntries }
}

