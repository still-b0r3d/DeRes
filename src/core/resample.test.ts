import { describe, expect, it } from 'vitest'
import { resampleArea, shrinkRgba } from './resample'

/** A one-channel image from rows of numbers. */
const img = (rows: number[][]) => Float32Array.from(rows.flat())

describe('area-average resampling', () => {
  it('averages exact blocks when shrinking by a whole number', () => {
    const src = img([
      [1, 3, 10, 20],
      [5, 7, 30, 40],
      [0, 0, 8, 8],
      [0, 4, 8, 8]
    ])
    const out = resampleArea(src, 4, 4, { x: 0, y: 0, w: 4, h: 4 }, 2, 2, 1)
    expect([...out]).toEqual([4, 25, 1, 8])
  })

  it('weighs partly covered pixels by how much is covered', () => {
    // 3 pixels to 2: each output covers 1.5 source pixels.
    const out = resampleArea(img([[0, 3, 6]]), 3, 1, { x: 0, y: 0, w: 3, h: 1 }, 2, 1, 1)
    expect(out[0]).toBeCloseTo((0 * 1 + 3 * 0.5) / 1.5, 5)
    expect(out[1]).toBeCloseTo((3 * 0.5 + 6 * 1) / 1.5, 5)
  })

  it('keeps a flat image flat at any size', () => {
    const src = new Float32Array(37 * 23).fill(0.42)
    for (const [w, h] of [
      [5, 3],
      [37, 23],
      [80, 50]
    ]) {
      const out = resampleArea(src, 37, 23, { x: 0, y: 0, w: 37, h: 23 }, w, h, 1)
      for (const v of out) expect(v).toBeCloseTo(0.42, 5)
    }
  })

  it('interpolates linearly when enlarging', () => {
    // 2 pixels to 4: centres at 0.25, 0.75, 1.25, 1.75 of the source.
    const out = resampleArea(img([[0, 1]]), 2, 1, { x: 0, y: 0, w: 2, h: 1 }, 4, 1, 1)
    expect([...out].map((v) => +v.toFixed(3))).toEqual([0, 0.25, 0.75, 1])
  })

  it('reads only the requested part (a crop)', () => {
    const src = img([
      [9, 9, 9, 9],
      [9, 1, 2, 9],
      [9, 3, 4, 9],
      [9, 9, 9, 9]
    ])
    const out = resampleArea(src, 4, 4, { x: 1, y: 1, w: 2, h: 2 }, 2, 2, 1)
    expect([...out]).toEqual([1, 2, 3, 4])
  })

  it('keeps channels apart (RGBA)', () => {
    const src = Float32Array.from([1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1])
    const out = resampleArea(src, 2, 2, { x: 0, y: 0, w: 2, h: 2 }, 1, 1, 4)
    expect([...out]).toEqual([0.5, 0.5, 0.5, 1])
  })
})

describe('shrinkRgba', () => {
  const px = (r: number, g: number, b: number, a: number) => [r, g, b, a]

  it('copies a picture that is already the size', () => {
    const src = Uint8ClampedArray.from([...px(1, 2, 3, 255), ...px(4, 5, 6, 0)])
    const out = shrinkRgba(src, 2, 1, 2, 1)
    expect([...out]).toEqual([...src])
    expect(out).not.toBe(src)
  })

  it('keeps a flat colour flat', () => {
    const src = new Uint8ClampedArray(9 * 7 * 4)
    for (let i = 0; i < 63; i++) src.set(px(200, 100, 50, 255), i * 4)
    const out = shrinkRgba(src, 9, 7, 4, 3)
    for (let i = 0; i < 12; i++) expect([...out.subarray(i * 4, i * 4 + 4)]).toEqual([200, 100, 50, 255])
  })

  it('averages in linear light', () => {
    const out = shrinkRgba(Uint8ClampedArray.from([...px(0, 0, 0, 255), ...px(255, 255, 255, 255)]), 2, 1, 1, 1)
    expect([...out]).toEqual([188, 188, 188, 255])
  })

  it('lets no colour in from transparent pixels', () => {
    const src = Uint8ClampedArray.from([...px(255, 255, 255, 255), ...px(0, 0, 0, 0), ...px(255, 255, 255, 255), ...px(0, 0, 0, 0)])
    expect([...shrinkRgba(src, 2, 2, 1, 1)]).toEqual([255, 255, 255, 128])
    expect([...shrinkRgba(new Uint8ClampedArray(16), 2, 2, 1, 1)]).toEqual([0, 0, 0, 0])
  })
})
