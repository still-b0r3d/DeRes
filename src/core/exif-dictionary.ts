// Comprehensive EXIF & TIFF Tag Dictionary
// Maps tag IDs to human-readable names and formatters according to TIFF 6.0 and Exif 2.32 specs.

export interface TagDefinition {
  name: string
  description?: string
  format?: (value: unknown) => string
}

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
      const n = Number(v)
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
  0x0128: {
    name: 'ResolutionUnit',
    format: (v) => (Number(v) === 2 ? 'Inches' : Number(v) === 3 ? 'Centimeters' : String(v))
  },
  0x0131: { name: 'Software' },
  0x0132: { name: 'DateTime' },
  0x013b: { name: 'Artist' },
  0x013e: { name: 'WhitePoint' },
  0x013f: { name: 'PrimaryChromaticities' },
  0x0211: { name: 'YCbCrCoefficients' },
  0x0212: { name: 'YCbCrSubSampling' },
  0x0213: { name: 'YCbCrPositioning' },
  0x0214: { name: 'ReferenceBlackWhite' },
  0x8298: { name: 'Copyright' },
  0x8769: { name: 'ExifIFDPointer' },
  0x8825: { name: 'GPSInfoIFDPointer' }
}

export const EXIF_SUBIFD_TAGS: Record<number, TagDefinition> = {
  0x829a: {
    name: 'ExposureTime',
    format: (v) => {
      const exp = Number(v)
      if (exp > 0 && exp < 1) return `1/${Math.round(1 / exp)}s`
      if (exp >= 1) return `${exp.toFixed(1)}s`
      return String(v)
    }
  },
  0x829d: { name: 'FNumber', format: (v) => `f/${Number(v).toFixed(1)}` },
  0x8822: {
    name: 'ExposureProgram',
    format: (v) => {
      const p: Record<number, string> = {
        0: 'Not defined',
        1: 'Manual',
        2: 'Normal program',
        3: 'Aperture priority',
        4: 'Shutter priority',
        5: 'Creative program',
        6: 'Action program',
        7: 'Portrait mode',
        8: 'Landscape mode'
      }
      return p[Number(v)] || String(v)
    }
  },
  0x8827: { name: 'ISOSpeedRatings', format: (v) => `ISO ${v}` },
  0x9000: { name: 'ExifVersion' },
  0x9003: { name: 'DateTimeOriginal' },
  0x9004: { name: 'DateTimeDigitized' },
  0x9101: { name: 'ComponentsConfiguration' },
  0x9102: { name: 'CompressedBitsPerPixel' },
  0x9201: { name: 'ShutterSpeedValue' },
  0x9202: { name: 'ApertureValue', format: (v) => `f/${Math.pow(Math.SQRT2, Number(v)).toFixed(1)}` },
  0x9203: { name: 'BrightnessValue' },
  0x9204: { name: 'ExposureBiasValue', format: (v) => `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(2)} EV` },
  0x9205: { name: 'MaxApertureValue' },
  0x9206: { name: 'SubjectDistance', format: (v) => `${Number(v).toFixed(2)} m` },
  0x9207: {
    name: 'MeteringMode',
    format: (v) => {
      const m: Record<number, string> = {
        0: 'Unknown',
        1: 'Average',
        2: 'Center-weighted average',
        3: 'Spot',
        4: 'Multi-spot',
        5: 'Multi-segment / Pattern',
        6: 'Partial'
      }
      return m[Number(v)] || String(v)
    }
  },
  0x9208: { name: 'LightSource' },
  0x9209: {
    name: 'Flash',
    format: (v) => {
      const n = Number(v)
      return (n & 1) === 1 ? 'Flash fired' : 'Flash did not fire'
    }
  },
  0x920a: { name: 'FocalLength', format: (v) => `${Number(v).toFixed(1)} mm` },
  0x927c: { name: 'MakerNote' },
  0x9286: { name: 'UserComment' },
  0x9290: { name: 'SubSecTime' },
  0x9291: { name: 'SubSecTimeOriginal' },
  0x9292: { name: 'SubSecTimeDigitized' },
  0xa000: { name: 'FlashpixVersion' },
  0xa001: {
    name: 'ColorSpace',
    format: (v) => (Number(v) === 1 ? 'sRGB' : Number(v) === 65535 ? 'Uncalibrated' : String(v))
  },
  0xa002: { name: 'PixelXDimension', format: (v) => `${v} px` },
  0xa003: { name: 'PixelYDimension', format: (v) => `${v} px` },
  0xa005: { name: 'InteroperabilityIFDPointer' },
  0xa217: { name: 'SensingMethod' },
  0xa300: { name: 'FileSource' },
  0xa301: { name: 'SceneType' },
  0xa302: { name: 'CFAPattern' },
  0xa401: { name: 'CustomRendered' },
  0xa402: { name: 'ExposureMode' },
  0xa403: { name: 'WhiteBalance', format: (v) => (Number(v) === 0 ? 'Auto' : Number(v) === 1 ? 'Manual' : String(v)) },
  0xa404: { name: 'DigitalZoomRatio' },
  0xa405: { name: 'FocalLengthIn35mmFilm', format: (v) => `${v} mm` },
  0xa406: { name: 'SceneCaptureType' },
  0xa407: { name: 'GainControl' },
  0xa408: { name: 'Contrast' },
  0xa409: { name: 'Saturation' },
  0xa40a: { name: 'Sharpness' },
  0xa420: { name: 'ImageUniqueID' },
  0xa430: { name: 'CameraOwnerName' },
  0xa431: { name: 'BodySerialNumber' },
  0xa432: { name: 'LensSpecification' },
  0xa433: { name: 'LensMake' },
  0xa434: { name: 'LensModel' },
  0xa435: { name: 'LensSerialNumber' }
}

export const GPS_SUBIFD_TAGS: Record<number, TagDefinition> = {
  0x0000: { name: 'GPSVersionID' },
  0x0001: { name: 'GPSLatitudeRef' },
  0x0002: { name: 'GPSLatitude' },
  0x0003: { name: 'GPSLongitudeRef' },
  0x0004: { name: 'GPSLongitude' },
  0x0005: { name: 'GPSAltitudeRef', format: (v) => (Number(v) === 1 ? 'Below sea level' : 'Above sea level') },
  0x0006: { name: 'GPSAltitude', format: (v) => `${Number(v).toFixed(1)} m` },
  0x0007: { name: 'GPSTimeStamp' },
  0x0008: { name: 'GPSSatellites' },
  0x0009: { name: 'GPSStatus' },
  0x000a: { name: 'GPSMeasureMode' },
  0x000b: { name: 'GPSDOP' },
  0x000c: { name: 'GPSSpeedRef' },
  0x000d: { name: 'GPSSpeed' },
  0x000e: { name: 'GPSTrackRef' },
  0x000f: { name: 'GPSTrack' },
  0x0010: { name: 'GPSImgDirectionRef' },
  0x0011: { name: 'GPSImgDirection' },
  0x0012: { name: 'GPSMapDatum' },
  0x001d: { name: 'GPSDateStamp' },
  0x001e: { name: 'GPSDifferential' }
}

export const INTEROP_SUBIFD_TAGS: Record<number, TagDefinition> = {
  0x0001: { name: 'InteroperabilityIndex' },
  0x0002: { name: 'InteroperabilityVersion' }
}

export const IFD1_TAGS: Record<number, TagDefinition> = {
  0x0100: { name: 'ThumbnailImageWidth' },
  0x0101: { name: 'ThumbnailImageHeight' },
  0x0103: { name: 'ThumbnailCompression' },
  0x0201: { name: 'JPEGInterchangeFormat' },
  0x0202: { name: 'JPEGInterchangeFormatLength' }
}

/** Resolves human-readable name for an EXIF tag in a given IFD category. */
export function getTagName(category: 'IFD0' | 'Exif' | 'GPS' | 'Interop' | 'IFD1', tagId: number): string {
  const dict =
    category === 'IFD0'
      ? IFD0_TAGS
      : category === 'Exif'
        ? EXIF_SUBIFD_TAGS
        : category === 'GPS'
          ? GPS_SUBIFD_TAGS
          : category === 'Interop'
            ? INTEROP_SUBIFD_TAGS
            : IFD1_TAGS

  return dict[tagId]?.name || `Unknown Tag (0x${tagId.toString(16).padStart(4, '0')})`
}

/** Formats a tag value using its dictionary definition or default rules. */
export function formatTagValue(
  category: 'IFD0' | 'Exif' | 'GPS' | 'Interop' | 'IFD1',
  tagId: number,
  val: unknown
): string {
  const dict =
    category === 'IFD0'
      ? IFD0_TAGS
      : category === 'Exif'
        ? EXIF_SUBIFD_TAGS
        : category === 'GPS'
          ? GPS_SUBIFD_TAGS
          : category === 'Interop'
            ? INTEROP_SUBIFD_TAGS
            : IFD1_TAGS

  const def = dict[tagId]
  if (def?.format) {
    try {
      return def.format(val)
    } catch {
      // Fallback
    }
  }

  if (val === null || val === undefined) return ''
  if (typeof val === 'number') return String(val)
  if (typeof val === 'string') return val.trim()
  if (Array.isArray(val)) return val.join(', ')
  return String(val)
}
