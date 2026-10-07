import { describe, expect, it } from 'vitest'
import { applyAdjust, edgeBoost, NEUTRAL, toGrey } from './adjust'
import { linearToSrgb, srgbToLinear } from './color'

const pixel = (r: number, g: number, b: number) => Float32Array.from([r, g, b].map((v) => srgbToLinear(v)))
const srgb = (rgb: Float32Array) => [...rgb].map((v) => +linearToSrgb(v).toFixed(3))

describe('pre-filters', () => {
  it('leave the picture alone at neutral', () => {
    const rgb = pixel(0.2, 0.5, 0.9)
    const copy = Float32Array.from(rgb)
    applyAdjust(rgb, NEUTRAL)
    expect(rgb).toEqual(copy)
  })

  it('brightness adds (in sRGB) and clamps', () => {
    const rgb = pixel(0.2, 0.5, 0.95)
    applyAdjust(rgb, { ...NEUTRAL, brightness: 0.1 })
    expect(srgb(rgb)).toEqual([0.3, 0.6, 1])
  })

  it('contrast stretches around mid-grey', () => {
    const rgb = pixel(0.25, 0.5, 0.75)
    applyAdjust(rgb, { ...NEUTRAL, contrast: 2 })
    expect(srgb(rgb)).toEqual([0, 0.5, 1])
  })

  it('saturation 0 makes grey', () => {
    const rgb = pixel(0.9, 0.2, 0.1)
    applyAdjust(rgb, { ...NEUTRAL, saturation: 0 })
    const [r, g, b] = srgb(rgb)
    expect(r).toBeCloseTo(g, 2)
    expect(g).toBeCloseTo(b, 2)
  })

  it('gamma above 1 lifts the shadows, ends stay put', () => {
    const rgb = pixel(0, 0.25, 1)
    applyAdjust(rgb, { ...NEUTRAL, gamma: 2 })
    const [lo, mid, hi] = srgb(rgb)
    expect(lo).toBe(0)
    expect(mid).toBeCloseTo(0.5, 2)
    expect(hi).toBe(1)
  })

  it('toGrey keeps the luminance', () => {
    const rgb = pixel(1, 0, 0)
    toGrey(rgb)
    expect(rgb[0]).toBeCloseTo(0.2126, 4)
    expect(rgb[1]).toBe(rgb[0])
    expect(rgb[2]).toBe(rgb[0])
  })

  it('edge boost sharpens an edge and leaves flat areas', () => {
    const w = 6
    const rgb = new Float32Array(w * 3 * 3)
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < w; x++) rgb.fill(srgbToLinear(x < 3 ? 0.3 : 0.7), (y * w + x) * 3, (y * w + x) * 3 + 3)
    edgeBoost(rgb, w, 3, 0.6)
    const row = (x: number) => +linearToSrgb(rgb[(w + x) * 3]).toFixed(2)
    expect(row(0)).toBe(0.3)
    expect(row(2)).toBeLessThan(0.3)
    expect(row(3)).toBeGreaterThan(0.7)
    expect(row(5)).toBe(0.7)
  })
})
