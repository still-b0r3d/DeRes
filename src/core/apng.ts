import { chunk, filterRow, header, indexDepth, PNG_SIGNATURE, zlib } from './png'

// Zero-dependency Animated PNG (APNG) encoding.
// Creates compliant APNG files with acTL, fcTL, IDAT, and fdAT chunks,
// supporting infinite loops (num_plays = 0), both indexed and 24-bit RGB /
// 32-bit RGBA frames, and standard browser zlib compression.

export interface ApngFrame {
  width: number
  height: number
  /** Frame duration in milliseconds (default: 100ms, i.e. 10 fps) */
  delayMs?: number
  /** 3 bytes per pixel RGB */
  rgb?: Uint8Array
  /** 4 bytes per pixel RGBA */
  rgba?: Uint8Array
  /** 1 byte per pixel indexed */
  indices?: Uint8Array
}

export interface ApngOptions {
  /** Number of times to loop (0 = infinite loop, default: 0) */
  numPlays?: number
  /** Palette for indexed frames (r, g, b per entry) */
  palette?: Uint8Array
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) {
    const t = y
    y = x % y
    x = t
  }
  return x
}

function makeFcTL(
  seq: number,
  width: number,
  height: number,
  delayMs: number
): Uint8Array<ArrayBuffer> {
  const fctl = new Uint8Array(26)
  const view = new DataView(fctl.buffer)
  view.setUint32(0, seq)
  view.setUint32(4, width)
  view.setUint32(8, height)
  view.setUint32(12, 0) // x_offset
  view.setUint32(16, 0) // y_offset

  const ms = Math.max(1, Math.round(delayMs))
  const g = gcd(ms, 1000)
  const delayNum = Math.min(65535, ms / g)
  const delayDen = Math.min(65535, 1000 / g)

  view.setUint16(20, delayNum)
  view.setUint16(22, delayDen)
  fctl[24] = 0 // APNG_DISPOSE_OP_NONE
  fctl[25] = 0 // APNG_BLEND_OP_SOURCE
  return fctl
}

function packIndexedScanlines(
  width: number,
  height: number,
  depth: 1 | 2 | 4 | 8,
  indices: Uint8Array
): Uint8Array<ArrayBuffer> {
  const stride = Math.ceil((width * depth) / 8)
  const raw = new Uint8Array(height * (stride + 1))
  const perByte = 8 / depth

  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1) + 1 // filter byte 0 (None)
    const rowOffset = y * width
    if (depth === 8) {
      raw.set(indices.subarray(rowOffset, rowOffset + width), o)
    } else {
      for (let x = 0; x < width; x++) {
        const val = indices[rowOffset + x]
        raw[o + Math.floor(x / perByte)] |= val << (8 - depth - (x % perByte) * depth)
      }
    }
  }
  return raw
}

function packRgbScanlines(
  width: number,
  height: number,
  rgb: Uint8Array
): Uint8Array<ArrayBuffer> {
  const stride = width * 3
  const raw = new Uint8Array(height * (stride + 1))
  let prev = new Uint8Array(stride)
  let cur = new Uint8Array(stride)
  const trial = new Uint8Array(stride)
  const best = new Uint8Array(stride)

  for (let y = 0; y < height; y++) {
    const rowOffset = y * stride
    cur.set(rgb.subarray(rowOffset, rowOffset + stride))

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
  return raw
}

function packRgbaScanlines(
  width: number,
  height: number,
  rgba: Uint8Array
): Uint8Array<ArrayBuffer> {
  const stride = width * 4
  const raw = new Uint8Array(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1)
    raw[o] = 0 // filter 0 (None)
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), o + 1)
  }
  return raw
}

/**
 * Encodes an array of frames into an Animated PNG (APNG) buffer.
 */
export async function encodeApng(
  frames: readonly ApngFrame[],
  options?: ApngOptions
): Promise<Uint8Array<ArrayBuffer>> {
  if (frames.length === 0) throw new Error('APNG requires at least one frame')

  const width = frames[0].width
  const height = frames[0].height
  const numPlays = options?.numPlays ?? 0

  const isIndexed = !!(options?.palette && frames[0].indices)
  const isRgba = !isIndexed && !!frames[0].rgba

  let depth = 8
  let colourType = 2 // 2 = truecolour RGB
  if (isIndexed) {
    const colours = options!.palette!.length / 3
    if (colours < 1 || colours > 256 || options!.palette!.length % 3 !== 0) {
      throw new Error('Bad APNG palette')
    }
    depth = indexDepth(colours)
    colourType = 3 // indexed
  } else if (isRgba) {
    colourType = 6 // truecolour with alpha
  }

  const chunks: Uint8Array[] = [PNG_SIGNATURE]

  // 1. IHDR
  chunks.push(chunk('IHDR', header(width, height, depth, colourType)))

  // 2. acTL (Animation Control Chunk)
  const actl = new Uint8Array(8)
  const actlView = new DataView(actl.buffer)
  actlView.setUint32(0, frames.length)
  actlView.setUint32(4, numPlays)
  chunks.push(chunk('acTL', actl))

  // 3. Optional PLTE for indexed mode
  if (isIndexed) {
    chunks.push(chunk('PLTE', options!.palette!))
  }

  // 4. Frames sequence
  let seq = 0

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    const delay = frame.delayMs ?? 100

    // Frame Control Chunk fcTL
    chunks.push(chunk('fcTL', makeFcTL(seq++, width, height, delay)))

    // Raw scanline packing
    let raw: Uint8Array<ArrayBuffer>
    if (isIndexed) {
      raw = packIndexedScanlines(width, height, depth as 1 | 2 | 4 | 8, frame.indices!)
    } else if (isRgba) {
      raw = packRgbaScanlines(width, height, frame.rgba!)
    } else {
      raw = packRgbScanlines(width, height, frame.rgb!)
    }

    const compressed = await zlib(raw)

    if (i === 0) {
      // First frame's data chunk is standard IDAT
      chunks.push(chunk('IDAT', compressed))
    } else {
      // Subsequent frames use fdAT: 4-byte sequence number + compressed zlib stream
      const fdat = new Uint8Array(4 + compressed.length)
      new DataView(fdat.buffer).setUint32(0, seq++)
      fdat.set(compressed, 4)
      chunks.push(chunk('fdAT', fdat))
    }
  }

  // 5. IEND
  chunks.push(chunk('IEND', new Uint8Array(0)))

  // Total byte size
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
  const out = new Uint8Array(totalLength)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }

  return out
}
