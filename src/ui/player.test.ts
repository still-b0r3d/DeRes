import { describe, expect, it } from 'vitest'
import { MAX_ANIMATION_BUDGET } from '../core/animate'
import { previewFxSize } from '../core/pipeline'
import { playScale } from './player'

// The preview's size while a GIF plays: every frame has to fit the budget,
// or frames past it are made again on every pass and playback stutters.

const square = [1, 1] as const
const sizeOf = (w: number, h: number) => (s: number) => previewFxSize(w, h, square, s, false)
const held = (w: number, h: number, s: number, frames: number) => {
  const [fw, fh] = previewFxSize(w, h, square, s, false)
  return fw * fh * frames
}

describe('playScale', () => {
  it('keeps the preview’s own size when every frame fits', () => {
    // Game Boy, 58 frames: 3× fits (480×432).
    expect(playScale(3, 58, sizeOf(160, 144))).toBe(3)
  })

  it('steps down whole sizes to 2×', () => {
    // Game Boy at 6× is 960×864: 58 of those are far too many; 3× fits.
    expect(playScale(6, 58, sizeOf(160, 144))).toBe(3)
    // 320×200: 2× fits (640×400 × 58).
    expect(playScale(5, 58, sizeOf(320, 200))).toBe(2)
  })

  it('goes in between 2× and 1× when 2× is too much (a 320×240 machine)', () => {
    const s = playScale(4, 58, sizeOf(320, 240))
    expect(s).toBe(1.9)
    expect(held(320, 240, s, 58)).toBeLessThanOrEqual(MAX_ANIMATION_BUDGET)
    expect(held(320, 240, 2, 58)).toBeGreaterThan(MAX_ANIMATION_BUDGET)
    // A whole number of pixels either way.
    expect(previewFxSize(320, 240, square, s, false)).toEqual([608, 456])
  })

  it('drops to 1× for the biggest machines, and never below', () => {
    // PC-98 (640×400): only its own size fits 58 frames.
    expect(playScale(3, 58, sizeOf(640, 400))).toBe(1)
    // Nothing fits 2000 frames of it: 1× (the rest are made as they come).
    expect(playScale(3, 2000, sizeOf(640, 400))).toBe(1)
  })
})
