import { describe, expect, it } from 'vitest'
import { DEFAULT_ASCII_SETTINGS } from '../core/ascii'
import { checkAsciiSettings } from './ascii-settings'

describe('saved ASCII settings', () => {
  it('keep every good value', () => {
    const good = {
      mode: 'ramp',
      columns: 132,
      rampPreset: 'detailed',
      customRamp: ' .oO@',
      invertRamp: true,
      colorMode: 'green',
      contrast: 40,
      brightness: -20,
      gamma: 1.4,
      twoToOneAspect: false,
      teletextSeparated: true,
      teletextHeader: false
    }
    expect(checkAsciiSettings(good)).toEqual(good)
  })

  it('fall back field by field, so one bad value can’t break the tab', () => {
    const out = checkAsciiSettings({ mode: 'nope', columns: 'lots', gamma: 99, contrast: -500, colorMode: 7, invertRamp: 'yes', rampPreset: 'custom' })
    expect(out).toEqual({ ...DEFAULT_ASCII_SETTINGS, gamma: 2.5, contrast: -100, rampPreset: 'custom' })
    expect(checkAsciiSettings(null)).toEqual(DEFAULT_ASCII_SETTINGS)
    expect(checkAsciiSettings('garbage')).toEqual(DEFAULT_ASCII_SETTINGS)
    expect(checkAsciiSettings({ columns: Infinity, brightness: NaN })).toEqual(DEFAULT_ASCII_SETTINGS)
  })

  it('round columns, and cut a ramp that runs on', () => {
    expect(checkAsciiSettings({ columns: 81.6 }).columns).toBe(82)
    expect(checkAsciiSettings({ columns: 5 }).columns).toBe(20)
    expect([...checkAsciiSettings({ customRamp: '█'.repeat(1000) }).customRamp!]).toHaveLength(256)
  })
})
