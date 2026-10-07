import { describe, expect, it } from 'vitest'
import { checkN64Tmem, processN64 } from './n64'

describe('Nintendo 64 processing', () => {
  it('correctly calculates TMEM sizes against 4 KB limit', () => {
    // 32×32 RGBA16 = 2048 bytes -> fits
    const t1 = checkN64Tmem(32, 32, 'rgba16')
    expect(t1.bytes).toBe(2048)
    expect(t1.fits).toBe(true)

    // 64×64 RGBA16 = 8192 bytes -> exceeds
    const t2 = checkN64Tmem(64, 64, 'rgba16')
    expect(t2.bytes).toBe(8192)
    expect(t2.fits).toBe(false)

    // 64×64 CI8 (8-bit) = 4096 bytes -> exactly fits
    const t3 = checkN64Tmem(64, 64, 'ci8')
    expect(t3.bytes).toBe(4096)
    expect(t3.fits).toBe(true)

    // 64×32 RGBA16 = 4096 bytes -> exactly fits
    const t4 = checkN64Tmem(64, 32, 'rgba16')
    expect(t4.bytes).toBe(4096)
    expect(t4.fits).toBe(true)
  })

  it('applies 3-point sample smoothing to the output', () => {
    const w = 8
    const h = 8
    const rgb = new Float32Array(w * h * 3)

    // Center impulse (white pixel on black background)
    rgb[(4 * w + 4) * 3] = 1.0
    rgb[(4 * w + 4) * 3 + 1] = 1.0
    rgb[(4 * w + 4) * 3 + 2] = 1.0

    const res = processN64(rgb, w, h)
    expect(res.indices.length).toBe(w * h)
    expect(res.rgb.length).toBe(w * h * 3)

    // Neighbors should receive diffused intensity
    const centerVal = res.rgb[(4 * w + 4) * 3]
    const rightVal = res.rgb[(4 * w + 5) * 3]
    expect(centerVal).toBeGreaterThan(0)
    expect(rightVal).toBeGreaterThan(0)
  })
})
