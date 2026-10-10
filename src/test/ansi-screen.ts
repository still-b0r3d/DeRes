// A small DOS ANSI screen for tests: it plays .ans bytes and says what was on
// the screen each time the cursor went home (an ANSImation's frames). It
// knows the codes the studio writes: colours (ESC[…m), cursor home and
// position (ESC[H, ESC[row;colH), clear screen (ESC[2J), CR, LF, and the
// SAUCE record's end-of-file mark (0x1A), where it stops.

export interface ScreenCell {
  /** The CP437 byte. */
  byte: number
  /** DOS colours 0–15 (a bold foreground is 8–15). */
  fg: number
  bg: number
}

export type Screen = ScreenCell[][]

/** DOS colour order (0 black, 1 red… in ANSI codes) to the ANSI 16 palette's order (1 blue, 4 red…). */
const DOS_TO_ANSI = [0, 4, 2, 6, 1, 5, 3, 7]

export interface Playback {
  /** The screen at each cursor-home after the first, and at the end: one per frame. */
  frames: Screen[]
  /** Escape codes seen, by their final letter ("m", "H", "J"). */
  codes: Record<string, number>
}

export function playAnsi(bytes: Uint8Array, width: number, height: number): Playback {
  const blank = (): ScreenCell => ({ byte: 0x20, fg: 7, bg: 0 })
  let screen: Screen = Array.from({ length: height }, () => Array.from({ length: width }, blank))
  const frames: Screen[] = []
  const codes: Record<string, number> = {}
  const snapshot = () => frames.push(screen.map((row) => row.map((c) => ({ ...c }))))
  let x = 0
  let y = 0
  let fg = 7
  let bg = 0
  let bold = false
  let homes = 0
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    if (b === 0x1a) break
    if (b === 0x1b && bytes[i + 1] === 0x5b) {
      let j = i + 2
      while (j < bytes.length && !(bytes[j] >= 0x40 && bytes[j] <= 0x7e)) j++
      const final = String.fromCharCode(bytes[j])
      const params = String.fromCharCode(...bytes.subarray(i + 2, j))
        .split(';')
        .filter((p) => p !== '')
        .map(Number)
      codes[final] = (codes[final] ?? 0) + 1
      if (final === 'm') {
        for (const p of params.length ? params : [0]) {
          if (p === 0) {
            fg = 7
            bg = 0
            bold = false
          } else if (p === 1) bold = true
          else if (p >= 30 && p <= 37) fg = DOS_TO_ANSI[p - 30]
          else if (p >= 40 && p <= 47) bg = DOS_TO_ANSI[p - 40]
        }
      } else if (final === 'H') {
        const row = (params[0] ?? 1) - 1
        const col = (params[1] ?? 1) - 1
        // Going home starts a new frame: the last one is done.
        if (row === 0 && col === 0 && homes++ > 0) snapshot()
        y = row
        x = col
      } else if (final === 'J' && params[0] === 2) {
        screen = Array.from({ length: height }, () => Array.from({ length: width }, blank))
        x = 0
        y = 0
      }
      i = j
      continue
    }
    if (b === 0x0d) x = 0
    else if (b === 0x0a) y++
    else {
      if (y < height && x < width) screen[y][x] = { byte: b, fg: bold ? fg + 8 : fg, bg }
      x++
    }
  }
  snapshot()
  return { frames, codes }
}
