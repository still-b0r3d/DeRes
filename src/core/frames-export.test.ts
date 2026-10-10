import { describe, expect, it } from 'vitest'
import { apngPlays, generateFramesExport, MAX_ANIMATION_BUDGET, type FramesExportOptions } from './animate'
import { ApngWriter } from './apng'
import { DEFAULT_FX } from './fx'
import { GifWriter } from './gif'
import { decodeGifFrames } from './gif-decode'
import type { Rendered } from './pipeline'
import { decodePng } from './png'

// The streaming GIF and APNG writers, and exporting an animated GIF's own frames.

const BW = Uint8Array.of(0, 0, 0, 255, 255, 255)
const RG = Uint8Array.of(255, 0, 0, 0, 255, 0)

/** A made-up frame "through the machine": 4×2, colour k on the left half, the other on the right. */
function fakeRendered(k: number, palette = BW): Rendered {
  const width = 4
  const height = 2
  const indices = Uint8Array.from({ length: 8 }, (_, i) => ((i % 4 < 2 ? k : k + 1) & 1))
  const rgb = new Uint8Array(24)
  indices.forEach((c, i) => rgb.set(palette.subarray(c * 3, c * 3 + 3), i * 3))
  const rect = { x: 0, y: 0, w: width, h: height }
  return {
    width,
    height,
    indices,
    palette,
    rgb,
    used: 2,
    geometry: { width, height, par: [1, 1], src: rect, dst: rect } as unknown as Rendered['geometry'],
    paper: [255, 255, 255]
  }
}

function options(o: Partial<FramesExportOptions> = {}): FramesExportOptions {
  return {
    format: 'gif',
    multiplier: 2,
    tv: false,
    fx: null,
    delaysMs: [70, 60, 70],
    loopCount: 0,
    render: (k) => fakeRendered(k),
    indexed: true,
    sharedPalette: true,
    ...o
  }
}

describe('GifWriter', () => {
  it('writes no loop block when told the GIF plays once', () => {
    for (const loop of [null, 0, 3] as const) {
      const w = new GifWriter(2, 1, { loop })
      w.add({ width: 2, height: 1, indices: Uint8Array.of(0, 1), palette: BW })
      w.add({ width: 2, height: 1, indices: Uint8Array.of(1, 0), palette: BW })
      const out = w.finish()
      expect(Buffer.from(out).includes('NETSCAPE2.0')).toBe(loop !== null)
      expect(decodeGifFrames(out).reader.loopCount).toBe(loop)
    }
  })

  it('gives a frame its own colour table only when its palette differs', () => {
    const w = new GifWriter(2, 1)
    w.add({ width: 2, height: 1, indices: Uint8Array.of(0, 1), palette: BW })
    w.add({ width: 2, height: 1, indices: Uint8Array.of(0, 1), palette: Uint8Array.from(BW) })
    w.add({ width: 2, height: 1, indices: Uint8Array.of(0, 1), palette: RG })
    const out = w.finish()
    const { frames } = decodeGifFrames(out)
    expect([...frames[1].rgba]).toEqual([0, 0, 0, 255, 255, 255, 255, 255])
    expect([...frames[2].rgba]).toEqual([255, 0, 0, 255, 0, 255, 0, 255])
    // Two image descriptors without a local table (flags 0), one with.
    const flags: number[] = []
    for (let i = 0; i + 9 < out.length; i++) if (out[i] === 0x2c && out[i - 1] === 0 && out[i + 5] === 2 && out[i + 7] === 1) flags.push(out[i + 9])
    expect(flags.map((f) => f & 0x80)).toEqual([0, 0, 0x80])
  })
})

describe('ApngWriter', () => {
  it('counts its frames when it finishes, and plays as often as asked', async () => {
    const w = new ApngWriter(2, 1, { numPlays: 3 })
    for (let k = 0; k < 4; k++) await w.add({ width: 2, height: 1, delayMs: 50, rgb: Uint8Array.of(k, 0, 0, 0, k, 0) })
    const out = w.finish()
    const view = new DataView(out.buffer)
    const actl = Buffer.from(out).indexOf('acTL')
    expect([view.getUint32(actl + 4), view.getUint32(actl + 8)]).toEqual([4, 3])
    // The first frame is a plain PNG's picture too.
    const png = await decodePng(out)
    expect([...png.rgba.subarray(0, 8)]).toEqual([0, 0, 0, 255, 0, 0, 0, 255])
  })

  it('maps a GIF loop count to APNG plays', () => {
    expect([apngPlays(null), apngPlays(0), apngPlays(1), apngPlays(4)]).toEqual([1, 0, 2, 5])
  })
})

describe('generateFramesExport', () => {
  it('makes an indexed GIF with the source’s delays and loop count, each frame enlarged', async () => {
    const seen: number[] = []
    const res = await generateFramesExport(options({ loopCount: null, onProgress: (d) => seen.push(d) }))
    expect([res.width, res.height, res.frameCount, res.mimeType]).toEqual([8, 4, 3, 'image/gif'])
    expect(seen).toEqual([1, 2, 3])
    const { reader, frames } = decodeGifFrames(res.data)
    expect(reader.loopCount).toBeNull()
    expect(frames.map((f) => f.delayMs)).toEqual([70, 60, 70])
    for (let k = 0; k < 3; k++) {
      const r = fakeRendered(k)
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 8; x++) {
          const s = (Math.floor(y / 2) * 4 + Math.floor(x / 2)) * 3
          const o = (y * 8 + x) * 4
          expect([...frames[k].rgba.subarray(o, o + 3)]).toEqual([...r.rgb.subarray(s, s + 3)])
        }
      }
    }
  })

  it('gives frames with their own palette their own colour table', async () => {
    const res = await generateFramesExport(options({ render: (k) => fakeRendered(0, k === 1 ? RG : BW), sharedPalette: false }))
    const { frames } = decodeGifFrames(res.data)
    expect([...frames[1].rgba.subarray(0, 4)]).toEqual([255, 0, 0, 255])
    expect([...frames[2].rgba.subarray(0, 4)]).toEqual([0, 0, 0, 255])
  })

  it('makes a full-colour GIF with the screen effect', async () => {
    const res = await generateFramesExport(options({ multiplier: 3, fx: { ...DEFAULT_FX, screen: 'crt' } }))
    const { frames } = decodeGifFrames(res.data)
    expect(frames).toHaveLength(3)
    expect([res.width, res.height]).toEqual([12, 6])
    expect(frames.map((f) => f.delayMs)).toEqual([70, 60, 70])
  })

  it('makes an indexed APNG when every frame shares one palette, and full colour when not', async () => {
    const shared = await generateFramesExport(options({ format: 'apng', loopCount: 2 }))
    expect(shared.mimeType).toBe('image/png')
    expect(shared.data[25]).toBe(3) // colour type: indexed
    const view = new DataView(shared.data.buffer)
    const actl = Buffer.from(shared.data).indexOf('acTL')
    expect([view.getUint32(actl + 4), view.getUint32(actl + 8)]).toEqual([3, 3])
    const own = await generateFramesExport(options({ format: 'apng', sharedPalette: false }))
    expect(own.data[25]).toBe(2) // truecolour
  })

  it('refuses sizes a phone couldn’t hold', async () => {
    const frames = Math.floor(MAX_ANIMATION_BUDGET / 32) + 1 // 8×4 per frame at 2×
    await expect(generateFramesExport(options({ delaysMs: new Array(frames).fill(10) }))).rejects.toThrow('too much to hold')
    await expect(generateFramesExport(options({ multiplier: 600 }))).rejects.toThrow('too big for an animation')
  })
})
