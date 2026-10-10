import { describe, expect, it } from 'vitest'
import { encodeGif } from './gif'
import { gifFrameCount } from './gif-info'

const palette = new Uint8Array([0, 0, 0, 255, 255, 255])
const frame = (k: number) => ({ width: 4, height: 3, delayMs: 100, indices: new Uint8Array(12).fill(k & 1) })

describe('gifFrameCount', () => {
  it('counts one frame and many', () => {
    expect(gifFrameCount(encodeGif([frame(0)], { palette }))).toBe(1)
    expect(gifFrameCount(encodeGif([0, 1, 2, 3, 4].map(frame), { palette }))).toBe(5)
  })

  it('counts frames that carry their own colour table', () => {
    const gif = encodeGif([{ ...frame(0), palette }, { ...frame(1), palette }])
    expect(gifFrameCount(gif)).toBe(2)
  })

  it('is 0 for things that are not GIFs', () => {
    expect(gifFrameCount(new Uint8Array(0))).toBe(0)
    expect(gifFrameCount(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0]))).toBe(0)
  })

  it('counts what a cut-off or damaged file has, and stops', () => {
    const gif = encodeGif([0, 1, 2].map(frame), { palette })
    expect(gifFrameCount(gif.subarray(0, gif.length - 1))).toBe(3) // no trailer
    expect(gifFrameCount(gif.subarray(0, Math.floor(gif.length * 0.6)))).toBeLessThan(3)
    const junk = gif.slice()
    junk[13 + palette.length] = 0x99 // where the first block starts
    expect(gifFrameCount(junk)).toBe(0)
  })
})
