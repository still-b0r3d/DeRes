import { describe, expect, it } from 'vitest'
import { asciiAnimationFit, asciiAnimationHint } from './ascii-controls'

// The ASCII studio's GIF and APNG drop to the biggest size that fits an
// animation (MAX_ANIMATION_PIXELS a frame), and say so by their buttons.

describe('asciiAnimationFit', () => {
  it('keeps the chosen size when a frame fits', () => {
    // 80 × 30 cells at 1× is 640×480.
    expect(asciiAnimationFit(80, 30, 1)).toEqual({ multiplier: 1, next: null })
    expect(asciiAnimationHint(80, 30, 1)).toBe('')
  })

  it('drops to the biggest size that fits, and names the next one up', () => {
    // 2× is 1280×960: past 1024×1024 pixels.
    expect(asciiAnimationFit(80, 30, 2)).toEqual({ multiplier: 1, next: 2 })
    expect(asciiAnimationHint(80, 30, 2)).toBe('GIF and APNG come out at 1× (640×480 px): 2× is too big for an animation.')
    expect(asciiAnimationHint(80, 30, 4)).toBe('GIF and APNG come out at 1× (640×480 px): 2× and up are too big for an animation.')
    // 40 × 25 (a C64 screen) fits at 2× (640×800), not 4×.
    expect(asciiAnimationFit(40, 25, 4)).toEqual({ multiplier: 2, next: 4 })
  })

  it('says when not even 1× fits', () => {
    // 200 × 75 cells at 1× is 1600×1200.
    expect(asciiAnimationFit(200, 75, 2)).toEqual({ multiplier: null, next: 1 })
    expect(asciiAnimationHint(200, 75, 2)).toBe("GIF and APNG can't be made: even 1× (1600×1200 px) is too big for an animation. Pick fewer columns.")
  })
})
