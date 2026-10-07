import { BYTE_TO_LINEAR, linearToByte } from './color'
import { PaletteMatcher } from './matcher'
import { attachSauce, type SauceInfo } from './sauce'

// ASCII / ANSI Studio Core
// Converts images into authentic BBS-style text art:
// 1. Half-block color mode (▀) doubling vertical resolution for truecolor and 16-color ANSI.
// 2. Character ramp density modes with 2:1 cell aspect ratio.
// 3. Export to Raw Text, GitHub Markdown, ANSI Terminal Escapes, HTML, and .ANS files with SAUCE records.

export type AsciiMode = 'half-block' | 'ramp'
export type AsciiColorMode = 'ansi16' | 'green' | 'amber' | 'mono' | 'truecolor'

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
  twoToOneAspect: true
}

export interface AsciiCell {
  char: string
  fg: [number, number, number] // [r, g, b] 0..255
  bg: [number, number, number] // [r, g, b] 0..255
  fgAnsi?: number // 0..15 if ANSI 16
  bgAnsi?: number // 0..15 if ANSI 16
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

const ANSI_16_MATCHER = new PaletteMatcher(new Uint8Array(ANSI_16_PALETTE.flat()))

/**
 * Maps an RGB color to the closest ANSI 16 index using OKLab color distance.
 */
export function matchAnsi16(r: number, g: number, b: number): number {
  return ANSI_16_MATCHER.nearestByte(r, g, b)
}

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

        tr = applyAdjustments(tr, tg, tb, s.contrast, s.brightness, s.gamma)[0]
        tg = applyAdjustments(tr, tg, tb, s.contrast, s.brightness, s.gamma)[1]
        tb = applyAdjustments(tr, tg, tb, s.contrast, s.brightness, s.gamma)[2]

        br = applyAdjustments(br, bg, bb, s.contrast, s.brightness, s.gamma)[0]
        bg = applyAdjustments(br, bg, bb, s.contrast, s.brightness, s.gamma)[1]
        bb = applyAdjustments(br, bg, bb, s.contrast, s.brightness, s.gamma)[2]

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
