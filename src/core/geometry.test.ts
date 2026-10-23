import { describe, expect, it } from 'vitest'
import { AUTO_MAX, coverage, CUSTOM_MAX, CUSTOM_MIN, customWidthRange, planGeometry, type GeometryInput } from './geometry'
import { profileById } from './profiles'

const base = (over: Partial<GeometryInput>): GeometryInput => ({
  srcW: 2000,
  srcH: 1000,
  origW: 4000,
  origH: 2000,
  profile: profileById('gameboy')!,
  resolution: 'native',
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

describe('custom width', () => {
  it('is the width picked, square pixels, the photo’s own shape', () => {
    const g = planGeometry(base({ resolution: 'custom', customWidth: 250 }))
    expect([g.width, g.height]).toEqual([250, 125])
    expect(g.par).toEqual([1, 1])
    expect(g.src).toEqual({ x: 0, y: 0, w: 2000, h: 1000 })
  })

  it('starts at the machine’s own width', () => {
    expect(planGeometry(base({ resolution: 'custom' })).width).toBe(160)
    expect(planGeometry(base({ resolution: 'custom', profile: profileById('vga')! })).width).toBe(320)
  })

  it('is the same for a photo whatever its size: the 256-pixel sample and a phone photo both come out 43 wide', () => {
    const small = planGeometry(base({ resolution: 'custom', customWidth: 43, srcW: 256, srcH: 256, origW: 256, origH: 256 }))
    const big = planGeometry(base({ resolution: 'custom', customWidth: 43, srcW: 2016, srcH: 1512, origW: 4032, origH: 3024 }))
    expect([small.width, small.height]).toEqual([43, 43])
    expect([big.width, big.height]).toEqual([43, 32])
  })

  it('is capped, keeping the shape', () => {
    const g = planGeometry(base({ resolution: 'custom', customWidth: 5000 }))
    expect(g.width).toBe(CUSTOM_MAX)
    expect(g.height).toBe(CUSTOM_MAX / 2)
    expect(planGeometry(base({ resolution: 'custom', customWidth: 1 })).width).toBe(CUSTOM_MIN)
  })

  it('never enlarges the photo, and a tall photo keeps its height under the cap', () => {
    expect(customWidthRange({ srcW: 256, srcH: 256, origW: 256, origH: 256 })).toEqual({ min: CUSTOM_MIN, max: 256 })
    const tall = { srcW: 1500, srcH: 2000, origW: 3000, origH: 4000 }
    expect(customWidthRange(tall)).toEqual({ min: CUSTOM_MIN, max: 768 })
    const g = planGeometry(base({ ...tall, resolution: 'custom', customWidth: 2000 }))
    expect([g.width, g.height]).toEqual([768, 1024])
    // A sliver narrower than the smallest width can still be made.
    expect(customWidthRange({ srcW: 4, srcH: 3000, origW: 4, origH: 3000 })).toEqual({ min: 1, max: 1 })
  })
})

describe('coverage', () => {
  it('counts the photo’s own pixels behind each output pixel, past a shrunk working copy', () => {
    const photo = { srcW: 2000, srcH: 1000, origW: 4000, origH: 2000 }
    expect(coverage(planGeometry(base({ resolution: 'custom', customWidth: 400 })), photo)).toEqual([10, 10])
    const [x, y] = coverage(planGeometry(base({})), photo)
    expect(x).toBeCloseTo(2000 / 144, 6)
    expect(y).toBeCloseTo(2000 / 144, 6)
  })

  it('is below 1 when the photo is enlarged', () => {
    const photo = { srcW: 80, srcH: 72, origW: 80, origH: 72 }
    expect(coverage(planGeometry(base({ ...photo })), photo)).toEqual([0.5, 0.5])
  })
})
