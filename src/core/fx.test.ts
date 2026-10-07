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

  it('VHS renders PLAY ▶ OSD in retro phosphor green and tracking scanlines', () => {
    // 320×240 preview
    const img = renderFxRgba(src, 320, 240, fx({ screen: 'vhs', vhsOsd: true, vhsTracking: 0.8, curve: 0 }))
    // Check for green OSD pixels in top-left region
    let greenOsdFound = false
    for (let y = 10; y < 40; y++) {
      for (let x = 10; x < 120; x++) {
        const [r, g, b] = at(img, 320, x, y)
        if (g > 200 && r < 50 && b < 80) {
          greenOsdFound = true
          break
        }
      }
      if (greenOsdFound) break
    }
    expect(greenOsdFound).toBe(true)

    // Check tracking noise band at bottom (y >= 225)
    let bottomDiffFound = false
    for (let y = 226; y < 240; y++) {
      for (let x = 0; x < 50; x++) {
        const [r, g, b] = at(img, 320, x, y)
        // Noise or jitter offsets from baseline [20, 20, 20]
        if (r > 60 || g > 60 || b > 60) {
          bottomDiffFound = true
          break
        }
      }
    }
    expect(bottomDiffFound).toBe(true)
  })

  it('NTSC composite causes horizontal chroma smear across transitions', () => {
    // 4×2 picture with red and cyan halves to test chroma difference bleed
    const colorSrc: FxSource = {
      rgb: Uint8Array.from([
        220, 20, 20, 220, 20, 20, 20, 220, 220, 20, 220, 220,
        220, 20, 20, 220, 20, 20, 20, 220, 220, 20, 220, 220
      ]),
      width: 4,
      height: 2,
      paper: [240, 240, 240]
    }
    const plain = renderFxRgba(colorSrc, 64, 32, fx({ screen: 'off' }))
    const comp = renderFxRgba(colorSrc, 64, 32, fx({ screen: 'composite', scanlines: 0, curve: 0 }))
    // Right of the transition (x = 34), chroma from red smears into cyan
    const plainEdge = at(plain, 64, 34, 16)
    const compEdge = at(comp, 64, 34, 16)
    expect(compEdge).not.toEqual(plainEdge)
  })

  it('P1 Green phosphor converts highlights to pure emerald green', () => {
    const img = renderFxRgba(src, 64, 32, fx({ screen: 'p1-green', scanlines: 0, curve: 0, bloom: 0 }))
    const [r, g, b] = at(img, 64, 48, 16) // Light half
    expect(g).toBeGreaterThan(150)
    expect(g).toBeGreaterThan(r * 2)
    expect(g).toBeGreaterThan(b * 2)
  })

  it('P3 Amber phosphor converts highlights to warm orange-gold', () => {
    const img = renderFxRgba(src, 64, 32, fx({ screen: 'p3-amber', scanlines: 0, curve: 0, bloom: 0 }))
    const [r, g, b] = at(img, 64, 48, 16) // Light half
    expect(r).toBeGreaterThan(150)
    expect(r).toBeGreaterThan(g)
    expect(b).toBeLessThan(50)
  })

  it('P4 White phosphor converts highlights to balanced paper-white', () => {
    const img = renderFxRgba(src, 64, 32, fx({ screen: 'p4-white', scanlines: 0, curve: 0, bloom: 0 }))
    const [r, g, b] = at(img, 64, 48, 16) // Light half
    expect(r).toBeGreaterThan(150)
    expect(g).toBeGreaterThan(150)
    expect(b).toBeGreaterThan(150)
    // Closely balanced greyscale
    expect(Math.abs(r - g)).toBeLessThan(30)
    expect(Math.abs(g - b)).toBeLessThan(30)
  })
})
