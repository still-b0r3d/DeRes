import { describe, expect, it } from 'vitest'
import { generateAscii } from './ascii'
import { asciiImageSize, asciiPixels, renderHalfBlockPng } from './ascii-render'
import { ColourCensus, encodeRgbAnimation, type RgbAnimationOptions } from './encode-animation'
import { decodeGifFrames } from './gif-decode'
import { decodePng } from './png'
import { readApng } from '../test/apng-frames'

// A GIF or APNG of full-colour frames made one at a time (the ASCII
// studio's animations): exact colours when they fit, frames made twice past
// the budget.

const W = 12
const H = 6

/** Frame k: a few flat colours that move (as rendered art is), or a different colour for every pixel of every frame. */
function frameRgb(k: number, noisy = false): Uint8Array {
  const rgb = new Uint8Array(W * H * 3)
  for (let p = 0; p < W * H; p++) {
    const x = p % W
    const n = p + k * W * H
    const colour = noisy ? [n & 0xff, n >> 8, 7] : [[255, 0, 0], [0, 0, 170], [85, 255, 85], [0, 0, 0]][Math.floor((x + k) / 3) % 4]
    rgb.set(colour, p * 3)
  }
  return rgb
}

/** r, g, b, a back to r, g, b. */
const toRgb = (rgba: Uint8Array | Uint8ClampedArray) => Uint8Array.from({ length: (rgba.length / 4) * 3 }, (_, i) => rgba[Math.floor(i / 3) * 4 + (i % 3)])

function options(o: Partial<RgbAnimationOptions> = {}): RgbAnimationOptions {
  return { format: 'gif', width: W, height: H, delaysMs: [70, 120, 50, 90], loopCount: 0, frame: (k) => frameRgb(k), ...o }
}

describe('ColourCensus', () => {
  it('lists the exact colours in the order first seen, up to 256', () => {
    const c = new ColourCensus()
    c.add(Uint8Array.of(1, 2, 3, 1, 2, 3, 9, 9, 9))
    c.add(Uint8Array.of(9, 9, 9, 4, 5, 6))
    expect([...c.palette()!]).toEqual([1, 2, 3, 9, 9, 9, 4, 5, 6])
  })

  it('gives up past 256 colours', () => {
    const c = new ColourCensus()
    c.add(Uint8Array.from({ length: 257 * 3 }, (_, i) => (i % 3 === 0 ? Math.floor(i / 3) % 256 : Math.floor(i / 3 / 256))))
    expect(c.palette()).toBeNull()
    expect(new ColourCensus().palette()).toBeNull()
  })
})

describe('encodeRgbAnimation', () => {
  it('a GIF of few colours keeps them exactly, with every delay and the loop count', async () => {
    for (const loopCount of [0, null, 2]) {
      const res = await encodeRgbAnimation(options({ loopCount }))
      expect([res.width, res.height, res.frameCount, res.mimeType]).toEqual([W, H, 4, 'image/gif'])
      const { reader, frames } = decodeGifFrames(res.data)
      expect(reader.loopCount).toBe(loopCount)
      expect(frames.map((f) => f.delayMs)).toEqual([70, 120, 50, 90])
      frames.forEach((f, k) => expect(toRgb(f.rgba)).toEqual(frameRgb(k)))
      // Four colours: a 4-entry global table (2 bits a pixel).
      expect(res.data[10]).toBe(0x91)
    }
  })

  it('an APNG of few colours is indexed with exactly those colours, and plays the loop count plus one', async () => {
    const res = await encodeRgbAnimation(options({ format: 'apng', loopCount: 2 }))
    const apng = await readApng(res.data)
    expect([apng.width, apng.height, apng.frameCount, apng.numPlays]).toEqual([W, H, 4, 3])
    expect([apng.colourType, apng.paletteColours]).toEqual([3, 4])
    expect(apng.frames.map((f) => f.delayMs)).toEqual([70, 120, 50, 90])
    apng.frames.forEach((f, k) => expect(toRgb(f.rgba)).toEqual(frameRgb(k)))
  })

  it('past 256 colours: the APNG stays full colour and exact; the GIF shares one palette', async () => {
    const noisy = { frame: (k: number) => frameRgb(k, true) }
    const apng = await readApng((await encodeRgbAnimation(options({ format: 'apng', ...noisy }))).data)
    expect(apng.colourType).toBe(2)
    apng.frames.forEach((f, k) => expect(toRgb(f.rgba)).toEqual(frameRgb(k, true)))
    const gif = await encodeRgbAnimation(options(noisy))
    const { frames } = decodeGifFrames(gif.data)
    expect(frames).toHaveLength(4)
    // One global table (the shared palette).
    expect(gif.data[10] & 0x80).toBe(0x80)
  })

  it('holds the frames between its two passes while they fit the budget; past it, makes each one twice', async () => {
    for (const budget of [W * H * 4, W * H * 4 - 1]) {
      const asked: number[] = []
      const notes: (string | undefined)[] = []
      const res = await encodeRgbAnimation(
        options({
          budget,
          frame: (k) => {
            asked.push(k)
            return frameRgb(k)
          },
          onProgress: (done, total, note) => notes.push(`${done}/${total} ${note ?? ''}`.trim())
        })
      )
      expect(asked).toEqual(budget >= W * H * 4 ? [0, 1, 2, 3] : [0, 1, 2, 3, 0, 1, 2, 3])
      expect(notes).toEqual(['1/4 reading the colours', '2/4 reading the colours', '3/4 reading the colours', '4/4 reading the colours', '1/4', '2/4', '3/4', '4/4'])
      // The same file either way.
      decodeGifFrames(res.data).frames.forEach((f, k) => expect(toRgb(f.rgba)).toEqual(frameRgb(k)))
    }
  })

  it('waits for the page between frames, and refuses a frame too big for an animation', async () => {
    let breaths = 0
    await encodeRgbAnimation(options({ breathe: async () => void breaths++ }))
    // Between frames of the first pass, and before each of the second.
    expect(breaths).toBe(3 + 4)
    await expect(encodeRgbAnimation(options({ width: 1025, height: 1024 }))).rejects.toThrow(/too big for an animation/)
    await expect(encodeRgbAnimation(options({ delaysMs: [] }))).rejects.toThrow(/no frames/)
  })
})

describe('the ASCII studio’s frames', () => {
  it('half-block art as pixels is its PNG, pixel for pixel, at every size', async () => {
    const rgba = new Uint8ClampedArray(40 * 30 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 29) % 256))
    for (const s of [{ mode: 'half-block', colorMode: 'ansi16' }, { mode: 'teletext', colorMode: 'teletext', teletextSeparated: true }] as const) {
      const art = generateAscii(rgba, 40, 30, { ...s, columns: 10 })
      for (const m of [1, 2, 4]) {
        const png = await decodePng((await renderHalfBlockPng(art, m)).png)
        expect([png.width, png.height]).toEqual(asciiImageSize(art.width, art.height, m))
        expect(asciiPixels(art, m)).toEqual(toRgb(png.rgba))
      }
    }
  }, 30_000)

  it('an animation of ANSI art is indexed with its 16 colours at most, the same pixels as the PNG', async () => {
    const pictures = [0, 1, 2].map((k) => new Uint8ClampedArray(40 * 30 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 29 + k * 40) % 256)))
    const arts = pictures.map((p) => generateAscii(p, 40, 30, { mode: 'half-block', colorMode: 'ansi16', columns: 20 }))
    const [width, height] = asciiImageSize(arts[0].width, arts[0].height, 2)
    const res = await encodeRgbAnimation({ format: 'gif', width, height, delaysMs: [100, 100, 100], loopCount: 0, frame: (k) => asciiPixels(arts[k], 2) })
    expect(res.data[10] & 0x07).toBeLessThanOrEqual(3)
    const { frames } = decodeGifFrames(res.data)
    for (let k = 0; k < 3; k++) {
      const png = await decodePng((await renderHalfBlockPng(arts[k], 2)).png)
      expect(toRgb(frames[k].rgba)).toEqual(toRgb(png.rgba))
    }
  })
})
