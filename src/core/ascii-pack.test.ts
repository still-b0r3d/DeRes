import { describe, expect, it } from 'vitest'
import { generateAscii, type AsciiSettings } from './ascii'
import { packAscii, packedBuffers, rowRuns, sameRow, unpackAscii } from './ascii-pack'

// ASCII art packed into typed arrays (how the worker hands frames over and
// the play bar keeps them), and back.

/** A made-up picture: colour bands that move with `shift`, and a grey ramp. */
function picture(w: number, h: number, shift = 0): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const band = Math.floor((x + shift) / 4) % 3
      rgba[o] = band === 0 ? 230 : (x * 255) / w
      rgba[o + 1] = band === 1 ? 200 : (y * 255) / h
      rgba[o + 2] = band === 2 ? 220 : 40
      rgba[o + 3] = 255
    }
  }
  return rgba
}

const MODES: Partial<AsciiSettings>[] = [
  { mode: 'half-block', columns: 24, colorMode: 'ansi16' },
  { mode: 'half-block', columns: 24, colorMode: 'truecolor' },
  { mode: 'half-block', columns: 24, colorMode: 'mono' },
  { mode: 'ramp', columns: 24, colorMode: 'c64', rampPreset: 'katakana' },
  // UTF-16 slices of a ramp with an emoji can leave half a character in a cell.
  { mode: 'ramp', columns: 24, colorMode: 'ansi16', rampPreset: 'custom', customRamp: ' .o😀#' },
  { mode: 'petscii', colorMode: 'c64' },
  { mode: 'teletext', columns: 40, colorMode: 'teletext', teletextHeader: true }
]

describe('packAscii / unpackAscii', () => {
  it('gives back exactly the art generateAscii made, in every mode', () => {
    for (const s of MODES) {
      const art = generateAscii(picture(64, 48), 64, 48, s)
      const packed = packAscii(art)
      expect(packed.chars).toHaveLength(art.width * art.height)
      expect(unpackAscii(packed), JSON.stringify(s)).toEqual(art)
    }
  })

  it('keeps the Teletext masks, C64 colours and ANSI indices (0 included)', () => {
    const tele = unpackAscii(packAscii(generateAscii(picture(64, 48), 64, 48, MODES[6])))
    expect(tele.cells[0][0].teletextMask).toBe(0)
    const ansi = unpackAscii(packAscii(generateAscii(new Uint8ClampedArray(16 * 4), 4, 4, { columns: 4 })))
    expect(ansi.cells[0][0].fgAnsi).toBe(0)
    expect(ansi.cells[0][0].bgAnsi).toBe(0)
    expect(ansi.cells[0][0].c64Color).toBeUndefined()
  })

  it('hands over its four buffers whole', () => {
    const packed = packAscii(generateAscii(picture(16, 16), 16, 16, { columns: 8 }))
    const buffers = packedBuffers(packed)
    expect(buffers).toHaveLength(4)
    expect(buffers.map((b) => b.byteLength)).toEqual([packed.chars.byteLength, packed.fg.byteLength, packed.bg.byteLength, packed.extra.byteLength])
    // structuredClone with them moved: the copy is whole, the original emptied.
    const moved = structuredClone(packed, { transfer: buffers })
    expect(moved.chars).toHaveLength(8 * packed.height)
    expect(packed.chars).toHaveLength(0)
  })
})

describe('sameRow and rowRuns', () => {
  it('tells the rows that changed between two frames', () => {
    const s = { mode: 'half-block' as const, columns: 32, colorMode: 'ansi16' as const }
    const top = picture(64, 48)
    const moved = picture(64, 48, 4)
    // The bottom half of the second frame is the first one's.
    moved.set(top.subarray(64 * 24 * 4), 64 * 24 * 4)
    const a = packAscii(generateAscii(top, 64, 48, s))
    const b = packAscii(generateAscii(moved, 64, 48, s))
    const changed = Array.from({ length: a.height }, (_, y) => !sameRow(a, b, y))
    expect(changed.some(Boolean)).toBe(true)
    expect(changed.slice(Math.ceil(a.height / 2) + 1).some(Boolean)).toBe(false)
    for (let y = 0; y < a.height; y++) expect(sameRow(a, a, y)).toBe(true)
    // A different size is never the same row.
    const narrow = packAscii(generateAscii(top, 64, 48, { ...s, columns: 30 }))
    expect(sameRow(a, narrow, 0)).toBe(false)
  })

  it('puts cells with the same two colours in one run, as hex', () => {
    const art = unpackAscii(packAscii(generateAscii(picture(64, 48), 64, 48, MODES[1])))
    const packed = packAscii(art)
    for (let y = 0; y < art.height; y++) {
      const runs = rowRuns(packed, y)
      expect(runs.map((r) => r.text).join('')).toBe(art.cells[y].map((c) => c.char).join(''))
      for (let i = 1; i < runs.length; i++) expect(runs[i].fg + runs[i].bg).not.toBe(runs[i - 1].fg + runs[i - 1].bg)
      const hex = (c: number[]) => c.map((v) => v.toString(16).padStart(2, '0')).join('')
      expect(runs[0].fg).toBe(hex(art.cells[y][0].fg))
      expect(runs[0].bg).toBe(hex(art.cells[y][0].bg))
    }
  })
})
