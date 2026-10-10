// A GIF decoder with no library, for opening animated GIFs frame by frame
// (the browser only hands a page the first frame). It composites each frame
// onto the logical screen the way browsers do: disposal 0/1 keeps the frame,
// 2 clears its rectangle to transparent, 3 puts back what was there before;
// frames that run off the screen are clipped; delays under 2 hundredths of a
// second count as 100 ms. A damaged file stops at the damage and keeps the
// frames before it, as browsers do.

export interface GifLimits {
  /** Largest logical screen, in pixels. */
  maxPixels: number
  /** Most frames handed out. */
  maxFrames: number
  /** Longest the decoding may take, in milliseconds. */
  maxMs: number
}

export const GIF_LIMITS: GifLimits = {
  maxPixels: 4096 * 4096,
  maxFrames: 2000,
  maxMs: 20_000
}

/** Why the frames ended before the file did; null when every frame was read. */
export type GifStop = 'damaged' | 'too-many-frames' | 'too-slow' | null

export interface DecodedGifFrame {
  /** 0 for the first frame. */
  index: number
  /**
   * The whole logical screen after this frame, r, g, b, a per pixel (alpha is
   * 0 or 255). It's the decoder's own buffer, reused for the next frame: copy
   * or shrink it before asking for another.
   */
  rgba: Uint8ClampedArray
  delayMs: number
  disposal: number
  /** Where the frame's own image sat (before clipping to the screen). */
  rect: Rect
  interlaced: boolean
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export class GifError extends Error {}

/** The browsers' rule: 0 or 1 hundredths of a second plays as 100 ms. */
export function frameDelayMs(centiseconds: number): number {
  return centiseconds < 2 ? 100 : centiseconds * 10
}

const MAX_CODES = 4096

type LzwResult = 'ok' | 'damaged' | 'too-slow'

/**
 * Reads a GIF's header straight away (throws GifError when it isn't one, or
 * its screen is bigger than the limits allow); frames() then decodes the
 * frames one at a time.
 */
export class GifReader {
  readonly version: '87a' | '89a'
  readonly width: number
  readonly height: number
  /**
   * The NETSCAPE2.0 loop count (0 = forever), or null when the file has none
   * (it plays once). Known once frames() has gone past it, which is before
   * the second frame in practice.
   */
  loopCount: number | null = null
  /** Set when frames() ends before the file does. */
  stop: GifStop = null

  private readonly bytes: Uint8Array
  private readonly limits: GifLimits
  private readonly globalTable: Uint8Array | null
  private pos: number

  constructor(bytes: Uint8Array, limits: Partial<GifLimits> = {}) {
    this.bytes = bytes
    this.limits = { ...GIF_LIMITS, ...limits }
    if (bytes.length < 13) throw new GifError('Not a GIF')
    const sig = String.fromCharCode(...bytes.subarray(0, 6))
    if (sig !== 'GIF87a' && sig !== 'GIF89a') throw new GifError('Not a GIF')
    this.version = sig === 'GIF87a' ? '87a' : '89a'
    this.width = bytes[6] | (bytes[7] << 8)
    this.height = bytes[8] | (bytes[9] << 8)
    if (!this.width || !this.height) throw new GifError('The GIF has no size')
    if (this.width * this.height > this.limits.maxPixels) throw new GifError('The GIF is too big')
    const flags = bytes[10]
    this.pos = 13
    this.globalTable = null
    if (flags & 0x80) {
      const size = 3 << ((flags & 7) + 1)
      if (13 + size > bytes.length) throw new GifError('The GIF is cut off')
      this.globalTable = bytes.subarray(13, 13 + size)
      this.pos += size
    }
  }

  /**
   * The frames, composited onto the screen. Stops early (and sets `stop`) at
   * damage, after maxFrames, or when maxMs runs out. A frame that is cut off
   * or holds bad data is dropped, with everything after it.
   */
  *frames(): Generator<DecodedGifFrame, void, void> {
    const { bytes, width: W, height: H } = this
    const n = bytes.length
    const deadline = Date.now() + this.limits.maxMs
    const halt = (why: GifStop): void => {
      this.stop = why
    }
    const screen = new Uint8ClampedArray(W * H * 4)
    // The previous frame, to be disposed of before the next is drawn, and
    // (for "restore to previous") what it covered.
    let pending: { disposal: number; rect: Rect; saved: SavedRect | null } | null = null
    let gce = { disposal: 0, delay: 0, transparent: -1 }
    let index = 0
    const lzw = new LzwDecoder()

    // A file that just ends between blocks (no trailer) is fine.
    while (this.pos < n) {
      const block = bytes[this.pos++]
      if (block === 0x3b) return
      if (block === 0x21) {
        const label = bytes[this.pos++]
        const start = this.pos
        if (!this.skipSubBlocks()) return halt('damaged')
        if (label === 0xf9 && bytes[start] >= 4) {
          const packed = bytes[start + 1]
          gce = {
            disposal: (packed >> 2) & 7,
            delay: bytes[start + 2] | (bytes[start + 3] << 8),
            transparent: packed & 1 ? bytes[start + 4] : -1
          }
        } else if (label === 0xff && bytes[start] === 11 && this.loopCount === null) {
          const id = String.fromCharCode(...bytes.subarray(start + 1, start + 12))
          const sub = start + 12
          if ((id === 'NETSCAPE2.0' || id === 'ANIMEXTS1.0') && bytes[sub] >= 3 && bytes[sub + 1] === 1) {
            this.loopCount = bytes[sub + 2] | (bytes[sub + 3] << 8)
          }
        }
        continue
      }
      if (block !== 0x2c) return halt('damaged')

      // An image: its descriptor, its own colour table, then the LZW data.
      if (this.pos + 10 > n) return halt('damaged')
      const p = this.pos
      const rect = {
        x: bytes[p] | (bytes[p + 1] << 8),
        y: bytes[p + 2] | (bytes[p + 3] << 8),
        w: bytes[p + 4] | (bytes[p + 5] << 8),
        h: bytes[p + 6] | (bytes[p + 7] << 8)
      }
      const flags = bytes[p + 8]
      const interlaced = !!(flags & 0x40)
      this.pos += 9
      let table = this.globalTable
      if (flags & 0x80) {
        const size = 3 << ((flags & 7) + 1)
        if (this.pos + size > n) return halt('damaged')
        table = bytes.subarray(this.pos, this.pos + size)
        this.pos += size
      }
      const minCodeSize = bytes[this.pos++]
      const dataStart = this.pos
      if (!this.skipSubBlocks()) return halt('damaged')
      if (!table || minCodeSize < 1 || minCodeSize > 11) return halt('damaged')
      if (index >= this.limits.maxFrames) return halt('too-many-frames')
      if (Date.now() > deadline) return halt('too-slow')

      if (pending?.disposal === 2) clearRect(screen, W, H, pending.rect)
      else if (pending?.disposal === 3 && pending.saved) putRect(screen, W, pending.saved)
      // Disposal 4 is an old way of writing "restore to previous" (browsers read it so).
      const disposal = gce.disposal === 4 ? 3 : gce.disposal
      const saved = disposal === 3 ? copyRect(screen, W, H, rect) : null

      const sink = new RowSink(screen, W, H, rect, interlaced, table, gce.transparent)
      const result = lzw.decode(bytes, dataStart, minCodeSize, sink, deadline)
      if (result !== 'ok') return halt(result)

      pending = { disposal, rect, saved }
      const frame: DecodedGifFrame = { index, rgba: screen, delayMs: frameDelayMs(gce.delay), disposal: gce.disposal, rect, interlaced }
      gce = { disposal: 0, delay: 0, transparent: -1 }
      index++
      yield frame
    }
  }

  /** Steps over sub-blocks to the 0 that ends them; false when the file ends first. */
  private skipSubBlocks(): boolean {
    const { bytes } = this
    while (this.pos < bytes.length) {
      const len = bytes[this.pos++]
      if (len === 0) return true
      this.pos += len
    }
    return false
  }
}

/** Every frame of a GIF, each copied (for tests and small files). */
export function decodeGifFrames(bytes: Uint8Array, limits?: Partial<GifLimits>): { reader: GifReader; frames: DecodedGifFrame[] } {
  const reader = new GifReader(bytes, limits)
  const frames: DecodedGifFrame[] = []
  for (const f of reader.frames()) frames.push({ ...f, rgba: f.rgba.slice() })
  return { reader, frames }
}

interface SavedRect extends Rect {
  rgba: Uint8ClampedArray
}

/** A rectangle clipped to the screen; null when none of it is on screen. */
function clip(r: Rect, W: number, H: number): Rect | null {
  const x0 = Math.min(W, r.x)
  const y0 = Math.min(H, r.y)
  const x1 = Math.min(W, r.x + r.w)
  const y1 = Math.min(H, r.y + r.h)
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null
}

function clearRect(screen: Uint8ClampedArray, W: number, H: number, r: Rect): void {
  const c = clip(r, W, H)
  if (!c) return
  for (let y = c.y; y < c.y + c.h; y++) screen.fill(0, (y * W + c.x) * 4, (y * W + c.x + c.w) * 4)
}

function copyRect(screen: Uint8ClampedArray, W: number, H: number, r: Rect): SavedRect | null {
  const c = clip(r, W, H)
  if (!c) return null
  const rgba = new Uint8ClampedArray(c.w * c.h * 4)
  for (let y = 0; y < c.h; y++) rgba.set(screen.subarray(((c.y + y) * W + c.x) * 4, ((c.y + y) * W + c.x + c.w) * 4), y * c.w * 4)
  return { ...c, rgba }
}

function putRect(screen: Uint8ClampedArray, W: number, s: SavedRect): void {
  for (let y = 0; y < s.h; y++) screen.set(s.rgba.subarray(y * s.w * 4, (y + 1) * s.w * 4), ((s.y + y) * W + s.x) * 4)
}

/**
 * Where decoded pixels go: one row at a time, drawn onto the screen when the
 * row is full (in interlaced order when the frame is interlaced), clipped,
 * with transparent pixels and indices past the colour table left as they
 * were. `done` once no row still to come can land on the screen.
 */
class RowSink {
  readonly row: Uint8Array
  done: boolean
  private readonly colours: number
  private readonly x0: number
  private readonly x1: number
  private y = 0
  private pass = 0
  private rows = 0
  private readonly screen: Uint8ClampedArray
  private readonly W: number
  private readonly H: number
  private readonly rect: Rect
  private readonly interlaced: boolean
  private readonly table: Uint8Array
  private readonly transparent: number

  constructor(screen: Uint8ClampedArray, W: number, H: number, rect: Rect, interlaced: boolean, table: Uint8Array, transparent: number) {
    this.screen = screen
    this.W = W
    this.H = H
    this.rect = rect
    this.interlaced = interlaced
    this.table = table
    this.transparent = transparent
    this.row = new Uint8Array(rect.w)
    this.colours = table.length / 3
    this.x0 = Math.min(rect.x, W)
    this.x1 = Math.min(rect.x + rect.w, W)
    this.done = rect.w === 0 || rect.h === 0 || rect.y >= H || this.x1 <= this.x0
  }

  /** The row buffer is full. */
  flush(): void {
    const { screen, table, row, transparent, colours, rect } = this
    const sy = rect.y + this.y
    if (sy < this.H) {
      let o = (sy * this.W + this.x0) * 4
      for (let x = this.x0 - rect.x, end = this.x1 - rect.x; x < end; x++, o += 4) {
        const k = row[x]
        if (k === transparent || k >= colours) continue
        screen[o] = table[k * 3]
        screen[o + 1] = table[k * 3 + 1]
        screen[o + 2] = table[k * 3 + 2]
        screen[o + 3] = 255
      }
    }
    this.rows++
    if (this.rows >= rect.h) {
      this.done = true
      return
    }
    if (!this.interlaced) {
      this.y++
      if (rect.y + this.y >= this.H) this.done = true
      return
    }
    // Four passes: every 8th row from 0, every 8th from 4, every 4th from 2, every 2nd from 1.
    this.y += INTERLACE_STEP[this.pass]
    while (this.y >= rect.h && this.pass < 3) this.y = INTERLACE_START[++this.pass]
  }
}

const INTERLACE_START = [0, 4, 2, 1]
const INTERLACE_STEP = [8, 8, 4, 2]

/**
 * LZW for GIF, codes up to 12 bits; the tables are reused from frame to
 * frame. Handles the clear and end codes, a code for the entry about to be
 * made ("KwKwK"), and a full table with no clear (codes stay 12 bits and
 * nothing more is added). A missing end code is fine; a code past the table
 * is damage.
 */
class LzwDecoder {
  private readonly prefix = new Uint16Array(MAX_CODES)
  private readonly suffix = new Uint8Array(MAX_CODES)
  private readonly first = new Uint8Array(MAX_CODES)
  private readonly stack = new Uint8Array(MAX_CODES)

  decode(bytes: Uint8Array, pos: number, minCodeSize: number, sink: RowSink, deadline: number): LzwResult {
    const { prefix, suffix, first, stack } = this
    const clear = 1 << minCodeSize
    const end = clear + 1
    for (let i = 0; i < clear; i++) {
      suffix[i] = i
      first[i] = i
    }
    let codeSize = minCodeSize + 1
    let mask = (1 << codeSize) - 1
    let next = clear + 2
    let prev = -1

    const row = sink.row
    const rowLen = row.length
    let x = 0
    let codes = 0

    let bits = 0
    let acc = 0
    let p = pos
    let blockLeft = 0
    const n = bytes.length

    while (!sink.done) {
      while (bits < codeSize) {
        if (blockLeft === 0) {
          blockLeft = p < n ? bytes[p++] : 0
          if (blockLeft === 0) return 'ok' // the data ended with no end code
        }
        if (p >= n) return 'ok'
        acc |= bytes[p++] << bits
        bits += 8
        blockLeft--
      }
      const code = acc & mask
      acc >>>= codeSize
      bits -= codeSize
      if ((++codes & 4095) === 0 && Date.now() > deadline) return 'too-slow'

      if (code === clear) {
        codeSize = minCodeSize + 1
        mask = (1 << codeSize) - 1
        next = clear + 2
        prev = -1
        continue
      }
      if (code === end) return 'ok'

      let top = 0
      if (prev === -1) {
        if (code > clear) return 'damaged'
      } else if (code <= next) {
        if (code === next && next === MAX_CODES) return 'damaged'
        if (next < MAX_CODES) {
          // The new entry: the previous one plus the first pixel of this one
          // (of the previous one itself, when this code names the new entry).
          prefix[next] = prev
          suffix[next] = first[code === next ? prev : code]
          first[next] = first[prev]
          next++
          if (next === mask + 1 && codeSize < 12) {
            codeSize++
            mask = (1 << codeSize) - 1
          }
        }
      } else {
        return 'damaged'
      }
      // The entry's pixels, unwound last first.
      let c = code
      while (c >= clear) {
        stack[top++] = suffix[c]
        c = prefix[c]
      }
      stack[top++] = c
      prev = code

      while (top > 0) {
        row[x++] = stack[--top]
        if (x === rowLen) {
          sink.flush()
          x = 0
          if (sink.done) return 'ok'
        }
      }
    }
    return 'ok'
  }
}
