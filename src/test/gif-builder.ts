// Hand-built GIFs for tests: any layout of blocks, with LZW written here (not
// by DeRes's own encoder), so the decoder is checked against something else.

export interface BuiltFrame {
  x?: number
  y?: number
  width: number
  height: number
  /** One colour index per pixel, row by row (in display order, even when interlaced). */
  indices: ArrayLike<number>
  /** r, g, b per entry. */
  localTable?: ArrayLike<number>
  interlaced?: boolean
  disposal?: number
  /** Hundredths of a second. */
  delay?: number
  transparent?: number
  /** Write no graphic control block at all. */
  noGce?: boolean
  minCodeSize?: number
  lzw?: LzwOptions
  /** Replaces the frame's LZW data (sub-blocks and all, without the minimum code size byte). */
  rawData?: Uint8Array
}

export interface LzwOptions {
  /** Leave out the end code. */
  noEnd?: boolean
  /** Keep going at 12 bits when the table fills, instead of sending a clear. */
  noClearWhenFull?: boolean
  /** Start without a clear code. */
  noLeadingClear?: boolean
}

export type Block = BuiltFrame | { raw: ArrayLike<number> }

export interface BuiltGif {
  version?: '87a' | '89a'
  width: number
  height: number
  globalTable?: ArrayLike<number>
  /** NETSCAPE2.0 loop count; leave out for none. */
  loop?: number
  blocks: Block[]
  /** Leave out the 0x3B at the end. */
  noTrailer?: boolean
}

/** Bits for a colour table of n entries (2 to 256). */
function tableBits(n: number): number {
  let bits = 1
  while (1 << bits < n) bits++
  return bits
}

function padTable(table: ArrayLike<number>): number[] {
  const bits = tableBits(table.length / 3)
  const out = Array.from(table)
  while (out.length < 3 << bits) out.push(0)
  return out
}

/** Plain LZW for GIF, written as 255-byte sub-blocks with the 0 at the end. */
export function lzwData(indices: ArrayLike<number>, minCodeSize: number, options: LzwOptions = {}): number[] {
  const clear = 1 << minCodeSize
  const end = clear + 1
  const out: number[] = []
  let acc = 0
  let bits = 0
  const write = (code: number, size: number) => {
    acc |= code << bits
    bits += size
    while (bits >= 8) {
      out.push(acc & 255)
      acc >>>= 8
      bits -= 8
    }
  }
  let size = minCodeSize + 1
  let next = clear + 2
  // (code of a string) * 256 + (the index after it) -> code of the longer string.
  let dict = new Map<number, number>()
  if (!options.noLeadingClear) write(clear, size)
  let w = -1
  for (let i = 0; i < indices.length; i++) {
    const k = indices[i]
    if (w < 0) {
      w = k
      continue
    }
    const hit = dict.get(w * 256 + k)
    if (hit !== undefined) {
      w = hit
      continue
    }
    write(w, size)
    if (next < 4096) {
      dict.set(w * 256 + k, next++)
      if (next === (1 << size) + 1 && size < 12) size++
    } else if (!options.noClearWhenFull) {
      write(clear, size)
      dict = new Map()
      size = minCodeSize + 1
      next = clear + 2
    }
    w = k
  }
  if (w >= 0) write(w, size)
  if (!options.noEnd) write(end, size)
  if (bits > 0) out.push(acc & 255)
  const blocks: number[] = []
  for (let i = 0; i < out.length; i += 255) {
    const part = out.slice(i, i + 255)
    blocks.push(part.length)
    for (const byte of part) blocks.push(byte)
  }
  blocks.push(0)
  return blocks
}

/** Rows of an interlaced frame in the order they're stored. */
export function interlaceOrder(height: number): number[] {
  const rows: number[] = []
  for (const [start, step] of [
    [0, 8],
    [4, 8],
    [2, 4],
    [1, 2]
  ]) {
    for (let y = start; y < height; y += step) rows.push(y)
  }
  return rows
}

export function buildGif(g: BuiltGif): Uint8Array {
  const out: number[] = [...`GIF${g.version ?? '89a'}`].map((c) => c.charCodeAt(0))
  const gct = g.globalTable ? padTable(g.globalTable) : null
  const gctBits = gct ? tableBits(gct.length / 3) : 0
  out.push(g.width & 255, g.width >> 8, g.height & 255, g.height >> 8)
  out.push(gct ? 0x80 | ((gctBits - 1) << 4) | (gctBits - 1) : 0, 0, 0)
  if (gct) out.push(...gct)
  if (g.loop !== undefined) {
    out.push(0x21, 0xff, 11, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 3, 1, g.loop & 255, g.loop >> 8, 0)
  }
  for (const b of g.blocks) {
    if ('raw' in b) {
      out.push(...Array.from(b.raw))
      continue
    }
    if (!b.noGce) {
      const t = b.transparent ?? -1
      const delay = b.delay ?? 10
      out.push(0x21, 0xf9, 4, ((b.disposal ?? 0) << 2) | (t >= 0 ? 1 : 0), delay & 255, delay >> 8, t >= 0 ? t : 0, 0)
    }
    const lct = b.localTable ? padTable(b.localTable) : null
    const lctBits = lct ? tableBits(lct.length / 3) : 0
    const x = b.x ?? 0
    const y = b.y ?? 0
    out.push(0x2c, x & 255, x >> 8, y & 255, y >> 8, b.width & 255, b.width >> 8, b.height & 255, b.height >> 8)
    out.push((lct ? 0x80 | (lctBits - 1) : 0) | (b.interlaced ? 0x40 : 0))
    if (lct) out.push(...lct)
    const min = b.minCodeSize ?? Math.max(2, lct ? lctBits : gctBits)
    out.push(min)
    if (b.rawData) {
      out.push(...b.rawData)
      continue
    }
    let pixels: ArrayLike<number> = b.indices
    if (b.interlaced) {
      const rows = interlaceOrder(b.height)
      const ordered: number[] = []
      for (const r of rows) for (let i = 0; i < b.width; i++) ordered.push(b.indices[r * b.width + i])
      pixels = ordered
    }
    for (const byte of lzwData(pixels, min, b.lzw)) out.push(byte)
  }
  if (!g.noTrailer) out.push(0x3b)
  return Uint8Array.from(out)
}

/** r, g, b, a of one pixel in an RGBA buffer `width` wide. */
export function pixelAt(rgba: ArrayLike<number>, width: number, x: number, y: number): number[] {
  const o = (y * width + x) * 4
  return [rgba[o], rgba[o + 1], rgba[o + 2], rgba[o + 3]]
}

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))

/** Bytes as sub-blocks of up to 255, with the 0 that ends them. */
export function subBlocks(bytes: ArrayLike<number>): number[] {
  const out: number[] = []
  for (let i = 0; i < bytes.length; i += 255) {
    const n = Math.min(255, bytes.length - i)
    out.push(n)
    for (let k = 0; k < n; k++) out.push(bytes[i + k])
  }
  out.push(0)
  return out
}

/** A comment block. */
export function gifComment(text: string): { raw: number[] } {
  return { raw: [0x21, 0xfe, ...subBlocks(new TextEncoder().encode(text))] }
}

/** A plain text block (a 12-byte text grid, then the text). */
export function gifPlainText(text: string): { raw: number[] } {
  return { raw: [0x21, 0x01, 12, 0, 0, 0, 0, 8, 0, 8, 0, 8, 8, 1, 0, ...subBlocks(ascii(text)).slice(0)] }
}

/** An application block: an 11-byte name, then data in sub-blocks. */
export function gifApp(name: string, data: ArrayLike<number>): { raw: number[] } {
  return { raw: [0x21, 0xff, 11, ...ascii(name.padEnd(11).slice(0, 11)), ...subBlocks(data)] }
}

/** XMP the way GIFs carry it: raw text after the name, then the 257-byte "magic trailer". */
export function gifXmp(xmp: string): { raw: number[] } {
  const trailer = [1]
  for (let b = 255; b >= 0; b--) trailer.push(b)
  return { raw: [0x21, 0xff, 11, ...ascii('XMP DataXMP'), ...new TextEncoder().encode(xmp), ...trailer, 0] }
}

/** An XMP packet with the given properties as attributes of its rdf:Description. */
export function xmpPacket(props: Record<string, string>): string {
  const attrs = Object.entries(props)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('')
  return (
    '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/">' +
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""' +
    ' xmlns:exif="http://ns.adobe.com/exif/1.0/" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"' +
    ` xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"${attrs}/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`
  )
}
