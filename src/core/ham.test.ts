import { describe, expect, it } from 'vitest'
import { processAmigaHam6 } from './ham'
import { linearToByte, srgbToLinear } from './color'

describe('Amiga HAM6 processing', () => {
  it('correctly holds and modifies channels across a scanline', () => {
    const w = 4
    const h = 2
    const rgb = new Float32Array(w * h * 3)

    // Smooth gradient across 4 pixels
    for (let x = 0; x < 4; x++) {
      rgb[x * 3] = srgbToLinear(x * 60)
      rgb[x * 3 + 1] = srgbToLinear(x * 40)
      rgb[x * 3 + 2] = srgbToLinear(x * 80)
    }

    const res = processAmigaHam6(rgb, w, h)
    expect(res.indices.length).toBe(w * h)
    expect(res.rgb.length).toBe(w * h * 3)
    expect(res.palette.length).toBe(48)
    expect(res.usedColours).toBeGreaterThan(0)

    // First pixel of each row must be a base palette colour (index < 16)
    expect(res.indices[0]).toBeLessThan(16)
    expect(res.indices[w]).toBeLessThan(16)
  })

  it('all output colors snap to 4 bits per channel (12-bit RGB)', () => {
    const w = 8
    const h = 8
    const rgb = new Float32Array(w * h * 3)
    for (let i = 0; i < w * h * 3; i++) rgb[i] = Math.random()

    const res = processAmigaHam6(rgb, w, h)
    for (let i = 0; i < w * h; i++) {
      const r8 = linearToByte(res.rgb[i * 3])
      const g8 = linearToByte(res.rgb[i * 3 + 1])
      const b8 = linearToByte(res.rgb[i * 3 + 2])

      // Each 8-bit channel must be an integer multiple of 255/15 = 17
      expect(r8 % 17).toBe(0)
      expect(g8 % 17).toBe(0)
      expect(b8 % 17).toBe(0)
    }
  })
})
