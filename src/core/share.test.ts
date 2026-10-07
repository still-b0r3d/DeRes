import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../ui/settings'
import { decodeSettings, encodeSettings } from './share'

describe('share link encoding/decoding', () => {
  it('encodes and decodes default settings', () => {
    const s = defaultSettings()
    const hash = encodeSettings(s)
    expect(hash.startsWith('#s=')).toBe(true)

    const decoded = decodeSettings(hash)
    expect(decoded).not.toBeNull()
    expect(decoded?.profileId).toBe(s.profileId)
    expect(decoded?.dither).toBe(s.dither)
    expect(decoded?.multiplier).toBe(s.multiplier)
  })

  it('preserves adjustments, fx, and custom palette', () => {
    const s = defaultSettings()
    s.profileId = 'snes'
    s.dither = 'floyd'
    s.adjust.brightness = 0.2
    s.adjust.contrast = 1.5
    s.customPalette = ['#000000', '#ffffff', '#ff0000']
    s.customCount = 32

    const hash = encodeSettings(s)
    const decoded = decodeSettings(hash)

    expect(decoded?.profileId).toBe('snes')
    expect(decoded?.adjust?.brightness).toBeCloseTo(0.2)
    expect(decoded?.adjust?.contrast).toBeCloseTo(1.5)
    expect(decoded?.customPalette).toEqual(['#000000', '#ffffff', '#ff0000'])
    expect(decoded?.customCount).toBe(32)
  })

  it('returns null on corrupted hash', () => {
    expect(decodeSettings('#s=invalid-not-json')).toBeNull()
    expect(decodeSettings('')).toBeNull()
  })
})
