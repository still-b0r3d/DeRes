import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildGif, pixelAt } from '../test/gif-builder'
import { MAX_ANIMATION_BUDGET } from './animate'
import { animationPlan, MIN_ANIMATION_EDGE, openAnimatedGif } from './gif-frames'

const RGBK = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]

describe('animationPlan', () => {
  it('keeps a GIF that fits as it is', () => {
    expect(animationPlan(512, 384, 58, 2048)).toEqual({ width: 512, height: 384, keep: 58 })
    expect(animationPlan(100, 80, 5000, 2048)).toEqual({ width: 100, height: 80, keep: Math.floor(MAX_ANIMATION_BUDGET / 8000) })
  })

  it('shrinks the frames until they all fit the budget', () => {
    const p = animationPlan(1000, 1000, 100, 2048)
    expect(p.keep).toBe(100)
    expect(p.width).toBe(p.height)
    expect(p.width * p.height * 100).toBeLessThanOrEqual(MAX_ANIMATION_BUDGET)
    expect(p.width).toBeGreaterThan(400)
  })

  it('never shrinks below the smallest long edge: it keeps fewer frames instead', () => {
    const p = animationPlan(1000, 500, 5000, 2048)
    expect([p.width, p.height]).toEqual([MIN_ANIMATION_EDGE, 128])
    expect(p.keep).toBe(Math.floor(MAX_ANIMATION_BUDGET / (MIN_ANIMATION_EDGE * 128)))
  })

  it('holds the frames no bigger than the working copy', () => {
    expect(animationPlan(4000, 100, 2, 2048)).toEqual({ width: 2048, height: 51, keep: 2 })
  })
})

describe('openAnimatedGif', () => {
  const frames = (n: number, w: number, h: number) =>
    Array.from({ length: n }, (_, k) => ({ width: w, height: h, indices: new Array(w * h).fill(k % 4), delay: 5 + k }))

  it('opens every frame with its delay and the loop count', () => {
    const gif = buildGif({ width: 6, height: 4, globalTable: RGBK, loop: 2, blocks: frames(5, 6, 4) })
    const a = openAnimatedGif(gif, 2048)!
    expect(a).not.toBeNull()
    expect([a.width, a.height, a.origW, a.origH]).toEqual([6, 4, 6, 4])
    expect(a.frames).toHaveLength(5)
    expect(a.total).toBe(5)
    expect(a.delaysMs).toEqual([50, 60, 70, 80, 90])
    expect(a.loopCount).toBe(2)
    expect(a.hasAlpha).toBe(false)
    expect(pixelAt(a.frames[1], 6, 5, 3)).toEqual([255, 0, 0, 255])
    expect(pixelAt(a.frames[3], 6, 0, 0)).toEqual([0, 0, 255, 255])
  })

  it('keeps only the first frames that fit, and counts the rest', () => {
    const gif = buildGif({ width: 64, height: 48, globalTable: RGBK, blocks: frames(10, 64, 48) })
    const a = openAnimatedGif(gif, 2048, { budget: 64 * 48 * 4 })!
    expect(a.frames).toHaveLength(4)
    expect(a.total).toBe(10)
    expect([a.width, a.height]).toEqual([64, 48])
  })

  it('shrinks big frames by area average', () => {
    const gif = buildGif({ width: 600, height: 300, globalTable: RGBK, blocks: frames(2, 600, 300) })
    const a = openAnimatedGif(gif, 2048, { budget: 300 * 150 * 2 })!
    expect([a.width, a.height, a.origW, a.origH]).toEqual([300, 150, 600, 300])
    expect(pixelAt(a.frames[1], 300, 150, 75)).toEqual([255, 0, 0, 255])
  })

  it('notices transparency in any frame', () => {
    const blocks = [
      { width: 2, height: 2, indices: [1, 1, 1, 1], disposal: 2 },
      { x: 1, y: 1, width: 1, height: 1, indices: [3] }
    ]
    const a = openAnimatedGif(buildGif({ width: 2, height: 2, globalTable: RGBK, blocks }), 2048)!
    expect(a.hasAlpha).toBe(true)
    expect(pixelAt(a.frames[0], 2, 0, 0)[3]).toBe(255)
    expect(pixelAt(a.frames[1], 2, 0, 0)[3]).toBe(0)
  })

  it('is null for a still, a GIF too big to animate, or one whose second frame is damaged', () => {
    expect(openAnimatedGif(buildGif({ width: 2, height: 2, globalTable: RGBK, blocks: frames(1, 2, 2) }), 2048)).toBeNull()
    expect(openAnimatedGif(new Uint8Array(100), 2048)).toBeNull()
    expect(openAnimatedGif(buildGif({ width: 65535, height: 65535, globalTable: RGBK, blocks: frames(2, 1, 1) }), 2048)).toBeNull()
    const broken = buildGif({
      width: 2,
      height: 2,
      globalTable: RGBK,
      blocks: [frames(1, 2, 2)[0], { width: 2, height: 2, indices: [], rawData: Uint8Array.of(1, 0xff, 0) }]
    })
    expect(openAnimatedGif(broken, 2048)).toBeNull()
  })

  it('opens the sample: 58 frames, 3.87 s, looping forever', () => {
    const bytes = new Uint8Array(readFileSync(new URL('../../b0r3d-brand/rukus-breaks-out.gif', import.meta.url)))
    const a = openAnimatedGif(bytes, 2048)!
    expect([a.width, a.height, a.frames.length, a.total, a.loopCount]).toEqual([512, 384, 58, 58, 0])
    expect(a.delaysMs.reduce((x, y) => x + y, 0)).toBe(3870)
    expect(a.hasAlpha).toBe(false)
  })
})
