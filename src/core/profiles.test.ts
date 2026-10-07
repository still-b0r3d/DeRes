import { describe, expect, it } from 'vitest'
import { DITHERS } from './dither'
import { DEFAULT_PROFILE, PROFILES, profileById } from './profiles'

describe('hardware profiles', () => {
  it('have unique ids and a valid default', () => {
    expect(new Set(PROFILES.map((p) => p.id)).size).toBe(PROFILES.length)
    expect(profileById(DEFAULT_PROFILE)).toBeDefined()
    expect(profileById('nope')).toBeUndefined()
  })

  it.each(PROFILES.map((p) => [p.id, p] as const))('%s is well formed', (_id, p) => {
    const colours = p.palette.colours
    expect(colours.length).toBeGreaterThanOrEqual(2)
    expect(colours.length).toBeLessThanOrEqual(256)
    for (const c of colours) expect(c).toMatch(/^#[0-9a-f]{6}$/)
    expect(new Set(colours).size).toBe(colours.length)
    expect(p.width).toBeGreaterThan(0)
    if (p.height !== 'auto') expect(p.height).toBeGreaterThan(0)
    expect(p.par.every((n) => Number.isInteger(n) && n > 0)).toBe(true)
    const ids = DITHERS.map((d) => d.id)
    expect(ids).toContain(p.dither)
    // A machine's own dither is only its default if it really has it.
    const native = DITHERS.filter((d) => d.native).map((d) => d.id)
    if (native.includes(p.dither)) expect(p.nativeDither).toBe(p.dither)
  })

  it('carries the right sizes for the well-known machines', () => {
    const size = (id: string) => {
      const p = profileById(id)!
      return [p.width, p.height, p.palette.colours.length]
    }
    expect(size('gameboy')).toEqual([160, 144, 4])
    expect(size('gameboy-camera')).toEqual([128, 112, 4])
    expect(size('cga-1')).toEqual([320, 200, 4])
    expect(size('ega')).toEqual([320, 200, 16])
    expect(size('c64-hires')).toEqual([320, 200, 16])
    expect(size('nes')).toEqual([256, 240, 55])
    expect(size('pico8')).toEqual([128, 128, 16])
    expect(size('atari-2600')).toEqual([160, 192, 128])
    expect(size('apple2-lores')).toEqual([40, 48, 15])
    expect(size('mac')).toEqual([512, 342, 2])
    expect(size('web-safe')).toEqual([640, 480, 216])
    expect(size('receipt')).toEqual([384, 'auto', 2])
  })

  it('includes the b0r3d colours', () => {
    expect(profileById('b0r3d')!.palette.colours).toEqual(['#131313', '#00ffff', '#ff00ff', '#00ff9d'])
  })
})
