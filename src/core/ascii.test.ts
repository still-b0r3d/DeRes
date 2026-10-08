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
  toPlainText,
  PETSCII_SCREEN_CODES,
  petsciiScreen,
  TELETEXT_MOSAICS
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

    expect(res.width).toBe(40) // a C64 screen is 40 columns, whatever columns says
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


describe('Teletext mosaic characters', () => {
  it('all 64 shapes map to the right Unicode character', () => {
    // Bits: 0 top-left, 1 top-right, 2 middle-left, 3 middle-right, 4 bottom-left, 5 bottom-right.
    // Unicode's sextants (U+1FB00…U+1FB3B) run in mask order but leave out the
    // shapes that already had characters: empty, left half (21), right half (42), full.
    expect(TELETEXT_MOSAICS.length).toBe(64)
    expect(TELETEXT_MOSAICS[0]).toBe(' ')
    expect(TELETEXT_MOSAICS[21]).toBe('▌')
    expect(TELETEXT_MOSAICS[42]).toBe('▐')
    expect(TELETEXT_MOSAICS[63]).toBe('█')
    const rest = Array.from({ length: 62 }, (_, i) => i + 1).filter((m) => m !== 21 && m !== 42)
    rest.forEach((m, k) => expect(TELETEXT_MOSAICS[m], `mask ${m}`).toBe(String.fromCodePoint(0x1fb00 + k)))
    // Spot checks against the Unicode names: SEXTANT-1 is the top-left alone,
    // SEXTANT-35 is middle-left + bottom-left, SEXTANT-23456 is all but the top-left.
    expect(TELETEXT_MOSAICS[1]).toBe('\u{1FB00}')
    expect(TELETEXT_MOSAICS[20]).toBe('\u{1FB13}')
    expect(TELETEXT_MOSAICS[62]).toBe('\u{1FB3B}')
  })
})

describe('PETSCII screen codes', () => {
  it('match the C64 character set', () => {
    // From the C64's PETSCII chart (PETSCII $A0-$BF are screen codes $60-$7F,
    // $C0-$DF are $40-$5F); +$80 shows the character reversed.
    expect(PETSCII_SCREEN_CODES).toEqual({
      ' ': 0x20,
      '█': 0xa0, // reversed space
      '▌': 0x61, // PETSCII $A1
      '▐': 0xe1, // reversed ▌
      '▄': 0x62, // PETSCII $A2
      '▀': 0xe2, // reversed ▄
      '▒': 0x66, // PETSCII $A6, the checkerboard
      '░': 0x66, // no lighter even shade on the C64
      '▓': 0xa0, // nor a darker one: full block
      '▖': 0x7b, // PETSCII $BB
      '▗': 0x6c, // PETSCII $AC
      '▘': 0x7e, // PETSCII $BE
      '▝': 0x7c, // PETSCII $BC
      '▚': 0x7f, // PETSCII $BF
      '▞': 0xff, // reversed ▚
      '━': 0x40, // PETSCII $C0 ─
      '┃': 0x5d, // PETSCII $DD │
      '♠': 0x41, // PETSCII $C1
      '♥': 0x53, // PETSCII $D3
      '♣': 0x58, // PETSCII $D8
      '♦': 0x5a, // PETSCII $DA
      '●': 0x51 // PETSCII $D1
    })
  })

  it('covers every character PETSCII mode makes', () => {
    const w = 64
    const h = 64
    const px = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) px.set([(i * 37) % 256, (i * 91) % 256, (i * 53) % 256, 255], i * 4)
    const res = generateAscii(px, w, h, { mode: 'petscii', columns: 32 })
    for (const row of res.cells) for (const cell of row) expect(PETSCII_SCREEN_CODES[cell.char], cell.char).toBeDefined()
  })
})

describe('PETSCII is a C64 screen: 40 columns, at most 25 rows', () => {
  const pic = (w: number, h: number) => {
    const px = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) px.set([(i * 37) % 256, (i * 91) % 256, (i * 53) % 256, 255], i * 4)
    return px
  }

  it('a wide picture fills the 40 columns, whatever the columns setting says', () => {
    for (const columns of [20, 80, 132]) {
      const r = generateAscii(pic(400, 300), 400, 300, { mode: 'petscii', columns })
      expect([r.width, r.height]).toEqual([40, 15])
    }
  })

  it('a tall picture is 25 rows high, narrower, and centred on the screen', () => {
    const r = generateAscii(pic(100, 400), 100, 400, { mode: 'petscii', columns: 80 })
    expect([r.width, r.height]).toEqual([13, 25])
    const { screen, colour } = petsciiScreen(r)
    expect(screen.length).toBe(1000)
    expect(colour.length).toBe(1000)
    const pad = 13
    for (let row = 0; row < 25; row++) {
      for (let x = 0; x < 40; x++) {
        const cell = x >= pad && x < pad + 13 ? r.cells[row][x - pad] : null
        expect(screen[row * 40 + x], `row ${row}, column ${x}`).toBe(cell ? PETSCII_SCREEN_CODES[cell.char] : 0x20)
      }
    }
  })
})
