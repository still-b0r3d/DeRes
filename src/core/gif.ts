import { BYTE_TO_LINEAR } from './color'
import { quantizeRgb } from './quantize'

// Zero-dependency Animated GIF (GIF89a) encoder.
// Generates standard GIF89a binary streams with Logical Screen Descriptor,
// Netscape 2.0 loop extension block, Graphic Control Extension per frame,
// and pure-TypeScript LZW table compression with sub-block streaming.

export interface GifFrame {
  width: number
  height: number
  /** Delay in milliseconds (default: 100ms, i.e. 10 fps) */
  delayMs?: number
  /** Indices into the color palette (one byte per pixel) */
  indices: Uint8Array
  /** Optional local color table for this specific frame (r, g, b entries) */
  palette?: Uint8Array
  /** Optional transparent color index (-1 or undefined for none) */
  transparentIndex?: number
}

export interface GifOptions {
  /** 0 = loop forever (the default); null = no loop block (plays once) */
  loop?: number | null
  /** Global color table (r, g, b per entry, up to 256 colors) */
  palette?: Uint8Array
}

export interface RgbGifFrame {
  width: number
  height: number
  delayMs?: number
  rgb: Uint8Array
  /** Which pixels show (255) and which are see-through (0); missing or null when all show. */
  alpha?: Uint8Array | null
}

/** A byte buffer that grows as it's written (a plain number[] costs 4–8 bytes per byte). */
class ByteSink {
  private buf = new Uint8Array(1 << 16)
  length = 0

  push(b: number): void {
    if (this.length === this.buf.length) {
      const bigger = new Uint8Array(this.buf.length * 2)
      bigger.set(this.buf)
      this.buf = bigger
    }
    this.buf[this.length++] = b
  }

  bytes(): Uint8Array {
    return this.buf.slice(0, this.length)
  }
}

/**
 * The LZW dictionary: the code for (prefix code, next index), 4096 × 256
 * entries. An entry counts only if its stamp is the current generation, so
 * clearing the dictionary (every ~4000 codes on a noisy frame) is one
 * increment instead of wiping 6 MB. Made once, on first use.
 */
const LZW_TABLE_SIZE = 4096 * 256
let lzwCodes: Uint16Array | null = null
let lzwStamps: Uint32Array | null = null
let lzwGeneration = 0

/**
 * Packs LZW-compressed stream for a frame's pixel indices into 255-byte sub-blocks.
 */
function compressLzw(pixels: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize
  const eoiCode = clearCode + 1

  const bytes = new ByteSink()
  const subBlock = new Uint8Array(255)
  let subLen = 0

  let accum = 0
  let accumBits = 0

  function flushSubBlock() {
    if (subLen > 0) {
      bytes.push(subLen)
      for (let i = 0; i < subLen; i++) bytes.push(subBlock[i])
      subLen = 0
    }
  }

  function writeByte(b: number) {
    subBlock[subLen++] = b
    if (subLen === 255) flushSubBlock()
  }

  function writeBits(val: number, bits: number) {
    accum |= val << accumBits
    accumBits += bits
    while (accumBits >= 8) {
      writeByte(accum & 0xff)
      accum >>>= 8
      accumBits -= 8
    }
  }

  function flushBits() {
    if (accumBits > 0) {
      writeByte(accum & 0xff)
      accum = 0
      accumBits = 0
    }
    flushSubBlock()
  }

  let codeSize = minCodeSize + 1
  let nextCode = clearCode + 2
  lzwCodes ??= new Uint16Array(LZW_TABLE_SIZE)
  lzwStamps ??= new Uint32Array(LZW_TABLE_SIZE)
  const codes = lzwCodes
  const stamps = lzwStamps
  let generation = ++lzwGeneration

  writeBits(clearCode, codeSize)

  if (pixels.length === 0) {
    writeBits(eoiCode, codeSize)
    flushBits()
    bytes.push(0x00) // Block terminator
    return bytes.bytes()
  }

  let prefix = pixels[0]

  for (let i = 1; i < pixels.length; i++) {
    const c = pixels[i]
    const key = (prefix << 8) | c
    if (stamps[key] === generation) {
      prefix = codes[key]
    } else {
      writeBits(prefix, codeSize)
      if (nextCode < 4096) {
        codes[key] = nextCode
        stamps[key] = generation
        nextCode++
        if (nextCode === (1 << codeSize) + 1 && codeSize < 12) {
          codeSize++
        }
      } else {
        writeBits(clearCode, codeSize)
        generation = ++lzwGeneration
        codeSize = minCodeSize + 1
        nextCode = clearCode + 2
      }
      prefix = c
    }
  }

  writeBits(prefix, codeSize)
  writeBits(eoiCode, codeSize)
  flushBits()
  bytes.push(0x00) // Block terminator

  return bytes.bytes()
}

function padPalette(palette: Uint8Array): { table: Uint8Array; depth: number } {
  const colours = Math.floor(palette.length / 3)
  let depth = 1
  while (1 << depth < colours && depth < 8) depth++
  const fullSize = 1 << depth
  const table = new Uint8Array(fullSize * 3)
  table.set(palette.subarray(0, Math.min(palette.length, fullSize * 3)))
  return { table, depth }
}

function samePalette(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * A GIF written a frame at a time: each frame is compressed as it's added and
 * only the compressed bytes are kept, so a long animation never has to be
 * held whole. The first frame's palette (or options.palette) is the global
 * colour table; a frame with a different palette carries its own.
 */
export class GifWriter {
  private readonly chunks: Uint8Array[] = []
  private global: { source: Uint8Array; depth: number } | null = null
  frames = 0

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly options: {
      /** NETSCAPE2.0 loop count: 0 (the default) loops forever; null writes none, so it plays once. */
      loop?: number | null
      /** Global colour table (r, g, b per entry, up to 256 colours). */
      palette?: Uint8Array
    } = {}
  ) {}

  add(frame: GifFrame): void {
    if (this.frames === 0) this.start(frame)
    const global = this.global!
    const delayCs = Math.max(1, Math.round((frame.delayMs ?? 100) / 10))
    const hasTrans = frame.transparentIndex !== undefined && frame.transparentIndex >= 0

    // Graphic Control Extension: the disposal, the delay, the transparent
    // index. Frames cover the whole screen, so each is kept (disposal 1)
    // until the next is drawn over it; a frame with see-through pixels is
    // cleared afterwards (disposal 2), or the next one's see-through pixels
    // would show it.
    const disposal = hasTrans ? 2 : 1
    this.chunks.push(
      Uint8Array.of(0x21, 0xf9, 0x04, (disposal << 2) | (hasTrans ? 1 : 0), delayCs & 0xff, (delayCs >> 8) & 0xff, hasTrans ? frame.transparentIndex! : 0, 0x00)
    )

    // Image Descriptor, at 0,0, with the frame's own table when its palette differs.
    const lct = frame.palette && !samePalette(frame.palette, global.source) ? padPalette(frame.palette) : null
    const id = new Uint8Array(10)
    const idView = new DataView(id.buffer)
    id[0] = 0x2c
    idView.setUint16(5, frame.width, true)
    idView.setUint16(7, frame.height, true)
    id[9] = lct ? 0x80 | ((lct.depth - 1) & 7) : 0x00
    this.chunks.push(id)
    if (lct) this.chunks.push(lct.table)

    const minCodeSize = Math.max(2, lct ? lct.depth : global.depth)
    this.chunks.push(Uint8Array.of(minCodeSize))
    this.chunks.push(compressLzw(frame.indices, minCodeSize))
    this.frames++
  }

  /** The whole file. */
  finish(): Uint8Array<ArrayBuffer> {
    if (this.frames === 0) throw new Error('GIF requires at least one frame')
    const total = this.chunks.reduce((sum, c) => sum + c.length, 0) + 1
    const out = new Uint8Array(total)
    let offset = 0
    for (const c of this.chunks) {
      out.set(c, offset)
      offset += c.length
    }
    out[offset] = 0x3b // Trailer
    return out
  }

  private start(first: GifFrame): void {
    const source = this.options.palette ?? first.palette
    if (!source || source.length < 3) throw new Error('GIF requires a color palette')
    const { table, depth } = padPalette(source)
    this.global = { source, depth }

    // Header, then the Logical Screen Descriptor: GCT flag, colour resolution
    // and GCT size (both depth - 1), background 0, aspect 0.
    this.chunks.push(Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))
    const lsd = new Uint8Array(7)
    const lsdView = new DataView(lsd.buffer)
    lsdView.setUint16(0, this.width, true)
    lsdView.setUint16(2, this.height, true)
    lsd[4] = 0x80 | (((depth - 1) & 7) << 4) | ((depth - 1) & 7)
    this.chunks.push(lsd, table)

    // Netscape 2.0 looping application extension (19 bytes).
    const loop = this.options.loop === undefined ? 0 : this.options.loop
    if (loop !== null) {
      this.chunks.push(
        Uint8Array.of(
          0x21, 0xff, 0x0b, // Extension introducer, label, block length 11
          0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, // 'NETSCAPE2.0'
          0x03, 0x01, // Sub-block length 3, sub-block ID 1
          loop & 0xff, (loop >> 8) & 0xff, // Loop count (0 = infinite)
          0x00 // Terminator
        )
      )
    }
  }
}

/**
 * Encodes an array of indexed frames into an Animated GIF (GIF89a).
 */
export function encodeGif(frames: readonly GifFrame[], options?: GifOptions): Uint8Array<ArrayBuffer> {
  if (frames.length === 0) throw new Error('GIF requires at least one frame')
  const writer = new GifWriter(frames[0].width, frames[0].height, options)
  for (const frame of frames) writer.add(frame)
  return writer.finish()
}

/**
 * One 256-colour (or smaller) palette for a set of full-colour frames, from
 * up to 32,768 pixels sampled evenly across all of them. With `alphas` (one
 * per frame, null for a frame where all show), see-through pixels are kept:
 * only pixels that show are sampled, and the palette stops at 255 colours,
 * leaving room for a see-through entry.
 */
export function rgbFramesPalette(frames: readonly Uint8Array[], pixelsPerFrame: number, alphas?: readonly (Uint8Array | null | undefined)[]): Uint8Array {
  const samples = new PaletteSamples(frames.length * pixelsPerFrame)
  frames.forEach((rgb, k) => samples.add(rgb, pixelsPerFrame, alphas?.[k]))
  return samples.palette(alphas ? 255 : 256)
}

/**
 * The samples rgbFramesPalette makes its palette from, taken a frame at a
 * time: frames can be let go as soon as they're added, and the palette is
 * the same as from all of them at once.
 */
export class PaletteSamples {
  private readonly step: number
  private readonly linSamples: number[] = []
  private counter = 0

  /** `totalPixels`: every pixel of every frame that will be added. */
  constructor(totalPixels: number) {
    this.step = Math.max(1, Math.floor(totalPixels / 32768))
  }

  /** A frame's pixels; with `alpha`, only the ones that show. */
  add(rgb: Uint8Array, pixels: number, alpha?: Uint8Array | null): void {
    const { step, linSamples } = this
    for (let p = 0; p < pixels; p++) {
      if (alpha && !alpha[p]) continue
      if (this.counter++ % step === 0) {
        const idx = p * 3
        linSamples.push(BYTE_TO_LINEAR[rgb[idx]], BYTE_TO_LINEAR[rgb[idx + 1]], BYTE_TO_LINEAR[rgb[idx + 2]])
      }
    }
  }

  /** Up to `colours` colours (255 leaves room for a see-through entry); never empty. */
  palette(colours = 256): Uint8Array {
    const palette = quantizeRgb(new Float32Array(this.linSamples), colours, 8)
    return palette.length > 0 ? palette : new Uint8Array(3)
  }
}

/**
 * Frame indices with the see-through pixels pointing at a palette entry of
 * their own. With fewer than 256 colours it's one more entry at the end;
 * with a full palette, the colour the shown pixels use least gives up its
 * entry, and its pixels move to the nearest other colour.
 */
export function withTransparentEntry(
  palette: Uint8Array,
  indices: Uint8Array,
  alpha: Uint8Array
): { palette: Uint8Array; indices: Uint8Array; transparentIndex: number } {
  const n = palette.length / 3
  const out = new Uint8Array(indices)
  let t = n
  let pal = palette
  if (n < 256) {
    pal = new Uint8Array(palette.length + 3)
    pal.set(palette)
  } else {
    const uses = new Uint32Array(256)
    for (let i = 0; i < out.length; i++) if (alpha[i]) uses[out[i]]++
    t = 0
    for (let k = 1; k < 256; k++) if (uses[k] < uses[t]) t = k
    if (uses[t] > 0) {
      let near = t === 0 ? 1 : 0
      let best = Infinity
      for (let k = 0; k < 256; k++) {
        if (k === t) continue
        const d = (palette[k * 3] - palette[t * 3]) ** 2 + (palette[k * 3 + 1] - palette[t * 3 + 1]) ** 2 + (palette[k * 3 + 2] - palette[t * 3 + 2]) ** 2
        if (d < best) {
          best = d
          near = k
        }
      }
      for (let i = 0; i < out.length; i++) if (out[i] === t) out[i] = near
    }
  }
  for (let i = 0; i < out.length; i++) if (!alpha[i]) out[i] = t
  return { palette: pal, indices: out, transparentIndex: t }
}

/**
 * Maps full-colour pixels to the nearest palette entry. Each distinct colour
 * is searched for once and remembered: animation frames repeat the same
 * colours a great deal, and the search covers up to 256 entries. The memory
 * is a fixed table over every 24-bit colour (16 MB + a 2 MB "seen" bit set),
 * not a Map: a noisy signal loop holds a million distinct colours, and a Map
 * of them took over 100 MB.
 */
export class NearestColour {
  private readonly nearest = new Uint8Array(1 << 24)
  private readonly seen = new Uint8Array(1 << 21)
  private readonly palR: Uint8Array
  private readonly palG: Uint8Array
  private readonly palB: Uint8Array

  constructor(readonly palette: Uint8Array) {
    const n = palette.length / 3
    this.palR = new Uint8Array(n)
    this.palG = new Uint8Array(n)
    this.palB = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      this.palR[i] = palette[i * 3]
      this.palG[i] = palette[i * 3 + 1]
      this.palB[i] = palette[i * 3 + 2]
    }
  }

  /** Palette indices for r, g, b pixels. */
  map(rgb: Uint8Array): Uint8Array {
    const { nearest, seen, palR, palG, palB } = this
    const palLength = palR.length
    const pixelCount = rgb.length / 3
    const indices = new Uint8Array(pixelCount)
    for (let p = 0; p < pixelCount; p++) {
      const r = rgb[p * 3]
      const g = rgb[p * 3 + 1]
      const b = rgb[p * 3 + 2]
      const key = (r << 16) | (g << 8) | b
      if (seen[key >> 3] & (1 << (key & 7))) {
        indices[p] = nearest[key]
        continue
      }
      let bestIdx = 0
      let bestDist = Infinity
      for (let i = 0; i < palLength; i++) {
        const dr = r - palR[i]
        const dg = g - palG[i]
        const db = b - palB[i]
        const dist = dr * dr + dg * dg + db * db
        if (dist < bestDist) {
          bestDist = dist
          bestIdx = i
          if (dist === 0) break
        }
      }
      nearest[key] = bestIdx
      seen[key >> 3] |= 1 << (key & 7)
      indices[p] = bestIdx
    }
    return indices
  }
}

/**
 * Encodes an array of 24-bit RGB frames into an Animated GIF by quantizing
 * to a shared 256-color palette (or using provided palette). Frames with
 * `alpha` keep their see-through pixels: they get an entry of their own
 * after up to 255 colours.
 */
export function encodeRgbGif(
  frames: readonly RgbGifFrame[],
  options?: { loop?: number | null; palette?: Uint8Array }
): Uint8Array<ArrayBuffer> {
  if (frames.length === 0) throw new Error('GIF requires at least one frame')
  const seeThrough = frames.some((f) => f.alpha)
  let palette =
    options?.palette && options.palette.length > 0
      ? options.palette
      : rgbFramesPalette(
          frames.map((f) => f.rgb),
          frames[0].width * frames[0].height,
          seeThrough ? frames.map((f) => f.alpha) : undefined
        )
  if (seeThrough) palette = palette.subarray(0, 255 * 3)
  const colours = new NearestColour(palette)
  const t = seeThrough ? transparentAfter(palette) : null
  const writer = new GifWriter(frames[0].width, frames[0].height, { loop: options?.loop, palette: t?.palette ?? colours.palette })
  for (const f of frames) {
    const indices = colours.map(f.rgb)
    if (t && f.alpha) for (let i = 0; i < indices.length; i++) if (!f.alpha[i]) indices[i] = t.index
    writer.add({ width: f.width, height: f.height, delayMs: f.delayMs, indices, transparentIndex: t?.index })
  }
  return writer.finish()
}

/** A palette of up to 255 colours with a see-through entry after them. */
export function transparentAfter(palette: Uint8Array): { palette: Uint8Array; index: number } {
  const index = Math.min(255, palette.length / 3)
  const out = new Uint8Array((index + 1) * 3)
  out.set(palette.subarray(0, index * 3))
  return { palette: out, index }
}
