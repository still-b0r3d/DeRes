import { BYTE_TO_LINEAR, linearToByte, linearToOklab, linearToSrgb } from './color'
import type { PaletteMatcher } from './matcher'

// Joel Yliluoma's arbitrary-palette positional dithering ("algorithm 2").
//
// Ordered dithering normally adds a threshold to the pixel and takes the
// nearest colour, which only works when the palette is evenly spaced. This
// instead builds a "mixing plan" for each colour: a list of PLAN palette
// entries whose average is as close as possible to it, sorted by brightness.
// Each pixel then takes the entry its 8×8 Bayer threshold points at, so a
// patch of that colour shows the whole mix.
//
// Mixes are averaged in linear light (how the eye adds up the dots) and judged
// in sRGB with Yliluoma's luma-weighted distance. Plans are cached by the
// colour rounded to 16 steps per channel: at most 4,096 plans, so after the
// first render nearly every slider move is a cache hit (5-bit keys looked the
// same and were 3–4 times slower on smooth photos). Big palettes only mix
// from the 16 entries nearest the colour, which keeps every plan cheap.

export const PLAN = 64
const CANDIDATES = 16

// Linear light to sRGB (0–1) as a plain table: the plan search reads it
// hundreds of times per colour.
const TABLE_STEPS = 4096
const LIN_TO_SRGB = new Float32Array(TABLE_STEPS + 1)
for (let i = 0; i <= TABLE_STEPS; i++) LIN_TO_SRGB[i] = linearToSrgb(i / TABLE_STEPS)

// Plans are cached by the colour rounded to KEY_LEVELS steps per channel.
const KEY_BITS = 4
const KEY_LEVELS = (1 << KEY_BITS) - 1
const KEYS = 1 << (3 * KEY_BITS)

/** A byte's step (rounded to the nearest). */
function step(v8: number): number {
  return ((v8 * KEY_LEVELS + 127) / 255) | 0
}

/** The byte a step stands for (0 -> 0, top -> 255). */
function stepByte(k: number): number {
  return Math.round((k * 255) / KEY_LEVELS)
}

function keyOf(r8: number, g8: number, b8: number): number {
  return (step(r8) << (2 * KEY_BITS)) | (step(g8) << KEY_BITS) | step(b8)
}

export class YliluomaPlanner {
  private readonly plans = new Uint8Array(KEYS * PLAN)
  private readonly ready = new Uint8Array(KEYS)
  private readonly srgb: Float32Array
  private readonly order: Int32Array
  private readonly scratchLab = new Float64Array(3)
  private readonly all: number[]
  private readonly sortScratch = new Uint16Array(PLAN)

  constructor(private readonly m: PaletteMatcher) {
    this.all = [...Array(m.size).keys()]
    this.srgb = new Float32Array(m.size * 3)
    for (let i = 0; i < m.size * 3; i++) this.srgb[i] = m.bytes[i] / 255
    // Entries by brightness, so a plan can be sorted by rank.
    this.order = new Int32Array(m.size)
    const ranked = [...Array(m.size).keys()].sort((a, b) => m.luma[a] - m.luma[b] || a - b)
    ranked.forEach((entry, rank) => (this.order[entry] = rank))
  }

  /** Palette entry for a linear-light colour at Bayer threshold t (0 … PLAN-1). */
  pick(r: number, g: number, b: number, t: number): number {
    const r8 = linearToByte(r)
    const g8 = linearToByte(g)
    const b8 = linearToByte(b)
    // A palette colour is shown as itself. (Its plan would be built for the
    // rounded cache step, which can mix in a neighbour.)
    const near = this.m.nearestByte(r8, g8, b8)
    const nb = this.m.bytes
    if (nb[near * 3] === r8 && nb[near * 3 + 1] === g8 && nb[near * 3 + 2] === b8) return near
    const key = keyOf(r8, g8, b8)
    if (!this.ready[key]) {
      this.build(key)
      this.ready[key] = 1
    }
    return this.plans[key * PLAN + t]
  }

  /** The mixing plan for an sRGB colour (exposed for tests). */
  planFor(r8: number, g8: number, b8: number): Uint8Array {
    const key = keyOf(r8, g8, b8)
    if (!this.ready[key]) {
      this.build(key)
      this.ready[key] = 1
    }
    return this.plans.subarray(key * PLAN, key * PLAN + PLAN)
  }

  private build(key: number): void {
    const m = this.m
    const mask = (1 << KEY_BITS) - 1
    const r8 = stepByte(key >> (2 * KEY_BITS))
    const g8 = stepByte((key >> KEY_BITS) & mask)
    const b8 = stepByte(key & mask)
    const tr = r8 / 255
    const tg = g8 / 255
    const tb = b8 / 255
    const tl = tr * 0.299 + tg * 0.587 + tb * 0.114
    const cands = this.candidates(r8, g8, b8)
    const lin = m.linear
    const srgb = this.srgb
    const plan = this.plans.subarray(key * PLAN, key * PLAN + PLAN)

    let count = 0
    let sr = 0
    let sg = 0
    let sb = 0
    while (count < PLAN) {
      // Try adding each candidate 1, 2, 4 … times (never more than doubles
      // the plan so far) and keep the addition whose average lands closest.
      const maxAdd = Math.min(count === 0 ? 1 : count, PLAN - count)
      let best = Infinity
      let chosen = cands[0]
      let amount = 1
      for (let ci = 0; ci < cands.length; ci++) {
        const c = cands[ci]
        const cr = lin[c * 3]
        const cg = lin[c * 3 + 1]
        const cb = lin[c * 3 + 2]
        if (count === 0) {
          // A plan's first entry: plain nearest in this metric.
          const d = penalty(tr, tg, tb, tl, srgb[c * 3], srgb[c * 3 + 1], srgb[c * 3 + 2])
          if (d < best) {
            best = d
            chosen = c
          }
          continue
        }
        for (let p = 1; p <= maxAdd; p *= 2) {
          // The mix's average, linear -> sRGB through the table.
          const k = TABLE_STEPS / (count + p)
          const mr = LIN_TO_SRGB[((sr + cr * p) * k + 0.5) | 0]
          const mg = LIN_TO_SRGB[((sg + cg * p) * k + 0.5) | 0]
          const mb = LIN_TO_SRGB[((sb + cb * p) * k + 0.5) | 0]
          const d = penalty(tr, tg, tb, tl, mr, mg, mb)
          if (d < best) {
            best = d
            chosen = c
            amount = p
          }
        }
      }
      for (let i = 0; i < amount; i++) plan[count + i] = chosen
      count += amount
      sr += lin[chosen * 3] * amount
      sg += lin[chosen * 3 + 1] * amount
      sb += lin[chosen * 3 + 2] * amount
    }
    // Dark to light, so low thresholds take the dark entries. Sorted as
    // (rank << 8 | entry) numbers, which a typed array sorts natively.
    const keyed = this.sortScratch
    for (let i = 0; i < PLAN; i++) keyed[i] = (this.order[plan[i]] << 8) | plan[i]
    keyed.sort()
    for (let i = 0; i < PLAN; i++) plan[i] = keyed[i] & 255
  }

  private candidates(r8: number, g8: number, b8: number): number[] {
    const m = this.m
    if (m.size <= CANDIDATES) return this.all
    const all = this.all
    const t = this.scratchLab
    linearToOklab(BYTE_TO_LINEAR[r8], BYTE_TO_LINEAR[g8], BYTE_TO_LINEAR[b8], t)
    const lab = m.lab
    const dist = (i: number) =>
      (lab[i * 3] - t[0]) ** 2 + (lab[i * 3 + 1] - t[1]) ** 2 + (lab[i * 3 + 2] - t[2]) ** 2
    return all
      .map((i) => [i, dist(i)] as const)
      .sort((a, b) => a[1] - b[1] || a[0] - b[0])
      .slice(0, CANDIDATES)
      .map(([i]) => i)
  }
}

// Yliluoma's colour distance: RGB differences weighted by how bright each
// channel looks, plus the difference in luma.
function penalty(
  r1: number,
  g1: number,
  b1: number,
  l1: number,
  r2: number,
  g2: number,
  b2: number
): number {
  const dr = r1 - r2
  const dg = g1 - g2
  const db = b1 - b2
  const dl = l1 - (r2 * 0.299 + g2 * 0.587 + b2 * 0.114)
  return (dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114) * 0.75 + dl * dl
}

/** The colour a plan is actually built for (the cache step's centre). */
export function planColour(r8: number, g8: number, b8: number): [number, number, number] {
  return [stepByte(step(r8)), stepByte(step(g8)), stepByte(step(b8))]
}
