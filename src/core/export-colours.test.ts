import { describe, expect, it } from 'vitest'
import { readApng } from '../test/apng-frames'
import { NEUTRAL } from './adjust'
import { generateAnimatedExport } from './animate'
import { ColourCensus } from './census'
import { exportPng } from './export'
import { DEFAULT_FX } from './fx'
import { decodeGifFrames } from './gif-decode'
import { Deres, pixelsArePalette, type DeresSettings, type Rendered } from './pipeline'
import { decodePng } from './png'
import { PROFILES, profileById } from './profiles'

// Every download without a screen effect holds the very colours the preview
// shows, on every machine. The looks that make their own colours (15-bit
// direct colour, HAM, the N64 filter, the analog looks) once wrote their
// colour codes into the PNG as if they were palette entries.

/** Smooth colours, like a photo: thousands of them through the full-colour looks. */
function photo(w: number, h: number, seeThrough = false): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const d = Math.hypot(x - w * 0.4, y - h * 0.45) / w
      px[i] = Math.max(0, Math.min(255, 220 - d * 300 + Math.sin(x / 9) * 20))
      px[i + 1] = Math.max(0, Math.min(255, (y / h) * 200 + Math.cos(y / 7) * 15))
      px[i + 2] = Math.max(0, Math.min(255, (x / w) * 180 + d * 120))
      // See-through: a disc in the middle shows, the rest doesn't.
      px[i + 3] = seeThrough && Math.hypot(x - w / 2, y - h / 2) > h * 0.4 ? 0 : 255
    }
  }
  return px
}

const settings = (profileId: string, over: Partial<DeresSettings> = {}): DeresSettings => ({
  profileId,
  fit: 'fill',
  resolution: 'native',
  block: 8,
  background: 'white',
  adjust: { ...NEUTRAL },
  dither: profileById(profileId)!.dither,
  fx: { ...DEFAULT_FX },
  pixelShape: 'raw',
  ...over
})

const opaque = new Deres()
opaque.setSource(photo(320, 240), 320, 240, 320, 240)
const holed = new Deres()
holed.setSource(photo(320, 240, true), 320, 240, 320, 240)

const ownColours = PROFILES.filter((p) => !pixelsArePalette(p)).map((p) => p.id)

/** Pixels of an r, g, b, a picture (enlarged m times) that differ from the render; with `alpha`, hidden ones must be see-through. */
function mismatches(rgba: Uint8Array | Uint8ClampedArray, r: Rendered, m: number, alpha?: Uint8Array | null): number {
  const width = r.width * m
  let wrong = 0
  for (let p = 0; p < rgba.length / 4; p++) {
    const s = Math.floor(Math.floor(p / width) / m) * r.width + Math.floor((p % width) / m)
    if (alpha && !alpha[s]) {
      if (rgba[p * 4 + 3] !== 0) wrong++
      continue
    }
    if (rgba[p * 4] !== r.rgb[s * 3] || rgba[p * 4 + 1] !== r.rgb[s * 3 + 1] || rgba[p * 4 + 2] !== r.rgb[s * 3 + 2] || rgba[p * 4 + 3] !== 255) wrong++
  }
  return wrong
}

/** How many colours a render shows, or null past 256. */
function exactCount(r: Rendered): number | null {
  const census = new ColourCensus()
  census.add(r.rgb, r.alpha)
  const palette = census.palette()
  return palette ? palette.length / 3 : null
}

describe('the plain PNG is the preview, pixel for pixel', () => {
  it('the own-colour looks are the ones whose pixels aren’t palette entries', () => {
    expect(ownColours.sort()).toEqual(['amiga-ham6', 'ccd-early', 'deepfry', 'fax', 'n64', 'newspaper', 'ps1', 'risograph'])
  })

  it.each(PROFILES.map((p) => p.id))('%s', async (id) => {
    const r = opaque.render(settings(id))
    expect(r.indexed).toBe(pixelsArePalette(profileById(id)!))
    const png = await decodePng((await exportPng(r, { multiplier: 2, tv: false, fx: null })).png)
    expect([png.width, png.height]).toEqual([r.width * 2, r.height * 2])
    expect(mismatches(png.rgba, r, 2)).toBe(0)
  })

  it('machine palettes and few colours stay indexed; many colours go full colour', async () => {
    const decoded = async (id: string) => decodePng((await exportPng(opaque.render(settings(id)), { multiplier: 1, tv: false, fx: null })).png)
    // The machine's whole palette, in its order.
    const gb = await decoded('gameboy')
    expect(gb.colourType).toBe(3)
    expect(gb.palette!.length / 3).toBe(4)
    // Fax: exactly its two colours.
    const fax = await decoded('fax')
    expect(fax.colourType).toBe(3)
    expect(fax.palette!.length / 3).toBe(2)
    for (const id of ['ps1', 'n64', 'amiga-ham6', 'deepfry']) expect((await decoded(id)).colourType).toBe(2)
  })
})

describe('kept see-through pixels on the own-colour looks', () => {
  it.each([...ownColours, 'gameboy'])('%s', async (id) => {
    const r = holed.render(settings(id, { background: 'transparent' }))
    expect(r.alpha).toBeTruthy()
    const png = await decodePng((await exportPng(r, { multiplier: 1, tv: false, fx: null })).png)
    const n = exactCount(r)
    expect(png.colourType).toBe(n !== null && n <= 255 ? 3 : 6)
    expect(mismatches(png.rgba, r, 1, r.alpha)).toBe(0)
  })
})

describe('the Shimmer loop shows the preview’s colours', () => {
  const loop = (r: Rendered, s: DeresSettings, format: 'apng' | 'gif') =>
    generateAnimatedExport(r, { style: 'dither-shimmer', format, multiplier: 1, tv: false, fx: null }, s, (x) => opaque.render(x))

  it.each([...ownColours, 'gameboy', 'vga'])('%s', async (id) => {
    const s = settings(id)
    const r = opaque.render(s)
    const apng = await readApng((await loop(r, s, 'apng')).data)
    expect(mismatches(apng.frames[0].rgba, r, 1)).toBe(0)
    // A GIF holds 256 colours at most: exact while the picture fits them.
    if (exactCount(r) !== null) {
      const gif = decodeGifFrames((await loop(r, s, 'gif')).data)
      expect(mismatches(gif.frames[0].rgba, r, 1)).toBe(0)
    }
  })
})
