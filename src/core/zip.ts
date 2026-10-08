import { crc32 } from './png'

// Zero-dependency, client-side ZIP archive generator.
// Packages scrubbed images and text exports into standard .zip files entirely in browser memory.

// Every entry gets the same fixed time and date, 00:00 on 1980-01-01 (the
// earliest a ZIP can hold), so the archive says nothing about when or where
// it was made. DOS date: (year - 1980) << 9 | month << 5 | day.
const ZIP_DATE = (0 << 9) | (1 << 5) | 1

export interface ZipEntry {
  name: string
  data: Uint8Array
}

export function createZip(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const encodedEntries = entries.map((e) => {
    const nameBytes = encoder.encode(e.name)
    const crc = crc32(e.data)
    return {
      name: e.name,
      nameBytes,
      data: e.data,
      crc,
      size: e.data.length
    }
  })

  // Calculate total buffer size
  let totalSize = 0
  for (const e of encodedEntries) {
    // Local header (30 bytes) + filename + data
    totalSize += 30 + e.nameBytes.length + e.size
    // Central directory header (46 bytes) + filename
    totalSize += 46 + e.nameBytes.length
  }
  // End of central directory record (22 bytes)
  totalSize += 22

  const buffer = new ArrayBuffer(totalSize)
  const out = new Uint8Array(buffer)
  const view = new DataView(buffer)

  let offset = 0
  const localOffsets: number[] = []

  // 1. Write Local File Headers and Data
  for (const e of encodedEntries) {
    localOffsets.push(offset)

    // Local file header signature: 0x04034b50 ("PK\x03\x04")
    view.setUint32(offset, 0x04034b50, true)
    view.setUint16(offset + 4, 20, true) // version needed: 2.0
    view.setUint16(offset + 6, 0x0800, true) // UTF-8 filename flag
    view.setUint16(offset + 8, 0, true) // compression method: 0 (Stored)
    view.setUint16(offset + 10, 0, true) // time
    view.setUint16(offset + 12, ZIP_DATE, true) // date
    view.setUint32(offset + 14, e.crc, true) // CRC-32
    view.setUint32(offset + 18, e.size, true) // compressed size
    view.setUint32(offset + 22, e.size, true) // uncompressed size
    view.setUint16(offset + 26, e.nameBytes.length, true) // filename length
    view.setUint16(offset + 28, 0, true) // extra field length
    offset += 30

    out.set(e.nameBytes, offset)
    offset += e.nameBytes.length

    out.set(e.data, offset)
    offset += e.size
  }

  // 2. Write Central Directory Headers
  const cdStart = offset
  for (let i = 0; i < encodedEntries.length; i++) {
    const e = encodedEntries[i]
    const localOffset = localOffsets[i]

    // Central directory header signature: 0x02014b50 ("PK\x01\x02")
    view.setUint32(offset, 0x02014b50, true)
    view.setUint16(offset + 4, 20, true) // version made by: 2.0
    view.setUint16(offset + 6, 20, true) // version needed: 2.0
    view.setUint16(offset + 8, 0x0800, true) // UTF-8 filename flag
    view.setUint16(offset + 10, 0, true) // compression method: 0
    view.setUint16(offset + 12, 0, true) // time
    view.setUint16(offset + 14, ZIP_DATE, true) // date
    view.setUint32(offset + 16, e.crc, true) // CRC-32
    view.setUint32(offset + 20, e.size, true) // compressed size
    view.setUint32(offset + 24, e.size, true) // uncompressed size
    view.setUint16(offset + 28, e.nameBytes.length, true) // filename length
    view.setUint16(offset + 30, 0, true) // extra field length
    view.setUint16(offset + 32, 0, true) // comment length
    view.setUint16(offset + 34, 0, true) // disk number start
    view.setUint16(offset + 36, 0, true) // internal file attributes
    view.setUint32(offset + 38, 0, true) // external file attributes
    view.setUint32(offset + 42, localOffset, true) // relative offset of local header
    offset += 46

    out.set(e.nameBytes, offset)
    offset += e.nameBytes.length
  }

  const cdSize = offset - cdStart

  // 3. Write End of Central Directory Record (EOCD)
  // EOCD signature: 0x06054b50 ("PK\x05\x06")
  view.setUint32(offset, 0x06054b50, true)
  view.setUint16(offset + 4, 0, true) // disk number
  view.setUint16(offset + 6, 0, true) // disk with central directory
  view.setUint16(offset + 8, encodedEntries.length, true) // disk entries
  view.setUint16(offset + 10, encodedEntries.length, true) // total entries
  view.setUint32(offset + 12, cdSize, true) // central directory size
  view.setUint32(offset + 16, cdStart, true) // central directory offset
  view.setUint16(offset + 20, 0, true) // comment length
  offset += 22

  return out
}
