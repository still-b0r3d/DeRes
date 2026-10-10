import type { AsciiCell, AsciiResult, AsciiSettings } from './ascii'

// ASCII art as a few typed arrays instead of an object per cell. It crosses
// from the worker for free (the buffers move rather than being copied), an
// animation's kept frames take 14 bytes a cell instead of a few hundred, and
// two frames can be compared row by row, so the preview only redraws rows
// that changed. unpackAscii gives back the art exactly as generateAscii made it.

/** A cell with no ANSI colour, Teletext mask or C64 colour. */
const NONE = 255

export interface PackedAscii {
  /** Columns and rows. */
  width: number
  height: number
  settings: AsciiSettings
  colorCount: number
  /** Each cell's character (one code point), row by row. */
  chars: Uint32Array
  /** r, g, b per cell. */
  fg: Uint8Array
  bg: Uint8Array
  /** Per cell: ANSI foreground, ANSI background, Teletext mask, C64 colour (255 where there's none). */
  extra: Uint8Array
}

export function packAscii(r: AsciiResult): PackedAscii {
  const n = r.width * r.height
  const chars = new Uint32Array(n)
  const fg = new Uint8Array(n * 3)
  const bg = new Uint8Array(n * 3)
  const extra = new Uint8Array(n * 4)
  let i = 0
  for (const row of r.cells) {
    for (const cell of row) {
      chars[i] = cell.char.codePointAt(0) ?? 0x20
      fg.set(cell.fg, i * 3)
      bg.set(cell.bg, i * 3)
      extra[i * 4] = cell.fgAnsi ?? NONE
      extra[i * 4 + 1] = cell.bgAnsi ?? NONE
      extra[i * 4 + 2] = cell.teletextMask ?? NONE
      extra[i * 4 + 3] = cell.c64Color ?? NONE
      i++
    }
  }
  return { width: r.width, height: r.height, settings: r.settings, colorCount: r.colorCount, chars, fg, bg, extra }
}

export function unpackAscii(p: PackedAscii): AsciiResult {
  const cells: AsciiCell[][] = []
  for (let y = 0, i = 0; y < p.height; y++) {
    const row: AsciiCell[] = []
    for (let x = 0; x < p.width; x++, i++) {
      const cell: AsciiCell = {
        char: String.fromCodePoint(p.chars[i]),
        fg: [p.fg[i * 3], p.fg[i * 3 + 1], p.fg[i * 3 + 2]],
        bg: [p.bg[i * 3], p.bg[i * 3 + 1], p.bg[i * 3 + 2]]
      }
      if (p.extra[i * 4] !== NONE) cell.fgAnsi = p.extra[i * 4]
      if (p.extra[i * 4 + 1] !== NONE) cell.bgAnsi = p.extra[i * 4 + 1]
      if (p.extra[i * 4 + 2] !== NONE) cell.teletextMask = p.extra[i * 4 + 2]
      if (p.extra[i * 4 + 3] !== NONE) cell.c64Color = p.extra[i * 4 + 3]
      row.push(cell)
    }
    cells.push(row)
  }
  return { width: p.width, height: p.height, cells, settings: p.settings, colorCount: p.colorCount }
}

/** The buffers to hand over with postMessage (they move, so the sender's copy is emptied). */
export function packedBuffers(p: PackedAscii): ArrayBuffer[] {
  return [p.chars.buffer, p.fg.buffer, p.bg.buffer, p.extra.buffer] as ArrayBuffer[]
}

/** Whether row y looks the same in both (characters and colours); false when they differ in size. */
export function sameRow(a: PackedAscii, b: PackedAscii, y: number): boolean {
  if (a.width !== b.width || a.height !== b.height) return false
  const from = y * a.width
  const to = from + a.width
  for (let i = from; i < to; i++) if (a.chars[i] !== b.chars[i]) return false
  for (let i = from * 3; i < to * 3; i++) if (a.fg[i] !== b.fg[i] || a.bg[i] !== b.bg[i]) return false
  return true
}

export interface AsciiRun {
  text: string
  /** Six hex digits, no "#". */
  fg: string
  bg: string
}

const hex = (c: Uint8Array, i: number) => ((c[i * 3] << 16) | (c[i * 3 + 1] << 8) | c[i * 3 + 2]).toString(16).padStart(6, '0')

/** Row y as runs of cells that share both colours: one element each in the preview. */
export function rowRuns(p: PackedAscii, y: number): AsciiRun[] {
  const runs: AsciiRun[] = []
  let run: AsciiRun | null = null
  for (let i = y * p.width, end = i + p.width; i < end; i++) {
    const fg = hex(p.fg, i)
    const bg = hex(p.bg, i)
    const char = String.fromCodePoint(p.chars[i])
    if (run && run.fg === fg && run.bg === bg) run.text += char
    else runs.push((run = { text: char, fg, bg }))
  }
  return runs
}
