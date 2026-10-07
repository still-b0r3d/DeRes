import { describe, expect, it } from 'vitest'
import { BYTE_TO_LINEAR, hexToRgb } from './color'
import { bucketByte, PaletteMatcher } from './matcher'

const bytes = (hexes: string[]) => Uint8Array.from(hexes.flatMap(hexToRgb))
const EGA = bytes([
  '#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
  '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff'
])

describe('PaletteMatcher', () => {
  it('maps every palette colour to itself', () => {
    const m = new PaletteMatcher(EGA)
    for (let i = 0; i < m.size; i++) {
      expect(m.nearestByte(EGA[i * 3], EGA[i * 3 + 1], EGA[i * 3 + 2])).toBe(i)
    }
  })

  it('gives the same answer as a full search for every cache bucket it fills', () => {
    const m = new PaletteMatcher(EGA)
    // A pseudo-random walk over the colour cube.
    let seed = 1
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 8) & 255
    for (let n = 0; n < 2000; n++) {
      const [r, g, b] = [rnd(), rnd(), rnd()]
      const cached = m.nearestByte(r, g, b)
      const full = m.search(bucketByte(r >> 2), bucketByte(g >> 2), bucketByte(b >> 2))
      expect(cached).toBe(full)
      // Asking again hits the cache and agrees.
      expect(m.nearestByte(r, g, b)).toBe(cached)
    }
  })

  it('accepts linear-light input, clamped', () => {
    const m = new PaletteMatcher(bytes(['#000000', '#ffffff']))
    expect(m.nearest(-1, -1, -1)).toBe(0)
    expect(m.nearest(5, 5, 5)).toBe(1)
    expect(m.nearest(BYTE_TO_LINEAR[30], BYTE_TO_LINEAR[30], BYTE_TO_LINEAR[30])).toBe(0)
  })

  it('measures the typical step between colours (sRGB)', () => {
    expect(new PaletteMatcher(bytes(['#000000', '#ffffff'])).spread).toBe(1)
    expect(new PaletteMatcher(EGA).spread).toBeCloseTo(1 / 3, 5)
    expect(new PaletteMatcher(bytes(['#123456'])).spread).toBe(0)
  })

  it('refuses empty or oversized palettes', () => {
    expect(() => new PaletteMatcher(new Uint8Array(0))).toThrow()
    expect(() => new PaletteMatcher(new Uint8Array(257 * 3))).toThrow()
  })
})
