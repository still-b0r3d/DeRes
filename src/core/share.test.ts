import { describe, expect, it } from 'vitest'
import { defaultSettings, settingsFromHash } from '../ui/settings'
import { decodeSettings, encodeSettings } from './share'

const link = (raw: object) => `#s=${Buffer.from(JSON.stringify(raw)).toString('base64url')}`

describe('share link encoding/decoding', () => {
  it('encodes and decodes default settings', () => {
    const s = defaultSettings()
    const hash = encodeSettings(s)
    expect(hash.startsWith('#s=')).toBe(true)

    const decoded = settingsFromHash(hash, defaultSettings())
    expect(decoded).not.toBeNull()
    expect(decoded?.profileId).toBe(s.profileId)
    expect(decoded?.dither).toBe(s.dither)
    expect(decoded?.multiplier).toBe(s.multiplier)
  })

  it('preserves adjustments, fx, and custom palette', () => {
    const s = defaultSettings()
    s.profileId = 'custom'
    s.dither = 'floyd'
    s.adjust.brightness = 0.2
    s.adjust.contrast = 1.5
    s.customPalette = ['#000000', '#ffffff', '#ff0000']
    s.customCount = 32

    const decoded = settingsFromHash(encodeSettings(s), defaultSettings())

    expect(decoded?.profileId).toBe('custom')
    expect(decoded?.adjust?.brightness).toBeCloseTo(0.2)
    expect(decoded?.adjust?.contrast).toBeCloseTo(1.5)
    expect(decoded?.customPalette).toEqual(['#000000', '#ffffff', '#ff0000'])
    expect(decoded?.customCount).toBe(32)
  })

  it('returns null on corrupted hash', () => {
    expect(decodeSettings('#s=invalid-not-json')).toBeNull()
    expect(decodeSettings('')).toBeNull()
    expect(settingsFromHash('#s=invalid-not-json', defaultSettings())).toBeNull()
  })
})

describe('share links are checked like saved settings', () => {
  it('a link from a newer version (or a typo) never breaks the page: odd values keep the current ones', () => {
    const base = defaultSettings()
    const s = settingsFromHash(
      link({
        p: 'future-machine',
        d: 'quantum',
        f: 'zoom',
        r: 'huge',
        b: 0,
        bg: 'plaid',
        ps: 'round',
        m: 9999,
        cc: 100000,
        a: [9, -3, 'x', 0],
        fx: ['hologram', 'dots', 5, -1, 'a', null, 2, 7, 'no']
      }),
      base
    )!
    expect(s.profileId).toBe(base.profileId)
    expect(s.dither).toBe(base.dither)
    expect(s.fit).toBe(base.fit)
    expect(s.resolution).toBe(base.resolution)
    expect(s.block).toBe(2)
    expect(s.background).toBe(base.background)
    expect(s.pixelShape).toBe(base.pixelShape)
    expect(s.multiplier).toBe(base.multiplier)
    expect(s.customCount).toBe(256)
    expect(s.adjust).toEqual({ brightness: 0.5, contrast: 0, saturation: 1, gamma: 0.4 })
    expect(s.fx.screen).toBe(base.fx.screen)
    expect(s.fx.mask).toBe(base.fx.mask)
    expect(s.fx.scanlines).toBe(1)
    expect(s.fx.curve).toBe(0)
    expect(s.fx.bloom).toBe(base.fx.bloom)
    expect(s.fx.vhsTracking).toBe(1)
    expect(s.fx.vhsOsd).toBe(base.fx.vhsOsd)
  })

  it('only real colours make it into a palette, and never more than 256', () => {
    const many = Array.from({ length: 300 }, (_, i) => `#${(i * 4567).toString(16).padStart(6, '0').slice(-6)}`)
    const s = settingsFromHash(link({ p: 'custom', cp: ['#ff0000', 'red', '#12345', 42, '#00FF00', ...many] }), defaultSettings())!
    expect(s.customPalette!.slice(0, 2)).toEqual(['#ff0000', '#00FF00'])
    expect(s.customPalette!.length).toBe(256)
    const none = settingsFromHash(link({ p: 'custom', cp: ['nope'] }), defaultSettings())!
    expect(none.customPalette).toBeUndefined()
  })

  it('the VHS settings make the round trip too', () => {
    const s = defaultSettings()
    s.profileId = 'vhs'
    s.fx = { ...s.fx, screen: 'vhs', vhsTracking: 0.3, vhsOsd: false }
    const back = settingsFromHash(encodeSettings(s), defaultSettings())!
    expect(back.fx).toEqual(s.fx)
  })
})
