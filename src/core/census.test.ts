import { describe, expect, it } from 'vitest'
import { ColourCensus, entriesIn } from './census'

describe('ColourCensus', () => {
  it('lists the exact colours in the order first seen, up to 256', () => {
    const c = new ColourCensus()
    c.add(Uint8Array.of(1, 2, 3, 1, 2, 3, 9, 9, 9))
    c.add(Uint8Array.of(9, 9, 9, 4, 5, 6))
    expect([...c.palette()!]).toEqual([1, 2, 3, 9, 9, 9, 4, 5, 6])
  })

  it('gives up past 256 colours', () => {
    const c = new ColourCensus()
    c.add(Uint8Array.from({ length: 257 * 3 }, (_, i) => (i % 3 === 0 ? Math.floor(i / 3) % 256 : Math.floor(i / 3 / 256))))
    expect(c.palette()).toBeNull()
    expect(new ColourCensus().palette()).toBeNull()
  })

  it('counts only the pixels that show', () => {
    const c = new ColourCensus()
    c.add(Uint8Array.of(1, 2, 3, 7, 7, 7, 4, 5, 6), Uint8Array.of(255, 0, 255))
    expect([...c.palette()!]).toEqual([1, 2, 3, 4, 5, 6])
    const hidden = new ColourCensus()
    hidden.add(Uint8Array.of(1, 2, 3), Uint8Array.of(0))
    expect(hidden.palette()).toBeNull()
  })
})

describe('entriesIn', () => {
  it('gives each pixel its colour’s entry, and hidden pixels entry 0', () => {
    const palette = Uint8Array.of(1, 2, 3, 4, 5, 6)
    expect([...entriesIn(palette, Uint8Array.of(4, 5, 6, 1, 2, 3, 4, 5, 6))]).toEqual([1, 0, 1])
    expect([...entriesIn(palette, Uint8Array.of(4, 5, 6, 9, 9, 9), Uint8Array.of(255, 0))]).toEqual([1, 0])
  })

  it('refuses a colour the palette doesn’t hold', () => {
    expect(() => entriesIn(Uint8Array.of(1, 2, 3), Uint8Array.of(9, 9, 9))).toThrow()
  })
})
