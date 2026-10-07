import { describe, expect, it } from 'vitest'
import { baseName, exportFilename } from './filename'

describe('export file names', () => {
  it('cleans up the photo name', () => {
    expect(baseName('IMG_2041.HEIC')).toBe('img-2041')
    expect(baseName('Café au lait (2).jpeg')).toBe('cafe-au-lait-2')
    expect(baseName('...png')).toBe('photo')
    expect(baseName('')).toBe('photo')
    expect(baseName('a'.repeat(80) + '.png')).toHaveLength(40)
  })

  it('says what is inside', () => {
    const name = { base: 'photo', profileId: 'snes', width: 256, height: 224, multiplier: 4, tv: false, fx: false }
    expect(exportFilename(name)).toBe('photo-snes-256x224-4x.png')
    expect(exportFilename({ ...name, tv: true, fx: true })).toBe('photo-snes-256x224-4x-tv-fx.png')
  })
})
