import { describe, expect, it } from 'vitest'
import { ANSI_HOME, AnsimationWriter, generateAscii, toAnsiBytes, type AsciiResult, type AsciiSettings } from './ascii'
import { parseSauce, SAUCE_EOF, SAUCE_RECORD_SIZE } from './sauce'
import { playAnsi, type Screen } from '../test/ansi-screen'

// The ANSImation: an animated GIF's frames as one .ans, each drawn over the
// last, read back here frame by frame on a small ANSI screen.

/** Frame k of a made-up animation: a bright square moving right across colour bands. */
function frame(k: number, w = 48, h = 32): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const inSquare = x >= k * 6 && x < k * 6 + 10 && y >= 8 && y < 20
      rgba.set(inSquare ? [255, 255, 80, 255] : [(x * 7) % 256, y * 8, 120, 255], o)
    }
  }
  return rgba
}

const frames = (n: number, s: Partial<AsciiSettings>): AsciiResult[] => Array.from({ length: n }, (_, k) => generateAscii(frame(k), 48, 32, s))

/** What the art should leave on an ANSI screen: its CP437 bytes (from the single-frame .ans) and colours. */
function expected(art: AsciiResult): Screen {
  // The single-frame .ans of the same art, played: one row per line.
  return playAnsi(toAnsiBytes(art), art.width, art.height).frames[0]
}

const HALF_BLOCK = { mode: 'half-block', columns: 24, colorMode: 'ansi16' } as const

describe('AnsimationWriter', () => {
  it('clears once, then draws every frame from cursor-home with no clear in between, and ends with one SAUCE record', () => {
    const arts = frames(5, HALF_BLOCK)
    const w = new AnsimationWriter()
    for (const a of arts) w.add(a)
    const bytes = w.finish({ title: 'moving square', author: '', group: 'b0r3d.org' })
    expect(w.frames).toBe(5)

    const text = Buffer.from(bytes).toString('latin1')
    expect(text.startsWith('\x1b[0m\x1b[2J\x1b[H')).toBe(true)
    // One clear, at the start; one cursor-home per frame.
    expect(text.split('\x1b[2J')).toHaveLength(2)
    expect(text.split(ANSI_HOME)).toHaveLength(6)
    // Rows after the first are put at their line, not after a CR LF.
    expect(text.includes('\r\n')).toBe(false)
    expect(text.split('\x1b[2;1H')).toHaveLength(6)
    expect(text.split(`\x1b[${arts[0].height};1H`)).toHaveLength(6)

    // EOF mark, then the 128-byte record describing one frame.
    const sauce = parseSauce(bytes)!
    expect(bytes[bytes.length - SAUCE_RECORD_SIZE - 1]).toBe(SAUCE_EOF)
    expect(sauce.fileSize).toBe(bytes.length - SAUCE_RECORD_SIZE - 1)
    expect(text.slice(0, sauce.fileSize).endsWith('\x1b[0m')).toBe(true)
    expect([sauce.tInfo1, sauce.tInfo2]).toEqual([arts[0].width, arts[0].height])
    expect(sauce.title).toBe('moving square')
    expect(sauce.author).toBe('')
    expect(sauce.group).toBe('b0r3d.org')
    expect(sauce.fontName).toBe('IBM VGA')
    expect(Buffer.from(bytes).indexOf('SAUCE00')).toBe(bytes.length - SAUCE_RECORD_SIZE)
  })

  it('reads back frame by frame: each screen is that frame, characters and colours', () => {
    for (const s of [HALF_BLOCK, { mode: 'ramp', columns: 30, colorMode: 'ansi16', rampPreset: 'blocks' }, { mode: 'ramp', columns: 30, colorMode: 'mono' }] as const) {
      const arts = frames(6, s)
      const w = new AnsimationWriter()
      for (const a of arts) w.add(a)
      const played = playAnsi(w.finish(), arts[0].width, arts[0].height)
      expect(played.frames, JSON.stringify(s)).toHaveLength(arts.length)
      played.frames.forEach((screen, k) => expect(screen, `${JSON.stringify(s)} frame ${k}`).toEqual(expected(arts[k])))
      // The frames really differ (the square moves).
      expect(played.frames[0]).not.toEqual(played.frames[5])
    }
  })

  it('with the 16 ANSI colours, every cell reads back as its colour (a bright background is shown dark, as in DOS)', () => {
    const arts = frames(3, HALF_BLOCK)
    const w = new AnsimationWriter()
    for (const a of arts) w.add(a)
    const played = playAnsi(w.finish(), arts[0].width, arts[0].height)
    played.frames.forEach((screen, k) => {
      arts[k].cells.forEach((row, y) =>
        row.forEach((cell, x) => {
          expect(screen[y][x]).toEqual({ byte: 0xdf, fg: cell.fgAnsi, bg: cell.bgAnsi! % 8 })
        })
      )
    })
  })

  it('only takes frames of one size', () => {
    const w = new AnsimationWriter()
    w.add(generateAscii(frame(0), 48, 32, HALF_BLOCK))
    expect(() => w.add(generateAscii(frame(0), 48, 32, { ...HALF_BLOCK, columns: 20 }))).toThrow(/same size/)
    expect(() => new AnsimationWriter().finish()).toThrow(/at least one frame/)
  })
})
