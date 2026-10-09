// EXIF & TIFF tag dictionary
// Tag names (TIFF 6.0, Exif 2.32, and the Windows XP tags) and how to show
// each value in the inspector's All Tags list.
//
// Values arrive decoded by exif.ts: text as a string, a single number as a
// number, several numbers as number[] (rationals already divided out, signed
// types signed), and UNDEFINED bytes as a Uint8Array. Long lists come in cut
// short, and `count` says how many values the tag really holds.

export type TagValue = string | number | number[] | Uint8Array | undefined

export interface TagDefinition {
  name: string
  format?: (value: TagValue, count: number) => string
}

export type TagCategory = 'IFD0' | 'Exif' | 'GPS' | 'Interop' | 'IFD1'

/** A number without float noise: 72, 0.3333, 41.2. */
function num(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)))
}

function first(v: TagValue): number {
  if (Array.isArray(v)) return v[0] ?? NaN
  if (v instanceof Uint8Array) return v[0] ?? NaN
  return Number(v)
}

function bytesOf(v: TagValue): Uint8Array {
  if (v instanceof Uint8Array) return v
  if (Array.isArray(v)) return Uint8Array.from(v)
  if (typeof v === 'number') return Uint8Array.of(v)
  return new Uint8Array(0)
}

function enumOf(map: Record<number, string>): (v: TagValue) => string {
  return (v) => map[first(v)] ?? String(first(v))
}

/** Seconds as a camera shows them: 1/250s, 0.8s, 2s. */
export function formatExposure(seconds: number): string {
  if (!(seconds > 0)) return String(seconds)
  if (seconds < 1) {
    const inv = 1 / seconds
    // 1/3, 1/250 ... but 0.8s stays 0.8s rather than becoming "1/1s".
    if (Math.abs(inv - Math.round(inv)) < 0.01 * inv) return `1/${Math.round(inv)}s`
    return `${num(Number(seconds.toFixed(3)))}s`
  }
  return `${num(Number(seconds.toFixed(1)))}s`
}

/** Degrees, minutes, seconds: 41° 52' 41.21". */
function dms(v: TagValue): string {
  if (!Array.isArray(v) || v.length < 3) return generic(v, 1)
  const [d, m, s] = v
  return `${num(d)}° ${num(m)}' ${num(Number(s.toFixed(2)))}"`
}

/** Exif version bytes "0232" → 2.32. */
function version(v: TagValue): string {
  const b = bytesOf(v)
  const text = String.fromCharCode(...b.subarray(0, 4))
  if (!/^\d{4}$/.test(text)) return generic(v, b.length)
  return `${Number(text.slice(0, 2))}.${text.slice(2)}`
}

/** UTF-16 text, guessing the byte order when the file doesn't say. */
function utf16(bytes: Uint8Array, littleEndian?: boolean): string {
  let le = littleEndian
  if (le === undefined) {
    // Mostly-Latin text has a zero in every other byte; which half holds
    // the zeros gives the byte order.
    let evenZeros = 0
    let oddZeros = 0
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      if (bytes[i] === 0) evenZeros++
      if (bytes[i + 1] === 0) oddZeros++
    }
    le = oddZeros >= evenZeros
  }
  const n = bytes.length - (bytes.length % 2)
  return new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(bytes.subarray(0, n)).replace(/\0+$/, '')
}

/**
 * UserComment and GPSProcessingMethod: 8 bytes naming the character set,
 * then the text.
 */
export function decodeCharsetText(v: TagValue): string {
  const b = bytesOf(v)
  if (b.length < 8) return printable(b) ?? `${b.length} bytes`
  const head = String.fromCharCode(...b.subarray(0, 8)).replace(/\0+$/, '')
  const body = b.subarray(8)
  if (head === 'UNICODE') return utf16(body).trim()
  if (head === 'JIS') return `${body.length} bytes of JIS text`
  // ASCII, or the all-zero "undefined" set that cameras fill with spaces.
  const text = new TextDecoder('utf-8').decode(body).replace(/\0+$/, '').trim()
  return text
}

/** Short runs of plain text inside UNDEFINED bytes, else null. */
function printable(b: Uint8Array): string | null {
  const end = b.indexOf(0) === -1 ? b.length : b.indexOf(0)
  if (end === 0 || end > 64) return null
  for (let i = 0; i < end; i++) if (b[i] < 0x20 || b[i] > 0x7e) return null
  for (let i = end; i < b.length; i++) if (b[i] !== 0) return null
  return String.fromCharCode(...b.subarray(0, end))
}

/** Any value, when the tag has no formatter of its own. */
function generic(v: TagValue, count: number): string {
  if (v === undefined) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number') return num(v)
  if (v instanceof Uint8Array) {
    const text = printable(v)
    return text !== null ? text : `${count} bytes`
  }
  const shown = v.slice(0, 16).map(num).join(', ')
  return count > 16 ? `${shown} … (${count} values)` : shown
}

/** Windows XP tags: UTF-16LE text in BYTE values. */
const xpText = (v: TagValue) => utf16(bytesOf(v), true)

const pointer = (what: string) => (v: TagValue) => `${what} at byte ${first(v)}`

export const IFD0_TAGS: Record<number, TagDefinition> = {
  0x00fe: { name: 'NewSubfileType' },
  0x00ff: { name: 'SubfileType' },
  0x0100: { name: 'ImageWidth' },
  0x0101: { name: 'ImageLength' },
  0x0102: { name: 'BitsPerSample' },
  0x0103: { name: 'Compression' },
  0x0106: { name: 'PhotometricInterpretation' },
  0x010e: { name: 'ImageDescription' },
  0x010f: { name: 'Make' },
  0x0110: { name: 'Model' },
  0x0111: { name: 'StripOffsets' },
  0x0112: {
    name: 'Orientation',
    format: (v) => {
      const n = first(v)
      const map: Record<number, string> = {
        1: 'Horizontal (normal)',
        2: 'Mirror horizontal',
        3: 'Rotate 180°',
        4: 'Mirror vertical',
        5: 'Mirror horizontal and rotate 270° CW',
        6: 'Rotate 90° CW',
        7: 'Mirror horizontal and rotate 90° CW',
        8: 'Rotate 270° CW'
      }
      return map[n] ? `${n} (${map[n]})` : String(n)
    }
  },
  0x0115: { name: 'SamplesPerPixel' },
  0x0116: { name: 'RowsPerStrip' },
  0x0117: { name: 'StripByteCounts' },
  0x011a: { name: 'XResolution' },
  0x011b: { name: 'YResolution' },
  0x011c: { name: 'PlanarConfiguration' },
  0x0128: { name: 'ResolutionUnit', format: enumOf({ 1: 'None', 2: 'Inches', 3: 'Centimeters' }) },
  0x0131: { name: 'Software' },
  0x0132: { name: 'DateTime' },
  0x013b: { name: 'Artist' },
  0x013e: { name: 'WhitePoint' },
  0x013f: { name: 'PrimaryChromaticities' },
  0x0211: { name: 'YCbCrCoefficients' },
  0x0212: { name: 'YCbCrSubSampling' },
  0x0213: { name: 'YCbCrPositioning', format: enumOf({ 1: 'Centered', 2: 'Co-sited' }) },
  0x0214: { name: 'ReferenceBlackWhite' },
  0x02bc: { name: 'XMP (in EXIF)', format: (_v, count) => `${count} bytes` },
  0x4746: { name: 'Rating' },
  0x4749: { name: 'RatingPercent' },
  0x8298: { name: 'Copyright' },
  0x83bb: { name: 'IPTC (in EXIF)', format: (_v, count) => `${count} values` },
  0x8769: { name: 'ExifIFDPointer', format: pointer('Exif block') },
  0x8773: { name: 'ICC Profile (in EXIF)', format: (_v, count) => `${count} bytes` },
  0x8825: { name: 'GPSInfoIFDPointer', format: pointer('GPS block') },
  0x9c9b: { name: 'XPTitle', format: xpText },
  0x9c9c: { name: 'XPComment', format: xpText },
  0x9c9d: { name: 'XPAuthor', format: xpText },
  0x9c9e: { name: 'XPKeywords', format: xpText },
  0x9c9f: { name: 'XPSubject', format: xpText },
  0xc4a5: { name: 'PrintIM', format: (_v, count) => `${count} bytes` },
  0xea1c: { name: 'Padding', format: (_v, count) => `${count} bytes` }
}

export const EXIF_SUBIFD_TAGS: Record<number, TagDefinition> = {
  0x829a: { name: 'ExposureTime', format: (v) => formatExposure(first(v)) },
  0x829d: { name: 'FNumber', format: (v) => `f/${num(Number(first(v).toFixed(2)))}` },
  0x8822: {
    name: 'ExposureProgram',
    format: enumOf({
      0: 'Not defined',
      1: 'Manual',
      2: 'Normal program',
      3: 'Aperture priority',
      4: 'Shutter priority',
      5: 'Creative program',
      6: 'Action program',
      7: 'Portrait mode',
      8: 'Landscape mode'
    })
  },
  0x8827: { name: 'ISOSpeedRatings', format: (v) => `ISO ${first(v)}` },
  0x8830: { name: 'SensitivityType' },
  0x8832: { name: 'RecommendedExposureIndex' },
  0x8833: { name: 'ISOSpeed' },
  0x9000: { name: 'ExifVersion', format: version },
  0x9003: { name: 'DateTimeOriginal' },
  0x9004: { name: 'DateTimeDigitized' },
  0x9010: { name: 'OffsetTime' },
  0x9011: { name: 'OffsetTimeOriginal' },
  0x9012: { name: 'OffsetTimeDigitized' },
  0x9101: {
    name: 'ComponentsConfiguration',
    format: (v) => {
      const names = ['-', 'Y', 'Cb', 'Cr', 'R', 'G', 'B']
      return Array.from(bytesOf(v).subarray(0, 4), (c) => names[c] ?? String(c)).join(', ')
    }
  },
  0x9102: { name: 'CompressedBitsPerPixel' },
  // APEX values: shutter Tv = -log2(seconds), aperture Av = 2·log2(f-number).
  0x9201: { name: 'ShutterSpeedValue', format: (v) => formatExposure(Math.pow(2, -first(v))) },
  0x9202: { name: 'ApertureValue', format: (v) => `f/${Math.pow(Math.SQRT2, first(v)).toFixed(1)}` },
  0x9203: { name: 'BrightnessValue', format: (v) => `${num(first(v))} EV` },
  0x9204: {
    name: 'ExposureBiasValue',
    format: (v) => {
      const n = first(v)
      return `${n > 0 ? '+' : ''}${num(Number(n.toFixed(2)))} EV`
    }
  },
  0x9205: { name: 'MaxApertureValue', format: (v) => `f/${Math.pow(Math.SQRT2, first(v)).toFixed(1)}` },
  0x9206: { name: 'SubjectDistance', format: (v) => `${num(Number(first(v).toFixed(2)))} m` },
  0x9207: {
    name: 'MeteringMode',
    format: enumOf({
      0: 'Unknown',
      1: 'Average',
      2: 'Center-weighted average',
      3: 'Spot',
      4: 'Multi-spot',
      5: 'Multi-segment / Pattern',
      6: 'Partial',
      255: 'Other'
    })
  },
  0x9208: { name: 'LightSource' },
  0x9209: { name: 'Flash', format: (v) => ((first(v) & 1) === 1 ? 'Flash fired' : 'Flash did not fire') },
  0x920a: { name: 'FocalLength', format: (v) => `${num(Number(first(v).toFixed(2)))} mm` },
  0x9214: { name: 'SubjectArea' },
  0x927c: { name: 'MakerNote', format: (_v, count) => `${count} bytes (the camera maker's own data)` },
  0x9286: { name: 'UserComment', format: decodeCharsetText },
  0x9290: { name: 'SubSecTime' },
  0x9291: { name: 'SubSecTimeOriginal' },
  0x9292: { name: 'SubSecTimeDigitized' },
  0xa000: { name: 'FlashpixVersion', format: version },
  0xa001: { name: 'ColorSpace', format: enumOf({ 1: 'sRGB', 65535: 'Uncalibrated' }) },
  0xa002: { name: 'PixelXDimension', format: (v) => `${first(v)} px` },
  0xa003: { name: 'PixelYDimension', format: (v) => `${first(v)} px` },
  0xa005: { name: 'InteroperabilityIFDPointer', format: pointer('Interop block') },
  0xa20e: { name: 'FocalPlaneXResolution' },
  0xa20f: { name: 'FocalPlaneYResolution' },
  0xa210: { name: 'FocalPlaneResolutionUnit', format: enumOf({ 2: 'Inches', 3: 'Centimeters' }) },
  0xa217: { name: 'SensingMethod' },
  0xa300: { name: 'FileSource', format: enumOf({ 1: 'Film scanner', 2: 'Reflection print scanner', 3: 'Digital camera' }) },
  0xa301: { name: 'SceneType', format: enumOf({ 1: 'Directly photographed' }) },
  0xa302: { name: 'CFAPattern' },
  0xa401: { name: 'CustomRendered' },
  0xa402: { name: 'ExposureMode', format: enumOf({ 0: 'Auto', 1: 'Manual', 2: 'Auto bracket' }) },
  0xa403: { name: 'WhiteBalance', format: enumOf({ 0: 'Auto', 1: 'Manual' }) },
  0xa404: { name: 'DigitalZoomRatio' },
  0xa405: { name: 'FocalLengthIn35mmFilm', format: (v) => `${first(v)} mm` },
  0xa406: { name: 'SceneCaptureType', format: enumOf({ 0: 'Standard', 1: 'Landscape', 2: 'Portrait', 3: 'Night' }) },
  0xa407: { name: 'GainControl' },
  0xa408: { name: 'Contrast' },
  0xa409: { name: 'Saturation' },
  0xa40a: { name: 'Sharpness' },
  0xa420: { name: 'ImageUniqueID' },
  0xa430: { name: 'CameraOwnerName' },
  0xa431: { name: 'BodySerialNumber' },
  0xa432: {
    name: 'LensSpecification',
    format: (v) => {
      if (!Array.isArray(v) || v.length < 4) return generic(v, 1)
      // 0 means "unknown" here (the file stores 0/0).
      const part = (a: number, b: number, unit: (n: string) => string) =>
        !a && !b ? '' : a === b || !b ? unit(num(a)) : unit(`${num(a)}–${num(b)}`)
      const focal = part(v[0], v[1], (n) => `${n} mm`)
      const f = part(v[2], v[3], (n) => `f/${n}`)
      return [focal, f].filter(Boolean).join(' ') || generic(v, 4)
    }
  },
  0xa433: { name: 'LensMake' },
  0xa434: { name: 'LensModel' },
  0xa435: { name: 'LensSerialNumber' },
  0xa460: { name: 'CompositeImage' },
  0xea1c: { name: 'Padding', format: (_v, count) => `${count} bytes` },
  0xea1d: { name: 'OffsetSchema' }
}

export const GPS_SUBIFD_TAGS: Record<number, TagDefinition> = {
  0x0000: { name: 'GPSVersionID', format: (v) => Array.from(bytesOf(v)).join('.') },
  0x0001: { name: 'GPSLatitudeRef' },
  0x0002: { name: 'GPSLatitude', format: dms },
  0x0003: { name: 'GPSLongitudeRef' },
  0x0004: { name: 'GPSLongitude', format: dms },
  0x0005: { name: 'GPSAltitudeRef', format: (v) => (first(v) === 1 ? 'Below sea level' : 'Above sea level') },
  0x0006: { name: 'GPSAltitude', format: (v) => `${first(v).toFixed(1)} m` },
  0x0007: {
    name: 'GPSTimeStamp',
    format: (v) => {
      if (!Array.isArray(v) || v.length < 3) return generic(v, 1)
      const pad = (n: number) => String(Math.floor(n)).padStart(2, '0')
      return `${pad(v[0])}:${pad(v[1])}:${pad(v[2])} UTC`
    }
  },
  0x0008: { name: 'GPSSatellites' },
  0x0009: { name: 'GPSStatus' },
  0x000a: { name: 'GPSMeasureMode' },
  0x000b: { name: 'GPSDOP' },
  0x000c: { name: 'GPSSpeedRef' },
  0x000d: { name: 'GPSSpeed' },
  0x000e: { name: 'GPSTrackRef' },
  0x000f: { name: 'GPSTrack', format: (v) => `${num(first(v))}°` },
  0x0010: { name: 'GPSImgDirectionRef' },
  0x0011: { name: 'GPSImgDirection', format: (v) => `${num(first(v))}°` },
  0x0012: { name: 'GPSMapDatum' },
  0x0013: { name: 'GPSDestLatitudeRef' },
  0x0014: { name: 'GPSDestLatitude', format: dms },
  0x0015: { name: 'GPSDestLongitudeRef' },
  0x0016: { name: 'GPSDestLongitude', format: dms },
  0x0017: { name: 'GPSDestBearingRef' },
  0x0018: { name: 'GPSDestBearing', format: (v) => `${num(first(v))}°` },
  0x0019: { name: 'GPSDestDistanceRef' },
  0x001a: { name: 'GPSDestDistance' },
  0x001b: { name: 'GPSProcessingMethod', format: decodeCharsetText },
  0x001c: { name: 'GPSAreaInformation', format: decodeCharsetText },
  0x001d: { name: 'GPSDateStamp' },
  0x001e: { name: 'GPSDifferential' },
  0x001f: { name: 'GPSHPositioningError', format: (v) => `${num(first(v))} m` }
}

export const INTEROP_SUBIFD_TAGS: Record<number, TagDefinition> = {
  0x0001: { name: 'InteroperabilityIndex' },
  0x0002: { name: 'InteroperabilityVersion', format: version }
}

export const IFD1_TAGS: Record<number, TagDefinition> = {
  0x0100: { name: 'ThumbnailImageWidth' },
  0x0101: { name: 'ThumbnailImageHeight' },
  0x0103: { name: 'ThumbnailCompression', format: enumOf({ 1: 'Uncompressed', 6: 'JPEG' }) },
  0x011a: { name: 'XResolution' },
  0x011b: { name: 'YResolution' },
  0x0128: { name: 'ResolutionUnit', format: enumOf({ 1: 'None', 2: 'Inches', 3: 'Centimeters' }) },
  0x0201: { name: 'JPEGInterchangeFormat', format: pointer('Thumbnail') },
  0x0202: { name: 'JPEGInterchangeFormatLength', format: (v) => `${first(v)} bytes` }
}

function dictFor(category: TagCategory): Record<number, TagDefinition> {
  switch (category) {
    case 'IFD0':
      return IFD0_TAGS
    case 'Exif':
      return EXIF_SUBIFD_TAGS
    case 'GPS':
      return GPS_SUBIFD_TAGS
    case 'Interop':
      return INTEROP_SUBIFD_TAGS
    default:
      return IFD1_TAGS
  }
}

/** Resolves human-readable name for an EXIF tag in a given IFD category. */
export function getTagName(category: TagCategory, tagId: number): string {
  return dictFor(category)[tagId]?.name || `Unknown Tag (0x${tagId.toString(16).padStart(4, '0')})`
}

/** Long text is cut here in the table; the filter still finds what's shown. */
const MAX_SHOWN_CHARS = 500

/** Formats a tag value using its dictionary definition or default rules. */
export function formatTagValue(category: TagCategory, tagId: number, val: TagValue, count = 1): string {
  const def = dictFor(category)[tagId]
  let text: string
  try {
    text = def?.format ? def.format(val, count) : generic(val, count)
  } catch {
    text = generic(val, count)
  }
  return text.length > MAX_SHOWN_CHARS ? `${text.slice(0, MAX_SHOWN_CHARS)}…` : text
}
