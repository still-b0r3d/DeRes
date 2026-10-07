import { BYTE_TO_LINEAR, linearToByte, linearToOklab, luminance } from './color'

// Finds the nearest palette colour to a linear-light colour, compared in
// OKLab. Answers are cached by the colour cut to 6 bits per channel (262,144
// entries, filled in as they're needed), so after the first few thousand
// pixels a lookup is a single array read. One matcher per palette; a new
// palette gets a new matcher, so the cache never needs clearing.

const EMPTY = 0xffff

/** The byte a 6-bit cache bucket stands for (0 -> 0, 63 -> 255). */
export function bucketByte(k: number): number {
  return (k << 2) | (k >> 4)
}

export class PaletteMatcher {
  readonly size: number
  /** The colours matched against, as sRGB bytes (r, g, b per entry). */
  readonly bytes: Uint8Array
  /** The same colours in linear light. */
  readonly linear: Float32Array
  readonly lab: Float32Array
  readonly luma: Float32Array
  /** Typical gap between neighbouring colours (sRGB, 0–1), for ordered dithering. */
  readonly spread: number
  private readonly cache = new Uint16Array(1 << 18).fill(EMPTY)
  private readonly target = new Float64Array(3)

  constructor(colours: Uint8Array) {
    if (colours.length === 0 || colours.length % 3 !== 0 || colours.length / 3 > 256) {
      throw new Error('A palette needs 1 to 256 colours')
    }
    this.size = colours.length / 3
    this.bytes = Uint8Array.from(colours)
    this.linear = new Float32Array(this.size * 3)
    this.lab = new Float32Array(this.size * 3)
    this.luma = new Float32Array(this.size)
    for (let i = 0; i < this.size; i++) {
      const r = BYTE_TO_LINEAR[colours[i * 3]]
      const g = BYTE_TO_LINEAR[colours[i * 3 + 1]]
      const b = BYTE_TO_LINEAR[colours[i * 3 + 2]]
      this.linear.set([r, g, b], i * 3)
      linearToOklab(r, g, b, this.lab, i * 3)
      this.luma[i] = luminance(r, g, b)
    }
    this.spread = this.measureSpread()
  }

  /** Nearest entry to a linear-light colour (values outside 0–1 are clamped). */
  nearest(r: number, g: number, b: number): number {
    return this.nearestByte(linearToByte(r), linearToByte(g), linearToByte(b))
  }

  /** Nearest entry to an sRGB colour given as bytes. */
  nearestByte(r8: number, g8: number, b8: number): number {
    const key = ((r8 >> 2) << 12) | ((g8 >> 2) << 6) | (b8 >> 2)
    let idx = this.cache[key]
    if (idx === EMPTY) {
      idx = this.search(bucketByte(r8 >> 2), bucketByte(g8 >> 2), bucketByte(b8 >> 2))
      this.cache[key] = idx
    }
    return idx
  }

  /** Full search, no cache: the entry closest in OKLab to an sRGB colour. */
  search(r8: number, g8: number, b8: number): number {
    const t = this.target
    linearToOklab(BYTE_TO_LINEAR[r8], BYTE_TO_LINEAR[g8], BYTE_TO_LINEAR[b8], t)
    const lab = this.lab
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < this.size; i++) {
      const dl = lab[i * 3] - t[0]
      const da = lab[i * 3 + 1] - t[1]
      const db = lab[i * 3 + 2] - t[2]
      const d = dl * dl + da * da + db * db
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return best
  }

  // The mean, over all entries, of the distance to the closest other entry
  // (largest single-channel difference, sRGB). Black and white gives 1, so an
  // ordered dither spans the full range; the EGA's steps of 0x55 give a
  // third, the web-safe cube's steps of 0x33 a fifth.
  private measureSpread(): number {
    if (this.size < 2) return 0
    const c = this.bytes
    let total = 0
    for (let i = 0; i < this.size; i++) {
      let min = Infinity
      for (let j = 0; j < this.size; j++) {
        if (i === j) continue
        const d =
          Math.max(
            Math.abs(c[i * 3] - c[j * 3]),
            Math.abs(c[i * 3 + 1] - c[j * 3 + 1]),
            Math.abs(c[i * 3 + 2] - c[j * 3 + 2])
          ) / 255
        if (d > 0 && d < min) min = d
      }
      if (min < Infinity) total += min
    }
    return total / this.size
  }
}
