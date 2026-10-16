// The exact colours in a picture (or a set of frames), while they fit a
// palette. A file holding exactly those colours is indexed and still shows
// the very pixels of the picture: the ASCII studio's animations, and the
// looks that make their own colours (HAM, the N64 filter, the analog looks).

/** The exact colours in a set of frames, while there are no more than 256. */
export class ColourCensus {
  private readonly seen = new Set<number>()
  private over = false

  /** A frame's pixels, r, g, b each; with `alpha`, only the ones that show. */
  add(rgb: Uint8Array, alpha?: Uint8Array | null): void {
    if (this.over) return
    const seen = this.seen
    let last = -1
    for (let i = 0, p = 0; i < rgb.length; i += 3, p++) {
      if (alpha && !alpha[p]) continue
      const c = (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2]
      // Rendered art comes in runs of one colour.
      if (c === last) continue
      last = c
      if (seen.has(c)) continue
      seen.add(c)
      if (seen.size > 256) {
        this.over = true
        seen.clear()
        return
      }
    }
  }

  /** r, g, b per colour, in the order first seen; null when there are more than 256 (or none). */
  palette(): Uint8Array | null {
    if (this.over || this.seen.size === 0) return null
    const out = new Uint8Array(this.seen.size * 3)
    let i = 0
    for (const c of this.seen) {
      out[i++] = c >> 16
      out[i++] = (c >> 8) & 0xff
      out[i++] = c & 0xff
    }
    return out
  }
}

/**
 * Each pixel's entry in `palette`, which holds every colour that shows (a
 * census's palette). Pixels that don't show (with `alpha`) get entry 0.
 */
export function entriesIn(palette: Uint8Array, rgb: Uint8Array, alpha?: Uint8Array | null): Uint8Array {
  const entry = new Map<number, number>()
  for (let k = 0; k < palette.length / 3; k++) entry.set((palette[k * 3] << 16) | (palette[k * 3 + 1] << 8) | palette[k * 3 + 2], k)
  const out = new Uint8Array(rgb.length / 3)
  for (let i = 0, p = 0; i < rgb.length; i += 3, p++) {
    if (alpha && !alpha[p]) continue
    const k = entry.get((rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2])
    if (k === undefined) throw new Error('A colour is missing from the palette')
    out[p] = k
  }
  return out
}
