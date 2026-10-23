import { describe, expect, it } from 'vitest'
import { coverage, planGeometry } from '../core/geometry'
import { profileById } from '../core/profiles'
import { resolutionText } from './controls'

// What the line under Resolution says, for the Rukus sample (256×256) unless
// a photo is given.
function text(id: string, custom: boolean, customWidth?: number, photo = { srcW: 256, srcH: 256, origW: 256, origH: 256 }): string {
  const p = profileById(id)!
  const g = planGeometry({ ...photo, profile: p, resolution: custom ? 'custom' : 'native', customWidth, fit: 'fill' })
  return resolutionText(p, custom, g, coverage(g, photo))
}

describe('the resolution line', () => {
  it('names the machine’s own size and how much of the photo goes into each pixel', () => {
    expect(text('gameboy', false)).toBe('Game Boy: 160×144 pixels. Each pixel averages 1.6 × 1.6 of your photo’s pixels.')
  })

  it('puts a custom size against the machine’s width', () => {
    expect(text('gameboy', true, 43)).toBe(
      'Game Boy: 160×144 pixels. Yours: 43×43, 27% of its width. Each pixel averages 6 × 6 of your photo’s pixels.'
    )
    expect(text('gameboy', true)).toContain('Yours: 160×160, the same width.')
    const phone = { srcW: 2016, srcH: 1512, origW: 4032, origH: 3024 }
    expect(text('gameboy', true, 400, phone)).toContain('Yours: 400×300, 2.5× its width. Each pixel averages 10.1 × 10.1')
  })

  it('says when the pixels aren’t square, and when the photo is enlarged', () => {
    expect(text('vga', false)).toBe('VGA 256: 320×200 pixels, each taller than wide. Your photo is smaller, so it’s enlarged 1.1×.')
  })

  it('has no photo part without a photo', () => {
    expect(resolutionText(profileById('gameboy')!, false, null, null)).toBe('Game Boy: 160×144 pixels.')
  })
})
