import { BYTE_TO_LINEAR, linearToByte } from './color'
import { PaletteMatcher } from './matcher'
import { attachSauce, type SauceInfo } from './sauce'

// ASCII / ANSI Studio Core
// Converts images into authentic BBS-style text art:
// 1. Half-block color mode (▀) doubling vertical resolution for truecolor and 16-color ANSI.
// 2. Character ramp density modes with 2:1 cell aspect ratio.
// 3. Export to Raw Text, GitHub Markdown, ANSI Terminal Escapes, HTML, and .ANS files with SAUCE records.

export type AsciiMode = 'half-block' | 'ramp' | 'petscii' | 'teletext'
export type AsciiColorMode = 'ansi16' | 'c64' | 'teletext' | 'green' | 'amber' | 'mono' | 'truecolor'

export const ASCII_RAMPS = {
  standard: ' .:-=+*#%@',
  detailed: ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
  blocks: ' ░▒▓█',
  katakana: ' ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ',
  binary: ' 01'
} as const

export type AsciiRampPreset = keyof typeof ASCII_RAMPS | 'custom'

export interface AsciiSettings {
  mode: AsciiMode
  columns: number
  rampPreset: AsciiRampPreset
  customRamp?: string
  invertRamp: boolean
  colorMode: AsciiColorMode
  contrast: number // -100 to 100
  brightness: number // -100 to 100
  gamma: number // 0.2 to 3.0
  twoToOneAspect: boolean
  teletextSeparated?: boolean
  teletextHeader?: boolean
}

export const DEFAULT_ASCII_SETTINGS: AsciiSettings = {
  mode: 'half-block',
  columns: 80,
  rampPreset: 'standard',
  customRamp: '',
  invertRamp: false,
  colorMode: 'ansi16',
  contrast: 0,
  brightness: 0,
  gamma: 1.0,
  twoToOneAspect: true,
  teletextSeparated: false,
  teletextHeader: true
}

export interface AsciiCell {
  char: string
  fg: [number, number, number] // [r, g, b] 0..255
  bg: [number, number, number] // [r, g, b] 0..255
  fgAnsi?: number // 0..15 if ANSI 16
  bgAnsi?: number // 0..15 if ANSI 16
  teletextMask?: number // 0..63 for Teletext 2×3 mosaic
  c64Color?: number // 0..15 for C64 PETSCII color
}

export interface AsciiResult {
  width: number // columns
  height: number // rows
  cells: AsciiCell[][]
  settings: AsciiSettings
  colorCount: number
}

// Standard 16 ANSI / PC CGA colors (index 0..15)
export const ANSI_16_PALETTE: [number, number, number][] = [
  [0, 0, 0], // 0: Black
  [0, 0, 170], // 1: Blue
  [0, 170, 0], // 2: Green
  [0, 170, 170], // 3: Cyan
  [170, 0, 0], // 4: Red
  [170, 0, 170], // 5: Magenta
  [170, 85, 0], // 6: Brown
  [170, 170, 170], // 7: Light Gray
  [85, 85, 85], // 8: Dark Gray
  [85, 85, 255], // 9: Light Blue
  [85, 255, 85], // 10: Light Green
  [85, 255, 255], // 11: Light Cyan
  [255, 85, 85], // 12: Light Red
  [255, 85, 255], // 13: Light Magenta
  [255, 255, 85], // 14: Yellow
  [255, 255, 255] // 15: Bright White
]

// Commodore 64 VIC-II 16-color palette
export const C64_VIC_PALETTE: [number, number, number][] = [
  [0, 0, 0], // 0: Black (#000000)
  [255, 255, 255], // 1: White (#ffffff)
  [129, 51, 56], // 2: Red (#813338)
  [117, 206, 200], // 3: Cyan (#75cec8)
  [142, 60, 151], // 4: Purple (#8e3c97)
  [86, 172, 77], // 5: Green (#56ac4d)
  [46, 44, 155], // 6: Blue (#2e2c9b)
  [237, 241, 113], // 7: Yellow (#edf171)
  [142, 80, 41], // 8: Orange (#8e5029)
  [85, 56, 0], // 9: Brown (#553800)
  [196, 108, 113], // 10: Light Red (#c46c71)
  [74, 74, 74], // 11: Dark Grey (#4a4a4a)
  [123, 123, 123], // 12: Grey (#7b7b7b)
  [169, 255, 159], // 13: Light Green (#a9ff9f)
  [112, 109, 235], // 14: Light Blue (#706deb)
  [178, 178, 178] // 15: Light Grey (#b2b2b2)
]

// Broadcast Teletext Level 1 8-color primary palette
export const TELETEXT_PALETTE: [number, number, number][] = [
  [0, 0, 0], // 0: Black
  [255, 0, 0], // 1: Red
  [0, 255, 0], // 2: Green
  [255, 255, 0], // 3: Yellow
  [0, 0, 255], // 4: Blue
  [255, 0, 255], // 5: Magenta
  [0, 255, 255], // 6: Cyan
  [255, 255, 255] // 7: White
]

const ANSI_16_MATCHER = new PaletteMatcher(new Uint8Array(ANSI_16_PALETTE.flat()))
const C64_MATCHER = new PaletteMatcher(new Uint8Array(C64_VIC_PALETTE.flat()))
const TELETEXT_MATCHER = new PaletteMatcher(new Uint8Array(TELETEXT_PALETTE.flat()))

/** Maps an RGB color to the closest ANSI 16 index using OKLab color distance. */
export function matchAnsi16(r: number, g: number, b: number): number {
  return ANSI_16_MATCHER.nearestByte(r, g, b)
}

/** Maps an RGB color to the closest C64 color index using OKLab color distance. */
export function matchC64(r: number, g: number, b: number): number {
  return C64_MATCHER.nearestByte(r, g, b)
}

/** Maps an RGB color to the closest Teletext broadcast color index. */
export function matchTeletext(r: number, g: number, b: number): number {
  return TELETEXT_MATCHER.nearestByte(r, g, b)
}

// Teletext 2×3 mosaics as Unicode characters, by mask (0..63). Mask bits:
// 0 top-left, 1 top-right, 2 middle-left, 3 middle-right, 4 bottom-left,
// 5 bottom-right. Unicode's sextants (U+1FB00…U+1FB3B, Symbols for Legacy
// Computing) run in mask order but leave out the four shapes that already
// had characters: empty (space), left half 21 (▌), right half 42 (▐) and
// full 63 (█). So masks 1–20 are U+1FB00 + m − 1, 22–41 are + m − 2 and
// 43–62 are + m − 3.
export const TELETEXT_MOSAICS: readonly string[] = Array.from({ length: 64 }, (_, m) => {
  if (m === 0) return ' '
  if (m === 21) return '▌'
  if (m === 42) return '▐'
  if (m === 63) return '█'
  return String.fromCodePoint(0x1fb00 + m - (m < 21 ? 1 : m < 42 ? 2 : 3))
})

// Fallback ASCII block representation for terminals or fonts without Unicode 13 sextants
export const TELETEXT_FALLBACK_BLOCKS: readonly string[] = [
  ' ', '░', '░', '▔', '░', '▌', '░', '░',
  '░', '░', '━', '░', '░', '░', '░', '▀',
  '░', '░', '░', '░', '▌', '▌', '░', '░',
  '░', '░', '░', '░', '░', '░', '░', '░',
  '░', '░', '░', '░', '░', '░', '░', '░',
  '░', '░', '░', '░', '░', '░', '░', '░',
  '▄', '░', '░', '░', '░', '░', '░', '░',
  '░', '░', '░', '░', '░', '▄', '▌', '█'
]

// C64 screen codes (uppercase/graphics set) for the characters PETSCII mode
// uses. PETSCII $A0-$BF are screen codes $60-$7F and $C0-$DF are $40-$5F;
// adding $80 shows a character reversed. The C64 has one even shade (the
// checkerboard) and no triangles.
export const PETSCII_SCREEN_CODES: Record<string, number> = {
  ' ': 0x20,
  '█': 0xa0, // reversed space
  '▌': 0x61, // PETSCII $A1
  '▐': 0xe1, // reversed ▌
  '▄': 0x62, // PETSCII $A2
  '▀': 0xe2, // reversed ▄
  '▒': 0x66, // PETSCII $A6, the checkerboard
  '░': 0x66, // no lighter even shade
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
}

export const C64_COLUMNS = 40
export const C64_ROWS = 25

/**
 * PETSCII art laid out on a C64 screen: 1000 screen codes and 1000 colours
 * (40×25, row by row), the art centred left to right, spaces around it.
 */
export function petsciiScreen(result: AsciiResult): { screen: Uint8Array; colour: Uint8Array } {
  const screen = new Uint8Array(C64_COLUMNS * C64_ROWS).fill(0x20)
  const colour = new Uint8Array(C64_COLUMNS * C64_ROWS).fill(1)
  const pad = Math.max(0, Math.floor((C64_COLUMNS - result.width) / 2))
  for (let r = 0; r < Math.min(C64_ROWS, result.height); r++) {
    for (let c = 0; c < Math.min(C64_COLUMNS - pad, result.width); c++) {
      const cell = result.cells[r][c]
      screen[r * C64_COLUMNS + pad + c] = PETSCII_SCREEN_CODES[cell.char] ?? 0x20
      colour[r * C64_COLUMNS + pad + c] = (cell.c64Color ?? 1) & 0x0f
    }
  }
  return { screen, colour }
}

// C64 color control codes for PETSCII .seq stream (0..15)
export const PETSCII_COLOR_CODES: readonly number[] = [
  0x90, // 0: Black
  0x05, // 1: White
  0x1c, // 2: Red
  0x9f, // 3: Cyan
  0x9c, // 4: Purple
  0x1e, // 5: Green
  0x1f, // 6: Blue
  0x9e, // 7: Yellow
  0x81, // 8: Orange
  0x95, // 9: Brown
  0x96, // 10: Light Red
  0x97, // 11: Dark Grey
  0x98, // 12: Grey
  0x99, // 13: Light Green
  0x9a, // 14: Light Blue
  0x9b  // 15: Light Grey
]

// Maps CP437 unicode characters to byte codes for .ANS file creation
const CP437_BYTE_MAP: Record<string, number> = {
  ' ': 0x20,
  '▀': 0xdf, // 223
  '▄': 0xdc, // 220
  '█': 0xdb, // 219
  '░': 0xb0, // 176
  '▒': 0xb1, // 177
  '▓': 0xb2, // 178
  '│': 0xb3,
  '┤': 0xb4,
  '╡': 0xb5,
  '╢': 0xb6,
  '╖': 0xb7,
  '╕': 0xb8,
  '╣': 0xb9,
  '║': 0xba,
  '╗': 0xbb,
  '╝': 0xbc,
  '╜': 0xbd,
  '╛': 0xbe,
  '┐': 0xbf,
  '└': 0xc0,
  '┴': 0xc1,
  '┬': 0xc2,
  '├': 0xc3,
  '─': 0xc4,
  '┼': 0xc5,
  '╞': 0xc6,
  '╟': 0xc7,
  '╚': 0xc8,
  '╔': 0xc9,
  '╩': 0xca,
  '╦': 0xcb,
  '╠': 0xcc,
  '═': 0xcd,
  '╬': 0xce
}

// Map ANSI 16 palette index to DOS ANSI color escape codes (0..7)
// DOS ANSI order: 0:Black, 1:Red, 2:Green, 3:Yellow, 4:Blue, 5:Magenta, 6:Cyan, 7:White
const ANSI_TO_DOS_CODE: number[] = [0, 4, 2, 6, 1, 5, 3, 7]

function applyAdjustments(
  r: number,
  g: number,
  b: number,
  contrast: number,
  brightness: number,
  gamma: number
): [number, number, number] {
  if (contrast === 0 && brightness === 0 && gamma === 1.0) {
    return [r, g, b]
  }

  // Linearize
  let lr = BYTE_TO_LINEAR[r]
  let lg = BYTE_TO_LINEAR[g]
  let lb = BYTE_TO_LINEAR[b]

  // Brightness (-100..100) -> -1..1
  if (brightness !== 0) {
    const bShift = brightness / 100
    lr = Math.max(0, lr + bShift)
    lg = Math.max(0, lg + bShift)
    lb = Math.max(0, lb + bShift)
  }

  // Contrast (-100..100)
  if (contrast !== 0) {
    const cFactor = Math.max(0, (100 + contrast) / 100)
    lr = Math.max(0, (lr - 0.5) * cFactor + 0.5)
    lg = Math.max(0, (lg - 0.5) * cFactor + 0.5)
    lb = Math.max(0, (lb - 0.5) * cFactor + 0.5)
  }

  // Gamma
  if (gamma !== 1.0 && gamma > 0.01) {
    const invGamma = 1 / gamma
    lr = Math.pow(Math.max(0, lr), invGamma)
    lg = Math.pow(Math.max(0, lg), invGamma)
    lb = Math.pow(Math.max(0, lb), invGamma)
  }

  return [linearToByte(lr), linearToByte(lg), linearToByte(lb)]
}

function sampleArea(
  rgba: Uint8ClampedArray | Uint8Array,
  srcW: number,
  srcH: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): [number, number, number] {
  const minX = Math.max(0, Math.floor(x0))
  const maxX = Math.max(minX, Math.min(srcW - 1, Math.floor(x1 - 0.0001)))
  const minY = Math.max(0, Math.floor(y0))
  const maxY = Math.max(minY, Math.min(srcH - 1, Math.floor(y1 - 0.0001)))

  let rSum = 0
  let gSum = 0
  let bSum = 0
  let count = 0

  for (let y = minY; y <= maxY; y++) {
    const rowOffset = y * srcW * 4
    for (let x = minX; x <= maxX; x++) {
      const idx = rowOffset + x * 4
      rSum += rgba[idx]
      gSum += rgba[idx + 1]
      bSum += rgba[idx + 2]
      count++
    }
  }

  if (count === 0) return [0, 0, 0]
  return [Math.round(rSum / count), Math.round(gSum / count), Math.round(bSum / count)]
}

/**
 * Calculates luminance (Rec. 709) of an 8-bit RGB color.
 */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255)
}

/**
 * Generates ASCII or ANSI text art from raw RGBA image data.
 */
export function generateAscii(
  rgba: Uint8ClampedArray | Uint8Array,
  srcW: number,
  srcH: number,
  settings: Partial<AsciiSettings> = {}
): AsciiResult {
  const s: AsciiSettings = { ...DEFAULT_ASCII_SETTINGS, ...settings }
  const cols = Math.max(1, Math.min(320, Math.round(s.columns)))
  const aspectMultiplier = s.twoToOneAspect ? 2 : 1

  // Resolve ramp
  let rampStr = ASCII_RAMPS.standard as string
  if (s.rampPreset === 'custom' && s.customRamp) rampStr = s.customRamp
  else if (s.rampPreset in ASCII_RAMPS) rampStr = ASCII_RAMPS[s.rampPreset as keyof typeof ASCII_RAMPS]
  if (rampStr.length === 0) rampStr = ' #'

  const cells: AsciiCell[][] = []
  const usedColours = new Set<string>()

  if (s.mode === 'teletext') {
    const rows = Math.max(1, Math.round((cols * srcH) / (srcW * aspectMultiplier)))
    const cellWInSrc = srcW / cols
    const cellHInSrc = srcH / rows

    for (let r = 0; r < rows; r++) {
      const row: AsciiCell[] = []
      const isHeaderRow = s.teletextHeader && r === 0

      const y0 = r * cellHInSrc
      const y1 = (r + 1) * cellHInSrc

      for (let c = 0; c < cols; c++) {
        if (isHeaderRow) {
          const headerText = 'P100  CEEFAX 100  OCT 07  b0r3d.org      '.padEnd(cols, ' ')
          const char = headerText[c] || ' '
          const fg: [number, number, number] = c < 4 ? [255, 255, 0] : c < 16 ? [0, 255, 255] : [255, 255, 255]
          const bg: [number, number, number] = [0, 0, 170]
          row.push({ char, fg, bg, teletextMask: 0 })
          continue
        }

        const x0 = c * cellWInSrc
        const x1 = (c + 1) * cellWInSrc
        const xm = (x0 + x1) / 2
        const yh = (y1 - y0) / 3

        const subBoxes = [
          [x0, y0, xm, y0 + yh],
          [xm, y0, x1, y0 + yh],
          [x0, y0 + yh, xm, y0 + 2 * yh],
          [xm, y0 + yh, x1, y0 + 2 * yh],
          [x0, y0 + 2 * yh, xm, y1],
          [xm, y0 + 2 * yh, x1, y1]
        ]

        let mask = 0
        let rSum = 0, gSum = 0, bSum = 0, activeCount = 0

        for (let b = 0; b < 6; b++) {
          const [bx0, by0, bx1, by1] = subBoxes[b]
          const [sr, sg, sb] = sampleArea(rgba, srcW, srcH, bx0, by0, bx1, by1)
          const [ar, ag, ab] = applyAdjustments(sr, sg, sb, s.contrast, s.brightness, s.gamma)
          const lum = luminance(ar, ag, ab)
          if (lum > 0.35) {
            mask |= (1 << b)
            rSum += ar
            gSum += ag
            bSum += ab
            activeCount++
          }
        }

        let fgRgb: [number, number, number] = [255, 255, 255]
        if (activeCount > 0) {
          const avgR = Math.round(rSum / activeCount)
          const avgG = Math.round(gSum / activeCount)
          const avgB = Math.round(bSum / activeCount)
          const palIdx = matchTeletext(avgR, avgG, avgB)
          fgRgb = TELETEXT_PALETTE[palIdx === 0 ? 7 : palIdx]
        }
        const bgRgb: [number, number, number] = [0, 0, 0]

        usedColours.add(`${fgRgb[0]},${fgRgb[1]},${fgRgb[2]}`)
        usedColours.add('0,0,0')

        const char = TELETEXT_MOSAICS[mask] ?? ' '
        row.push({
          char,
          fg: fgRgb,
          bg: bgRgb,
          teletextMask: mask
        })
      }
      cells.push(row)
    }

    return {
      width: cols,
      height: rows,
      cells,
      settings: s,
      colorCount: usedColours.size
    }
  }

  if (s.mode === 'petscii') {
    // A C64 screen is 40×25 characters, whatever the columns setting says: a
    // wide picture fills the 40 columns, a tall one is 25 rows high and
    // narrower (the exports centre it).
    let cols = C64_COLUMNS
    let rows = Math.max(1, Math.round((cols * srcH) / (srcW * aspectMultiplier)))
    if (rows > C64_ROWS) {
      rows = C64_ROWS
      cols = Math.max(1, Math.min(C64_COLUMNS, Math.round((rows * srcW * aspectMultiplier) / srcH)))
    }
    const cellWInSrc = srcW / cols
    const cellHInSrc = srcH / rows

    for (let r = 0; r < rows; r++) {
      const row: AsciiCell[] = []
      const y0 = r * cellHInSrc
      const y1 = (r + 1) * cellHInSrc
      const ym = (y0 + y1) / 2

      for (let c = 0; c < cols; c++) {
        const x0 = c * cellWInSrc
        const x1 = (c + 1) * cellWInSrc
        const xm = (x0 + x1) / 2

        const qTL = sampleArea(rgba, srcW, srcH, x0, y0, xm, ym)
        const qTR = sampleArea(rgba, srcW, srcH, xm, y0, x1, ym)
        const qBL = sampleArea(rgba, srcW, srcH, x0, ym, xm, y1)
        const qBR = sampleArea(rgba, srcW, srcH, xm, ym, x1, y1)

        const [r0, g0, b0] = applyAdjustments(qTL[0], qTL[1], qTL[2], s.contrast, s.brightness, s.gamma)
        const [r1, g1, b1] = applyAdjustments(qTR[0], qTR[1], qTR[2], s.contrast, s.brightness, s.gamma)
        const [r2, g2, b2] = applyAdjustments(qBL[0], qBL[1], qBL[2], s.contrast, s.brightness, s.gamma)
        const [r3, g3, b3] = applyAdjustments(qBR[0], qBR[1], qBR[2], s.contrast, s.brightness, s.gamma)

        const l0 = luminance(r0, g0, b0)
        const l1 = luminance(r1, g1, b1)
        const l2 = luminance(r2, g2, b2)
        const l3 = luminance(r3, g3, b3)
        const avgLum = (l0 + l1 + l2 + l3) / 4

        const thresh = Math.max(0.25, Math.min(0.75, avgLum))
        const bTL = l0 >= thresh ? 1 : 0
        const bTR = l1 >= thresh ? 1 : 0
        const bBL = l2 >= thresh ? 1 : 0
        const bBR = l3 >= thresh ? 1 : 0
        const qBits = (bTL << 3) | (bTR << 2) | (bBL << 1) | bBR

        let char = ' '
        switch (qBits) {
          case 0b1111: char = '█'; break
          case 0b0000: char = ' '; break
          case 0b1100: char = '▀'; break
          case 0b0011: char = '▄'; break
          case 0b1010: char = '▌'; break
          case 0b0101: char = '▐'; break
          case 0b1000: char = '▘'; break
          case 0b0100: char = '▝'; break
          case 0b0010: char = '▖'; break
          case 0b0001: char = '▗'; break
          case 0b1001: char = '▚'; break
          case 0b0110: char = '▞'; break
          default: {
            if (avgLum > 0.8) char = '█'
            else if (avgLum > 0.6) char = '▓'
            else if (avgLum > 0.4) char = '▒'
            else if (avgLum > 0.2) char = '░'
            else char = ' '
            break
          }
        }

        const wholeCell = sampleArea(rgba, srcW, srcH, x0, y0, x1, y1)
        const [wr, wg, wb] = applyAdjustments(wholeCell[0], wholeCell[1], wholeCell[2], s.contrast, s.brightness, s.gamma)
        const c64FgIdx = matchC64(wr, wg, wb)
        const fgRgb = C64_VIC_PALETTE[c64FgIdx === 0 && char !== ' ' ? 1 : c64FgIdx]
        const bgRgb: [number, number, number] = [0, 0, 0]

        usedColours.add(`${fgRgb[0]},${fgRgb[1]},${fgRgb[2]}`)
        usedColours.add('0,0,0')

        row.push({
          char,
          fg: fgRgb,
          bg: bgRgb,
          c64Color: c64FgIdx
        })
      }
      cells.push(row)
    }

    return {
      width: cols,
      height: rows,
      cells,
      settings: s,
      colorCount: usedColours.size
    }
  }

  if (s.mode === 'half-block') {
    // In half-block mode, each character cell (▀) has top half (fg) and bottom half (bg).
    // The total pixel height is (cols * srcH / srcW) when cells are 2:1 tall.
    // Each character row contains 2 vertical pixels.
    const pixelH = Math.max(2, Math.round((cols * srcH) / srcW))
    const rows = Math.ceil(pixelH / 2)

    const cellWInSrc = srcW / cols
    const subpixelHInSrc = srcH / pixelH

    for (let r = 0; r < rows; r++) {
      const row: AsciiCell[] = []
      const topY0 = r * 2 * subpixelHInSrc
      const topY1 = (r * 2 + 1) * subpixelHInSrc
      const botY0 = topY1
      const botY1 = Math.min(srcH, (r * 2 + 2) * subpixelHInSrc)

      for (let c = 0; c < cols; c++) {
        const x0 = c * cellWInSrc
        const x1 = (c + 1) * cellWInSrc

        // Sample top and bottom subpixels
        let [tr, tg, tb] = sampleArea(rgba, srcW, srcH, x0, topY0, x1, topY1)
        let [br, bg, bb] = sampleArea(rgba, srcW, srcH, x0, botY0, x1, botY1)

        const adjTop = applyAdjustments(tr, tg, tb, s.contrast, s.brightness, s.gamma)
        tr = adjTop[0]
        tg = adjTop[1]
        tb = adjTop[2]

        const adjBot = applyAdjustments(br, bg, bb, s.contrast, s.brightness, s.gamma)
        br = adjBot[0]
        bg = adjBot[1]
        bb = adjBot[2]

        let fgRgb: [number, number, number]
        let bgRgb: [number, number, number]
        let fgAnsi: number | undefined
        let bgAnsi: number | undefined

        switch (s.colorMode) {
          case 'ansi16': {
            fgAnsi = matchAnsi16(tr, tg, tb)
            bgAnsi = matchAnsi16(br, bg, bb)
            fgRgb = ANSI_16_PALETTE[fgAnsi]
            bgRgb = ANSI_16_PALETTE[bgAnsi]
            break
          }
          case 'c64': {
            const fgC64 = matchC64(tr, tg, tb)
            const bgC64 = matchC64(br, bg, bb)
            fgRgb = C64_VIC_PALETTE[fgC64]
            bgRgb = C64_VIC_PALETTE[bgC64]
            break
          }
          case 'teletext': {
            const fgTt = matchTeletext(tr, tg, tb)
            const bgTt = matchTeletext(br, bg, bb)
            fgRgb = TELETEXT_PALETTE[fgTt]
            bgRgb = TELETEXT_PALETTE[bgTt]
            break
          }
          case 'green': {
            const tl = luminance(tr, tg, tb)
            const bl = luminance(br, bg, bb)
            fgRgb = [0, Math.round(tl * 255), Math.round(tl * 102)]
            bgRgb = [10, Math.round(bl * 36 + 18), 10]
            break
          }
          case 'amber': {
            const tl = luminance(tr, tg, tb)
            const bl = luminance(br, bg, bb)
            fgRgb = [Math.round(tl * 255), Math.round(tl * 176), 0]
            bgRgb = [20, Math.round(bl * 24 + 13), 0]
            break
          }
          case 'mono': {
            const tl = Math.round(luminance(tr, tg, tb) * 230)
            const bl = Math.round(luminance(br, bg, bb) * 40)
            fgRgb = [tl, tl, tl]
            bgRgb = [bl, bl, bl]
            break
          }
          case 'truecolor':
          default: {
            fgRgb = [tr, tg, tb]
            bgRgb = [br, bg, bb]
            break
          }
        }

        usedColours.add(`${fgRgb[0]},${fgRgb[1]},${fgRgb[2]}`)
        usedColours.add(`${bgRgb[0]},${bgRgb[1]},${bgRgb[2]}`)

        row.push({
          char: '▀',
          fg: fgRgb,
          bg: bgRgb,
          fgAnsi,
          bgAnsi
        })
      }
      cells.push(row)
    }

    return {
      width: cols,
      height: rows,
      cells,
      settings: s,
      colorCount: usedColours.size
    }
  }

  // Ramp mode: 1 character per cell
  const rows = Math.max(1, Math.round((cols * srcH) / (srcW * aspectMultiplier)))
  const cellWInSrc = srcW / cols
  const cellHInSrc = srcH / rows

  for (let r = 0; r < rows; r++) {
    const row: AsciiCell[] = []
    const y0 = r * cellHInSrc
    const y1 = (r + 1) * cellHInSrc

    for (let c = 0; c < cols; c++) {
      const x0 = c * cellWInSrc
      const x1 = (c + 1) * cellWInSrc

      let [cr, cg, cb] = sampleArea(rgba, srcW, srcH, x0, y0, x1, y1)
      const adjusted = applyAdjustments(cr, cg, cb, s.contrast, s.brightness, s.gamma)
      cr = adjusted[0]
      cg = adjusted[1]
      cb = adjusted[2]

      const lum = Math.max(0, Math.min(1, luminance(cr, cg, cb)))
      let rampIdx = Math.floor(lum * rampStr.length)
      if (rampIdx >= rampStr.length) rampIdx = rampStr.length - 1
      if (s.invertRamp) rampIdx = rampStr.length - 1 - rampIdx

      const char = rampStr[rampIdx]

      let fgRgb: [number, number, number]
      let bgRgb: [number, number, number]
      let fgAnsi: number | undefined
      let bgAnsi: number | undefined

      switch (s.colorMode) {
        case 'ansi16': {
          fgAnsi = matchAnsi16(cr, cg, cb)
          bgAnsi = 0 // Black background
          fgRgb = ANSI_16_PALETTE[fgAnsi]
          bgRgb = ANSI_16_PALETTE[bgAnsi]
          break
        }
        case 'c64': {
          const fgC64 = matchC64(cr, cg, cb)
          fgRgb = C64_VIC_PALETTE[fgC64 === 0 ? 1 : fgC64]
          bgRgb = [0, 0, 0]
          break
        }
        case 'teletext': {
          const fgTt = matchTeletext(cr, cg, cb)
          fgRgb = TELETEXT_PALETTE[fgTt === 0 ? 7 : fgTt]
          bgRgb = [0, 0, 0]
          break
        }
        case 'green': {
          fgRgb = [0, Math.round(lum * 255), Math.round(lum * 102)]
          bgRgb = [10, 18, 10]
          break
        }
        case 'amber': {
          fgRgb = [Math.round(lum * 255), Math.round(lum * 176), 0]
          bgRgb = [20, 13, 0]
          break
        }
        case 'mono': {
          const val = Math.round(lum * 230)
          fgRgb = [val, val, val]
          bgRgb = [19, 19, 19]
          break
        }
        case 'truecolor':
        default: {
          fgRgb = [cr, cg, cb]
          bgRgb = [0, 0, 0]
          break
        }
      }

      usedColours.add(`${fgRgb[0]},${fgRgb[1]},${fgRgb[2]}`)
      row.push({
        char,
        fg: fgRgb,
        bg: bgRgb,
        fgAnsi,
        bgAnsi
      })
    }
    cells.push(row)
  }

  return {
    width: cols,
    height: rows,
    cells,
    settings: s,
    colorCount: usedColours.size
  }
}

/**
 * Serializes ASCII result as plain text.
 */
export function toPlainText(result: AsciiResult): string {
  return result.cells.map((row) => row.map((cell) => cell.char).join('')).join('\n')
}

/**
 * Serializes ASCII result as GitHub-flavored Markdown code block.
 */
export function toMarkdown(result: AsciiResult): string {
  return '```text\n' + toPlainText(result) + '\n```'
}

/**
 * Serializes ASCII result as terminal ANSI escape sequence string.
 */
export function toAnsiText(result: AsciiResult): string {
  const isAnsi16 = result.settings.colorMode === 'ansi16'
  const isTruecolor = result.settings.colorMode === 'truecolor'
  const lines: string[] = []

  let lastFg = -1
  let lastBg = -1
  let lastFgRgb = ''
  let lastBgRgb = ''

  for (const row of result.cells) {
    let line = ''
    for (const cell of row) {
      if (isAnsi16 && cell.fgAnsi !== undefined && cell.bgAnsi !== undefined) {
        if (cell.fgAnsi !== lastFg || cell.bgAnsi !== lastBg) {
          const fgCode = cell.fgAnsi >= 8 ? `1;3${ANSI_TO_DOS_CODE[cell.fgAnsi - 8]}` : `0;3${ANSI_TO_DOS_CODE[cell.fgAnsi]}`
          const bgCode = `4${ANSI_TO_DOS_CODE[cell.bgAnsi % 8]}`
          line += `\x1b[${fgCode};${bgCode}m`
          lastFg = cell.fgAnsi
          lastBg = cell.bgAnsi
        }
      } else if (isTruecolor) {
        const fgKey = `${cell.fg[0]};${cell.fg[1]};${cell.fg[2]}`
        const bgKey = `${cell.bg[0]};${cell.bg[1]};${cell.bg[2]}`
        if (fgKey !== lastFgRgb || bgKey !== lastBgRgb) {
          line += `\x1b[38;2;${fgKey};48;2;${bgKey}m`
          lastFgRgb = fgKey
          lastBgRgb = bgKey
        }
      } else {
        // Green, Amber, Mono
        const fgKey = `${cell.fg[0]};${cell.fg[1]};${cell.fg[2]}`
        const bgKey = `${cell.bg[0]};${cell.bg[1]};${cell.bg[2]}`
        if (fgKey !== lastFgRgb || bgKey !== lastBgRgb) {
          line += `\x1b[38;2;${fgKey};48;2;${bgKey}m`
          lastFgRgb = fgKey
          lastBgRgb = bgKey
        }
      }
      line += cell.char
    }
    // Reset at line end to prevent background bleeding
    line += '\x1b[0m'
    lastFg = -1
    lastBg = -1
    lastFgRgb = ''
    lastBgRgb = ''
    lines.push(line)
  }

  return lines.join('\n')
}

/**
 * Serializes ASCII result as self-contained HTML `<pre>`.
 */
export function toHtml(result: AsciiResult): string {
  const lines: string[] = []

  for (const row of result.cells) {
    let lineHtml = ''
    let curSpanText = ''
    let curSpanFg = ''
    let curSpanBg = ''

    const flush = () => {
      if (!curSpanText) return
      lineHtml += `<span style="color:#${curSpanFg};background-color:#${curSpanBg}">${escapeHtml(curSpanText)}</span>`
      curSpanText = ''
    }

    for (const cell of row) {
      const fgHex = hex(cell.fg)
      const bgHex = hex(cell.bg)
      if (fgHex !== curSpanFg || bgHex !== curSpanBg) {
        flush()
        curSpanFg = fgHex
        curSpanBg = bgHex
      }
      curSpanText += cell.char
    }
    flush()
    lines.push(lineHtml)
  }

  return (
    `<pre style="font-family:'IBM VGA 8x16',monospace;background:#000;color:#aaa;line-height:1;letter-spacing:0;font-size:16px;white-space:pre;overflow:auto">\n` +
    lines.join('\n') +
    `\n</pre>`
  )
}

function hex(rgb: [number, number, number]): string {
  return (
    rgb[0].toString(16).padStart(2, '0') +
    rgb[1].toString(16).padStart(2, '0') +
    rgb[2].toString(16).padStart(2, '0')
  )
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Builds CP437 raw byte buffer with ANSI escapes and optional SAUCE record.
 */
export function toAnsiBytes(result: AsciiResult, sauceInfo?: SauceInfo): Uint8Array {
  const chunks: number[] = []

  let lastFg = -1
  let lastBg = -1

  for (const row of result.cells) {
    for (const cell of row) {
      if (cell.fgAnsi !== undefined && cell.bgAnsi !== undefined) {
        if (cell.fgAnsi !== lastFg || cell.bgAnsi !== lastBg) {
          const fgCode = cell.fgAnsi >= 8 ? `1;3${ANSI_TO_DOS_CODE[cell.fgAnsi - 8]}` : `0;3${ANSI_TO_DOS_CODE[cell.fgAnsi]}`
          const bgCode = `4${ANSI_TO_DOS_CODE[cell.bgAnsi % 8]}`
          const escStr = `\x1b[${fgCode};${bgCode}m`
          for (let i = 0; i < escStr.length; i++) chunks.push(escStr.charCodeAt(i))
          lastFg = cell.fgAnsi
          lastBg = cell.bgAnsi
        }
      }

      // Convert character to CP437 byte
      let byte = CP437_BYTE_MAP[cell.char]
      if (byte === undefined) {
        const code = cell.char.charCodeAt(0)
        byte = code >= 32 && code <= 126 ? code : 0x20
      }
      chunks.push(byte)
    }

    // Line break in DOS ANSI is \r\n
    chunks.push(0x0d, 0x0a)
    lastFg = -1
    lastBg = -1
  }

  // End with reset
  const resetStr = '\x1b[0m'
  for (let i = 0; i < resetStr.length; i++) chunks.push(resetStr.charCodeAt(i))

  const rawBytes = new Uint8Array(chunks)

  const meta: SauceInfo = {
    title: sauceInfo?.title ?? 'B0r3d ANSI Art',
    author: sauceInfo?.author ?? 'still_b0r3d',
    group: sauceInfo?.group ?? 'b0r3d.org',
    tInfo1: result.width,
    tInfo2: result.height,
    fontName: 'IBM VGA',
    ...sauceInfo
  }

  return attachSauce(rawBytes, meta)
}

/**
 * Exports PETSCII art as a Commodore .seq byte stream with C64 color control codes.
 */
export function exportPetsciiSeq(result: AsciiResult): Uint8Array {
  const bytes: number[] = []
  let lastCol = -1

  for (const row of result.cells) {
    for (const cell of row) {
      const col = cell.c64Color ?? 1
      if (col !== lastCol) {
        bytes.push(PETSCII_COLOR_CODES[col] ?? 0x05)
        lastCol = col
      }
      const code = PETSCII_SCREEN_CODES[cell.char] ?? 0x20
      bytes.push(code)
    }
    bytes.push(0x0d) // PETSCII Return
  }

  return new Uint8Array(bytes)
}

/**
 * Exports PETSCII art as a C64 PRG file (load address $0400 screen RAM + $D800 color RAM).
 */
export function exportPetsciiPrg(result: AsciiResult): Uint8Array {
  // Format:
  // 2 bytes: Load address $0400 (0x00, 0x04)
  // 1000 bytes: Screen RAM ($0400 - $07E7)
  // 1000 bytes: Color RAM ($D800 - $DBE7)
  const prg = new Uint8Array(2 + 1000 + 1000)

  // Load address $0400
  prg[0] = 0x00
  prg[1] = 0x04

  const { screen, colour } = petsciiScreen(result)
  prg.set(screen, 2)
  prg.set(colour, 2 + 1000)
  return prg
}

/**
 * Formats Teletext result into a classic broadcast Ceefax page (.ttx plain text).
 */
export function exportTeletextPage(result: AsciiResult): string {
  const lines: string[] = []
  for (let r = 0; r < result.height; r++) {
    let line = ''
    for (let c = 0; c < result.width; c++) {
      line += result.cells[r][c].char
    }
    lines.push(line)
  }
  return lines.join('\n')
}
