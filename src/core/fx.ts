import { BYTE_TO_LINEAR, linearToByte, luminance } from './color'

// Screen effects: what the picture looked like on the machine's screen. They
// need more pixels than the picture has (a scanline is a part of a pixel), so
// they render an enlarged copy. Preview-only by default; the export can keep
// them from 3× up. Nothing here moves or flickers.

export type Screen = 'off' | 'crt' | 'lcd' | 'vhs' | 'composite' | 'p1-green' | 'p3-amber' | 'p4-white'
export type Mask = 'none' | 'shadow' | 'grille'

export interface Fx {
  screen: Screen
  /** CRT phosphor mask. */
  mask: Mask
  /** CRT, 0 … 1. */
  scanlines: number
  curve: number
  bloom: number
  /** LCD, 0 … 1: the gaps between pixels. */
  grid: number
  /** LCD, 0 … 1: the shadow each dark pixel casts. */
  ghost: number
  /** VHS tracking noise intensity (0..1) */
  vhsTracking?: number
  /** VHS OSD toggle */
  vhsOsd?: boolean
}

export const DEFAULT_FX: Fx = {
  screen: 'off',
  mask: 'grille',
  scanlines: 0.7,
  curve: 0.3,
  bloom: 0.3,
  grid: 0.5,
  ghost: 0.4,
  vhsTracking: 0.8,
  vhsOsd: true
}

export interface FxSource {
  /** The finished picture, sRGB bytes, 3 per pixel. */
  rgb: Uint8Array
  width: number
  height: number
  /** The lightest palette colour: an LCD's "off" pixels and the gaps between pixels. */
  paper: readonly [number, number, number]
}

// 5×7 monospace bitmap font for VHS OSD
const OSD_FONT: Record<string, number[]> = {
  ' ': [0, 0, 0, 0, 0],
  ':': [0, 0x24, 0, 0, 0],
  '-': [0x08, 0x08, 0x08, 0x08, 0x08],
  '0': [0x3e, 0x51, 0x49, 0x45, 0x3e],
  '1': [0x00, 0x42, 0x7f, 0x40, 0x00],
  '2': [0x42, 0x61, 0x51, 0x49, 0x46],
  '3': [0x21, 0x41, 0x45, 0x4b, 0x31],
  '4': [0x18, 0x14, 0x12, 0x7f, 0x10],
  '5': [0x27, 0x45, 0x45, 0x45, 0x39],
  '6': [0x3c, 0x4a, 0x49, 0x49, 0x30],
  '7': [0x01, 0x71, 0x09, 0x05, 0x03],
  '8': [0x36, 0x49, 0x49, 0x49, 0x36],
  '9': [0x06, 0x49, 0x49, 0x29, 0x1e],
  A: [0x7e, 0x11, 0x11, 0x11, 0x7e],
  L: [0x7f, 0x40, 0x40, 0x40, 0x40],
  P: [0x7f, 0x09, 0x09, 0x09, 0x06],
  S: [0x26, 0x49, 0x49, 0x49, 0x32],
  Y: [0x07, 0x08, 0x70, 0x08, 0x07],
  '▶': [0x7f, 0x3e, 0x1c, 0x08, 0x00]
}

function getOsdPixel(text: string, rx: number, ry: number, scale: number): { fg: boolean; bg: boolean } {
  const charW = 6 * scale
  const charH = 8 * scale
  if (ry < 0 || ry >= charH) return { fg: false, bg: false }

  const cIdx = Math.floor(rx / charW)
  if (cIdx < 0 || cIdx >= text.length) return { fg: false, bg: false }

  const ch = text[cIdx]
  const glyph = OSD_FONT[ch] ?? OSD_FONT[' ']
  const gx = Math.floor((rx % charW) / scale)
  const gy = Math.floor(ry / scale)

  if (gx >= 0 && gx < 5 && gy >= 0 && gy < 7) {
    if (((glyph[gx] >> gy) & 1) === 1) return { fg: true, bg: false }
  }

  // Check drop shadow / border (1 step down and right)
  const bgGx = Math.floor(((rx - scale) % charW) / scale)
  const bgGy = Math.floor((ry - scale) / scale)
  if (bgGx >= 0 && bgGx < 5 && bgGy >= 0 && bgGy < 7) {
    if (((glyph[bgGx] >> bgGy) & 1) === 1) return { fg: false, bg: true }
  }

  return { fg: false, bg: false }
}

function fxHash(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x, 0x3456789a) ^ Math.imul(y, 0x9abcdef0) ^ seed) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x1234567b)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// The electron beam across one pixel row
const BEAM_LEVELS = 16
const BEAM_STEPS = 64
const BEAM = new Float32Array(BEAM_LEVELS * (BEAM_STEPS + 1))
for (let l = 0; l < BEAM_LEVELS; l++) {
  const sigma = 0.12 + 0.18 * ((l + 0.5) / BEAM_LEVELS)
  for (let i = 0; i <= BEAM_STEPS; i++) {
    const d = i / BEAM_STEPS - 0.5
    BEAM[l * (BEAM_STEPS + 1) + i] = Math.exp(-(d * d) / (2 * sigma * sigma))
  }
}
const BEAM_PEAK = 1.2
const MASK_DIM = 0.45

/**
 * Sets up rendering the picture at outW×outH with the screen effect. The
 * returned function fills one output row (3 bytes per pixel), in any order.
 */
export function fxRenderer(
  src: FxSource,
  outW: number,
  outH: number,
  fx: Fx
): (oy: number, row: Uint8Array) => void {
  const { width: w, height: h } = src
  const lin = new Float32Array(w * h * 3)
  for (let i = 0; i < lin.length; i++) lin[i] = BYTE_TO_LINEAR[src.rgb[i]]
  const sx = outW / w
  const sy = outH / h

  const crt = fx.screen === 'crt'
  const lcd = fx.screen === 'lcd'
  const vhs = fx.screen === 'vhs'
  const composite = fx.screen === 'composite'
  const p1 = fx.screen === 'p1-green'
  const p3 = fx.screen === 'p3-amber'
  const p4 = fx.screen === 'p4-white'
  const isPhosphor = p1 || p3 || p4
  const hasCrtPhysics = crt || isPhosphor || vhs || composite

  // Scanlines need at least 2 output rows per picture row to show.
  const scan = hasCrtPhysics ? fx.scanlines * clamp01(sy - 1) : 0
  const curve = hasCrtPhysics ? fx.curve : 0
  const k = curve * 0.08
  const glow = (hasCrtPhysics || isPhosphor) && fx.bloom > 0 ? blur(lin, w, h) : null
  const bloom = glow ? fx.bloom * 0.7 : 0
  const mask = crt ? fx.mask : 'none'
  const gain = mask !== 'none' ? 3 / (1 + 2 * MASK_DIM) : 1

  // LCD gaps
  const grid = lcd ? fx.grid * 0.65 * clamp01(Math.min(sx, sy) - 2) : 0
  const ghost = lcd ? fx.ghost * 0.45 : 0
  const paper = src.paper.map((b) => BYTE_TO_LINEAR[b])
  const gapU = 1 / sx
  const gapV = 1 / sy

  // VHS parameters
  const trackingIntensity = fx.vhsTracking ?? 0.8
  const showVhsOsd = fx.vhsOsd !== false
  const osdScale = Math.max(1, Math.min(4, Math.floor(outH / 160)))
  const vhsTopOsd = 'PLAY ▶'
  const vhsBotOsd = 'SP -0:12:34'

  const c = new Float32Array(3)
  const chromaFiltered = new Float32Array(3)

  return (oy, row) => {
    const ny = ((oy + 0.5) / outH) * 2 - 1

    // VHS Tracking scanlines & head jitter band in bottom ~6% of scanlines
    let vhsJitterX = 0
    let vhsHeadNoise = false
    if (vhs && oy >= Math.floor(outH * 0.94)) {
      const lineProgress = (oy - outH * 0.94) / (outH * 0.06)
      const wave = Math.sin(oy * 0.5) * 8 * lineProgress
      const noise = (fxHash(0, oy, 11) - 0.5) * 16 * trackingIntensity
      vhsJitterX = (wave + noise) * sx * 0.5
      vhsHeadNoise = fxHash(1, oy, 22) < 0.28 * trackingIntensity
    }

    // Reset composite chroma I/Q filters for the scanline
    let compI = 0
    let compQ = 0
    let lastY = 0
    let compRing = 0

    // Reset VHS horizontal chroma smear filter
    chromaFiltered[0] = 0
    chromaFiltered[1] = 0
    chromaFiltered[2] = 0

    for (let ox = 0; ox < outW; ox++) {
      let u: number
      let v: number
      let fade = 1

      if (curve > 0) {
        const nx = ((ox + 0.5) / outW) * 2 - 1
        const cx = nx * (1 + k * ny * ny)
        const cy = ny * (1 + k * nx * nx)
        const edge = Math.min(1 - Math.abs(cx), 1 - Math.abs(cy))
        if (edge <= 0) {
          row[ox * 3] = row[ox * 3 + 1] = row[ox * 3 + 2] = 0
          continue
        }
        fade = Math.min(1, edge * 60) * (1 - curve * 0.25 * (cx * cx + cy * cy) * 0.5)
        u = ((cx + 1) / 2) * w
        v = ((cy + 1) / 2) * h
      } else {
        u = (ox + 0.5) / sx
        v = (oy + 0.5) / sy
      }

      // VHS head jitter shift
      if (vhs && vhsJitterX !== 0) {
        u += vhsJitterX / sx
      }

      const px = Math.min(w - 1, Math.max(0, Math.floor(u)))
      const py = Math.min(h - 1, Math.max(0, Math.floor(v)))
      const p = (py * w + px) * 3
      c[0] = lin[p]
      c[1] = lin[p + 1]
      c[2] = lin[p + 2]

      if (lcd) {
        if (ghost > 0) {
          const qx = Math.max(0, Math.floor(u - 0.35))
          const qy = Math.max(0, Math.floor(v - 0.35))
          const q = (qy * w + qx) * 3
          if (luminance(lin[q], lin[q + 1], lin[q + 2]) < luminance(c[0], c[1], c[2])) {
            for (let j = 0; j < 3; j++) c[j] += (lin[q + j] - c[j]) * ghost
          }
        }
        if (grid > 0 && (u - px < gapU || v - py < gapV)) {
          for (let j = 0; j < 3; j++) c[j] += (paper[j] - c[j]) * grid
        }
      } else if (isPhosphor) {
        // Monochrome CRT Phosphor Decay & Bloom (P1 Green, P3 Amber, P4 White)
        const lum = luminance(c[0], c[1], c[2])
        if (p1) {
          // P1 Green Phosphor (525nm peak)
          c[0] = lum * 0.16
          c[1] = lum * 1.0
          c[2] = lum * 0.2
        } else if (p3) {
          // P3 Amber Phosphor (600nm peak)
          c[0] = lum * 1.0
          c[1] = lum * 0.58
          c[2] = lum * 0.04
        } else {
          // P4 White Phosphor
          c[0] = lum * 0.92
          c[1] = lum * 0.96
          c[2] = lum * 1.0
        }

        // CRT beam scanlines
        let beam = 1
        if (scan > 0) {
          const level = Math.min(BEAM_LEVELS - 1, (Math.sqrt(lum) * BEAM_LEVELS) | 0)
          const across = Math.min(BEAM_STEPS, ((v - py) * BEAM_STEPS + 0.5) | 0)
          beam = 1 - scan + scan * BEAM_PEAK * BEAM[level * (BEAM_STEPS + 1) + across]
        }
        const f = beam * fade
        c[0] *= f
        c[1] *= f
        c[2] *= f

        if (glow) {
          const glowColor = new Float32Array(3)
          sampleBilinear(glow, w, h, u - 0.5, v - 0.5, glowColor, 1.0)
          const glowLum = luminance(glowColor[0], glowColor[1], glowColor[2]) * bloom * fade
          if (p1) {
            c[0] += glowLum * 0.16
            c[1] += glowLum * 1.0
            c[2] += glowLum * 0.2
          } else if (p3) {
            c[0] += glowLum * 1.0
            c[1] += glowLum * 0.58
            c[2] += glowLum * 0.04
          } else {
            c[0] += glowLum * 0.92
            c[1] += glowLum * 0.96
            c[2] += glowLum * 1.0
          }
        }
      } else if (composite) {
        // NTSC Composite Video Chroma Bleed & Subcarrier Cross-talk
        // RGB to YIQ
        const curY = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
        const inI = 0.596 * c[0] - 0.274 * c[1] - 0.322 * c[2]
        const inQ = 0.211 * c[0] - 0.523 * c[1] + 0.312 * c[2]

        // Low-pass horizontal chroma smear
        compI = compI * 0.72 + inI * 0.28
        compQ = compQ * 0.65 + inQ * 0.35

        // Phase cross-talk on sharp luma transitions (chroma fringing & ringing)
        const dY = curY - lastY
        lastY = curY
        compRing = compRing * 0.65 + dY * 0.35
        const phaseI = compI + compRing * Math.sin(ox * 1.2)

        // Inverse YIQ to linear RGB
        c[0] = Math.max(0, curY + 0.956 * phaseI + 0.621 * compQ)
        c[1] = Math.max(0, curY - 0.272 * phaseI - 0.647 * compQ)
        c[2] = Math.max(0, curY - 1.106 * phaseI + 1.703 * compQ)

        // CRT scanline modulation
        if (scan > 0) {
          const across = Math.min(BEAM_STEPS, ((v - py) * BEAM_STEPS + 0.5) | 0)
          const beam = 1 - scan + scan * BEAM_PEAK * BEAM[across]
          c[0] *= beam * fade
          c[1] *= beam * fade
          c[2] *= beam * fade
        }
      } else if (vhs) {
        // VHS Analog Tape Chroma Smear + Tracking Noise Band
        const curLum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]

        // Horizontal chroma bleed: low-pass filter color difference signals
        // Chroma lags horizontally (tape reading head bandwidth ~0.4MHz)
        const alpha = 0.22
        chromaFiltered[0] = chromaFiltered[0] * (1 - alpha) + (c[0] - curLum) * alpha
        chromaFiltered[1] = chromaFiltered[1] * (1 - alpha) + (c[1] - curLum) * alpha
        chromaFiltered[2] = chromaFiltered[2] * (1 - alpha) + (c[2] - curLum) * alpha

        // Sample slightly to the right for color bleeding
        const smearU = Math.min(w - 1, u + 2.5 / sx)
        const smearP = (py * w + Math.floor(smearU)) * 3
        const smearLum = 0.299 * lin[smearP] + 0.587 * lin[smearP + 1] + 0.114 * lin[smearP + 2]

        c[0] = Math.max(0, curLum + chromaFiltered[0] * 0.6 + (lin[smearP] - smearLum) * 0.4)
        c[1] = Math.max(0, curLum + chromaFiltered[1] * 0.6 + (lin[smearP + 1] - smearLum) * 0.4)
        c[2] = Math.max(0, curLum + chromaFiltered[2] * 0.6 + (lin[smearP + 2] - smearLum) * 0.4)

        // Analog tape head snow noise in bottom tracking band
        if (vhsHeadNoise && fxHash(ox, oy, 33) < 0.45 * trackingIntensity) {
          const noiseByte = fxHash(ox, oy, 44) > 0.5 ? 0.95 : 0.05
          c[0] = c[1] = c[2] = noiseByte
        }

        // Soft scanlines
        if (scan > 0) {
          const across = Math.min(BEAM_STEPS, ((v - py) * BEAM_STEPS + 0.5) | 0)
          const beam = 1 - scan * 0.6 + scan * 0.6 * BEAM_PEAK * BEAM[across]
          c[0] *= beam * fade
          c[1] *= beam * fade
          c[2] *= beam * fade
        }
      } else if (crt) {
        let beam = 1
        if (scan > 0) {
          const level = Math.min(BEAM_LEVELS - 1, (Math.sqrt(luminance(c[0], c[1], c[2])) * BEAM_LEVELS) | 0)
          const across = Math.min(BEAM_STEPS, ((v - py) * BEAM_STEPS + 0.5) | 0)
          beam = 1 - scan + scan * BEAM_PEAK * BEAM[level * (BEAM_STEPS + 1) + across]
        }
        let mr = 1
        let mg = 1
        let mb = 1
        if (mask !== 'none') {
          const phase = ox % 3
          const dark = mask === 'shadow' && (oy + (Math.floor(ox / 3) & 1) * 2) % 4 === 0
          mr = phase === 0 ? 1 : MASK_DIM
          mg = phase === 1 ? 1 : MASK_DIM
          mb = phase === 2 ? 1 : MASK_DIM
          if (dark) {
            mr *= MASK_DIM
            mg *= MASK_DIM
            mb *= MASK_DIM
          }
        }
        const f = beam * gain * fade
        c[0] *= f * mr
        c[1] *= f * mg
        c[2] *= f * mb
        if (glow) {
          sampleBilinear(glow, w, h, u - 0.5, v - 0.5, c, bloom * fade)
        }
      }

      // VHS OSD (PLAY ▶ top-left, SP -0:12:34 bottom-left)
      if (vhs && showVhsOsd) {
        // Top-left PLAY ▶
        const topX0 = 14 * osdScale
        const topY0 = 12 * osdScale
        const { fg: topFg, bg: topBg } = getOsdPixel(vhsTopOsd, ox - topX0, oy - topY0, osdScale)

        // Bottom-left SP -0:12:34
        const botX0 = 14 * osdScale
        const botY0 = outH - (22 * osdScale)
        const { fg: botFg, bg: botBg } = getOsdPixel(vhsBotOsd, ox - botX0, oy - botY0, osdScale)

        if (topFg || botFg) {
          // Retro phosphor green OSD: sRGB [0, 255, 65]
          c[0] = 0
          c[1] = 1.0
          c[2] = 0.06
        } else if (topBg || botBg) {
          // Drop-shadow outline: black
          c[0] = 0
          c[1] = 0
          c[2] = 0
        }
      }

      row[ox * 3] = linearToByte(c[0])
      row[ox * 3 + 1] = linearToByte(c[1])
      row[ox * 3 + 2] = linearToByte(c[2])
    }
  }
}

/** The screen-effect image as RGBA, for showing on a canvas. */
export function renderFxRgba(src: FxSource, outW: number, outH: number, fx: Fx): Uint8ClampedArray {
  const out = new Uint8ClampedArray(outW * outH * 4)
  const render = fxRenderer(src, outW, outH, fx)
  const row = new Uint8Array(outW * 3)
  for (let y = 0; y < outH; y++) {
    render(y, row)
    let o = y * outW * 4
    for (let i = 0; i < row.length; i += 3) {
      out[o] = row[i]
      out[o + 1] = row[i + 1]
      out[o + 2] = row[i + 2]
      out[o + 3] = 255
      o += 4
    }
  }
  return out
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

// A soft blur of the picture at its own size (box blur, 3 taps, twice each
// way), for the bloom. Cheap because the picture is small.
function blur(lin: Float32Array, w: number, h: number): Float32Array {
  let a = Float32Array.from(lin)
  let b = new Float32Array(lin.length)
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const l = Math.max(0, x - 1)
        const r = Math.min(w - 1, x + 1)
        for (let j = 0; j < 3; j++) {
          b[(y * w + x) * 3 + j] =
            (a[(y * w + l) * 3 + j] + a[(y * w + x) * 3 + j] + a[(y * w + r) * 3 + j]) / 3
        }
      }
    }
    ;[a, b] = [b, a]
    for (let y = 0; y < h; y++) {
      const u = Math.max(0, y - 1)
      const d = Math.min(h - 1, y + 1)
      for (let x = 0; x < w; x++) {
        for (let j = 0; j < 3; j++) {
          b[(y * w + x) * 3 + j] =
            (a[(u * w + x) * 3 + j] + a[(y * w + x) * 3 + j] + a[(d * w + x) * 3 + j]) / 3
        }
      }
    }
    ;[a, b] = [b, a]
  }
  return a
}

function sampleBilinear(
  img: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
  into: Float32Array,
  amount: number
): void {
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)))
  const x1 = Math.min(w - 1, x0 + 1)
  const y1 = Math.min(h - 1, y0 + 1)
  const fx = clamp01(x - x0)
  const fy = clamp01(y - y0)
  for (let j = 0; j < 3; j++) {
    const top = img[(y0 * w + x0) * 3 + j] * (1 - fx) + img[(y0 * w + x1) * 3 + j] * fx
    const bot = img[(y1 * w + x0) * 3 + j] * (1 - fx) + img[(y1 * w + x1) * 3 + j] * fx
    into[j] += (top * (1 - fy) + bot * fy) * amount
  }
}
