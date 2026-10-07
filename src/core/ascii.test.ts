import { describe, expect, it } from 'vitest'
import {
  exportPetsciiPrg,
  exportPetsciiSeq,
  exportTeletextPage,
  generateAscii,
  luminance,
  matchAnsi16,
  toAnsiBytes,
  toAnsiText,
  toHtml,
  toMarkdown,
  toPlainText
} from './ascii'
import { parseSauce } from './sauce'

describe('ASCII & ANSI engine', () => {
  it('calculates correct luminance for primary colors', () => {
    expect(luminance(0, 0, 0)).toBe(0)
    expect(luminance(255, 255, 255)).toBeCloseTo(1, 3)
    // Green has highest perceived luminance in Rec.709
    expect(luminance(0, 255, 0)).toBeGreaterThan(luminance(255, 0, 0))
    expect(luminance(255, 0, 0)).toBeGreaterThan(luminance(0, 0, 255))
  })

  it('matches primary colors to authentic ANSI 16 palette indices', () => {
    expect(matchAnsi16(0, 0, 0)).toBe(0) // Black
    expect(matchAnsi16(0, 0, 255)).toBe(9) // Light Blue or Blue (1 or 9)
    expect(matchAnsi16(0, 255, 0)).toBe(10) // Light Green
    expect(matchAnsi16(255, 0, 0)).toBe(12) // Light Red
    expect(matchAnsi16(255, 255, 255)).toBe(15) // Bright White
  })

  it('generates half-block ANSI art with 2:1 cell aspect ratio', () => {
    // 4x4 image: top 2 rows red, bottom 2 rows blue
    const w = 4
    const h = 4
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4
        if (y < 2) {
          rgba[idx] = 255 // Red
          rgba[idx + 1] = 0
          rgba[idx + 2] = 0
        } else {
          rgba[idx] = 0
          rgba[idx + 1] = 0
          rgba[idx + 2] = 255 // Blue
        }
        rgba[idx + 3] = 255
      }
    }

    const res = generateAscii(rgba, w, h, {
      mode: 'half-block',
      columns: 4,
      colorMode: 'ansi16'
    })

    expect(res.width).toBe(4)
    expect(res.height).toBe(2) // 4 pixels high = 2 half-block character rows
    expect(res.cells.length).toBe(2)
    expect(res.cells[0].length).toBe(4)

    // First row: top pixel is red, bottom pixel is red
    expect(res.cells[0][0].char).toBe('▀')
    expect(res.cells[0][0].fgAnsi).toBe(12) // Light Red
    expect(res.cells[0][0].bgAnsi).toBe(12) // Light Red

    // Second row: top pixel is blue, bottom pixel is blue
    expect(res.cells[1][0].char).toBe('▀')
    expect(res.cells[1][0].fgAnsi).toBe(9) // Light Blue
    expect(res.cells[1][0].bgAnsi).toBe(9) // Light Blue
  })

  it('generates character ramp ASCII art with luminance density mapping', () => {
    // Horizontal gradient: left black, right white
    const w = 10
    const h = 10
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4
        const val = Math.round((x / (w - 1)) * 255)
        rgba[idx] = val
        rgba[idx + 1] = val
        rgba[idx + 2] = val
        rgba[idx + 3] = 255
      }
    }

    const res = generateAscii(rgba, w, h, {
      mode: 'ramp',
      columns: 10,
      rampPreset: 'standard', // ' .:-=+*#%@'
      twoToOneAspect: true
    })

    expect(res.width).toBe(10)
    // 2:1 ratio for 10x10 square image gives 5 rows
    expect(res.height).toBe(5)

    const firstRow = res.cells[0].map((c) => c.char).join('')
    // First char should be space (black)
    expect(firstRow[0]).toBe(' ')
    // Last char should be @ (white)
    expect(firstRow[firstRow.length - 1]).toBe('@')
  })

  it('inverts character ramp when invertRamp is true', () => {
    const w = 10
    const h = 10
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = 0 // Black
      rgba[i * 4 + 1] = 0
      rgba[i * 4 + 2] = 0
      rgba[i * 4 + 3] = 255
    }

    const normal = generateAscii(rgba, w, h, {
      mode: 'ramp',
      columns: 10,
      rampPreset: 'standard',
      invertRamp: false
    })
    const inverted = generateAscii(rgba, w, h, {
      mode: 'ramp',
      columns: 10,
      rampPreset: 'standard',
      invertRamp: true
    })

    expect(normal.cells[0][0].char).toBe(' ')
    expect(inverted.cells[0][0].char).toBe('@')
  })

  it('exports plain text and markdown representations', () => {
    const w = 2
    const h = 2
    const rgba = new Uint8ClampedArray(w * h * 4).fill(255)
    const res = generateAscii(rgba, w, h, {
      mode: 'ramp',
      columns: 2,
      rampPreset: 'binary', // ' 01'
      twoToOneAspect: false
    })

    const text = toPlainText(res)
    expect(text.includes('\n')).toBe(true)

    const md = toMarkdown(res)
    expect(md.startsWith('```text\n')).toBe(true)
    expect(md.endsWith('\n```')).toBe(true)
  })

  it('exports terminal ANSI escape sequences with color tags', () => {
    const w = 2
    const h = 2
    const rgba = new Uint8ClampedArray(w * h * 4)
    // Pixel 0: Red, Pixel 1: Blue
    rgba[0] = 255; rgba[1] = 0; rgba[2] = 0; rgba[3] = 255
    rgba[4] = 0; rgba[5] = 0; rgba[6] = 255; rgba[7] = 255
    // Row 2: Green, Green
    rgba[8] = 0; rgba[9] = 255; rgba[10] = 0; rgba[11] = 255
    rgba[12] = 0; rgba[13] = 255; rgba[14] = 0; rgba[15] = 255

    const res = generateAscii(rgba, w, h, {
      mode: 'half-block',
      columns: 2,
      colorMode: 'ansi16'
    })

    const ansi = toAnsiText(res)
    expect(ansi).toContain('\x1b[')
    expect(ansi).toContain('\x1b[0m')
  })

  it('exports HTML with formatted style spans', () => {
    const w = 2
    const h = 2
    const rgba = new Uint8ClampedArray(w * h * 4).fill(255)
    const res = generateAscii(rgba, w, h, {
      mode: 'half-block',
      columns: 2,
      colorMode: 'ansi16'
    })

    const html = toHtml(res)
    expect(html.startsWith('<pre')).toBe(true)
    expect(html).toContain('<span style="color:#ffffff;background-color:#ffffff">')
    expect(html.endsWith('</pre>')).toBe(true)
  })

  it('exports CP437 .ans bytes with attached SAUCE record', () => {
    const w = 4
    const h = 4
    const rgba = new Uint8ClampedArray(w * h * 4).fill(255)
    const res = generateAscii(rgba, w, h, {
      mode: 'half-block',
      columns: 4,
      colorMode: 'ansi16'
    })

    const ansBytes = toAnsiBytes(res, {
      title: 'Test ANSI',
      author: 'still_b0r3d'
    })

    // Check CP437 byte 0xDF for '▀'
    expect(ansBytes).toContain(0xdf)
    // Check CRLF (0x0D, 0x0A)
    expect(ansBytes).toContain(0x0d)
    expect(ansBytes).toContain(0x0a)

    // Verify SAUCE record
    const sauce = parseSauce(ansBytes)
    expect(sauce).not.toBeNull()
    expect(sauce?.title).toBe('Test ANSI')
    expect(sauce?.author).toBe('still_b0r3d')
    expect(sauce?.tInfo1).toBe(4)
    expect(sauce?.fontName).toBe('IBM VGA')
  })

  it('generates PETSCII Commodore 64 art and exports to .seq and .prg', () => {
    const w = 8
    const h = 8
    const rgba = new Uint8ClampedArray(w * h * 4).fill(255) // Solid white
    const res = generateAscii(rgba, w, h, {
      mode: 'petscii',
      columns: 4,
      colorMode: 'c64'
    })

    expect(res.width).toBe(4)
    expect(res.settings.mode).toBe('petscii')
    expect(res.cells.length).toBeGreaterThan(0)

    // Export .seq
    const seq = exportPetsciiSeq(res)
    expect(seq.length).toBeGreaterThan(0)
    // Check PETSCII carriage return (0x0D)
    expect(seq).toContain(0x0d)

    // Export .prg (2 + 1000 + 1000 = 2002 bytes)
    const prg = exportPetsciiPrg(res)
    expect(prg.length).toBe(2002)
    // C64 screen RAM load address $0400 (0x00, 0x04)
    expect(prg[0]).toBe(0x00)
    expect(prg[1]).toBe(0x04)
  })

  it('generates Ceefax Teletext 2x3 mosaic art and exports page', () => {
    const w = 6
    const h = 9
    const rgba = new Uint8ClampedArray(w * h * 4).fill(255) // White
    const res = generateAscii(rgba, w, h, {
      mode: 'teletext',
      columns: 3,
      colorMode: 'teletext',
      teletextHeader: true
    })

    expect(res.width).toBe(3)
    // With header enabled, row 0 contains Teletext broadcast title
    expect(res.cells.length).toBeGreaterThan(1)
    const headerLine = res.cells[0].map((c) => c.char).join('')
    expect(headerLine).toBe('P10')

    const page = exportTeletextPage(res)
    expect(page.includes('\n')).toBe(true)
    expect(page.length).toBeGreaterThan(0)
  })
})

