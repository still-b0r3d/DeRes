import { describe, expect, it } from 'vitest'
import {
  BYTE_TO_LINEAR,
  hexToRgb,
  linearToByte,
  linearToOklab,
  linearToSrgb,
  rgbToHex,
  srgbToLinear,
  toLinear,
  toSrgb
} from './color'

describe('sRGB and linear light', () => {
  it('maps the ends exactly', () => {
    expect(BYTE_TO_LINEAR[0]).toBe(0)
    expect(BYTE_TO_LINEAR[255]).toBe(1)
    expect(linearToByte(0)).toBe(0)
    expect(linearToByte(1)).toBe(255)
  })

  it('matches the sRGB curve at mid-grey', () => {
    // sRGB 0.5 is about 21.4% linear light.
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214, 3)
    expect(linearToSrgb(0.214)).toBeCloseTo(0.5, 3)
  })

  it('round-trips every byte exactly', () => {
    for (let b = 0; b < 256; b++) expect(linearToByte(BYTE_TO_LINEAR[b])).toBe(b)
  })

  it('clamps out-of-range and NaN input', () => {
    expect(linearToByte(-0.2)).toBe(0)
    expect(linearToByte(1.7)).toBe(255)
    expect(linearToByte(NaN)).toBe(0)
  })

  it('has fast curves that agree with the exact ones', () => {
    for (let i = 0; i <= 100; i++) {
      const v = i / 100
      expect(toSrgb(v)).toBeCloseTo(linearToSrgb(v), 3)
      expect(toLinear(v)).toBeCloseTo(srgbToLinear(v), 4)
    }
  })
})

describe('OKLab', () => {
  const lab = (r: number, g: number, b: number) => {
    const out = [0, 0, 0]
    linearToOklab(BYTE_TO_LINEAR[r], BYTE_TO_LINEAR[g], BYTE_TO_LINEAR[b], out)
    return out
  }

  it('puts white at L=1 and black at L=0, both without colour', () => {
    const w = lab(255, 255, 255)
    expect(w[0]).toBeCloseTo(1, 3)
    expect(Math.abs(w[1])).toBeLessThan(1e-3)
    expect(Math.abs(w[2])).toBeLessThan(1e-3)
    expect(lab(0, 0, 0)).toEqual([0, 0, 0])
  })

  it('matches the published value for sRGB red', () => {
    // From Björn Ottosson's reference implementation.
    const [L, a, b] = lab(255, 0, 0)
    expect(L).toBeCloseTo(0.62796, 3)
    expect(a).toBeCloseTo(0.22486, 3)
    expect(b).toBeCloseTo(0.12585, 3)
  })
})

describe('hex', () => {
  it('converts both ways', () => {
    expect(hexToRgb('#00ff9d')).toEqual([0, 255, 157])
    expect(rgbToHex(0, 255, 157)).toBe('#00ff9d')
    expect(() => hexToRgb('nope')).toThrow()
  })
})
