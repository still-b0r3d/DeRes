import { describe, expect, it } from 'vitest'
import { NEUTRAL } from './adjust'
import { hexToRgb } from './color'
import { exportPng, FX_MIN_MULTIPLIER } from './export'
import { DEFAULT_FX } from './fx'
import { colourCount, Deres, exportSize, MAX_EXPORT_PIXELS, paletteBytes, type DeresSettings } from './pipeline'
import { decodePng } from './png'
import { PROFILES, profileById } from './profiles'

// A made-up test picture (no photos in this repo): a hue sweep left to right,
// dark to light top to bottom, with a transparent corner.
function testPicture(w: number, h: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = x / (w - 1)
      const l = y / (h - 1)
      const i = (y * w + x) * 4
      px[i] = 255 * l * (0.5 + 0.5 * Math.cos(t * 6.28))
      px[i + 1] = 255 * l * (0.5 + 0.5 * Math.cos(t * 6.28 - 2.09))
      px[i + 2] = 255 * l * (0.5 + 0.5 * Math.cos(t * 6.28 + 2.09))
      px[i + 3] = x < w / 8 && y < h / 8 ? 0 : 255
    }
  }
  return px
}

const settings = (over: Partial<DeresSettings> = {}): DeresSettings => ({
  profileId: 'gameboy',
  fit: 'fill',
  resolution: 'native',
  block: 8,
  background: 'white',
  adjust: { ...NEUTRAL },
  dither: 'floyd',
  fx: { ...DEFAULT_FX },
  pixelShape: 'raw',
  ...over
})

function loaded(): Deres {
  const d = new Deres()
  d.setSource(testPicture(400, 300), 400, 300, 4000, 3000)
  return d
}

describe('the DeRes pipeline', () => {
  it('needs a picture first', () => {
    expect(() => new Deres().render(settings())).toThrow()
  })

  it('reports transparency', () => {
    const d = new Deres()
    expect(d.setSource(testPicture(16, 16), 16, 16, 16, 16).hasAlpha).toBe(true)
    const opaque = new Uint8ClampedArray(4 * 4 * 4).fill(255)
    expect(d.setSource(opaque, 4, 4, 4, 4).hasAlpha).toBe(false)
  })

  it.each(PROFILES.map((p) => p.id))('%s renders at its size using only its colours', (id) => {
    const r = loaded().render(settings({ profileId: id, dither: profileById(id)!.dither }))
    const p = profileById(id)!
    expect(r.width).toBe(p.width)
    if (p.height !== 'auto') expect(r.height).toBe(p.height)
    if (p.palette.kind === 'fixed') {
      const allowed = new Set(p.palette.colours)
      for (let i = 0; i < r.width * r.height; i += 97) {
        const hex = '#' + [...r.rgb.subarray(i * 3, i * 3 + 3)].map((v) => v.toString(16).padStart(2, '0')).join('')
        expect(allowed.has(hex)).toBe(true)
      }
      expect(r.used).toBeGreaterThan(1)
      expect(r.used).toBeLessThanOrEqual(p.palette.colours.length)
    } else {
      expect(r.used).toBeGreaterThan(1)
    }
  })

  it('fills "fit" bars with the darkest colour', () => {
    const r = loaded().render(settings({ profileId: 'pico8', fit: 'fit', dither: 'none' }))
    // 4:3 photo on a square screen: bars above and below.
    expect(r.geometry.dst.y).toBeGreaterThan(0)
    expect([...r.rgb.subarray(0, 3)]).toEqual(hexToRgb('#000000'))
  })

  it('shows transparent parts on the chosen background', () => {
    const d = loaded()
    const white = d.render(settings({ profileId: 'mac', fit: 'stretch', dither: 'none', background: 'white' }))
    const black = d.render(settings({ profileId: 'mac', fit: 'stretch', dither: 'none', background: 'black' }))
    expect(white.rgb[0]).toBe(255)
    expect(black.rgb[0]).toBe(0)
  })

  it('pre-filters change the result', () => {
    const d = loaded()
    const before = d.render(settings({ dither: 'none' }))
    const after = d.render(settings({ dither: 'none', adjust: { ...NEUTRAL, brightness: 0.3 } }))
    const sum = (a: Uint8Array) => a.reduce((s, v) => s + v, 0)
    expect(sum(after.indices)).toBeGreaterThan(sum(before.indices))
  })

  it("only uses the Game Boy Camera's dither on the camera", () => {
    const d = loaded()
    const cam = d.render(settings({ profileId: 'gameboy-camera', dither: 'gbcam' }))
    expect(cam.used).toBe(4)
    // Elsewhere it falls back to the machine's own default.
    const ega = d.render(settings({ profileId: 'ega', dither: 'gbcam' }))
    const egaDefault = d.render(settings({ profileId: 'ega', dither: profileById('ega')!.dither }))
    expect(ega.indices).toEqual(egaDefault.indices)
  })

  it('lists grey-level palettes darkest first', () => {
    const bytes = paletteBytes(profileById('receipt')!)
    expect(bytes[0]).toBeLessThan(bytes[3])
  })
})

describe('export', () => {
  const rendered = () => loaded().render(settings({ profileId: 'cga-1', dither: 'bayer4' }))

  it('sizes by whole multiples, or stretched to the pixel shape', () => {
    expect(exportSize(320, 200, [5, 6], 4, false)).toEqual([1280, 800])
    expect(exportSize(320, 200, [5, 6], 6, true)).toEqual([1600, 1200])
    expect(exportSize(160, 144, [1, 1], 3, true)).toEqual([480, 432])
  })

  it('writes an indexed PNG with the exact palette, every pixel a crisp block', async () => {
    const r = rendered()
    const out = await exportPng(r, { multiplier: 3, tv: false, fx: null })
    expect([out.width, out.height, out.fx]).toEqual([960, 600, false])
    const png = await decodePng(out.png)
    expect([png.width, png.height, png.colourType]).toEqual([960, 600, 3])
    expect(png.palette).toEqual(r.palette)
    for (const [x, y] of [
      [0, 0],
      [100, 50],
      [319, 199]
    ]) {
      const want = r.indices[y * 320 + x]
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) expect(png.indices![(y * 3 + dy) * 960 + x * 3 + dx]).toBe(want)
    }
  })

  it('stretches columns for "as on a TV"', async () => {
    const out = await exportPng(rendered(), { multiplier: 6, tv: true, fx: null })
    expect([out.width, out.height]).toEqual([1600, 1200])
  })

  it('bakes in the screen effect only from 3× up, as full colour', async () => {
    const r = rendered()
    const fx = { ...DEFAULT_FX, screen: 'crt' as const }
    const small = await exportPng(r, { multiplier: FX_MIN_MULTIPLIER - 1, tv: false, fx })
    expect(small.fx).toBe(false)
    const big = await exportPng(r, { multiplier: FX_MIN_MULTIPLIER, tv: false, fx })
    expect(big.fx).toBe(true)
    expect((await decodePng(big.png)).colourType).toBe(2)
  })

  it('refuses exports too big for a phone to hold', async () => {
    const r = rendered()
    const m = Math.ceil(Math.sqrt(MAX_EXPORT_PIXELS / (320 * 200))) + 1
    await expect(exportPng(r, { multiplier: m, tv: false, fx: null })).rejects.toThrow('too big')
  })

  it('quantizes range profiles according to their bit grid and count', () => {
    const d = loaded()
    const sms = d.render(settings({ profileId: 'mastersystem', dither: 'floyd' }))
    expect(sms.palette.length / 3).toBeLessThanOrEqual(32)
    // Master System is 2-bit channel grid (values in 0, 85, 170, 255)
    const allowed2Bit = new Set([0, 85, 170, 255])
    for (let i = 0; i < sms.palette.length; i++) {
      expect(allowed2Bit.has(sms.palette[i])).toBe(true)
    }

    const snes = d.render(settings({ profileId: 'snes', dither: 'floyd' }))
    expect(snes.palette.length / 3).toBeLessThanOrEqual(256)
  })

  it('renders PlayStation profile with 15-bit direct hardware dither and exports cleanly', async () => {
    const d = loaded()
    const ps = d.render(settings({ profileId: 'ps1', dither: 'ps1' }))
    expect(ps.width).toBe(320)
    expect(ps.height).toBe(240)
    expect(ps.used).toBeGreaterThan(1)
    const out = await exportPng(ps, { multiplier: 2, tv: false, fx: null })
    expect(out.width).toBe(640)
    expect(out.height).toBe(480)
    const decoded = await decodePng(out.png)
    expect(decoded.width).toBe(640)
  })

  it('respects custom loaded palette', () => {
    const d = loaded()
    const custom = ['#112233', '#445566', '#778899']
    const r = d.render(settings({ profileId: 'custom', customPalette: custom, dither: 'none' }))
    expect(r.palette.length / 3).toBe(3)
    expect(r.used).toBeLessThanOrEqual(3)
  })
})


describe('how many colours a machine gets', () => {
  const used = (profileId: string, customCount?: number) =>
    loaded().render(settings({ profileId, dither: 'none', customCount })).used

  it("range and pool machines use their own count unless the slider asks for fewer", () => {
    expect(colourCount(profileById('snes')!)).toBe(256)
    expect(colourCount(profileById('vga')!)).toBe(256)
    expect(colourCount(profileById('amstrad-cpc-1')!)).toBe(4)
    expect(colourCount(profileById('snes')!, 32)).toBe(32)
    // Never more than the machine had, never fewer than 2.
    expect(colourCount(profileById('amstrad-cpc-1')!, 16)).toBe(4)
    expect(colourCount(profileById('vga')!, 100000)).toBe(256)
    expect(colourCount(profileById('vga')!, 1)).toBe(2)
    // The Custom machine: 2 to 256, 16 to start with.
    expect(colourCount(profileById('custom')!)).toBe(16)
    expect(colourCount(profileById('custom')!, 200)).toBe(200)
    expect(colourCount(profileById('gameboy')!)).toBeNull()
  })

  it('the picture really uses them', () => {
    expect(used('snes')).toBeGreaterThan(100)
    expect(used('vga')).toBeGreaterThan(100)
    expect(used('amstrad-cpc-1')).toBeLessThanOrEqual(4)
    expect(used('amstrad-cpc-1', 16)).toBeLessThanOrEqual(4)
    expect(used('snes', 8)).toBeLessThanOrEqual(8)
  })
})

describe('a grabbed or loaded palette', () => {
  const grabbed = ['#ff0000', '#00ff00', '#0000ff']
  const hexes = (pal: Uint8Array) =>
    Array.from({ length: pal.length / 3 }, (_, i) => '#' + [...pal.subarray(i * 3, i * 3 + 3)].map((v) => v.toString(16).padStart(2, '0')).join(''))

  it('is used by the Custom machine', () => {
    const r = loaded().render(settings({ profileId: 'custom', dither: 'none', customPalette: grabbed }))
    expect(hexes(r.palette)).toEqual(grabbed)
  })

  it.each(['genesis', 'vga', 'atari-st', 'amstrad-cpc-0'])('is not used by %s', (id) => {
    const r = loaded().render(settings({ profileId: id, dither: 'none', customPalette: grabbed }))
    expect(hexes(r.palette)).not.toEqual(grabbed)
    expect(r.palette.length / 3).toBeGreaterThan(3)
  })
})

describe('.chr tile exports', () => {
  /** The 64 pixel values of tile t: Game Boy (rows of low/high byte pairs) or NES (8 low bytes, then 8 high). */
  const tile = (chr: Uint8Array, t: number, nes: boolean) =>
    Array.from({ length: 64 }, (_, i) => {
      const row = i >> 3
      const bit = 7 - (i & 7)
      const lo = chr[t * 16 + (nes ? row : row * 2)]
      const hi = chr[t * 16 + (nes ? row + 8 : row * 2 + 1)]
      return ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1)
    })
  const firstTile = (indices: Uint8Array, width: number) =>
    Array.from({ length: 64 }, (_, i) => indices[(i >> 3) * width + (i & 7)])

  it.each(['gameboy', 'gameboy-pocket', 'gameboy-camera'])('%s: colour 0 is the lightest, as the hardware shows it', (id) => {
    const r = loaded().render(settings({ profileId: id, dither: 'none' }))
    expect(r.emulatorData?.format).toBe('chr')
    // Indices count darkest first (0 = darkest); the Game Boy counts lightest first.
    expect(tile(r.emulatorData!.data, 0, false)).toEqual(firstTile(r.indices, r.width).map((v) => 3 - v))
  })

  it("Game Boy Color: each pixel's number within its tile's palette", () => {
    const r = loaded().render(settings({ profileId: 'gbc', dither: 'none' }))
    expect(tile(r.emulatorData!.data, 0, false)).toEqual(firstTile(r.indices, r.width).map((v) => v & 3))
  })

  it("NES (attributes): real NES tiles, one number per colour of the tile's sub-palette", () => {
    // A busy, opaque picture, so the first tile holds several colours.
    const d = new Deres()
    const px = new Uint8ClampedArray(256 * 240 * 4)
    for (let i = 0; i < 256 * 240; i++) px.set([(i * 37) % 256, (i * 91) % 256, (i * 53) % 256, 255], i * 4)
    d.setSource(px, 256, 240, 256, 240)
    const r = d.render(settings({ profileId: 'nes-attr', dither: 'none' }))
    const chr = r.emulatorData!.data
    expect(chr.length % 16).toBe(0)
    // Tile 0 is always first in the file. Within it, the same NES colour must
    // always get the same number, and different colours different numbers.
    const nums = tile(chr, 0, true)
    const colours = firstTile(r.indices, r.width)
    expect(new Set(colours).size).toBeGreaterThan(2)
    expect(new Set(colours.map((c, i) => `${c}:${nums[i]}`)).size).toBe(new Set(colours).size)
    expect(new Set(nums).size).toBe(new Set(colours).size)
  })

  it('the plain NES look (any colour anywhere) offers no .chr: a real NES could not show it', () => {
    expect(profileById('nes')!.limits?.emulatorFormats ?? []).not.toContain('chr')
    expect(profileById('nes')!.exportNote).toMatch(/NES \(attributes\)/)
    expect(loaded().render(settings({ profileId: 'nes' })).emulatorData).toBeUndefined()
  })
})

