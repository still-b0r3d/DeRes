import { describe, expect, it } from 'vitest'
import { AUTO_MAX, CUSTOM_MAX, planGeometry, type GeometryInput } from './geometry'
import { profileById } from './profiles'

const base = (over: Partial<GeometryInput>): GeometryInput => ({
  srcW: 2000,
  srcH: 1000,
  origW: 4000,
  origH: 2000,
  profile: profileById('gameboy')!,
  resolution: 'native',
  block: 8,
  fit: 'fill',
  ...over
})

describe('framing', () => {
  it('fill crops the middle of the photo to the screen shape', () => {
    const g = planGeometry(base({}))
    expect([g.width, g.height]).toEqual([160, 144])
    // 160:144 screen from a 2:1 photo: full height, width 1000 × 160/144.
    expect(g.src.h).toBe(1000)
    expect(g.src.w).toBeCloseTo((1000 * 160) / 144, 6)
    expect(g.src.x).toBeCloseTo((2000 - g.src.w) / 2, 6)
    expect(g.dst).toEqual({ x: 0, y: 0, w: 160, h: 144 })
  })

  it("fill uses the screen's real shape when pixels aren't square", () => {
    // CGA: 320×200 with 5:6 pixels shows as 4:3 on the screen.
    const g = planGeometry(base({ profile: profileById('cga-1')!, srcW: 1600, srcH: 1200 }))
    expect(g.src).toEqual({ x: 0, y: 0, w: 1600, h: 1200 })
    expect(g.par).toEqual([5, 6])
  })

  it('fit keeps the whole photo and centres it between bars', () => {
    const g = planGeometry(base({ fit: 'fit' }))
    expect(g.src).toEqual({ x: 0, y: 0, w: 2000, h: 1000 })
    expect(g.dst).toEqual({ x: 0, y: 32, w: 160, h: 80 })
  })

  it('fit puts tall photos between side bars', () => {
    const g = planGeometry(base({ fit: 'fit', srcW: 1000, srcH: 2000 }))
    expect(g.dst).toEqual({ x: 44, y: 0, w: 72, h: 144 })
  })

  it('stretch uses everything', () => {
    const g = planGeometry(base({ fit: 'stretch' }))
    expect(g.src).toEqual({ x: 0, y: 0, w: 2000, h: 1000 })
    expect(g.dst).toEqual({ x: 0, y: 0, w: 160, h: 144 })
  })

  it("the receipt printer's height follows the photo", () => {
    const g = planGeometry(base({ profile: profileById('receipt')! }))
    expect([g.width, g.height]).toEqual([384, 192])
    const tall = planGeometry(base({ profile: profileById('receipt')!, srcW: 100, srcH: 100000 }))
    expect(tall.height).toBe(AUTO_MAX)
  })
})

describe('custom block size', () => {
  it('makes one pixel per block of the original photo', () => {
    const g = planGeometry(base({ resolution: 'custom', block: 16 }))
    expect([g.width, g.height]).toEqual([250, 125])
    expect(g.par).toEqual([1, 1])
  })

  it('is capped, keeping the shape', () => {
    const g = planGeometry(base({ resolution: 'custom', block: 2 }))
    expect(g.width).toBe(CUSTOM_MAX)
    expect(g.height).toBe(CUSTOM_MAX / 2)
  })
})
