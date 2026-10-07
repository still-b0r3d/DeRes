import { describe, expect, it } from 'vitest'
import { DEFAULT_FX, renderFxRgba, type Fx, type FxSource } from './fx'

// 4×2 picture: dark and light halves.
const src: FxSource = {
  rgb: Uint8Array.from([
    20, 20, 20, 20, 20, 20, 220, 220, 220, 220, 220, 220,
    20, 20, 20, 20, 20, 20, 220, 220, 220, 220, 220, 220
  ]),
  width: 4,
  height: 2,
  paper: [240, 240, 240]
}
const fx = (over: Partial<Fx>): Fx => ({ ...DEFAULT_FX, ...over })
const at = (img: Uint8ClampedArray, w: number, x: number, y: number) => [...img.subarray((y * w + x) * 4, (y * w + x) * 4 + 3)]

describe('screen effects', () => {
  it('"off" is a plain nearest-neighbour enlargement', () => {
    const img = renderFxRgba(src, 16, 8, fx({ screen: 'off' }))
    expect(img.length).toBe(16 * 8 * 4)
    expect(at(img, 16, 0, 0)).toEqual([20, 20, 20])
    expect(at(img, 16, 15, 7)).toEqual([220, 220, 220])
  })

  it('scanlines darken between rows more than through them', () => {
    const img = renderFxRgba(src, 32, 16, fx({ screen: 'crt', mask: 'none', curve: 0, bloom: 0, scanlines: 1 }))
    // Picture rows are 8 output rows tall: compare a row's middle and edge.
    const middle = at(img, 32, 4, 4)[0]
    const edge = at(img, 32, 4, 0)[0]
    expect(middle).toBeGreaterThan(edge)
  })

  it('an aperture grille tints neighbouring columns red, green, blue', () => {
    const img = renderFxRgba(src, 24, 12, fx({ screen: 'crt', mask: 'grille', curve: 0, bloom: 0, scanlines: 0 }))
    const [r0, g0] = at(img, 24, 18, 6)
    const [r1, g1] = at(img, 24, 19, 6)
    expect(r0).toBeGreaterThan(g0)
    expect(g1).toBeGreaterThan(r1)
  })

  it('curvature blacks out the corners', () => {
    const img = renderFxRgba(src, 40, 20, fx({ screen: 'crt', curve: 1, bloom: 0 }))
    expect(at(img, 40, 0, 0)).toEqual([0, 0, 0])
  })

  it('the LCD grid lightens the gaps between pixels, towards the paper colour', () => {
    const img = renderFxRgba(src, 16, 8, fx({ screen: 'lcd', grid: 1, ghost: 0 }))
    // Output pixel (0,0) is a gap; (1,1) is inside the first dark pixel.
    expect(at(img, 16, 0, 0)[0]).toBeGreaterThan(at(img, 16, 1, 1)[0])
  })

  it('LCD ghosting casts dark pixels onto light neighbours', () => {
    const plain = renderFxRgba(src, 16, 8, fx({ screen: 'lcd', grid: 0, ghost: 0 }))
    const ghosted = renderFxRgba(src, 16, 8, fx({ screen: 'lcd', grid: 0, ghost: 1 }))
    // Just right of the dark/light border.
    expect(at(ghosted, 16, 8, 3)[0]).toBeLessThan(at(plain, 16, 8, 3)[0])
  })
})
