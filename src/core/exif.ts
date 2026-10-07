// EXIF & Metadata Parser
// Extracts camera, GPS coordinates, timestamps, exposure settings, thumbnails,
// and trailer data across JPEG, PNG, WebP, and HEIC files without external dependencies.

export interface GpsCoordinates {
  latitude: number
  longitude: number
  altitude?: number
  latRef: string
  lonRef: string
}

export interface ImageMetadata {
  format: 'jpeg' | 'png' | 'webp' | 'heic' | 'unknown'
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
  hasIccProfile: boolean
  hasThumbnail: boolean
  thumbnail?: {
    mimeType: string
    data: Uint8Array
  }
  trailerBytes: number
  rawTagCount: number
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
    const brand = String.fromCharCode(data[8], data[9], data[10], data[11])
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand.toLowerCase())) {
      return 'heic'
    }
  }
  return 'unknown'
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
    const end = Math.min(this.data.length, pos + length)
    let s = ''
    for (let i = pos; i < end; i++) {
      if (this.data[i] === 0) break
      s += String.fromCharCode(this.data[i])
    }
    return s.trim()
  }

  readIfd(offset: number): Map<number, { type: number; count: number; value: unknown; valOffset: number }> {
    const entries = new Map<number, { type: number; count: number; value: unknown; valOffset: number }>()
    if (offset + 2 > this.data.length - this.baseOffset) return entries
    const numTags = this.getUint16(offset)
    let cur = offset + 2

    for (let i = 0; i < numTags; i++) {
      if (cur + 12 > this.data.length - this.baseOffset) break
      const tag = this.getUint16(cur)
      const type = this.getUint16(cur + 2)
      const count = this.getUint32(cur + 4)
      const typeSize = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8][type] || 1
      const totalSize = count * typeSize

      let value: unknown
      let valOffset: number

      if (totalSize <= 4) {
        valOffset = cur + 8
        switch (type) {
          case 1: // BYTE
            value = this.data[this.baseOffset + cur + 8]
            break
          case 2: // ASCII
            value = this.getString(cur + 8, count)
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
          case 2: // ASCII
            value = this.getString(valOffset, count)
            break
          case 5: // RATIONAL
          case 10: // SRATIONAL
            value = this.getRational(valOffset)
            break
          default:
            value = valOffset
        }
      }

      entries.set(tag, { type, count, value, valOffset })
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

  const ifd0 = reader.readIfd(ifd0Offset)
  meta.rawTagCount += ifd0.size

  // Standard tags in IFD0
  if (ifd0.has(0x010f)) meta.make = String(ifd0.get(0x010f)!.value)
  if (ifd0.has(0x0110)) meta.model = String(ifd0.get(0x0110)!.value)
  if (ifd0.has(0x0112)) meta.orientation = Number(ifd0.get(0x0112)!.value)
  if (ifd0.has(0x0132)) meta.dateTime = String(ifd0.get(0x0132)!.value)
  if (ifd0.has(0x0131)) meta.software = String(ifd0.get(0x0131)!.value)
  if (ifd0.has(0x013b)) meta.artist = String(ifd0.get(0x013b)!.value)
  if (ifd0.has(0x8298)) meta.copyright = String(ifd0.get(0x8298)!.value)

  // SubIFD Exif (0x8769)
  if (ifd0.has(0x8769)) {
    const exifOffset = Number(ifd0.get(0x8769)!.value)
    const exifIfd = reader.readIfd(exifOffset)
    meta.rawTagCount += exifIfd.size

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
    rawTagCount: 0
  }

  if (format === 'jpeg') {
    inspectJpeg(data, meta)
  } else if (format === 'png') {
    inspectPng(data, meta)
  } else if (format === 'webp') {
    inspectWebp(data, meta)
  } else if (format === 'heic') {
    inspectHeic(data, meta)
  }

  return meta
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

    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
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
      }
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
    const len =
      (data[pos] << 24) |
      (data[pos + 1] << 16) |
      (data[pos + 2] << 8) |
      data[pos + 3]
    const type = String.fromCharCode(
      data[pos + 4],
      data[pos + 5],
      data[pos + 6],
      data[pos + 7]
    )
    const chunkData = pos + 8
    const nextChunk = chunkData + len + 4

    if (type === 'eXIf') {
      parseTiffBlock(data, chunkData, meta)
    } else if (type === 'iCCP') {
      meta.hasIccProfile = true
    } else if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      meta.rawTagCount++
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

function inspectWebp(data: Uint8Array, meta: ImageMetadata): void {
  let pos = 12 // Skip "RIFF" + size + "WEBP"

  while (pos + 8 <= data.length) {
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
