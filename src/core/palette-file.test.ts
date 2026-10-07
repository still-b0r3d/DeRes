import { describe, expect, it } from 'vitest'
import {
  exportPaletteGpl,
  exportPaletteHex,
  exportPaletteJasc,
  exportPalettePng,
  parsePalettePng,
  parsePaletteText
} from './palette-file'

describe('parsePaletteText', () => {
  it('parses .hex format (with and without hash, 3-char and 6-char)', () => {
    const text = `#00ffff\nff00ff\n#0f0\n;comment\n`
    const colors = parsePaletteText(text)
    expect(colors).toEqual(['#00ffff', '#ff00ff', '#00ff00'])
  })

  it('parses JASC-PAL format', () => {
    const text = `JASC-PAL\r\n0100\r\n3\r\n0 0 0\r\n255 0 128\r\n255 255 255\r\n`
    const colors = parsePaletteText(text)
    expect(colors).toEqual(['#000000', '#ff0080', '#ffffff'])
  })

  it('parses GIMP .gpl format', () => {
    const text = `GIMP Palette\nName: Test\nColumns: 4\n# Comment\n  0   0   0 Black\n255 255   0 Yellow\n`
    const colors = parsePaletteText(text)
    expect(colors).toEqual(['#000000', '#ffff00'])
  })
})

describe('export and round-trip', () => {
  const sample = ['#081820', '#346856', '#88c070', '#e0f8d0']

  it('round-trips .hex', () => {
    const hex = exportPaletteHex(sample)
    expect(parsePaletteText(hex)).toEqual(sample)
  })

  it('round-trips JASC-PAL', () => {
    const jasc = exportPaletteJasc(sample)
    expect(parsePaletteText(jasc)).toEqual(sample)
  })

  it('round-trips GIMP .gpl', () => {
    const gpl = exportPaletteGpl(sample)
    expect(parsePaletteText(gpl)).toEqual(sample)
  })

  it('round-trips palette PNG', async () => {
    const pngBytes = await exportPalettePng(sample)
    const parsed = await parsePalettePng(pngBytes)
    expect(parsed).toEqual(sample)
  })
})
