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
 * An APNG written a frame at a time: each frame is packed and compressed as
 * it's added and only the compressed chunks are kept. Frames are indexed
 * when a palette is given (every frame then uses it), otherwise RGB, or RGBA
 * when the first frame is.
 */
export class ApngWriter {
  private readonly chunks: Uint8Array[] = [PNG_SIGNATURE]
  private mode: 'indexed' | 'rgb' | 'rgba' = 'rgb'
  private depth = 8
  private seq = 0
  private actlAt = -1
  frames = 0

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly options: ApngOptions = {}
  ) {}

  async add(frame: ApngFrame): Promise<void> {
    if (this.frames === 0) this.start(frame)
    const { width, height } = this
    this.chunks.push(chunk('fcTL', makeFcTL(this.seq++, width, height, frame.delayMs ?? 100)))
    let raw: Uint8Array<ArrayBuffer>
    if (this.mode === 'indexed') raw = packIndexedScanlines(width, height, this.depth as 1 | 2 | 4 | 8, frame.indices!)
    else if (this.mode === 'rgba') raw = packRgbaScanlines(width, height, frame.rgba!)
    else raw = packRgbScanlines(width, height, frame.rgb!)
    const compressed = await zlib(raw)
    if (this.frames === 0) {
      // The first frame's data is a plain IDAT, so a viewer without APNG shows it.
      this.chunks.push(chunk('IDAT', compressed))
    } else {
      // Later frames: fdAT, a sequence number then the compressed data.
      const fdat = new Uint8Array(4 + compressed.length)
      new DataView(fdat.buffer).setUint32(0, this.seq++)
      fdat.set(compressed, 4)
      this.chunks.push(chunk('fdAT', fdat))
    }
    this.frames++
  }

  /** The whole file. */
  finish(): Uint8Array<ArrayBuffer> {
    if (this.frames === 0) throw new Error('APNG requires at least one frame')
    // acTL: how many frames, and how many times to play them.
    const actl = new Uint8Array(8)
    const view = new DataView(actl.buffer)
    view.setUint32(0, this.frames)
    view.setUint32(4, this.options.numPlays ?? 0)
    this.chunks[this.actlAt] = chunk('acTL', actl)
    const parts = [...this.chunks, chunk('IEND', new Uint8Array(0))]
    const out = new Uint8Array(parts.reduce((sum, c) => sum + c.length, 0))
    let offset = 0
    for (const c of parts) {
      out.set(c, offset)
      offset += c.length
    }
    return out
  }

  private start(first: ApngFrame): void {
    const palette = this.options.palette
    let colourType = 2 // truecolour RGB
    if (palette && first.indices) {
      const colours = palette.length / 3
      if (colours < 1 || colours > 256 || palette.length % 3 !== 0) throw new Error('Bad APNG palette')
      this.depth = indexDepth(colours)
      colourType = 3
      this.mode = 'indexed'
    } else if (first.rgba) {
      colourType = 6
      this.mode = 'rgba'
    } else {
      this.mode = 'rgb'
    }
    this.chunks.push(chunk('IHDR', header(this.width, this.height, this.depth, colourType)))
    this.actlAt = this.chunks.length
    this.chunks.push(new Uint8Array(0)) // acTL, written by finish() once the frames are counted
    if (this.mode === 'indexed') this.chunks.push(chunk('PLTE', palette!))
  }
}

/**
 * Encodes an array of frames into an Animated PNG (APNG) buffer.
 */
export async function encodeApng(frames: readonly ApngFrame[], options?: ApngOptions): Promise<Uint8Array<ArrayBuffer>> {
  if (frames.length === 0) throw new Error('APNG requires at least one frame')
  const writer = new ApngWriter(frames[0].width, frames[0].height, options)
  for (const frame of frames) await writer.add(frame)
  return writer.finish()
}
