import { fxRenderer, type Fx } from './fx'
import type { Rendered } from './pipeline'

// The Signal step: the finished picture leaves the machine as an analog TV
// signal (RF, composite, or recorded on a VHS tape) and comes back the way a TV
// decoded it. The real work is the ntsc-rs engine, built to WebAssembly from
// signal/ and loaded only when the signal is on (see src/signal/load.ts). This
// file decides what to send it: how wide each pixel was on the wire, how the
// machine timed its lines, and the engine settings for each connection.

export type SignalMode = 'off' | 'auto' | 'rf' | 'composite' | 'vhs-sp' | 'vhs-lp' | 'vhs-ep'
export type SignalConnection = Exclude<SignalMode, 'off' | 'auto'>
export type SignalDecoder = 'notch' | 'comb'

export interface SignalSettings {
  mode: SignalMode
  /** 0 = a clean signal, 0.5 = as the connection usually looked, 1 = worn out. */
  wear: number
  /** Colour after decoding, 1 = as decoded. */
  colour: number
  /** Composite pre-emphasis: sharper edges (and a little louder colour). */
  sharpen: number
  /** How the TV split colour from brightness. A comb filter cancels the colour fringes (and artifact colour). */
  decoder: SignalDecoder
}

export const DEFAULT_SIGNAL: SignalSettings = { mode: 'off', wear: 0.5, colour: 1, sharpen: 0.25, decoder: 'notch' }

export const SIGNAL_MODES: readonly SignalMode[] = ['off', 'auto', 'rf', 'composite', 'vhs-sp', 'vhs-lp', 'vhs-ep']

export const CONNECTION_NAMES: Record<SignalConnection, string> = {
  rf: 'RF (aerial socket)',
  composite: 'composite video',
  'vhs-sp': 'a VHS tape (SP)',
  'vhs-lp': 'a VHS tape (LP)',
  'vhs-ep': 'a VHS tape (EP)'
}

/** Loop lengths and speeds offered when the signal is on. */
export const LOOP_FRAMES = [16, 32, 48] as const
export const LOOP_FPS = [15, 30] as const
export type LoopFrames = (typeof LOOP_FRAMES)[number]
export type LoopFps = (typeof LOOP_FPS)[number]

/**
 * Engine frames per loop frame. The engine moves at NTSC speed (30 frames a
 * second), so a 15 fps loop skips every other one to keep motion real-time.
 */
export function engineStep(fps: number): number {
  return Math.max(1, Math.round(30 / fps))
}

// ---------------------------------------------------------------------------
// Machines on the wire.
//
// The engine works in samples of 4× the colour carrier (14.318 MHz), so one
// colour cycle is 4 samples. A machine's pixel clock decides how many samples
// a pixel lasts: CGA's 640-pixel mode is exactly 1, the NES 2.67 (5.37 MHz).
// That's what makes artifact colour and dither blending come out right.
// Machines that ran 228 colour cycles per line (instead of broadcast NTSC's
// 227.5) kept the colour carrier in the same phase on every line, so their
// colour fringes stand still; the engine is told to do the same.

export interface SignalMachine {
  /** 14.318 MHz samples per picture pixel. */
  samplesPerPixel: number
  /** 228 colour cycles per line: the same carrier phase on every line. */
  lineLocked: boolean
  /** How it usually reached the TV ("Machine's own"). */
  connection: SignalConnection
  /** Extra colour gain for this machine (on top of the slider). */
  colour?: number
  /** Send the palette as CGA hi-res bit patterns, so the colours come from the signal. */
  artifact?: 'cga'
}

const MASTER = 14.31818
const clock = (mhz: number) => MASTER / mhz

const MACHINES: Record<string, SignalMachine> = {
  // IBM CGA: 14.318 MHz hi-res, 7.16 MHz in the 320 modes; 228 cycles a line.
  'cga-0': { samplesPerPixel: 2, lineLocked: true, connection: 'composite' },
  'cga-1': { samplesPerPixel: 2, lineLocked: true, connection: 'composite' },
  // Each colour is a 4-pixel pattern in the 640 mode; the TV makes the colour.
  'cga-composite': { samplesPerPixel: 2, lineLocked: true, connection: 'composite', artifact: 'cga' },
  ega: { samplesPerPixel: 2, lineLocked: true, connection: 'composite' },
  // VIC-II NTSC dot clock 8.18 MHz; 227.5 cycles a line (its colours crawl).
  'c64-hires': { samplesPerPixel: clock(8.181816), lineLocked: false, connection: 'composite' },
  'c64-mc': { samplesPerPixel: 2 * clock(8.181816), lineLocked: false, connection: 'composite' },
  // A PAL machine (shown here through the NTSC engine); 7 MHz pixels, RF out.
  'zx-spectrum': { samplesPerPixel: clock(7), lineLocked: false, connection: 'rf' },
  // NES / SNES PPU dot clock 5.37 MHz (227⅓ cycles a line; shown as broadcast).
  nes: { samplesPerPixel: clock(5.369318), lineLocked: false, connection: 'rf' },
  'nes-attr': { samplesPerPixel: clock(5.369318), lineLocked: false, connection: 'rf' },
  snes: { samplesPerPixel: clock(5.369318), lineLocked: false, connection: 'composite' },
  // The TIA's pixel is one colour clock; 228 clocks a line.
  'atari-2600': { samplesPerPixel: 4, lineLocked: true, connection: 'rf' },
  // Apple II: 7.16 MHz hi-res dots, 14 samples per lo-res block; 228 cycles a line.
  'apple2-hires': { samplesPerPixel: 2, lineLocked: true, connection: 'composite' },
  'apple2-lores': { samplesPerPixel: 14, lineLocked: true, connection: 'composite' },
  // Genesis H40: 6.71 MHz; Master System / MSX TMS9918: 5.37 MHz; all 228 cycles a line.
  genesis: { samplesPerPixel: clock(6.711647), lineLocked: true, connection: 'composite' },
  mastersystem: { samplesPerPixel: clock(5.369318), lineLocked: true, connection: 'composite' },
  'msx-screen2': { samplesPerPixel: clock(5.369318), lineLocked: true, connection: 'composite' },
  // Amiga low-res 7.16 MHz (its lines alternate 227 and 228 cycles).
  'amiga-ham6': { samplesPerPixel: 2, lineLocked: false, connection: 'composite' },
  'atari-st': { samplesPerPixel: clock(8), lineLocked: false, connection: 'rf' },
  ps1: { samplesPerPixel: clock(6.708), lineLocked: false, connection: 'composite' },
  // The tape look and the early camcorder-era camera go through a VCR.
  vhs: { samplesPerPixel: 2, lineLocked: false, connection: 'vhs-sp' },
  'ccd-early': { samplesPerPixel: 1, lineLocked: false, connection: 'vhs-sp' }
}

/** How a machine's picture went out. Machines that never had a TV output get a plain composite line. */
export function signalMachine(profileId: string, pictureWidth: number): SignalMachine {
  const known = MACHINES[profileId]
  if (known) return known
  // About 640 samples across, the width of an NTSC picture.
  return { samplesPerPixel: Math.min(16, Math.max(1, 640 / Math.max(1, pictureWidth))), lineLocked: false, connection: 'composite' }
}

/** The connection a mode stands for on this machine. */
export function resolveConnection(mode: SignalMode, machine: SignalMachine): SignalConnection | null {
  if (mode === 'off') return null
  return mode === 'auto' ? machine.connection : mode
}

// ---------------------------------------------------------------------------
// CGA composite: DeRes's 16 colours are the 16 four-pixel patterns of the
// 640-pixel mode. Lined up with the engine's colour carrier, pattern
// rotl(reverse(k), 2) gives colour k of the cga-composite table (measured:
// within a few degrees of hue on average, see the README).

const reverse4 = (k: number) => ((k & 1) << 3) | ((k & 2) << 1) | ((k & 4) >> 1) | ((k & 8) >> 3)
const rotl4 = (k: number, n: number) => ((k << n) | (k >> (4 - n))) & 15

/** The 4-bit hi-res pattern for colour k (bit 3 = the first pixel of each group of four). */
export function cgaPattern(k: number): number {
  return rotl4(reverse4(k & 15), 2)
}

// ---------------------------------------------------------------------------
// Picture → signal input.

export interface SignalImage {
  /** r, g, b per sample; one row per line. */
  rgb: Uint8Array
  /** Samples across (picture width × samples per pixel). */
  width: number
  /** Lines (= picture rows). */
  height: number
}

/** The picture as the machine put it on the wire: each pixel held for its share of samples. */
export function signalInput(r: Rendered, machine: SignalMachine): { rgba: Uint8Array; width: number; height: number } {
  const width = Math.max(1, Math.round(r.width * machine.samplesPerPixel))
  const height = r.height
  const rgba = new Uint8Array(width * height * 4)
  const column = new Int32Array(width)
  for (let x = 0; x < width; x++) column[x] = Math.min(r.width - 1, Math.floor((x * r.width) / width))
  const cga = machine.artifact === 'cga' && r.palette.length === 16 * 3
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * r.width + column[x]
      const o = (y * width + x) * 4
      if (cga) {
        const v = (cgaPattern(r.indices[p]) >> (3 - (x & 3))) & 1 ? 255 : 0
        rgba[o] = rgba[o + 1] = rgba[o + 2] = v
      } else {
        rgba[o] = r.rgb[p * 3]
        rgba[o + 1] = r.rgb[p * 3 + 1]
        rgba[o + 2] = r.rgb[p * 3 + 2]
      }
      rgba[o + 3] = 255
    }
  }
  return { rgba, width, height }
}

// ---------------------------------------------------------------------------
// Engine settings. Keys are the engine's own (ntsc-rs settings files); they are
// laid over its full defaults, because keys left out fall back to old ones.

type EngineSettings = Record<string, number | boolean>

const PRESETS: Record<SignalConnection, EngineSettings> = {
  composite: { vhs_settings: false, head_switching: false, tracking_noise: false },
  rf: {
    vhs_settings: false,
    head_switching: false,
    tracking_noise: false,
    snow_intensity: 0.004,
    composite_noise_intensity: 0.12,
    luma_noise_intensity: 0.03,
    chroma_noise_intensity: 0.25,
    chroma_phase_noise_intensity: 0.004
  },
  'vhs-sp': { vhs_settings: true, vhs_tape_speed: 1, head_switching: true, tracking_noise: true, vhs_edge_wave_enabled: true, vhs_edge_wave: 0.5 },
  'vhs-lp': {
    vhs_settings: true,
    vhs_tape_speed: 2,
    head_switching: true,
    tracking_noise: true,
    vhs_edge_wave_enabled: true,
    vhs_edge_wave: 0.8,
    vhs_chroma_loss: 0.0002,
    snow_intensity: 0.001
  },
  'vhs-ep': {
    vhs_settings: true,
    vhs_tape_speed: 3,
    head_switching: true,
    tracking_noise: true,
    tracking_noise_wave_intensity: 25,
    tracking_noise_snow_intensity: 0.1,
    vhs_edge_wave_enabled: true,
    vhs_edge_wave: 1.2,
    vhs_chroma_loss: 0.0005,
    snow_intensity: 0.002,
    composite_noise_intensity: 0.1,
    chroma_noise_intensity: 0.2,
    chroma_phase_noise_intensity: 0.003
  }
}

/** The settings the wear slider scales (0 = none of it, 0.5 = the preset, 1 = double). */
const WEAR_KEYS = [
  'composite_noise_intensity',
  'luma_noise_intensity',
  'chroma_noise_intensity',
  'snow_intensity',
  'chroma_phase_noise_intensity',
  'tracking_noise_wave_intensity',
  'tracking_noise_snow_intensity',
  'tracking_noise_noise_intensity',
  'head_switching_horizontal_shift',
  'vhs_edge_wave',
  'vhs_chroma_loss'
]

export function engineSettings(
  defaultsJson: string,
  connection: SignalConnection,
  s: SignalSettings,
  lines: number
): string {
  const settings: EngineSettings = { ...(JSON.parse(defaultsJson) as EngineSettings), ...PRESETS[connection] }
  const wear = Math.min(1, Math.max(0, s.wear)) * 2
  for (const key of WEAR_KEYS) if (typeof settings[key] === 'number') settings[key] = (settings[key] as number) * wear
  // Up to 288 lines is one field per frame (a console's 240p); taller pictures are interlaced.
  const progressive = lines <= 288
  return JSON.stringify({
    ...settings,
    random_seed: 0,
    // A machine doesn't notch-filter its own output (the engine's default does, for camera video).
    input_luma_filter: 0,
    composite_preemphasis: Math.min(1, Math.max(0, s.sharpen)),
    chroma_demodulation: s.decoder === 'comb' ? 3 : 1,
    use_field: progressive ? 3 : 4,
    scale_settings: true,
    scale_with_video_size: false,
    // The input is already in samples at the engine's own rate.
    bandwidth_scale: 1,
    vertical_scale: (progressive ? lines : lines / 2) / 240,
    version: 1
  })
}

// ---------------------------------------------------------------------------
// Running it.

/** The engine, once loaded (src/signal/load.ts in the browser, src/test/signal-engine.ts in tests). */
export interface SignalEngine {
  signal(rgba: Uint8Array, width: number, height: number, frame: number, settingsJson: string, chroma: number, lineLocked: boolean, pad: number): Uint8Array
  /** The engine's full default settings (JSON). */
  defaultsJson: string
}

/** Edge-repeated picture added each side while the signal runs, so the filters don't darken the edges. */
const PAD = 16

/** One frame of the picture through the signal; null when the signal is off. */
export function runSignal(
  engine: SignalEngine,
  r: Rendered,
  profileId: string,
  s: SignalSettings,
  frame: number
): SignalImage | null {
  const machine = signalMachine(profileId, r.width)
  const connection = resolveConnection(s.mode, machine)
  if (!connection) return null
  const input = signalInput(r, machine)
  const json = engineSettings(engine.defaultsJson, connection, s, input.height)
  const colour = Math.max(0, s.colour) * (machine.colour ?? 1)
  const out = engine.signal(input.rgba, input.width, input.height, frame, json, colour, machine.lineLocked, PAD)
  const rgb = new Uint8Array(input.width * input.height * 3)
  for (let i = 0, n = input.width * input.height; i < n; i++) {
    rgb[i * 3] = out[i * 4]
    rgb[i * 3 + 1] = out[i * 4 + 1]
    rgb[i * 3 + 2] = out[i * 4 + 2]
  }
  return { rgb, width: input.width, height: input.height }
}

/**
 * The colours this signal really makes from a machine's artifact patterns
 * (CGA composite), entry k for colour k; null for other machines. DeRes then
 * dithers to these, so the picture aims at what the TV will show rather than
 * at a table of approximations.
 */
export function artifactPalette(engine: SignalEngine, profileId: string, s: SignalSettings): string[] | null {
  const machine = signalMachine(profileId, 320)
  if (machine.artifact !== 'cga' || !resolveConnection(s.mode, machine)) return null
  // 16 bands of 16 pixels (8 whole patterns each), noise off.
  const band = 16, width = 16 * band, height = 32
  const indices = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) indices[y * width + x] = Math.floor(x / band)
  const swatches: Rendered = {
    width,
    height,
    indices,
    palette: new Uint8Array(16 * 3),
    rgb: new Uint8Array(width * height * 3),
    used: 16,
    geometry: { width, height, src: { x: 0, y: 0, w: width, h: height }, dst: { x: 0, y: 0, w: width, h: height }, par: [1, 1] },
    paper: [255, 255, 255]
  }
  const img = runSignal(engine, swatches, profileId, { ...s, wear: 0 }, 0)
  if (!img) return null
  const per = img.width / 16
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0')
  const colours: string[] = []
  for (let k = 0; k < 16; k++) {
    const acc = [0, 0, 0]
    let n = 0
    // The middle of the band, away from its neighbours' fringes.
    for (let y = 4; y < height - 4; y++) {
      for (let x = Math.round(k * per + per / 4); x < Math.round((k + 1) * per - per / 4); x++) {
        for (let c = 0; c < 3; c++) acc[c] += img.rgb[(y * img.width + x) * 3 + c]
        n++
      }
    }
    colours.push('#' + acc.map((v) => hex(v / n)).join(''))
  }
  return colours
}

// ---------------------------------------------------------------------------
// Showing it.

/**
 * The signal resized across to outW samples: area-averaged when it shrinks (so
 * the colour carrier's fine pattern doesn't alias), linear when it grows. Lines
 * stay lines.
 */
export function resampleSignal(img: SignalImage, outW: number): SignalImage {
  if (outW === img.width) return img
  const { width: w, height: h } = img
  const out = new Uint8Array(outW * h * 3)
  const scale = w / outW
  for (let y = 0; y < h; y++) {
    const row = y * w * 3
    for (let x = 0; x < outW; x++) {
      const o = (y * outW + x) * 3
      if (scale > 1) {
        const a = x * scale
        const b = a + scale
        let r = 0, g = 0, bl = 0
        for (let i = Math.floor(a); i < Math.ceil(b) && i < w; i++) {
          const wgt = Math.min(b, i + 1) - Math.max(a, i)
          r += img.rgb[row + i * 3] * wgt
          g += img.rgb[row + i * 3 + 1] * wgt
          bl += img.rgb[row + i * 3 + 2] * wgt
        }
        out[o] = Math.round(r / scale)
        out[o + 1] = Math.round(g / scale)
        out[o + 2] = Math.round(bl / scale)
      } else {
        const u = Math.max(0, Math.min(w - 1, (x + 0.5) * scale - 0.5))
        const i0 = Math.floor(u)
        const i1 = Math.min(w - 1, i0 + 1)
        const f = u - i0
        for (let c = 0; c < 3; c++) {
          out[o + c] = Math.round(img.rgb[row + i0 * 3 + c] * (1 - f) + img.rgb[row + i1 * 3 + c] * f)
        }
      }
    }
  }
  return { rgb: out, width: outW, height: h }
}

/**
 * Makes a function that fills one row (r, g, b per pixel) of the signal shown
 * at outW×outH, through the screen effect when one is given (CRT, LCD…).
 */
export function signalRenderer(
  img: SignalImage,
  outW: number,
  outH: number,
  fx: Fx | null,
  phase: number,
  paper: readonly [number, number, number]
): (oy: number, row: Uint8Array) => void {
  const src = resampleSignal(img, outW)
  if (fx && fx.screen !== 'off') {
    return fxRenderer({ rgb: src.rgb, width: outW, height: src.height, paper }, outW, outH, fx, phase)
  }
  return (oy, row) => {
    const line = Math.min(src.height - 1, Math.floor((oy * src.height) / outH))
    row.set(src.rgb.subarray(line * outW * 3, (line + 1) * outW * 3))
  }
}

/** The whole picture as r, g, b per pixel (animation frames). */
export function signalFrame(
  img: SignalImage,
  outW: number,
  outH: number,
  fx: Fx | null,
  phase: number,
  paper: readonly [number, number, number]
): Uint8Array {
  const render = signalRenderer(img, outW, outH, fx, phase, paper)
  const out = new Uint8Array(outW * outH * 3)
  const row = new Uint8Array(outW * 3)
  for (let y = 0; y < outH; y++) {
    render(y, row)
    out.set(row, y * outW * 3)
  }
  return out
}

/** Signal settings checked field by field (saved settings and share links). */
export function checkSignal(loaded: unknown, base: SignalSettings): SignalSettings {
  const s = (loaded && typeof loaded === 'object' ? loaded : {}) as Record<string, unknown>
  const num = (v: unknown, lo: number, hi: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
  return {
    mode: SIGNAL_MODES.includes(s.mode as SignalMode) ? (s.mode as SignalMode) : base.mode,
    wear: num(s.wear, 0, 1, base.wear),
    colour: num(s.colour, 0, 1.5, base.colour),
    sharpen: num(s.sharpen, 0, 1, base.sharpen),
    decoder: s.decoder === 'comb' || s.decoder === 'notch' ? s.decoder : base.decoder
  }
}
