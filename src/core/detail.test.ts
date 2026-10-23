import { describe, expect, it } from 'vitest'
import { BYTE_TO_LINEAR, linearToByte } from './color'
import { DEFAULT_DETAIL, detailAmount, keepDetail, MAX_DETAIL } from './detail'

/** A grey picture (sRGB byte `bg`) with one dark column (byte `line`) at x. */
function lined(w: number, h: number, bg: number, line: number, x: number): Float32Array {
  const rgb = new Float32Array(w * h * 3).fill(BYTE_TO_LINEAR[bg])
  for (let y = 0; y < h; y++) rgb.fill(BYTE_TO_LINEAR[line], (y * w + x) * 3, (y * w + x) * 3 + 3)
  return rgb
}
const byteAt = (rgb: Float32Array, w: number, x: number, y: number) => linearToByte(rgb[(y * w + x) * 3])

describe('detail amount', () => {
  it('is 1 at the default when the photo is shrunk 2× or more, and grows with the setting', () => {
    expect(detailAmount(DEFAULT_DETAIL, [2, 2])).toBe(1)
    expect(detailAmount(DEFAULT_DETAIL, [6, 6])).toBe(1)
    expect(detailAmount(1, [6, 6])).toBe(MAX_DETAIL)
    expect(detailAmount(0, [6, 6])).toBe(0)
  })

  it('fades out as the shrink does: nothing for a photo that isn’t shrunk', () => {
    expect(detailAmount(1, [1, 1])).toBe(0)
    expect(detailAmount(1, [0.5, 0.5])).toBe(0)
    expect(detailAmount(1, [1.5, 1.5])).toBeCloseTo(MAX_DETAIL / 2, 6)
  })

  it('keeps odd settings in range', () => {
    expect(detailAmount(5, [3, 3])).toBe(MAX_DETAIL)
    expect(detailAmount(-1, [3, 3])).toBe(0)
  })
})

describe('keepDetail', () => {
  it('leaves a flat picture alone', () => {
    const flat = new Float32Array(8 * 6 * 3).fill(BYTE_TO_LINEAR[150])
    const out = keepDetail(flat, 8, 6, MAX_DETAIL)
    for (let i = 0; i < out.length; i++) expect(linearToByte(out[i])).toBe(150)
  })

  it('makes a faded thin line stand out again', () => {
    // A line that a shrink averaged to 150 on a 190 field.
    const rgb = lined(9, 5, 190, 150, 4)
    const out = keepDetail(rgb, 9, 5, 1)
    expect(byteAt(out, 9, 4, 2)).toBeLessThan(150)
    expect(byteAt(out, 9, 3, 2)).toBeGreaterThanOrEqual(190)
    // Away from the line nothing changes.
    expect(byteAt(out, 9, 0, 2)).toBe(190)
    expect(byteAt(out, 9, 8, 2)).toBe(190)
  })

  it('works in sRGB: a dark line and a light line move by the same step', () => {
    const dark = keepDetail(lined(9, 3, 128, 108, 4), 9, 3, 1)
    const light = keepDetail(lined(9, 3, 128, 148, 4), 9, 3, 1)
    expect(108 - byteAt(dark, 9, 4, 1)).toBe(byteAt(light, 9, 4, 1) - 148)
  })

  it('stays within black and white', () => {
    const out = keepDetail(lined(5, 5, 255, 0, 2), 5, 5, MAX_DETAIL)
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('handles a picture one pixel wide or tall', () => {
    expect(keepDetail(new Float32Array(3).fill(0.5), 1, 1, 1)[0]).toBeCloseTo(0.5, 3)
    expect(keepDetail(lined(5, 1, 200, 100, 2), 5, 1, 1).length).toBe(15)
  })
})
