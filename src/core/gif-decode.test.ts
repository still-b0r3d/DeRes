import { describe, expect, it } from 'vitest'
import { buildGif, lzwData, pixelAt, type BuiltFrame } from '../test/gif-builder'
import { encodeGif } from './gif'
import { decodeGifFrames, frameDelayMs, GifError, GifReader } from './gif-decode'

// Two-colour and four-colour tables used throughout: index 0 black, 1 red, 2 green, 3 blue.
const RGBK = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]
const BLACK = [0, 0, 0, 255]
const RED = [255, 0, 0, 255]
const GREEN = [0, 255, 0, 255]
const BLUE = [0, 0, 255, 255]
const CLEAR = [0, 0, 0, 0]

const fill = (w: number, h: number, k: number) => new Array(w * h).fill(k)

/** Every pixel of an RGBA screen, as [r, g, b, a] rows. */
function pixels(rgba: Uint8ClampedArray, w: number, h: number): number[][][] {
  const rows: number[][][] = []
  for (let y = 0; y < h; y++) {
    const row: number[][] = []
    for (let x = 0; x < w; x++) row.push(pixelAt(rgba, w, x, y))
    rows.push(row)
  }
  return rows
}

/** A deterministic noise source. */
function noise(n: number, colours: number, seed = 1): number[] {
  let s = seed
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) >>> 0
    out.push((s >>> 16) % colours)
  }
  return out
}

describe('GIF decoder: round trips through DeRes’s own encoder', () => {
  it('reads frames on the global palette, with their delays and loop count', () => {
    const palette = Uint8Array.from(RGBK)
    const frames = [0, 1, 2, 3].map((k) => ({ width: 5, height: 3, delayMs: 70 + k * 10, indices: new Uint8Array(15).fill(k) }))
    const { reader, frames: out } = decodeGifFrames(encodeGif(frames, { palette, loop: 0 }))
    expect(reader.version).toBe('89a')
    expect([reader.width, reader.height]).toEqual([5, 3])
    expect(reader.loopCount).toBe(0)
    expect(reader.stop).toBeNull()
    expect(out.map((f) => f.delayMs)).toEqual([70, 80, 90, 100])
    for (let k = 0; k < 4; k++) {
      const colour = [BLACK, RED, GREEN, BLUE][k]
      for (const row of pixels(out[k].rgba, 5, 3)) for (const p of row) expect(p).toEqual(colour)
    }
  })

  it('reads frames that carry their own colour tables', () => {
    const a = Uint8Array.from([10, 20, 30, 40, 50, 60])
    const b = Uint8Array.from([200, 100, 0, 0, 100, 200, 9, 9, 9])
    const indices = Uint8Array.from([0, 1, 1, 0])
    const gif = encodeGif([
      { width: 2, height: 2, indices, palette: a },
      { width: 2, height: 2, indices: Uint8Array.from([2, 1, 0, 2]), palette: b }
    ])
    const { frames } = decodeGifFrames(gif)
    expect(pixels(frames[0].rgba, 2, 2)).toEqual([
      [
        [10, 20, 30, 255],
        [40, 50, 60, 255]
      ],
      [
        [40, 50, 60, 255],
        [10, 20, 30, 255]
      ]
    ])
    expect(pixels(frames[1].rgba, 2, 2)).toEqual([
      [
        [9, 9, 9, 255],
        [0, 100, 200, 255]
      ],
      [
        [200, 100, 0, 255],
        [9, 9, 9, 255]
      ]
    ])
  })

  it('shows the frame underneath through transparent pixels', () => {
    const palette = Uint8Array.from(RGBK)
    const gif = encodeGif(
      [
        { width: 3, height: 1, indices: Uint8Array.from([1, 1, 1]) },
        { width: 3, height: 1, indices: Uint8Array.from([3, 0, 2]), transparentIndex: 0 }
      ],
      { palette }
    )
    const { frames } = decodeGifFrames(gif)
    expect(pixels(frames[1].rgba, 3, 1)[0]).toEqual([BLUE, RED, GREEN])
  })

  it('makes pixels transparent where nothing has been drawn', () => {
    const palette = Uint8Array.from(RGBK)
    const gif = encodeGif([{ width: 2, height: 1, indices: Uint8Array.from([0, 1]), transparentIndex: 0 }], { palette })
    const { frames } = decodeGifFrames(gif)
    expect(pixels(frames[0].rgba, 2, 1)[0]).toEqual([CLEAR, RED])
  })

  it('reads noisy frames (codes up to 12 bits, many clears)', () => {
    const palette = new Uint8Array(256 * 3).map((_, i) => (i * 37) & 255)
    const indices = Uint8Array.from(noise(64 * 96, 256))
    const { frames } = decodeGifFrames(encodeGif([{ width: 64, height: 96, indices }], { palette }))
    for (let i = 0; i < indices.length; i++) {
      const k = indices[i]
      expect([frames[0].rgba[i * 4], frames[0].rgba[i * 4 + 1], frames[0].rgba[i * 4 + 2]]).toEqual([palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2]])
    }
  })
})

describe('GIF decoder: hand-built files', () => {
  const two = (a: BuiltFrame, b: BuiltFrame, more: BuiltFrame[] = []) => buildGif({ width: 4, height: 4, globalTable: RGBK, blocks: [a, b, ...more] })

  it('puts interlaced rows back in order', () => {
    // Each row holds its own number (mod 4), so any row out of place shows.
    for (const h of [1, 2, 3, 5, 8, 9, 13, 16]) {
      const indices = Array.from({ length: 3 * h }, (_, i) => Math.floor(i / 3) % 4)
      const gif = buildGif({ width: 3, height: h, globalTable: RGBK, blocks: [{ width: 3, height: h, indices, interlaced: true }] })
      const { frames } = decodeGifFrames(gif)
      expect(frames[0].interlaced).toBe(true)
      for (let y = 0; y < h; y++) expect(pixelAt(frames[0].rgba, 3, 1, y)).toEqual([BLACK, RED, GREEN, BLUE][y % 4])
    }
  })

  it('disposal 2 clears the frame’s rectangle to transparent', () => {
    const gif = two(
      { width: 4, height: 4, indices: fill(4, 4, 1), disposal: 1 },
      { x: 1, y: 1, width: 2, height: 2, indices: fill(2, 2, 3), disposal: 2 },
      [{ x: 3, y: 3, width: 1, height: 1, indices: [2] }]
    )
    const { frames } = decodeGifFrames(gif)
    expect(pixelAt(frames[1].rgba, 4, 1, 1)).toEqual(BLUE)
    const after = pixels(frames[2].rgba, 4, 4)
    expect(after[1][1]).toEqual(CLEAR)
    expect(after[2][2]).toEqual(CLEAR)
    expect(after[0][0]).toEqual(RED)
    expect(after[1][3]).toEqual(RED)
    expect(after[3][3]).toEqual(GREEN)
  })

  it('disposal 3 puts back what the frame covered (and so does disposal 4)', () => {
    for (const disposal of [3, 4]) {
      const gif = two(
        { width: 4, height: 4, indices: fill(4, 4, 1), disposal: 1 },
        { x: 0, y: 0, width: 2, height: 4, indices: fill(2, 4, 3), disposal },
        [{ x: 3, y: 0, width: 1, height: 1, indices: [2] }]
      )
      const { frames } = decodeGifFrames(gif)
      expect(pixelAt(frames[1].rgba, 4, 0, 3)).toEqual(BLUE)
      const after = pixels(frames[2].rgba, 4, 4)
      expect(after.flat().filter((p) => p[2] === 255)).toEqual([])
      expect(after[3][0]).toEqual(RED)
      expect(after[0][3]).toEqual(GREEN)
    }
  })

  it('places frames at their offsets and clips what runs off the screen', () => {
    const gif = two(
      { width: 4, height: 4, indices: fill(4, 4, 0) },
      { x: 2, y: 3, width: 3, height: 2, indices: [1, 2, 3, 1, 2, 3] }
    )
    const { frames } = decodeGifFrames(gif)
    const p = pixels(frames[1].rgba, 4, 4)
    expect(p[3][2]).toEqual(RED)
    expect(p[3][3]).toEqual(GREEN)
    expect(p[2][2]).toEqual(BLACK)
    expect(p[0][0]).toEqual(BLACK)
  })

  it('survives a frame that sits wholly off the screen, or declares a huge size', () => {
    const gif = two(
      { width: 4, height: 4, indices: fill(4, 4, 1) },
      { x: 60000, y: 60000, width: 2, height: 2, indices: fill(2, 2, 3) },
      [{ width: 65535, height: 65535, indices: [2, 2, 2, 2, 2, 2] }]
    )
    const { frames, reader } = decodeGifFrames(gif)
    expect(frames).toHaveLength(3)
    expect(reader.stop).toBeNull()
    expect(pixels(frames[1].rgba, 4, 4).flat().every((p) => p.join() === RED.join())).toBe(true)
    // The huge frame's first row is 65535 wide and the data runs out long before it ends.
    expect(pixelAt(frames[2].rgba, 4, 0, 0)).toEqual(RED)
  })

  it('reads the LZW corner cases: KwKwK, a full table with no clear, no end code, no leading clear', () => {
    const run = fill(64, 64, 2) // one long run: almost every code names the entry about to be made
    const busy = noise(64 * 512, 4, 7) // fills the 4096-entry table well before the end
    for (const lzw of [{}, { noClearWhenFull: true }, { noEnd: true }, { noLeadingClear: true }]) {
      for (const indices of [run, busy]) {
        const gif = buildGif({ width: 64, height: indices.length / 64, globalTable: RGBK, blocks: [{ width: 64, height: indices.length / 64, indices, lzw }] })
        const { frames, reader } = decodeGifFrames(gif)
        expect(reader.stop).toBeNull()
        const want = new Uint8ClampedArray(indices.length * 4)
        indices.forEach((k, i) => want.set([BLACK, RED, GREEN, BLUE][k], i * 4))
        expect(frames[0].rgba).toEqual(want)
      }
    }
  })

  it('stops at a cut-off file and keeps the frames before the cut', () => {
    const frame = (k: number) => ({ width: 4, height: 4, indices: noise(16, 4, k) })
    const gif = buildGif({ width: 4, height: 4, globalTable: RGBK, blocks: [frame(1), frame(2), frame(3)] })
    const cut = decodeGifFrames(gif.subarray(0, gif.length - 6))
    expect(cut.frames).toHaveLength(2)
    expect(cut.reader.stop).toBe('damaged')
    // A file that just lacks the trailer is whole.
    const noTrailer = decodeGifFrames(gif.subarray(0, gif.length - 1))
    expect(noTrailer.frames).toHaveLength(3)
    expect(noTrailer.reader.stop).toBeNull()
  })

  it('stops at garbage LZW, an unknown block, or a frame with no colour table', () => {
    const good = { width: 4, height: 4, indices: fill(16, 1, 1) }
    // A first code past the table (7, with clear = 4).
    const garbage = buildGif({ width: 4, height: 4, globalTable: RGBK, blocks: [good, { ...good, rawData: Uint8Array.of(2, 0xff, 0xff, 0) }, good] })
    let out = decodeGifFrames(garbage)
    expect(out.frames).toHaveLength(1)
    expect(out.reader.stop).toBe('damaged')

    // Clear, 1, then 7 when the next entry to be made is 6.
    const ahead = lzwData([1, 1], 2).slice()
    ahead[1] = 0b11001100
    ahead[2] |= 1
    out = decodeGifFrames(buildGif({ width: 4, height: 4, globalTable: RGBK, blocks: [good, { ...good, rawData: Uint8Array.from(ahead) }] }))
    expect(out.frames).toHaveLength(1)

    out = decodeGifFrames(buildGif({ width: 4, height: 4, globalTable: RGBK, blocks: [good, { raw: [0x99] }, good] }))
    expect(out.frames).toHaveLength(1)
    expect(out.reader.stop).toBe('damaged')

    out = decodeGifFrames(buildGif({ width: 4, height: 4, blocks: [good] }))
    expect(out.frames).toHaveLength(0)
    expect(out.reader.stop).toBe('damaged')
  })

  it('skips comments, plain text and other extensions between frames', () => {
    const comment = [0x21, 0xfe, 5, ...[...'hello'].map((c) => c.charCodeAt(0)), 0]
    const text = [0x21, 0x01, 12, 0, 0, 0, 0, 4, 0, 4, 0, 8, 8, 1, 0, 2, 104, 105, 0]
    const app = [0x21, 0xff, 11, ...[...'XMP DataXMP'].map((c) => c.charCodeAt(0)), 3, 1, 2, 3, 0]
    const gif = buildGif({
      width: 2,
      height: 1,
      globalTable: RGBK,
      blocks: [{ raw: comment }, { width: 2, height: 1, indices: [1, 2] }, { raw: text }, { raw: app }, { width: 2, height: 1, indices: [3, 3] }]
    })
    const { frames, reader } = decodeGifFrames(gif)
    expect(frames).toHaveLength(2)
    expect(reader.stop).toBeNull()
    expect(pixels(frames[1].rgba, 2, 1)[0]).toEqual([BLUE, BLUE])
  })

  it('leaves pixels whose index is past the colour table as they were', () => {
    const gif = buildGif({ width: 3, height: 1, globalTable: [255, 0, 0, 0, 255, 0], blocks: [{ width: 3, height: 1, indices: [0, 3, 1], minCodeSize: 2 }] })
    expect(pixels(decodeGifFrames(gif).frames[0].rgba, 3, 1)[0]).toEqual([RED, CLEAR, GREEN])
  })

  it('reads delays the browsers’ way, and the loop count', () => {
    expect([0, 1, 2, 7, 100].map(frameDelayMs)).toEqual([100, 100, 20, 70, 1000])
    const blocks = [0, 1, 2].map((d) => ({ width: 1, height: 1, indices: [1], delay: d }))
    const once = decodeGifFrames(buildGif({ width: 1, height: 1, globalTable: RGBK, blocks }))
    expect(once.frames.map((f) => f.delayMs)).toEqual([100, 100, 20])
    expect(once.reader.loopCount).toBeNull()
    expect(decodeGifFrames(buildGif({ width: 1, height: 1, globalTable: RGBK, blocks, loop: 3 })).reader.loopCount).toBe(3)
    expect(decodeGifFrames(buildGif({ width: 1, height: 1, globalTable: RGBK, blocks, loop: 0 })).reader.loopCount).toBe(0)
  })

  it('reads GIF87a files (no extensions)', () => {
    const gif = buildGif({ version: '87a', width: 2, height: 1, globalTable: RGBK, blocks: [{ width: 2, height: 1, indices: [2, 3], noGce: true }] })
    const { reader, frames } = decodeGifFrames(gif)
    expect(reader.version).toBe('87a')
    expect(frames[0].delayMs).toBe(100)
    expect(pixels(frames[0].rgba, 2, 1)[0]).toEqual([GREEN, BLUE])
  })
})

describe('GIF decoder: limits', () => {
  it('refuses a huge declared screen before allocating anything', () => {
    const huge = buildGif({ width: 65535, height: 65535, globalTable: RGBK, blocks: [{ width: 1, height: 1, indices: [1] }] })
    expect(() => new GifReader(huge)).toThrow(GifError)
    expect(() => new GifReader(buildGif({ width: 0, height: 5, globalTable: RGBK, blocks: [] }))).toThrow(GifError)
    expect(() => new GifReader(new Uint8Array(20))).toThrow(GifError)
    expect(() => new GifReader(Uint8Array.from([...'GIF89a'].map((c) => c.charCodeAt(0))))).toThrow(GifError)
  })

  it('stops after the most frames allowed, and when the time runs out', () => {
    const blocks = [1, 2, 3].map((k) => ({ width: 64, height: 128, indices: noise(64 * 128, 4, k) }))
    const gif = buildGif({ width: 64, height: 128, globalTable: RGBK, blocks })
    const few = decodeGifFrames(gif, { maxFrames: 2 })
    expect(few.frames).toHaveLength(2)
    expect(few.reader.stop).toBe('too-many-frames')
    const slow = decodeGifFrames(gif, { maxMs: -1 })
    expect(slow.frames).toHaveLength(0)
    expect(slow.reader.stop).toBe('too-slow')
  })

  it('hands out its own buffer, reused for each frame', () => {
    const blocks = [1, 2].map((k) => ({ width: 1, height: 1, indices: [k] }))
    const reader = new GifReader(buildGif({ width: 1, height: 1, globalTable: RGBK, blocks }))
    const seen: Uint8ClampedArray[] = []
    for (const f of reader.frames()) seen.push(f.rgba)
    expect(seen[0]).toBe(seen[1])
    expect(pixelAt(seen[0], 1, 0, 0)).toEqual(GREEN)
  })
})
