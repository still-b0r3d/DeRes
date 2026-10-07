// PNG encoding and decoding with no library: the compression is the
// browser's own CompressionStream ("deflate" is the zlib format PNG wants),
// with an uncompressed fallback for browsers without it. Encoding runs in the
// worker, so there is no canvas size limit, and pictures with 256 colours or
// fewer are written as indexed PNGs (1, 2, 4 or 8 bits per pixel), which come
// out several times smaller. Nothing but the picture is written: no text,
// no dates, no software name.

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (let i = 0; i < bytes.length; ) {
    const end = Math.min(bytes.length, i + 5552)
    for (; i < end; i++) {
      a += bytes[i]
      b += a
    }
    a %= 65521
    b %= 65521
  }
  return ((b << 16) | a) >>> 0
}

/** Bytes in zlib format, uncompressed (stored blocks). */
export function zlibStored(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const blocks = Math.max(1, Math.ceil(data.length / 65535))
  const out = new Uint8Array(2 + data.length + blocks * 5 + 4)
  const view = new DataView(out.buffer)
  out[0] = 0x78
  out[1] = 0x01
  let o = 2
  for (let b = 0; b < blocks; b++) {
    const chunk = data.subarray(b * 65535, Math.min(data.length, (b + 1) * 65535))
    out[o] = b === blocks - 1 ? 1 : 0
    view.setUint16(o + 1, chunk.length, true)
    view.setUint16(o + 3, ~chunk.length & 0xffff, true)
    out.set(chunk, o + 5)
    o += 5 + chunk.length
  }
  view.setUint32(o, adler32(data))
  return out
}

async function pipe(data: Uint8Array<ArrayBuffer>, stream: GenericTransformStream): Promise<Uint8Array<ArrayBuffer>> {
  const piped = new Blob([data]).stream().pipeThrough(stream as TransformStream<Uint8Array, Uint8Array>)
  return new Uint8Array(await new Response(piped).arrayBuffer())
}

export async function zlib(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof CompressionStream === 'function') return pipe(data, new CompressionStream('deflate'))
  return zlibStored(data)
}

async function unzlib(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return pipe(data, new DecompressionStream('deflate'))
}

function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

function header(width: number, height: number, depth: number, colourType: number): Uint8Array {
  if (!(width > 0 && height > 0)) throw new Error('A PNG needs a size')
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr[8] = depth
  ihdr[9] = colourType
  return ihdr
}

async function assemble(parts: Uint8Array[], raw: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const idat = await zlib(raw)
  const chunks = [SIGNATURE, ...parts, chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

/** Bits per pixel for an indexed PNG with this many colours. */
export function indexDepth(colours: number): 1 | 2 | 4 | 8 {
  return colours <= 2 ? 1 : colours <= 4 ? 2 : colours <= 16 ? 4 : 8
}

/**
 * An indexed (palette) PNG. getRow(y, out) fills `out` with the row's palette
 * indices, one per pixel.
 */
export async function encodeIndexedPng(
  width: number,
  height: number,
  palette: Uint8Array,
  getRow: (y: number, out: Uint8Array) => void
): Promise<Uint8Array<ArrayBuffer>> {
  const colours = palette.length / 3
  if (colours < 1 || colours > 256 || palette.length % 3) throw new Error('Bad palette')
  const depth = indexDepth(colours)
  const stride = Math.ceil((width * depth) / 8)
  const raw = new Uint8Array(height * (stride + 1))
  const row = new Uint8Array(width)
  const perByte = 8 / depth
  for (let y = 0; y < height; y++) {
    getRow(y, row)
    const o = y * (stride + 1) + 1 // filter byte 0 ("none") is already there
    if (depth === 8) {
      raw.set(row, o)
    } else {
      for (let x = 0; x < width; x++) {
        raw[o + Math.floor(x / perByte)] |= row[x] << (8 - depth - (x % perByte) * depth)
      }
    }
  }
  return assemble([chunk('IHDR', header(width, height, depth, 3)), chunk('sRGB', Uint8Array.of(0)), chunk('PLTE', palette)], raw)
}

/** A truecolour PNG. getRow(y, out) fills `out` with 3 bytes (r, g, b) per pixel. */
export async function encodeRgbPng(
  width: number,
  height: number,
  getRow: (y: number, out: Uint8Array) => void
): Promise<Uint8Array<ArrayBuffer>> {
  const stride = width * 3
  const raw = new Uint8Array(height * (stride + 1))
  let prev = new Uint8Array(stride)
  let cur = new Uint8Array(stride)
  const trial = new Uint8Array(stride)
  const best = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    getRow(y, cur)
    // Try each filter, keep the one whose bytes look smallest (the usual
    // "sum of absolute values" rule).
    let bestSum = Infinity
    let bestType = 0
    for (let type = 0; type <= 4; type++) {
      const sum = filterRow(type, cur, prev, trial, 3)
      if (sum < bestSum) {
        bestSum = sum
        bestType = type
        best.set(trial)
      }
    }
    const o = y * (stride + 1)
    raw[o] = bestType
    raw.set(best, o + 1)
    ;[prev, cur] = [cur, prev]
  }
  return assemble([chunk('IHDR', header(width, height, 8, 2)), chunk('sRGB', Uint8Array.of(0))], raw)
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

function filterRow(type: number, cur: Uint8Array, prev: Uint8Array, out: Uint8Array, bpp: number): number {
  let sum = 0
  for (let i = 0; i < cur.length; i++) {
    const a = i >= bpp ? cur[i - bpp] : 0
    const b = prev[i]
    const c = i >= bpp ? prev[i - bpp] : 0
    let v: number
    switch (type) {
      case 0:
        v = cur[i]
        break
      case 1:
        v = cur[i] - a
        break
      case 2:
        v = cur[i] - b
        break
      case 3:
        v = cur[i] - ((a + b) >> 1)
        break
      default:
        v = cur[i] - paeth(a, b, c)
    }
    v &= 255
    out[i] = v
    sum += v < 128 ? v : 256 - v
  }
  return sum
}

export interface DecodedPng {
  width: number
  height: number
  bitDepth: number
  colourType: number
  /** r, g, b per entry, for indexed PNGs. */
  palette: Uint8Array | null
  /** One index per pixel, for indexed PNGs. */
  indices: Uint8Array | null
  /** r, g, b, a per pixel. */
  rgba: Uint8Array
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/** Decodes a non-interlaced PNG of up to 8 bits per channel. */
export async function decodePng(bytes: Uint8Array): Promise<DecodedPng> {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new Error('Not a PNG')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0
  let height = 0
  let depth = 0
  let type = 0
  let palette: Uint8Array | null = null
  const idat: Uint8Array[] = []
  for (let o = 8; o < bytes.length; ) {
    const len = view.getUint32(o)
    const name = String.fromCharCode(...bytes.subarray(o + 4, o + 8))
    const data = bytes.subarray(o + 8, o + 8 + len)
    if (crc32(bytes.subarray(o + 4, o + 8 + len)) !== view.getUint32(o + 8 + len)) {
      throw new Error(`Bad CRC in ${name}`)
    }
    if (name === 'IHDR') {
      width = view.getUint32(o + 8)
      height = view.getUint32(o + 12)
      depth = data[8]
      type = data[9]
      if (data[12] !== 0) throw new Error('Interlaced PNGs are not supported')
    } else if (name === 'PLTE') {
      palette = Uint8Array.from(data)
    } else if (name === 'IDAT') {
      idat.push(data)
    } else if (name === 'IEND') {
      break
    }
    o += 12 + len
  }
  const channels = CHANNELS[type]
  if (!channels || depth > 8 || (depth < 8 && type !== 0 && type !== 3)) {
    throw new Error(`Unsupported PNG (type ${type}, ${depth} bits)`)
  }
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0))
  let p = 0
  for (const c of idat) {
    joined.set(c, p)
    p += c.length
  }
  const raw = await unzlib(joined)
  const stride = Math.ceil((width * channels * depth) / 8)
  const bpp = Math.max(1, (channels * depth) / 8)
  const lines = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const line = lines.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? lines.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      const add = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c)
      line[i] = (src[i] + add) & 255
    }
  }
  const sample = (y: number, i: number): number => {
    if (depth === 8) return lines[y * stride + i]
    const perByte = 8 / depth
    const byte = lines[y * stride + Math.floor(i / perByte)]
    return (byte >> (8 - depth - (i % perByte) * depth)) & ((1 << depth) - 1)
  }
  const rgba = new Uint8Array(width * height * 4)
  let indices: Uint8Array | null = null
  if (type === 3) {
    if (!palette) throw new Error('Indexed PNG without a palette')
    indices = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const k = sample(y, x)
        indices[y * width + x] = k
        rgba.set([palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2], 255], (y * width + x) * 4)
      }
    }
  } else {
    const scale = 255 / ((1 << depth) - 1)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4
        const s = x * channels
        if (type === 0 || type === 4) {
          const g = Math.round(sample(y, s) * scale)
          rgba.set([g, g, g, type === 4 ? sample(y, s + 1) : 255], o)
        } else {
          rgba.set([sample(y, s), sample(y, s + 1), sample(y, s + 2), type === 6 ? sample(y, s + 3) : 255], o)
        }
      }
    }
  }
  return { width, height, bitDepth: depth, colourType: type, palette, indices, rgba }
}
