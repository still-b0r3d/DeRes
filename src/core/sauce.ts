// SAUCE (Standard Architecture for Universal Comment Extentions) v00
// Metadata record appended to BBS ANSI/ASCII artwork files (.ans, .asc, .nfo).
// Exactly 128 bytes preceded by an EOF marker (\x1A / Ctrl-Z).

export interface SauceInfo {
  title?: string
  author?: string
  group?: string
  date?: string // YYYYMMDD
  dataType?: number // 1 = Character
  fileType?: number // 1 = ANSi
  tInfo1?: number // Columns (e.g. 80)
  tInfo2?: number // Rows / lines
  tFlags?: number // BBS flags (e.g. 0)
  fontName?: string // e.g. "IBM VGA"
}

export const SAUCE_MAGIC = 'SAUCE'
export const SAUCE_VERSION = '00'
export const SAUCE_RECORD_SIZE = 128
export const SAUCE_EOF = 0x1a

function padString(str: string | undefined, length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  bytes.fill(0x20) // Space padded
  if (!str) return bytes
  const enc = new TextEncoder()
  const raw = enc.encode(str)
  const copyLen = Math.min(raw.length, length)
  bytes.set(raw.subarray(0, copyLen), 0)
  return bytes
}

function formatDate(d: Date = new Date()): string {
  const y = d.getFullYear().toString().padStart(4, '0')
  const m = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${y}${m}${day}`
}

/**
 * Builds a 128-byte SAUCE record for the given file size and metadata.
 */
export function buildSauceRecord(fileSize: number, info: SauceInfo = {}): Uint8Array {
  const record = new Uint8Array(SAUCE_RECORD_SIZE)
  const view = new DataView(record.buffer, record.byteOffset, record.byteLength)
  const enc = new TextEncoder()

  // 0..4: "SAUCE"
  record.set(enc.encode(SAUCE_MAGIC), 0)
  // 5..6: "00"
  record.set(enc.encode(SAUCE_VERSION), 5)

  // 7..41: Title (35 chars)
  record.set(padString(info.title ?? '', 35), 7)

  // 42..61: Author (20 chars)
  record.set(padString(info.author ?? 'still_b0r3d', 20), 42)

  // 62..81: Group (20 chars)
  record.set(padString(info.group ?? 'b0r3d.org', 20), 62)

  // 82..89: Date (8 chars CCYYMMDD)
  const dateStr = info.date && info.date.length === 8 ? info.date : formatDate()
  record.set(enc.encode(dateStr), 82)

  // 90..93: FileSize (uint32 LE)
  view.setUint32(90, fileSize, true)

  // 94: DataType (1 = Character)
  record[94] = info.dataType ?? 1

  // 95: FileType (1 = ANSi)
  record[95] = info.fileType ?? 1

  // 96..97: TInfo1 (Columns, uint16 LE)
  view.setUint16(96, info.tInfo1 ?? 80, true)

  // 98..99: TInfo2 (Lines, uint16 LE)
  view.setUint16(98, info.tInfo2 ?? 0, true)

  // 100..101: TInfo3 (0)
  view.setUint16(100, 0, true)

  // 102..103: TInfo4 (0)
  view.setUint16(102, 0, true)

  // 104: Comments count (0)
  record[104] = 0

  // 105: TFlags (0 = Non-blink standard)
  record[105] = info.tFlags ?? 0

  // 106..127: TInfoS (Font name / custom info, 22 chars null/space padded)
  const fontBytes = new Uint8Array(22)
  if (info.fontName) {
    const rawFont = enc.encode(info.fontName)
    fontBytes.set(rawFont.subarray(0, Math.min(rawFont.length, 22)), 0)
  }
  record.set(fontBytes, 106)

  return record
}

/**
 * Attaches EOF byte + 128-byte SAUCE record to raw ANSI data.
 */
export function attachSauce(ansiData: Uint8Array, info: SauceInfo = {}): Uint8Array {
  const sauce = buildSauceRecord(ansiData.length, info)
  const combined = new Uint8Array(ansiData.length + 1 + SAUCE_RECORD_SIZE)
  combined.set(ansiData, 0)
  combined[ansiData.length] = SAUCE_EOF
  combined.set(sauce, ansiData.length + 1)
  return combined
}

/**
 * Parses and verifies a SAUCE record from file data, if present.
 */
export function parseSauce(data: Uint8Array): (SauceInfo & { fileSize: number }) | null {
  if (data.length < SAUCE_RECORD_SIZE) return null
  const offset = data.length - SAUCE_RECORD_SIZE
  const dec = new TextDecoder('ascii')
  const magic = dec.decode(data.subarray(offset, offset + 5))
  if (magic !== SAUCE_MAGIC) return null

  const view = new DataView(data.buffer, data.byteOffset + offset, SAUCE_RECORD_SIZE)
  const title = dec.decode(data.subarray(offset + 7, offset + 42)).trimEnd()
  const author = dec.decode(data.subarray(offset + 42, offset + 62)).trimEnd()
  const group = dec.decode(data.subarray(offset + 62, offset + 82)).trimEnd()
  const date = dec.decode(data.subarray(offset + 82, offset + 90))
  const fileSize = view.getUint32(90, true)
  const dataType = data[offset + 94]
  const fileType = data[offset + 95]
  const tInfo1 = view.getUint16(96, true)
  const tInfo2 = view.getUint16(98, true)
  const tFlags = data[offset + 105]
  const fontName = dec.decode(data.subarray(offset + 106, offset + 128)).replace(/\0+$/, '').trimEnd()

  return {
    title,
    author,
    group,
    date,
    fileSize,
    dataType,
    fileType,
    tInfo1,
    tInfo2,
    tFlags,
    fontName
  }
}
