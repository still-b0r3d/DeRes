// Test helpers: hand-built EXIF blocks with any tags at all, and made-up
// Content Credentials. Nothing here ships in the app, and none of it is real
// camera or C2PA data: just enough structure for the parsers to walk.

export interface RawTag {
  tag: number
  type: number
  count: number
  /** The value, already in the block's byte order. */
  bytes: number[]
}

/** Little- or big-endian byte writers for building tag values. */
export function bytesFor(le: boolean) {
  const u16 = (v: number) => (le ? [v & 0xff, (v >> 8) & 0xff] : [(v >> 8) & 0xff, v & 0xff])
  const u32 = (v: number) => {
    const b = [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
    return le ? b.reverse() : b
  }
  return {
    u16,
    u32,
    ascii: (tag: number, text: string): RawTag => {
      const b = [...new TextEncoder().encode(text), 0]
      return { tag, type: 2, count: b.length, bytes: b }
    },
    short: (tag: number, ...v: number[]): RawTag => ({ tag, type: 3, count: v.length, bytes: v.flatMap(u16) }),
    long: (tag: number, ...v: number[]): RawTag => ({ tag, type: 4, count: v.length, bytes: v.flatMap(u32) }),
    rational: (tag: number, ...v: [number, number][]): RawTag => ({
      tag,
      type: 5,
      count: v.length,
      bytes: v.flatMap(([n, d]) => [...u32(n), ...u32(d)])
    }),
    srational: (tag: number, ...v: [number, number][]): RawTag => ({
      tag,
      type: 10,
      count: v.length,
      bytes: v.flatMap(([n, d]) => [...u32(n >>> 0), ...u32(d >>> 0)])
    }),
    undefinedBytes: (tag: number, b: number[]): RawTag => ({ tag, type: 7, count: b.length, bytes: b }),
    byteList: (tag: number, b: number[]): RawTag => ({ tag, type: 1, count: b.length, bytes: b })
  }
}

/**
 * A TIFF block: IFD0, then (when given) an Exif IFD and a GPS IFD, then the
 * values too long for their slot, in order. Returns the block and where
 * each long value landed (by tag), so tests can check what moved.
 */
export function rawTiff(
  ifd0: RawTag[],
  exif: RawTag[] = [],
  gps: RawTag[] = [],
  le = true
): { tiff: Uint8Array; valueAt: Map<number, number> } {
  const w = bytesFor(le)
  const size: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }
  const ifd0All = [...ifd0]
  if (exif.length) ifd0All.push(w.long(0x8769, 0))
  if (gps.length) ifd0All.push(w.long(0x8825, 0))
  const lists = [ifd0All, exif, gps].filter((l) => l.length)
  for (const l of lists) l.sort((a, b) => a.tag - b.tag)
  const tables: number[] = []
  let cursor = 8
  for (const l of lists) {
    tables.push(cursor)
    cursor += 2 + l.length * 12 + 4
  }
  const valueAt = new Map<number, number>()
  const big: { tag: number; bytes: number[] }[] = []
  for (const l of lists) {
    for (const t of l) {
      if (t.count * size[t.type] > 4) {
        valueAt.set(t.tag, cursor)
        big.push(t)
        cursor += t.bytes.length + (t.bytes.length & 1)
      }
    }
  }
  if (exif.length) ifd0All.find((t) => t.tag === 0x8769)!.bytes = w.u32(tables[1])
  if (gps.length) ifd0All.find((t) => t.tag === 0x8825)!.bytes = w.u32(tables[exif.length ? 2 : 1])

  const out = new Uint8Array(cursor)
  out.set(le ? [0x49, 0x49, 0x2a, 0x00] : [0x4d, 0x4d, 0x00, 0x2a])
  out.set(w.u32(8), 4)
  lists.forEach((l, i) => {
    let p = tables[i]
    out.set(w.u16(l.length), p)
    p += 2
    for (const t of l) {
      out.set([...w.u16(t.tag), ...w.u16(t.type), ...w.u32(t.count)], p)
      if (valueAt.has(t.tag) && t.count * size[t.type] > 4) out.set(w.u32(valueAt.get(t.tag)!), p + 8)
      else out.set(t.bytes, p + 8)
      p += 12
    }
    out.set(w.u32(0), p)
  })
  for (const t of big) out.set(t.bytes, valueAt.get(t.tag)!)
  return { tiff: out, valueAt }
}

/** A JPEG APP1 "Exif" segment around a TIFF block. */
export function exifApp1(tiff: Uint8Array): number[] {
  const len = 2 + 6 + tiff.length
  return [0xff, 0xe1, len >> 8, len & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
}

/** A JPEG APP1 XMP segment. */
export function xmpApp1(xmp: string): number[] {
  const body = [...new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0'), ...new TextEncoder().encode(xmp)]
  return [0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body]
}

/** XMP declaring an IPTC digital source type. */
export const xmpSourceType = (code: string) =>
  `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description Iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/${code}"/></rdf:RDF></x:xmpmeta>`

const enc = (s: string) => [...new TextEncoder().encode(s)]

function cborText(s: string): number[] {
  const b = enc(s)
  if (b.length < 24) return [0x60 + b.length, ...b]
  if (b.length < 256) return [0x78, b.length, ...b]
  return [0x79, b.length >> 8, b.length & 0xff, ...b]
}

/**
 * A JUMBF box that looks like Content Credentials: a "c2pa" label, a CBOR
 * claim generator (old or new style) and, optionally, an IPTC digital source
 * type in an action. Not signed and not valid C2PA.
 */
export function fakeC2paBox(o: { generator?: string; generatorInfo?: string; sourceType?: string; label?: string }): Uint8Array {
  const body = [
    ...enc('jumd'),
    ...enc(o.label ?? 'c2pa'),
    0x00, 0x11, 0x00, 0x10, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
    0x03,
    ...enc(o.label ?? 'c2pa'),
    0,
    0xa3,
    ...(o.generator ? [...cborText('claim_generator'), ...cborText(o.generator)] : []),
    ...(o.generatorInfo
      ? [...cborText('claim_generator_info'), 0x81, 0xa2, ...cborText('name'), ...cborText(o.generatorInfo), ...cborText('version'), ...cborText('1.0')]
      : []),
    ...(o.sourceType
      ? [...cborText('digitalSourceType'), ...cborText(`http://cv.iptc.org/newscodes/digitalsourcetype/${o.sourceType}`)]
      : [])
  ]
  const len = 8 + body.length
  return new Uint8Array([(len >>> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff, ...enc('jumb'), ...body])
}

/** JPEG APP11 segments carrying a JUMBF box, split into packets of at most `packet` box bytes. */
export function jumbfApp11(box: Uint8Array, packet = 60000): number[] {
  const out: number[] = []
  for (let i = 0, z = 1; i < box.length; z++) {
    const take = Math.min(packet, box.length - i)
    const header = [0x4a, 0x50, 0x00, 0x01, (z >>> 24) & 0xff, (z >> 16) & 0xff, (z >> 8) & 0xff, z & 0xff]
    // Later packets repeat the box's own 8-byte header.
    const payload = [...header, ...(z > 1 ? [...box.subarray(0, 8)] : []), ...box.subarray(i, i + take)]
    const len = payload.length + 2
    out.push(0xff, 0xeb, len >> 8, len & 0xff, ...payload)
    i += take
  }
  return out
}

/** A WebP-shaped RIFF file holding the given chunks (no real picture in it). */
export function fakeWebp(chunks: { fourCC: string; data: Uint8Array }[]): Uint8Array {
  const parts: number[] = []
  for (const c of chunks) {
    const n = c.data.length
    parts.push(...enc(c.fourCC), n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff, ...c.data)
    if (n & 1) parts.push(0)
  }
  const size = 4 + parts.length
  return new Uint8Array([...enc('RIFF'), size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >>> 24) & 0xff, ...enc('WEBP'), ...parts])
}
