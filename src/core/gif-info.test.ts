import { describe, expect, it } from 'vitest'
import { encodeGif } from './gif'
import { durationText, framesText, gifFrameCount } from './gif-info'

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

describe('the picture info for GIF frames', () => {
  it('says how long an animation runs', () => {
    expect(durationText(3870)).toBe('3.9 s')
    expect(durationText(100)).toBe('0.1 s')
    expect(durationText(42_400)).toBe('42 s')
    expect(durationText(125_000)).toBe('2 min 5 s')
  })

  it('counts the frames, and says when some were cut', () => {
    expect(framesText(58, { frames: 58, total: 58, durationMs: 3870 })).toBe('58 frames · 3.9 s')
    expect(framesText(300, { frames: 40, total: 300, durationMs: 2700 })).toBe('first 40 of 300 frames · 2.7 s')
    expect(framesText(58, null)).toBe('first of 58 frames')
    expect(framesText(1, null)).toBe('')
    expect(framesText(0, null)).toBe('')
  })
})
