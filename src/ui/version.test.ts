import { describe, expect, it } from 'vitest'
import { shownVersion } from './version'

describe('the version the page shows', () => {
  it('leaves off a last .0, as the PC app writes its version', () => {
    expect(shownVersion('1.0.0')).toBe('1.0')
    expect(shownVersion('1.3.0')).toBe('1.3')
    expect(shownVersion('0.10.0')).toBe('0.10')
  })

  it('keeps every other number whole', () => {
    expect(shownVersion('0.9.4')).toBe('0.9.4')
    expect(shownVersion('0.9.2.1')).toBe('0.9.2.1')
    expect(shownVersion('1.0.1')).toBe('1.0.1')
    expect(shownVersion('1.0')).toBe('1.0')
    expect(shownVersion('dev')).toBe('dev')
  })
})
