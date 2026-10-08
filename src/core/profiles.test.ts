import { describe, expect, it } from 'vitest'
import { DITHERS } from './dither'
import { DEFAULT_PROFILE, PROFILES, profileById, representativePalette } from './profiles'

describe('hardware profiles', () => {
  it('have unique ids and a valid default', () => {
    expect(new Set(PROFILES.map((p) => p.id)).size).toBe(PROFILES.length)
    expect(profileById(DEFAULT_PROFILE)).toBeDefined()
    expect(profileById('nope')).toBeUndefined()
  })

  it.each(PROFILES.map((p) => [p.id, p] as const))('%s is well formed', (_id, p) => {
    const colours = representativePalette(p.palette)
    expect(colours.length).toBeGreaterThanOrEqual(2)
    expect(colours.length).toBeLessThanOrEqual(256)
    for (const c of colours) expect(c).toMatch(/^#[0-9a-f]{6}$/)
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
      const count = p.palette.kind === 'fixed' ? p.palette.colours.length : (p.palette.kind === 'range' ? p.palette.count : 32)
      return [p.width, p.height, count]
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
    expect(size('snes')).toEqual([256, 224, 256])
    expect(size('genesis')).toEqual([320, 224, 61])
    expect(size('mastersystem')).toEqual([256, 192, 32])
    expect(size('pc98')).toEqual([640, 400, 16])
    expect(size('vga')).toEqual([320, 200, 256])
    expect(size('ps1')).toEqual([320, 240, 32])
    expect(size('nokia-3310')).toEqual([84, 48, 2])
    expect(size('gbc')).toEqual([160, 144, 32])
    expect(size('virtualboy')).toEqual([384, 224, 4])
    expect(size('atari-st')).toEqual([320, 200, 16])
    expect(size('amstrad-cpc-0')).toEqual([160, 200, 32])
    expect(size('amstrad-cpc-1')).toEqual([320, 200, 32])
    expect(size('msx-screen2')).toEqual([256, 192, 32])
    expect(size('cga-composite')).toEqual([320, 200, 16])
    expect(profileById('digipal')).toBeUndefined()
  })

  it('includes the b0r3d colours', () => {
    const p = profileById('b0r3d')!
    expect(p.palette.kind === 'fixed' && p.palette.colours).toEqual(['#131313', '#00ffff', '#ff00ff', '#00ff9d'])
  })

  it('configures v0.7.0 specific profile constraints', () => {
    const nokia = profileById('nokia-3310')!
    expect(nokia.screen).toBe('lcd')
    expect(nokia.mono).toBe(true)

    const vb = profileById('virtualboy')!
    expect(vb.screen).toBe('crt')
    expect(vb.palette.kind === 'fixed' && vb.palette.colours.length).toBe(4)

    const ast = profileById('atari-st')!
    expect(ast.par).toEqual([5, 6])
    expect(ast.palette.kind).toBe('range')

    const cpc0 = profileById('amstrad-cpc-0')!
    expect(cpc0.par).toEqual([2, 1])
    expect(cpc0.palette.kind).toBe('pool')

    const msx = profileById('msx-screen2')!
    expect(msx.palette.kind).toBe('cell')

    const gbc = profileById('gbc')!
    expect(gbc.palette.kind).toBe('cell')
    expect(gbc.limits?.emulatorFormats).toContain('chr')
  })
})
