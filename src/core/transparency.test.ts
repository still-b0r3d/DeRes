import { describe, expect, it } from 'vitest'
import { NEUTRAL } from './adjust'
import { generateAnimatedExport, generateFramesExport } from './animate'
import { exportPng, exportWallpaper, wallpaperPresetById } from './export'
import { DEFAULT_FX, fxRenderer, type Fx } from './fx'
import { encodeRgbGif, withTransparentEntry } from './gif'
import { decodeGifFrames } from './gif-decode'
import { Deres, type DeresSettings, type Rendered } from './pipeline'
import { decodePng } from './png'
import { runSignal, signalFrame, DEFAULT_SIGNAL } from './signal'
import { analyzeTileFit } from './tiles'
import { encodeSettings } from './share'
import { readApng } from '../test/apng-frames'
import { testSignalEngine } from '../test/signal-engine'
import { checkSettings, defaultSettings, settingsFromHash } from '../ui/settings'

// Kept transparency: the background 'transparent'. Made-up pictures only (no
// photos in this repo): a disc of one colour on a see-through background,
// its edge anti-aliased, so some pixels are partly covered.

function disc(w: number, h: number, rgb: readonly [number, number, number], radius = 0.3, cx = 0.5, cy = 0.5): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4)
  const r = Math.min(w, h) * radius
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x + 0.5 - cx * w, y + 0.5 - cy * h)
      const cover = Math.min(1, Math.max(0, r - d + 0.5))
      px.set([rgb[0], rgb[1], rgb[2], Math.round(cover * 255)], (y * w + x) * 4)
    }
  }
  return px
}

/** A disc whose colour sweeps round the hue circle (lots of colours). */
function rainbowDisc(w: number, h: number): Uint8ClampedArray {
  const px = disc(w, h, [0, 0, 0], 0.45)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = Math.atan2(y - h / 2, x - w / 2)
      const l = 0.3 + (0.7 * y) / h
      const i = (y * w + x) * 4
      px[i] = 255 * l * (0.5 + 0.5 * Math.cos(t))
      px[i + 1] = 255 * l * (0.5 + 0.5 * Math.cos(t - 2.09))
      px[i + 2] = 255 * l * (0.5 + 0.5 * Math.cos(t + 2.09))
    }
  }
  return px
}

const settings = (over: Partial<DeresSettings> = {}): DeresSettings => ({
  profileId: 'gameboy',
  fit: 'fill',
  resolution: 'native',
  block: 8,
  background: 'transparent',
  adjust: { ...NEUTRAL },
  dither: 'floyd',
  fx: { ...DEFAULT_FX },
  pixelShape: 'raw',
  ...over
})

function loaded(px: Uint8ClampedArray, w: number, h: number): Deres {
  const d = new Deres()
  d.setSource(px, w, h, w, h)
  return d
}

const GREY: [number, number, number] = [128, 128, 128]
/** A plain CRT: glow on, no scanlines, mask or curve, so a flat picture stays flat. */
const FLAT_CRT: Fx = { ...DEFAULT_FX, screen: 'crt', scanlines: 0, mask: 'none', curve: 0, bloom: 0.6 }

/** Pixels that show next to one that doesn't (the edge). */
function edgePixels(r: Rendered): number[] {
  const a = r.alpha!
  const out: number[] = []
  for (let y = 1; y < r.height - 1; y++) {
    for (let x = 1; x < r.width - 1; x++) {
      const i = y * r.width + x
      if (a[i] && (!a[i - 1] || !a[i + 1] || !a[i - r.width] || !a[i + r.width])) out.push(i)
    }
  }
  return out
}

/** The picture's mask at an enlargement, nearest-neighbour (what the exports should hold). */
function maskAt(r: Rendered, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.min(r.width - 1, Math.floor((x * r.width) / width))
      const sy = Math.min(r.height - 1, Math.floor((y * r.height) / height))
      out[y * width + x] = r.alpha ? r.alpha[sy * r.width + sx] : 255
    }
  }
  return out
}

function alphaOf(rgba: Uint8Array | Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(rgba.length / 4)
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4 + 3]
  return out
}

describe('kept transparency in the pipeline', () => {
  it('shows a pixel when at least half of it is covered, and hides the rest', () => {
    const d = loaded(disc(320, 288, GREY), 320, 288)
    const r = d.render(settings())
    expect(r.alpha).toBeTruthy()
    const a = r.alpha!
    expect(a[72 * 160 + 80]).toBe(255) // the middle
    expect(a[0]).toBe(0) // a corner
    expect(new Set(a)).toEqual(new Set([0, 255]))
    // The disc is 0.3 of 288 px across, at 1/2 scale: about π × 43² pixels.
    const shown = a.reduce((n, v) => n + (v ? 1 : 0), 0)
    expect(Math.abs(shown - Math.PI * 43.2 * 43.2)).toBeLessThan(60)
    // White and black lay the background in, as before.
    expect(d.render(settings({ background: 'white' })).alpha ?? null).toBeNull()
    expect(d.render(settings({ background: 'black' })).alpha ?? null).toBeNull()
  })

  it('leaves a picture with nothing see-through exactly as it was', () => {
    const px = disc(320, 288, GREY)
    for (let i = 3; i < px.length; i += 4) px[i] = 255
    const d = loaded(px, 320, 288)
    for (const fit of ['fill', 'fit'] as const) {
      const keep = d.render(settings({ fit }))
      const white = d.render(settings({ fit, background: 'white' }))
      expect(keep.alpha ?? null).toBeNull()
      expect(Buffer.from(keep.rgb).equals(Buffer.from(white.rgb))).toBe(true)
    }
  })

  it('gives the edge no fringe from what was under it', () => {
    const d = loaded(disc(320, 288, GREY), 320, 288)
    // No dither: one grey disc comes out as one colour, partly covered edge
    // pixels included. On white or black they're lighter or darker.
    const flat = d.render(settings({ dither: 'none' }))
    const shown = flat.indices.filter((_, i) => flat.alpha![i])
    expect(new Set(shown).size).toBe(1)
    const edges = edgePixels(flat)
    const black = d.render(settings({ dither: 'none', background: 'black' }))
    expect(edges.some((i) => black.indices[i] < flat.indices[i])).toBe(true)
    // (A darker grey, so half white is a lighter shade.)
    const dark = loaded(disc(320, 288, [60, 60, 60]), 320, 288)
    const darkFlat = dark.render(settings({ dither: 'none' }))
    expect(new Set(darkFlat.indices.filter((_, i) => darkFlat.alpha![i])).size).toBe(1)
    const white = dark.render(settings({ dither: 'none', background: 'white' }))
    expect(edgePixels(darkFlat).some((i) => white.indices[i] > darkFlat.indices[i])).toBe(true)
    // Error diffusion: the edge uses the same two greys as the middle; on
    // white the light one creeps in, on black the dark one.
    const fs = d.render(settings({ dither: 'floyd' }))
    const middle = new Set(fs.indices.filter((_, i) => fs.alpha![i]))
    expect(new Set(edges.map((i) => fs.indices[i])).size).toBeLessThanOrEqual(middle.size)
    expect(fs.used).toBe(middle.size)
    expect(middle.size).toBeLessThanOrEqual(2)
    const fsWhite = d.render(settings({ dither: 'floyd', background: 'white' }))
    expect(edges.some((i) => !middle.has(fsWhite.indices[i]))).toBe(true)
  })

  it('counts only the colours that show', () => {
    const d = loaded(disc(320, 288, [200, 40, 40]), 320, 288)
    for (const profileId of ['pico8', 'snes', 'zx-spectrum', 'n64', 'amiga-ham6', 'deepfry']) {
      const r = d.render(settings({ profileId }))
      const seen = new Set<number>()
      for (let i = 0; i < r.width * r.height; i++) {
        if (r.alpha![i]) seen.add((r.rgb[i * 3] << 16) | (r.rgb[i * 3 + 1] << 8) | r.rgb[i * 3 + 2])
      }
      // Indexed machines count indices (the same thing for them); the rest count colours.
      expect(r.used, profileId).toBeLessThanOrEqual(Math.max(seen.size, 1))
      expect(r.used, profileId).toBeGreaterThan(0)
    }
  })

  it('makes the "fit" bars see-through, the picture carrying on into them', () => {
    // A wide picture on the Game Boy's screen: bars above and below.
    const d = loaded(disc(600, 200, GREY, 0.45), 600, 200)
    const r = d.render(settings({ fit: 'fit', dither: 'none' }))
    const { dst } = r.geometry
    expect(dst.y).toBeGreaterThan(0)
    for (let x = 0; x < r.width; x++) expect(r.alpha![x]).toBe(0)
    // Black on white or black, as before.
    const onWhite = d.render(settings({ fit: 'fit', dither: 'none', background: 'white' }))
    expect(Array.from(onWhite.rgb.subarray(0, 3))).toEqual([0x08, 0x18, 0x20])
  })

  it('writes hidden pixels into .chr tiles as colour 0, see-through on sprites', () => {
    const d = loaded(disc(320, 288, GREY, 0.2), 320, 288)
    const keep = d.render(settings())
    // Tile 0 (top left) is all hidden: colour 0 is all zero bits.
    expect(Array.from(keep.emulatorData!.data.subarray(0, 16)).every((b) => b === 0)).toBe(true)
    const black = d.render(settings({ background: 'black' }))
    expect(Array.from(black.emulatorData!.data.subarray(0, 16)).every((b) => b === 0xff)).toBe(true)
  })

  it('leaves hidden pixels out of the hardware-fit count', () => {
    const indices = new Uint8Array(16 * 8).map((_, i) => i % 7)
    const alpha = new Uint8Array(16 * 8).fill(0)
    const all = analyzeTileFit(indices, 16, 8)
    const none = analyzeTileFit(indices, 16, 8, undefined, alpha)
    expect(all.uniqueTiles).toBe(2)
    expect(none.uniqueTiles).toBe(1)
    expect(none.uniqueColours).toBe(0)
  })

  it('keeps it for an animation whose other frames have see-through parts', () => {
    const d = new Deres()
    const px = disc(320, 288, GREY)
    for (let i = 3; i < px.length; i += 4) px[i] = 255
    d.setSource(px, 320, 288, 320, 288, true)
    const r = d.render(settings({ fit: 'fit' }))
    expect(d.hasAlpha).toBe(true)
    // An opaque frame of it: everything shows (the frame fills the screen).
    expect(r.alpha ?? null).toBeNull()
  })
})

describe('kept transparency through the screen effects and the signal', () => {
  const d = loaded(disc(320, 288, GREY), 320, 288)
  const r = d.render(settings({ dither: 'none' }))

  it('shows an effect pixel only where the picture pixel under it shows, glow and all', () => {
    const W = r.width * 4
    const H = r.height * 4
    for (const screen of ['crt', 'vhs', 'composite', 'p1-green', 'lcd'] as const) {
      const render = fxRenderer({ rgb: r.rgb, width: r.width, height: r.height, paper: r.paper, alpha: r.alpha }, W, H, {
        ...FLAT_CRT,
        screen,
        vhsOsd: false
      })
      const row = new Uint8Array(W * 3)
      const a = new Uint8Array(W)
      const want = maskAt(r, W, H)
      let wrong = 0
      for (let y = 0; y < H; y++) {
        render(y, row, a)
        for (let x = 0; x < W; x++) if (a[x] !== want[y * W + x]) wrong++
      }
      // VHS jitters its bottom lines sideways: the outline goes with them.
      if (screen === 'vhs') expect(wrong, screen).toBeLessThan(W * H * 0.01)
      else expect(wrong, screen).toBe(0)
    }
  })

  it('gives the glow no dark ring at the edge', () => {
    const W = r.width * 3
    const H = r.height * 3
    const colours = (rr: Rendered, keep: boolean) => {
      const render = fxRenderer({ rgb: rr.rgb, width: rr.width, height: rr.height, paper: rr.paper, alpha: keep ? rr.alpha : null }, W, H, FLAT_CRT)
      const row = new Uint8Array(W * 3)
      const found = new Set<number>()
      const want = maskAt(r, W, H)
      for (let y = 0; y < H; y++) {
        render(y, row)
        for (let x = 0; x < W; x++) if (want[y * W + x]) found.add((row[x * 3] << 16) | (row[x * 3 + 1] << 8) | row[x * 3 + 2])
      }
      return found
    }
    // A flat disc stays one colour to its edge; on black, the glow darkens the edge.
    expect(colours(r, true).size).toBe(1)
    expect(colours(d.render(settings({ dither: 'none', background: 'black' })), false).size).toBeGreaterThan(1)
  })

  it('makes outside a curved screen see-through, and keeps the VHS OSD', () => {
    const W = r.width * 4
    const H = r.height * 4
    const render = fxRenderer({ rgb: r.rgb, width: r.width, height: r.height, paper: r.paper, alpha: r.alpha }, W, H, {
      ...DEFAULT_FX,
      screen: 'vhs',
      curve: 1,
      vhsOsd: true
    })
    const row = new Uint8Array(W * 3)
    const a = new Uint8Array(W)
    render(0, row, a)
    expect(a[0]).toBe(0)
    // "PLAY ▶" sits at the top left, over the see-through corner.
    let osd = 0
    for (let y = 0; y < 80; y++) {
      render(y, row, a)
      for (let x = 0; x < 200; x++) if (a[x]) osd++
    }
    expect(osd).toBeGreaterThan(0)
    // Without kept transparency, outside the screen stays black, as before.
    const opaque = fxRenderer({ rgb: r.rgb, width: r.width, height: r.height, paper: r.paper }, W, H, { ...DEFAULT_FX, screen: 'crt', curve: 1 })
    opaque(0, row, a)
    expect(a[0]).toBe(255)
    expect(row[0]).toBe(0)
  })

  it('cuts the signal at the picture’s outline', () => {
    const engine = testSignalEngine()
    for (const mode of ['composite', 'vhs-ep'] as const) {
      const img = runSignal(engine, r, 'gameboy', { ...DEFAULT_SIGNAL, mode }, 3)!
      expect(img.alpha).toBeTruthy()
      const W = r.width * 3
      const H = r.height * 3
      const frame = signalFrame(img, W, H, null, 0, r.paper)
      const want = maskAt(r, W, H)
      let wrong = 0
      for (let i = 0; i < W * H; i++) if (frame.alpha![i] !== want[i]) wrong++
      // Samples are resized across; the outline may land a sample either side.
      expect(wrong, mode).toBeLessThan(W * H * 0.01)
      const withCrt = signalFrame(img, W, H, FLAT_CRT, 0, r.paper)
      expect(withCrt.alpha!.some((v) => v === 0)).toBe(true)
    }
  })
})

describe('kept transparency in the files', () => {
  const d = loaded(disc(320, 288, GREY), 320, 288)
  const r = d.render(settings())

  it('a plain PNG: the palette plus one see-through entry', async () => {
    const out = await exportPng(r, { multiplier: 2, tv: false, fx: null })
    const png = await decodePng(out.png)
    expect(png.colourType).toBe(3)
    expect(png.palette!.length / 3).toBe(5)
    expect(Array.from(png.palette!.subarray(0, 12))).toEqual(Array.from(r.palette))
    expect(Buffer.from(alphaOf(png.rgba)).equals(Buffer.from(maskAt(r, out.width, out.height)))).toBe(true)
    // The shown pixels are the picture's own colours.
    for (let i = 0; i < out.width * out.height; i++) {
      if (!png.rgba[i * 4 + 3]) continue
      const sx = Math.floor((i % out.width) / 2)
      const sy = Math.floor(i / out.width / 2)
      const p = (sy * r.width + sx) * 3
      expect([png.rgba[i * 4], png.rgba[i * 4 + 1], png.rgba[i * 4 + 2]]).toEqual([r.rgb[p], r.rgb[p + 1], r.rgb[p + 2]])
    }
    // White, as before: no tRNS, four colours.
    const white = await decodePng((await exportPng(d.render(settings({ background: 'white' })), { multiplier: 2, tv: false, fx: null })).png)
    expect(white.palette!.length / 3).toBe(4)
    expect(alphaOf(white.rgba).every((v) => v === 255)).toBe(true)
  })

  it('a PNG with a full 256-colour palette goes full colour with alpha', async () => {
    const vga = loaded(rainbowDisc(640, 400), 640, 400).render(settings({ profileId: 'vga' }))
    expect(vga.palette.length / 3).toBe(256)
    const out = await exportPng(vga, { multiplier: 1, tv: false, fx: null })
    const png = await decodePng(out.png)
    expect(png.colourType).toBe(6)
    expect(Buffer.from(alphaOf(png.rgba)).equals(Buffer.from(vga.alpha!))).toBe(true)
  })

  it('a PNG with the screen effect, or the signal, has alpha', async () => {
    const out = await exportPng(r, { multiplier: 3, tv: false, fx: FLAT_CRT })
    expect(out.fx).toBe(true)
    const png = await decodePng(out.png)
    expect(png.colourType).toBe(6)
    expect(Buffer.from(alphaOf(png.rgba)).equals(Buffer.from(maskAt(r, out.width, out.height)))).toBe(true)

    const signal = runSignal(testSignalEngine(), r, 'gameboy', { ...DEFAULT_SIGNAL, mode: 'rf' }, 0)
    const sig = await decodePng((await exportPng(r, { multiplier: 2, tv: false, fx: null, signal })).png)
    expect(sig.colourType).toBe(6)
    expect(alphaOf(sig.rgba).some((v) => v === 0)).toBe(true)
    expect(alphaOf(sig.rgba).some((v) => v === 255)).toBe(true)
  })

  it('a wallpaper stays solid: see-through pixels take its backdrop colour', async () => {
    const preset = wallpaperPresetById('win95')!
    for (const fx of [null, FLAT_CRT]) {
      const out = await exportWallpaper(r, preset, { tv: false, fx })
      const png = await decodePng(out.png)
      expect(png.colourType).toBe(2)
      // The middle of the screen is the middle of the disc; its corner is backdrop.
      const corner = Array.from(png.rgba.subarray(0, 3))
      expect(corner).toEqual(Array.from(r.palette.subarray(0, 3)))
      const middle = (Math.floor(out.height / 2) * out.width + Math.floor(out.width / 2)) * 4
      expect(png.rgba[middle + 3]).toBe(255)
    }
  })

  it('a GIF: a transparent index, and each frame cleared after it shows', () => {
    const rgb = new Uint8Array(4 * 3).fill(200)
    const alpha = Uint8Array.of(255, 0, 255, 0)
    const gif = encodeRgbGif([{ width: 2, height: 2, rgb, alpha }, { width: 2, height: 2, rgb, alpha: Uint8Array.of(0, 255, 0, 255) }])
    const { frames } = decodeGifFrames(gif)
    expect(frames.map((f) => f.disposal)).toEqual([2, 2])
    expect(Array.from(alphaOf(frames[0].rgba))).toEqual([255, 0, 255, 0])
    // Frame 2's see-through pixels don't show frame 1.
    expect(Array.from(alphaOf(frames[1].rgba))).toEqual([0, 255, 0, 255])
    // Without alpha: no transparent index, frames kept (disposal 1), as before.
    const plain = decodeGifFrames(encodeRgbGif([{ width: 2, height: 2, rgb }])).frames
    expect(plain[0].disposal).toBe(1)
    expect(alphaOf(plain[0].rgba).every((v) => v === 255)).toBe(true)
  })

  it('a full palette gives up its least-used colour for the see-through entry', () => {
    const palette = new Uint8Array(256 * 3).map((_, i) => i % 256)
    const indices = Uint8Array.of(0, 0, 0, 5, 5, 7, 9)
    const alpha = Uint8Array.of(255, 255, 255, 255, 255, 0, 255)
    const t = withTransparentEntry(palette, indices, alpha)
    expect(t.palette).toBe(palette)
    // Colour 1 isn't used at all: it becomes the see-through one, nothing moves.
    expect(t.transparentIndex).toBe(1)
    expect(Array.from(t.indices)).toEqual([0, 0, 0, 5, 5, 1, 9])
    const small = withTransparentEntry(Uint8Array.of(1, 2, 3, 4, 5, 6), Uint8Array.of(0, 1), Uint8Array.of(255, 0))
    expect(small.transparentIndex).toBe(2)
    expect(small.palette.length).toBe(9)
    expect(Array.from(small.indices)).toEqual([0, 2])
  })

  it.each(['gif', 'apng'] as const)('every loop style keeps it (%s)', async (format) => {
    const sourceRgba = disc(320, 288, GREY)
    for (const style of ['screen-fx', 'compare-wipe', 'dither-shimmer'] as const) {
      for (const fx of [null, FLAT_CRT]) {
        const res = await generateAnimatedExport(
          r,
          { style, format, multiplier: 3, tv: false, fx, sourceRgba, sourceWidth: 320, sourceHeight: 288, seeThrough: true },
          settings(),
          (s) => d.render(s)
        )
        const frames =
          format === 'gif'
            ? decodeGifFrames(res.data).frames.map((f) => alphaOf(f.rgba))
            : (await readApng(res.data)).frames.map((f) => alphaOf(f.rgba))
        const want = maskAt(r, res.width, res.height)
        // The A/B wipe shows all of the DeRes picture at frames 8 and 9 (frame 0 is the original).
        const k = style === 'compare-wipe' ? 9 : 0
        let wrong = 0
        for (let i = 0; i < want.length; i++) if (frames[k][i] !== want[i]) wrong++
        expect(wrong, `${style} ${fx ? 'crt' : 'plain'}`).toBe(0)
        expect(frames[0].some((v) => v === 0)).toBe(true)
      }
    }
  }, 30_000)

  it.each(['gif', 'apng'] as const)('an animated GIF’s own frames keep their own outlines (%s)', async (format) => {
    // Two frames, the disc moving: frame 2 hides where frame 1 showed.
    const pics = [disc(320, 288, GREY, 0.2, 0.3), disc(320, 288, GREY, 0.2, 0.7)]
    const renders = pics.map((px) => {
      const dd = new Deres()
      dd.setSource(px, 320, 288, 320, 288, true)
      return dd.render(settings())
    })
    for (const fx of [null, FLAT_CRT]) {
      for (const indexed of [true, false]) {
        const res = await generateFramesExport({
          format,
          multiplier: 3,
          tv: false,
          fx,
          delaysMs: [100, 100],
          loopCount: 0,
          render: (k) => renders[k],
          indexed,
          sharedPalette: true,
          seeThrough: true
        })
        const frames =
          format === 'gif'
            ? decodeGifFrames(res.data).frames.map((f) => alphaOf(f.rgba))
            : (await readApng(res.data)).frames.map((f) => alphaOf(f.rgba))
        for (let k = 0; k < 2; k++) {
          const want = maskAt(renders[k], res.width, res.height)
          let wrong = 0
          for (let i = 0; i < want.length; i++) if (frames[k][i] !== want[i]) wrong++
          expect(wrong, `frame ${k} ${fx ? 'crt' : 'plain'} ${indexed ? 'indexed' : 'full colour'}`).toBe(0)
        }
      }
    }
  }, 30_000)

  it('a full-colour GIF past the budget keeps it too (made in two passes)', async () => {
    const renders = [disc(320, 288, GREY, 0.2, 0.3), disc(320, 288, GREY, 0.2, 0.7)].map((px) => {
      const dd = new Deres()
      dd.setSource(px, 320, 288, 320, 288, true)
      return dd.render(settings())
    })
    const res = await generateFramesExport({
      format: 'gif',
      multiplier: 3,
      tv: false,
      fx: FLAT_CRT,
      delaysMs: [100, 100],
      loopCount: 0,
      render: (k) => renders[k],
      indexed: false,
      sharedPalette: false,
      seeThrough: true,
      budget: 1
    })
    const frames = decodeGifFrames(res.data).frames
    expect(Buffer.from(alphaOf(frames[1].rgba)).equals(Buffer.from(maskAt(renders[1], res.width, res.height)))).toBe(true)
  })
})

describe('the setting', () => {
  it('is saved, checked and shared', () => {
    const s = { ...defaultSettings(), background: 'transparent' as const }
    expect(checkSettings({ background: 'transparent' }, defaultSettings()).background).toBe('transparent')
    expect(checkSettings({ background: 'see-through' }, defaultSettings()).background).toBe('white')
    expect(settingsFromHash(encodeSettings(s), defaultSettings())!.background).toBe('transparent')
  })
})
