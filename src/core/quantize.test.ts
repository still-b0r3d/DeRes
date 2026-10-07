import { describe, expect, it } from 'vitest'
import { BYTE_TO_LINEAR, rgbToHex } from './color'
import { quantizeRgb, snapToBits } from './quantize'

describe('snapToBits', () => {
  it('snaps 8-bit values to 2-bit (Master System)', () => {
    // 2-bit values must be only 0, 85, 170, 255
    const allowed = new Set([0, 85, 170, 255])
    for (let i = 0; i <= 255; i++) {
      expect(allowed.has(snapToBits(i, 2))).toBe(true)
    }
    expect(snapToBits(0, 2)).toBe(0)
    expect(snapToBits(128, 2)).toBe(170)
    expect(snapToBits(255, 2)).toBe(255)
  })

  it('snaps 8-bit values to 3-bit (Genesis)', () => {
    const allowed = new Set([0, 36, 73, 109, 146, 182, 219, 255])
    for (let i = 0; i <= 255; i++) {
      expect(allowed.has(snapToBits(i, 3))).toBe(true)
    }
  })

  it('snaps 8-bit values to 4-bit (PC-98)', () => {
    for (let i = 0; i <= 255; i++) {
      const snapped = snapToBits(i, 4)
      expect(snapped % 17).toBe(0) // 255 / 15 = 17
    }
  })

  it('snaps 8-bit values to 5-bit (SNES)', () => {
    const vals = new Set<number>()
    for (let i = 0; i <= 255; i++) {
      vals.add(snapToBits(i, 5))
    }
    expect(vals.size).toBe(32)
  })
})

describe('quantizeRgb', () => {
  function makeRgb(colors: [number, number, number][]): Float32Array {
    const buf = new Float32Array(colors.length * 3)
    for (let i = 0; i < colors.length; i++) {
      buf[i * 3] = BYTE_TO_LINEAR[colors[i][0]]
      buf[i * 3 + 1] = BYTE_TO_LINEAR[colors[i][1]]
      buf[i * 3 + 2] = BYTE_TO_LINEAR[colors[i][2]]
    }
    return buf
  }

  it('reduces a 4-color image to 4 colors', () => {
    const rgb = makeRgb([
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 255]
    ])
    const pal = quantizeRgb(rgb, 4, 8)
    expect(pal.length / 3).toBe(4)
  })

  it('respects target count and snaps to 2-bit channel grid', () => {
    const pixels: [number, number, number][] = []
    for (let i = 0; i < 1000; i++) {
      pixels.push([(i * 7) % 256, (i * 13) % 256, (i * 29) % 256])
    }
    const rgb = makeRgb(pixels)
    const pal = quantizeRgb(rgb, 16, 2)
    expect(pal.length / 3).toBeLessThanOrEqual(16)
    const allowed = new Set([0, 85, 170, 255])
    for (let i = 0; i < pal.length; i++) {
      expect(allowed.has(pal[i])).toBe(true)
    }
  })

  it('is deterministic: same input produces exact same output', () => {
    const pixels: [number, number, number][] = []
    for (let i = 0; i < 500; i++) {
      pixels.push([i % 256, (i * 3) % 256, (i * 5) % 256])
    }
    const rgb = makeRgb(pixels)
    const pal1 = quantizeRgb(rgb, 8, 3)
    const pal2 = quantizeRgb(rgb, 8, 3)
    expect(Array.from(pal1)).toEqual(Array.from(pal2))
  })
})

describe('quantizeFromPool', () => {
  it('selects at most targetCount colors strictly from the provided pool', async () => {
    const { quantizeFromPool } = await import('./quantize')
    const pool = ['#000000', '#ff0000', '#00ff00', '#0000ff', '#ffffff']
    const rgb = new Float32Array(100 * 3)
    for (let i = 0; i < 100; i++) {
      rgb[i * 3] = i / 100 // reds
    }
    const selected = quantizeFromPool(rgb, pool, 3)
    const colorCount = selected.length / 3
    expect(colorCount).toBeLessThanOrEqual(3)
    for (let i = 0; i < colorCount; i++) {
      const hex = rgbToHex(selected[i * 3], selected[i * 3 + 1], selected[i * 3 + 2])
      expect(pool).toContain(hex)
    }
  })

  it('returns all pool colors if pool size is less than or equal to targetCount', async () => {
    const { quantizeFromPool } = await import('./quantize')
    const pool = ['#111111', '#222222']
    const rgb = new Float32Array(10 * 3)
    const selected = quantizeFromPool(rgb, pool, 4)
    expect(selected.length / 3).toBe(2)
    expect(rgbToHex(selected[0], selected[1], selected[2])).toBe('#111111')
    expect(rgbToHex(selected[3], selected[4], selected[5])).toBe('#222222')
  })
})
