import { describe, expect, it } from 'vitest'
import { testSignalEngine } from '../test/signal-engine'
import { DEFAULT_FX } from './fx'
import type { Rendered } from './pipeline'
import { CGA_COMPOSITE_PALETTE } from './profiles'
import {
  artifactPalette,
  cgaPattern,
  checkSignal,
  DEFAULT_SIGNAL,
  engineSettings,
  engineStep,
  resampleSignal,
  resolveConnection,
  runSignal,
  signalFrame,
  signalInput,
  signalMachine,
  type SignalSettings
} from './signal'

const ON: SignalSettings = { ...DEFAULT_SIGNAL, mode: 'composite' }

function picture(width: number, height: number, colour: (x: number, y: number) => [number, number, number]): Rendered {
  const rgb = new Uint8Array(width * height * 3)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgb.set(colour(x, y), (y * width + x) * 3)
  return {
    width,
    height,
    rgb,
    indices: new Uint8Array(width * height),
    palette: new Uint8Array(0),
    used: 0,
    geometry: { width, height, src: { x: 0, y: 0, w: width, h: height }, dst: { x: 0, y: 0, w: width, h: height }, par: [1, 1] },
    paper: [255, 255, 255]
  }
}

/** Hue (degrees) and colourfulness of an sRGB colour in the TV's I/Q plane. */
function iq(r: number, g: number, b: number): { hue: number; chroma: number } {
  const i = (0.5959 * r - 0.2746 * g - 0.3213 * b) / 255
  const q = (0.2115 * r - 0.5227 * g + 0.3112 * b) / 255
  return { hue: ((Math.atan2(q, i) * 180) / Math.PI + 360) % 360, chroma: Math.hypot(i, q) }
}
const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

function mean(img: { rgb: Uint8Array; width: number }, x0: number, x1: number, y0: number, y1: number, parity?: 0 | 1): [number, number, number] {
  const acc = [0, 0, 0]
  let n = 0
  for (let y = y0; y < y1; y++) {
    if (parity !== undefined && (y & 1) !== parity) continue
    for (let x = x0; x < x1; x++) {
      for (let c = 0; c < 3; c++) acc[c] += img.rgb[(y * img.width + x) * 3 + c]
      n++
    }
  }
  return acc.map((v) => v / n) as [number, number, number]
}

describe('signal engine', () => {
  const engine = testSignalEngine()

  it('loads, and its defaults are a full settings file', () => {
    const d = JSON.parse(engine.defaultsJson)
    expect(d.version).toBe(1)
    expect(d).toHaveProperty('composite_preemphasis')
    expect(d).toHaveProperty('vhs_edge_wave_speed')
  })

  it('does nothing while the signal is off', () => {
    expect(runSignal(engine, picture(32, 24, () => [90, 90, 90]), 'ega', DEFAULT_SIGNAL, 0)).toBeNull()
  })

  it('gives the same picture for the same frame, and moves the noise between frames', () => {
    const r = picture(160, 120, (x, y) => [(x * 7) & 255, (y * 5) & 255, 128])
    const vhs = { ...DEFAULT_SIGNAL, mode: 'vhs-sp' as const }
    const a = runSignal(engine, r, 'nes', vhs, 3)!
    runSignal(engine, r, 'nes', vhs, 7)
    const b = runSignal(engine, r, 'nes', vhs, 3)!
    const c = runSignal(engine, r, 'nes', vhs, 4)!
    expect(Buffer.from(a.rgb).equals(Buffer.from(b.rgb))).toBe(true)
    let changed = 0
    for (let i = 0; i < a.rgb.length; i++) if (a.rgb[i] !== c.rgb[i]) changed++
    expect(changed / a.rgb.length).toBeGreaterThan(0.3)
  })

  it('sends each pixel for as long as the machine held it on the wire', () => {
    const r = picture(320, 224, () => [0, 0, 0])
    expect(signalInput(r, signalMachine('genesis', 320)).width).toBe(683)
    expect(signalInput(picture(256, 240, () => [0, 0, 0]), signalMachine('nes', 256)).width).toBe(683)
    expect(signalInput(picture(160, 192, () => [0, 0, 0]), signalMachine('atari-2600', 160)).width).toBe(640)
    // A machine with no TV output gets about an NTSC picture's width.
    expect(signalMachine('gameboy', 160).samplesPerPixel).toBe(4)
    expect(signalMachine('ccd-early', 640).samplesPerPixel).toBe(1)
  })

  it('keeps the edges: no dark ramp down the left side', () => {
    const grey = runSignal(engine, picture(128, 96, () => [150, 150, 150]), 'ega', { ...ON, wear: 0 }, 0)!
    const left = mean(grey, 0, 2, 10, 86)
    const middle = mean(grey, 100, 140, 10, 86)
    for (let c = 0; c < 3; c++) expect(Math.abs(left[c] - middle[c])).toBeLessThan(12)
  })

  it('turns CGA bit patterns into the cga-composite colours, the same on every line', () => {
    // 16 bands, one per colour, through the composite signal with the noise off.
    const w = 320, h = 40, band = 20
    const r = picture(w, h, () => [0, 0, 0])
    r.palette = Uint8Array.from(CGA_COMPOSITE_PALETTE.flatMap((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))))
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) r.indices[y * w + x] = Math.floor(x / band)
    const img = runSignal(engine, r, 'cga-composite', { ...ON, wear: 0, sharpen: 0 }, 0)!
    expect(img.width).toBe(640)
    const offs: number[] = []
    for (const k of [1, 2, 3, 4, 6, 8, 9, 11, 12, 13, 14]) {
      const x0 = k * band * 2 + 10, x1 = (k + 1) * band * 2 - 10
      const even = iq(...mean(img, x0, x1, 4, h - 4, 0))
      const odd = iq(...mean(img, x0, x1, 4, h - 4, 1))
      const want = iq(...(Array.from(r.palette.subarray(k * 3, k * 3 + 3)) as [number, number, number]))
      // Locked line timing: odd lines show the same colour as even ones.
      expect(hueGap(even.hue, odd.hue)).toBeLessThan(10)
      offs.push(hueGap(even.hue, want.hue))
    }
    const rms = Math.sqrt(offs.reduce((a, b) => a + b * b, 0) / offs.length)
    expect(rms).toBeLessThan(35)
    // Black and white patterns stay black and white.
    expect(cgaPattern(0)).toBe(0)
    expect(cgaPattern(15)).toBe(15)
  })

  it('flips the colour every other line on broadcast timing (that is what the lock is for)', () => {
    const w = 320, h = 40
    const r = picture(w, h, (x) => (x & 1 ? [255, 255, 255] : [0, 0, 0]))
    const locked = runSignal(engine, r, 'cga-1', { ...ON, wear: 0 }, 0)!
    const broadcast = runSignal(engine, r, 'amiga-ham6', { ...ON, wear: 0 }, 0)!
    const flip = (img: typeof locked) => hueGap(iq(...mean(img, 40, img.width - 40, 4, h - 4, 0)).hue, iq(...mean(img, 40, img.width - 40, 4, h - 4, 1)).hue)
    expect(flip(locked)).toBeLessThan(10)
    expect(flip(broadcast)).toBeGreaterThan(90)
  })

  it("measures the colours CGA composite's patterns really make, for the dither to aim at", () => {
    const pal = artifactPalette(engine, 'cga-composite', ON)!
    expect(pal).toHaveLength(16)
    const rgb = pal.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number])
    expect(Math.max(...rgb[0])).toBeLessThan(20)
    expect(Math.min(...rgb[15])).toBeGreaterThan(235)
    // 0101 and 1010 run at twice the carrier: grey, no colour.
    expect(iq(...rgb[5]).chroma).toBeLessThan(0.05)
    expect(iq(...rgb[10]).chroma).toBeLessThan(0.05)
    for (const k of [1, 2, 4, 8, 6, 9]) expect(iq(...rgb[k]).chroma).toBeGreaterThan(0.1)
    expect(artifactPalette(engine, 'cga-composite', DEFAULT_SIGNAL)).toBeNull()
    expect(artifactPalette(engine, 'ega', ON)).toBeNull()
  })

  it('lets the colour slider turn the colour down', () => {
    const r = picture(160, 60, () => [200, 40, 40])
    const full = iq(...mean(runSignal(engine, r, 'ega', { ...ON, wear: 0 }, 0)!, 60, 260, 10, 50))
    const half = iq(...mean(runSignal(engine, r, 'ega', { ...ON, wear: 0, colour: 0.5 }, 0)!, 60, 260, 10, 50))
    expect(half.chroma / full.chroma).toBeGreaterThan(0.4)
    expect(half.chroma / full.chroma).toBeLessThan(0.6)
  })

  it('wear 0 turns the noise off', () => {
    const r = picture(160, 120, () => [128, 128, 128])
    const s = { ...DEFAULT_SIGNAL, mode: 'rf' as const, wear: 0 }
    const a = runSignal(engine, r, 'nes', s, 1)!
    const b = runSignal(engine, r, 'nes', s, 2)!
    let diff = 0
    for (let i = 0; i < a.rgb.length; i++) diff += Math.abs(a.rgb[i] - b.rgb[i])
    expect(diff / a.rgb.length).toBeLessThan(1)
  })
})

describe('signal settings', () => {
  it('picks the machine\'s own connection for "auto"', () => {
    expect(resolveConnection('auto', signalMachine('nes', 256))).toBe('rf')
    expect(resolveConnection('auto', signalMachine('genesis', 320))).toBe('composite')
    expect(resolveConnection('auto', signalMachine('vhs', 320))).toBe('vhs-sp')
    expect(resolveConnection('off', signalMachine('nes', 256))).toBeNull()
    expect(resolveConnection('vhs-ep', signalMachine('nes', 256))).toBe('vhs-ep')
  })

  it('builds a full engine settings file', () => {
    const d = JSON.stringify({ version: 1, composite_noise_intensity: 0.05, use_field: 4 })
    const s = JSON.parse(engineSettings(d, 'vhs-ep', { ...DEFAULT_SIGNAL, wear: 1, decoder: 'comb' }, 224))
    expect(s.use_field).toBe(3)
    expect(s.vhs_tape_speed).toBe(3)
    expect(s.composite_noise_intensity).toBeCloseTo(0.2)
    expect(s.chroma_demodulation).toBe(3)
    expect(s.input_luma_filter).toBe(0)
    expect(JSON.parse(engineSettings(d, 'composite', DEFAULT_SIGNAL, 480)).use_field).toBe(4)
  })

  it('checks every field, keeping the old value for anything odd', () => {
    expect(checkSignal({ mode: 'vhs-lp', wear: 7, colour: -1, sharpen: 'x', decoder: 'comb' }, DEFAULT_SIGNAL)).toEqual({
      mode: 'vhs-lp',
      wear: 1,
      colour: 0,
      sharpen: DEFAULT_SIGNAL.sharpen,
      decoder: 'comb'
    })
    expect(checkSignal({ mode: 'pal' }, DEFAULT_SIGNAL)).toEqual(DEFAULT_SIGNAL)
    expect(checkSignal(null, DEFAULT_SIGNAL)).toEqual(DEFAULT_SIGNAL)
  })

  it('steps the engine at NTSC speed', () => {
    expect(engineStep(15)).toBe(2)
    expect(engineStep(30)).toBe(1)
  })
})

describe('showing the signal', () => {
  it('averages when it shrinks and keeps the lines', () => {
    const img = { width: 4, height: 2, rgb: Uint8Array.from([0, 0, 0, 100, 100, 100, 200, 200, 200, 255, 255, 255, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]) }
    const half = resampleSignal(img, 2)
    expect(Array.from(half.rgb)).toEqual([50, 50, 50, 228, 228, 228, 10, 10, 10, 10, 10, 10])
    expect(resampleSignal(img, 4)).toBe(img)
  })

  it('fills the export size, with or without a screen effect', () => {
    const img = { width: 6, height: 3, rgb: new Uint8Array(6 * 3 * 3).fill(120) }
    const plain = signalFrame(img, 12, 9, null, 0, [255, 255, 255])
    expect(plain.rgb.length).toBe(12 * 9 * 3)
    expect(plain.rgb.every((v) => v === 120)).toBe(true)
    expect(plain.alpha).toBeNull()
    const crt = signalFrame(img, 12, 9, { ...DEFAULT_FX, screen: 'crt' }, 0, [255, 255, 255])
    expect(crt.rgb.length).toBe(12 * 9 * 3)
  })
})
