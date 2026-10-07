import { BYTE_TO_LINEAR, linearToByte, luminance, toLinear, toSrgb } from './color'

// Analog, print & video aesthetics:
// 1. Early digital camera CCD: 640×480 sensor, photon/chroma noise, burnt-orange 7-segment date stamp.
// 2. JPEG "deep fry": 8×8 block DCT quantization crunch, extreme contrast & saturation, high-frequency ringing.
// 3. Newspaper halftone: CMYK angled screen dot rosettes (C 15°, M 75°, Y 0°, K 45°) on unbleached newsprint.
// 4. Two-ink risograph: Fluorescent Pink + Teal spot inks, halftone screening, mechanical drum misregistration jitter.
// 5. Streaky 1-bit fax: High-contrast 1-bit error diffusion, roller feed streaks, scanline dropouts, transmission header.

export interface AnalogResult {
  indices: Uint8Array
  rgb: Float32Array
  paper: [number, number, number]
}

// Deterministic 2D PRNG hash
function hash2d(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x, 0x1f1f1f1f) ^ Math.imul(y, 0x5b5b5b5b) ^ seed) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

// --- 7-segment / Bitmap font for Date Stamp & Headers ---

// 7-segment digit bitmasks: [a, b, c, d, e, f, g]
// a: top, b: top-right, c: bot-right, d: bottom, e: bot-left, f: top-left, g: middle
const SEVEN_SEG: Record<string, number> = {
  '0': 0b0111111,
  '1': 0b0000110,
  '2': 0b1011011,
  '3': 0b1001111,
  '4': 0b1100110,
  '5': 0b1101101,
  '6': 0b1111101,
  '7': 0b0000111,
  '8': 0b1111111,
  '9': 0b1101111,
  '-': 0b1000000,
  ' ': 0b0000000,
  "'": 0b0100000 // apostrophe using top-left / top
}

/** Checks whether pixel (px, py) relative to top-left of a 7-segment digit (width 8, height 14) is on */
function isSevenSegmentPixel(ch: string, px: number, py: number): boolean {
  if (ch === "'") {
    return px >= 2 && px <= 4 && py >= 1 && py <= 4
  }
  const mask = SEVEN_SEG[ch] ?? 0
  if (!mask) return false

  const w = 8
  const h = 14
  const mid = 6

  // Segment a: top bar
  if (mask & 0b0000001 && py >= 0 && py <= 1 && px >= 1 && px <= w - 2) return true
  // Segment b: top-right vertical
  if (mask & 0b0000010 && py >= 1 && py <= mid && px >= w - 2 && px < w) return true
  // Segment c: bottom-right vertical
  if (mask & 0b0000100 && py >= mid && py <= h - 2 && px >= w - 2 && px < w) return true
  // Segment d: bottom bar
  if (mask & 0b0001000 && py >= h - 2 && py < h && px >= 1 && px <= w - 2) return true
  // Segment e: bottom-left vertical
  if (mask & 0b0010000 && py >= mid && py <= h - 2 && px >= 0 && px <= 1) return true
  // Segment f: top-left vertical
  if (mask & 0b0100000 && py >= 1 && py <= mid && px >= 0 && px <= 1) return true
  // Segment g: middle bar
  if (mask & 0b1000000 && py >= mid - 1 && py <= mid && px >= 1 && px <= w - 2) return true

  return false
}

// 5×7 monospace bitmap font for teletype / fax headers
const FONT_5X7: Record<string, number[]> = {
  ' ': [0, 0, 0, 0, 0],
  ':': [0, 0x24, 0, 0, 0],
  '-': [0x08, 0x08, 0x08, 0x08, 0x08],
  '+': [0x08, 0x08, 0x3e, 0x08, 0x08],
  '/': [0x03, 0x0c, 0x30, 0xc0, 0],
  '.': [0, 0x40, 0, 0, 0],
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
  B: [0x7f, 0x49, 0x49, 0x49, 0x36],
  C: [0x3e, 0x41, 0x41, 0x41, 0x22],
  D: [0x7f, 0x41, 0x41, 0x22, 0x1c],
  E: [0x7f, 0x49, 0x49, 0x49, 0x41],
  F: [0x7f, 0x09, 0x09, 0x09, 0x01],
  G: [0x3e, 0x41, 0x49, 0x49, 0x7a],
  H: [0x7f, 0x08, 0x08, 0x08, 0x7f],
  I: [0x00, 0x41, 0x7f, 0x41, 0x00],
  L: [0x7f, 0x40, 0x40, 0x40, 0x40],
  M: [0x7f, 0x02, 0x0c, 0x02, 0x7f],
  O: [0x3e, 0x41, 0x41, 0x41, 0x3e],
  P: [0x7f, 0x09, 0x09, 0x09, 0x06],
  R: [0x7f, 0x09, 0x19, 0x29, 0x46],
  T: [0x01, 0x01, 0x7f, 0x01, 0x01],
  X: [0x63, 0x14, 0x08, 0x14, 0x63],
  Y: [0x07, 0x08, 0x70, 0x08, 0x07],
  '▶': [0x7f, 0x3e, 0x1c, 0x08, 0x00]
}

function isFont5x7Pixel(ch: string, px: number, py: number): boolean {
  const glyph = FONT_5X7[ch.toUpperCase()] ?? FONT_5X7[' ']
  if (px < 0 || px >= 5 || py < 0 || py >= 7) return false
  return ((glyph[px] >> py) & 1) === 1
}

// -------------------------------------------------------------------------
// 1. EARLY DIGITAL CAMERA CCD (640×480 + SENSOR NOISE + BURNT-ORANGE DATE)
// -------------------------------------------------------------------------

export function processEarlyCcd(
  linearRgb: Float32Array,
  width: number,
  height: number
): AnalogResult {
  const n = width * height
  const outRgb = new Float32Array(n * 3)
  const indices = new Uint8Array(n)

  // Burnt-orange date stamp in bottom right: "'99 10 24"
  const dateStr = "'99 10 24"
  const digitW = 8
  const digitH = 14
  const digitSpacing = 3
  const totalDateW = dateStr.length * (digitW + digitSpacing) - digitSpacing
  const dateX0 = width - totalDateW - 20
  const dateY0 = height - digitH - 18

  // Luminous burnt-orange: sRGB [255, 120, 0] -> linear [1.0, 0.18, 0.0]
  const stampLinR = BYTE_TO_LINEAR[255]
  const stampLinG = BYTE_TO_LINEAR[120]
  const stampLinB = BYTE_TO_LINEAR[0]

  // Halo / glow around segments: sRGB [130, 45, 0]
  const haloLinR = BYTE_TO_LINEAR[130]
  const haloLinG = BYTE_TO_LINEAR[45]
  const haloLinB = BYTE_TO_LINEAR[0]

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const p = idx * 3

      // 1. CCD Sensor Noise (photon shot noise + thermal chroma grain)
      const r = linearRgb[p]
      const g = linearRgb[p + 1]
      const b = linearRgb[p + 2]
      const lum = luminance(r, g, b)

      // Shot noise variance is proportional to sqrt(lum), with baseline dark current noise
      const n1 = hash2d(x, y, 101) - 0.5
      const n2 = hash2d(x, y, 202) - 0.5
      const n3 = hash2d(x, y, 303) - 0.5

      const shotScale = 0.035 * Math.sqrt(Math.max(0.01, lum)) + 0.018
      const chromaScale = 0.022

      let nr = r + n1 * shotScale + (n2 - n3) * chromaScale
      let ng = g + n2 * shotScale + (n3 - n1) * chromaScale
      let nb = b + n3 * shotScale + (n1 - n2) * chromaScale

      nr = Math.max(0, Math.min(1, nr))
      ng = Math.max(0, Math.min(1, ng))
      nb = Math.max(0, Math.min(1, nb))

      // 2. Burnt-orange 7-Segment Date Stamp in bottom-right corner
      let isStamp = false
      let isHalo = false

      if (x >= dateX0 - 2 && x <= dateX0 + totalDateW + 2 && y >= dateY0 - 2 && y <= dateY0 + digitH + 2) {
        // Check exact digit or neighbor glow
        const relX = x - dateX0
        const relY = y - dateY0
        const charIdx = Math.floor(relX / (digitW + digitSpacing))
        const charX = relX % (digitW + digitSpacing)

        if (charIdx >= 0 && charIdx < dateStr.length && charX < digitW) {
          if (isSevenSegmentPixel(dateStr[charIdx], charX, relY)) {
            isStamp = true
          }
        }

        if (!isStamp) {
          // Check 1px 8-neighborhood for glow
          for (let dy = -1; dy <= 1 && !isHalo; dy++) {
            for (let dx = -1; dx <= 1 && !isHalo; dx++) {
              const nx = relX + dx
              const ny = relY + dy
              const cIdx = Math.floor(nx / (digitW + digitSpacing))
              const cX = nx % (digitW + digitSpacing)
              if (cIdx >= 0 && cIdx < dateStr.length && cX < digitW && cX >= 0) {
                if (isSevenSegmentPixel(dateStr[cIdx], cX, ny)) {
                  isHalo = true
                }
              }
            }
          }
        }
      }

      if (isStamp) {
        outRgb[p] = stampLinR
        outRgb[p + 1] = stampLinG
        outRgb[p + 2] = stampLinB
      } else if (isHalo) {
        // Additive optical bloom
        outRgb[p] = Math.min(1, nr * 0.7 + haloLinR)
        outRgb[p + 1] = Math.min(1, ng * 0.7 + haloLinG)
        outRgb[p + 2] = Math.min(1, nb * 0.7 + haloLinB)
      } else {
        outRgb[p] = nr
        outRgb[p + 1] = ng
        outRgb[p + 2] = nb
      }

      // Compact 8-bit index for tile/fit analysis
      indices[idx] = (linearToByte(outRgb[p]) >> 3) ^ (linearToByte(outRgb[p + 1]) >> 3) ^ (linearToByte(outRgb[p + 2]) >> 3)
    }
  }

  return { indices, rgb: outRgb, paper: [255, 255, 255] }
}

// -------------------------------------------------------------------------
// 2. JPEG "DEEP FRY" DCT CRUNCH
// -------------------------------------------------------------------------

// Precomputed 8×8 DCT cosine basis matrix
const COS_TABLE = new Float32Array(64)
for (let u = 0; u < 8; u++) {
  for (let x = 0; x < 8; x++) {
    COS_TABLE[u * 8 + x] = Math.cos(((2 * x + 1) * u * Math.PI) / 16)
  }
}

// Heavy DCT quantization matrix simulating multi-generation JPEG crunch
const JPEG_QUANT = new Float32Array([
  32, 24, 28, 48, 64, 80, 112, 128,
  24, 28, 32, 54, 68, 96, 120, 140,
  28, 32, 44, 64, 88, 120, 140, 160,
  48, 54, 64, 80, 112, 144, 160, 180,
  64, 68, 88, 112, 144, 176, 192, 210,
  80, 96, 120, 144, 176, 208, 224, 240,
  112, 120, 140, 160, 192, 224, 240, 255,
  128, 140, 160, 180, 210, 240, 255, 255
])

export function processDeepFry(
  linearRgb: Float32Array,
  width: number,
  height: number
): AnalogResult {
  const n = width * height
  const outRgb = new Float32Array(n * 3)
  const indices = new Uint8Array(n)

  // Step 1: Oversaturate and boost contrast ("deep fried" color curve)
  const srgb = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const r = toSrgb(linearRgb[i * 3])
    const g = toSrgb(linearRgb[i * 3 + 1])
    const b = toSrgb(linearRgb[i * 3 + 2])

    const l = 0.299 * r + 0.587 * g + 0.114 * b
    // Boost contrast
    const cl = Math.min(1, Math.max(0, (l - 0.45) * 1.55 + 0.45))
    // Boost saturation +50%
    const sr = cl + (r - l) * 1.6
    const sg = cl + (g - l) * 1.6
    const sb = cl + (b - l) * 1.6

    srgb[i * 3] = Math.min(1, Math.max(0, sr))
    srgb[i * 3 + 1] = Math.min(1, Math.max(0, sg))
    srgb[i * 3 + 2] = Math.min(1, Math.max(0, sb))
  }

  // Step 2: 8×8 block Discrete Cosine Transform (DCT) quantization
  const blockIn = new Float32Array(64)
  const blockDct = new Float32Array(64)
  const blockOut = new Float32Array(64)

  for (let c = 0; c < 3; c++) {
    for (let by = 0; by < height; by += 8) {
      for (let bx = 0; bx < width; bx += 8) {
        // Fill 8×8 block
        for (let y = 0; y < 8; y++) {
          const sy = Math.min(height - 1, by + y)
          for (let x = 0; x < 8; x++) {
            const sx = Math.min(width - 1, bx + x)
            blockIn[y * 8 + x] = (srgb[(sy * width + sx) * 3 + c] - 0.5) * 255
          }
        }

        // Forward 8×8 2D DCT
        for (let u = 0; u < 8; u++) {
          const alphaU = u === 0 ? 0.35355339 : 0.5 // 1/sqrt(8) vs sqrt(2/8)
          for (let v = 0; v < 8; v++) {
            const alphaV = v === 0 ? 0.35355339 : 0.5
            let sum = 0
            for (let y = 0; y < 8; y++) {
              const cosV = COS_TABLE[v * 8 + y]
              for (let x = 0; x < 8; x++) {
                sum += blockIn[y * 8 + x] * COS_TABLE[u * 8 + x] * cosV
              }
            }
            blockDct[v * 8 + u] = alphaU * alphaV * sum
          }
        }

        // Quantization with severe step sizes + high-frequency cutoff
        for (let k = 0; k < 64; k++) {
          const q = JPEG_QUANT[k] * 1.4
          blockDct[k] = Math.round(blockDct[k] / q) * q
        }

        // Inverse 8×8 2D DCT
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            let sum = 0
            for (let v = 0; v < 8; v++) {
              const alphaV = v === 0 ? 0.35355339 : 0.5
              const cosV = COS_TABLE[v * 8 + y]
              for (let u = 0; u < 8; u++) {
                const alphaU = u === 0 ? 0.35355339 : 0.5
                sum += alphaU * alphaV * blockDct[v * 8 + u] * COS_TABLE[u * 8 + x] * cosV
              }
            }
            blockOut[y * 8 + x] = Math.min(1, Math.max(0, (sum + 128) / 255))
          }
        }

        // Write back
        for (let y = 0; y < 8; y++) {
          const dy = by + y
          if (dy >= height) break
          for (let x = 0; x < 8; x++) {
            const dx = bx + x
            if (dx >= width) break
            srgb[(dy * width + dx) * 3 + c] = blockOut[y * 8 + x]
          }
        }
      }
    }
  }

  // Convert back to linear RGB
  for (let i = 0; i < n; i++) {
    const p = i * 3
    outRgb[p] = toLinear(srgb[p])
    outRgb[p + 1] = toLinear(srgb[p + 1])
    outRgb[p + 2] = toLinear(srgb[p + 2])
    indices[i] = (linearToByte(outRgb[p]) >> 4) | ((linearToByte(outRgb[p + 1]) >> 4) << 4)
  }

  return { indices, rgb: outRgb, paper: [255, 255, 255] }
}

// -------------------------------------------------------------------------
// 3. NEWSPAPER HALFTONE ROSETTES (CMYK SCREEN ANGLES ON NEWSPRINT)
// -------------------------------------------------------------------------

export function processNewspaperHalftone(
  linearRgb: Float32Array,
  width: number,
  height: number
): AnalogResult {
  const n = width * height
  const outRgb = new Float32Array(n * 3)
  const indices = new Uint8Array(n)

  // Standard rotary newspaper press angles
  const ANGLE_C = (15 * Math.PI) / 180
  const ANGLE_M = (75 * Math.PI) / 180
  const ANGLE_Y = 0
  const ANGLE_K = (45 * Math.PI) / 180

  // Halftone screen frequency: 6px dot pitch
  const PITCH = 5.5
  const MAX_RADIUS = PITCH * 0.7071

  // Unbleached newsprint paper tint: #f2ede4
  const paperR = BYTE_TO_LINEAR[242]
  const paperG = BYTE_TO_LINEAR[237]
  const paperB = BYTE_TO_LINEAR[228]

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const p = idx * 3

      // Convert linear RGB to sRGB [0..1]
      const r = toSrgb(linearRgb[p])
      const g = toSrgb(linearRgb[p + 1])
      const b = toSrgb(linearRgb[p + 2])

      // CMYK separation with Under Color Removal (UCR)
      const k = Math.min(1 - r, 1 - g, 1 - b) * 0.85
      const denom = Math.max(0.001, 1 - k)
      const c = Math.min(1, Math.max(0, (1 - r - k) / denom))
      const m = Math.min(1, Math.max(0, (1 - g - k) / denom))
      const yCol = Math.min(1, Math.max(0, (1 - b - k) / denom))

      // Halftone dot screening for each channel
      const dotC = halftoneDot(x, y, ANGLE_C, PITCH, MAX_RADIUS, c)
      const dotM = halftoneDot(x, y, ANGLE_M, PITCH, MAX_RADIUS, m)
      const dotY = halftoneDot(x, y, ANGLE_Y, PITCH, MAX_RADIUS, yCol)
      const dotK = halftoneDot(x, y, ANGLE_K, PITCH, MAX_RADIUS, k)

      // Subtractive ink multiplication over newsprint paper
      // C absorbs Red, M absorbs Green, Y absorbs Blue, K absorbs all
      const outR = paperR * (1 - dotC * 0.95) * (1 - dotK * 0.97)
      const outG = paperG * (1 - dotM * 0.92) * (1 - dotK * 0.97)
      const outB = paperB * (1 - dotY * 0.90) * (1 - dotK * 0.97)

      outRgb[p] = Math.max(0, Math.min(1, outR))
      outRgb[p + 1] = Math.max(0, Math.min(1, outG))
      outRgb[p + 2] = Math.max(0, Math.min(1, outB))

      indices[idx] = (dotK > 0.5 ? 8 : 0) | (dotC > 0.5 ? 4 : 0) | (dotM > 0.5 ? 2 : 0) | (dotY > 0.5 ? 1 : 0)
    }
  }

  return { indices, rgb: outRgb, paper: [242, 237, 228] }
}

function halftoneDot(
  x: number,
  y: number,
  angle: number,
  pitch: number,
  maxR: number,
  channel: number
): number {
  if (channel <= 0.01) return 0
  if (channel >= 0.99) return 1

  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const u = x * cos + y * sin
  const v = -x * sin + y * cos

  const modU = ((u % pitch) + pitch) % pitch - pitch / 2
  const modV = ((v % pitch) + pitch) % pitch - pitch / 2
  const dist = Math.sqrt(modU * modU + modV * modV)

  const radius = maxR * Math.sqrt(channel)
  // Anti-aliased dot edge
  if (dist < radius - 0.5) return 1
  if (dist > radius + 0.5) return 0
  return radius + 0.5 - dist
}

// -------------------------------------------------------------------------
// 4. TWO-INK RISOGRAPH (FLUO PINK + TEAL SPOT INKS + DRUM MISREGISTRATION)
// -------------------------------------------------------------------------

export function processRisograph(
  linearRgb: Float32Array,
  width: number,
  height: number
): AnalogResult {
  const n = width * height
  const outRgb = new Float32Array(n * 3)
  const indices = new Uint8Array(n)

  // Spot Inks:
  // Ink 1: Fluorescent Pink (#ff48b0)
  // Ink 2: Teal / Aqua (#00838a)
  // Paper: Off-white warm riso vellum (#fbf9f4)
  const paperR = BYTE_TO_LINEAR[251]
  const paperG = BYTE_TO_LINEAR[249]
  const paperB = BYTE_TO_LINEAR[244]

  const ANGLE_PINK = (15 * Math.PI) / 180
  const ANGLE_TEAL = (75 * Math.PI) / 180
  const PITCH = 5.0
  const MAX_RADIUS = PITCH * 0.7071

  // Drum Misregistration Offset for Teal drum (mechanical pass slip)
  const JITTER_X = 1.5
  const JITTER_Y = 1.0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const p = idx * 3

      // Convert to sRGB
      const r = toSrgb(linearRgb[p])
      const g = toSrgb(linearRgb[p + 1])
      const b = toSrgb(linearRgb[p + 2])

      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const dark = 1 - lum

      // Color separation into Pink and Teal ink coverage
      // Pink responds to reds, magentas, warm skin tones, highlights
      const warm = Math.max(0, r - (g + b) * 0.5)
      const pinkCoverage = Math.min(1, Math.max(0, dark * (0.35 + 0.65 * warm) + 0.25 * (1 - g)))

      // Sample shifted position for Teal drum misregistration
      const tx = Math.max(0, Math.min(width - 1, Math.round(x + JITTER_X)))
      const ty = Math.max(0, Math.min(height - 1, Math.round(y + JITTER_Y)))
      const tp = (ty * width + tx) * 3

      const tr = toSrgb(linearRgb[tp])
      const tg = toSrgb(linearRgb[tp + 1])
      const tb = toSrgb(linearRgb[tp + 2])
      const tLum = 0.2126 * tr + 0.7152 * tg + 0.0722 * tb
      const tDark = 1 - tLum

      // Teal responds to blues, cyans, cool shadows
      const cool = Math.max(0, (tg + tb) * 0.5 - tr)
      const tealCoverage = Math.min(1, Math.max(0, tDark * (0.45 + 0.55 * cool) + 0.3 * (1 - tr)))

      // Halftone dot screening
      const dotPink = halftoneDot(x, y, ANGLE_PINK, PITCH, MAX_RADIUS, pinkCoverage)
      const dotTeal = halftoneDot(tx, ty, ANGLE_TEAL, PITCH, MAX_RADIUS, tealCoverage)

      // Transparent spot ink overprint multiplication
      // Fluo Pink absorbs Green (leaves Red and Blue)
      // Teal absorbs Red (leaves Green and Blue)
      // Overlap produces rich dark violet / indigo
      const outR = paperR * (1 - dotTeal * 0.98)
      const outG = paperG * (1 - dotPink * 0.85) * (1 - dotTeal * 0.25)
      const outB = paperB * (1 - dotPink * 0.35) * (1 - dotTeal * 0.55)

      outRgb[p] = Math.max(0, Math.min(1, outR))
      outRgb[p + 1] = Math.max(0, Math.min(1, outG))
      outRgb[p + 2] = Math.max(0, Math.min(1, outB))

      indices[idx] = (dotPink > 0.5 ? 1 : 0) | (dotTeal > 0.5 ? 2 : 0)
    }
  }

  return { indices, rgb: outRgb, paper: [251, 249, 244] }
}

// -------------------------------------------------------------------------
// 5. STREAKY 1-BIT FAX (ERROR DIFFUSION + FEED STREAKS + HEADER)
// -------------------------------------------------------------------------

export function processFax(
  linearRgb: Float32Array,
  width: number,
  height: number
): AnalogResult {
  const n = width * height
  const outRgb = new Float32Array(n * 3)
  const indices = new Uint8Array(n)

  // Transmission header text at top of page (lines 0 to 18)
  const headerText = 'FROM: B0R3D FAX G3       TEL: +1-800-B0R3D       PAGE: 001/001       2026-10-07 14:20'
  const headerH = 20

  // Dirty thermal roller vertical streak lines (x coordinates)
  const streakPositions = [
    Math.round(width * 0.12),
    Math.round(width * 0.28),
    Math.round(width * 0.65),
    Math.round(width * 0.84)
  ]

  // Scanline dropout rows (packet glitch)
  const dropoutRow1 = Math.round(height * 0.42)
  const dropoutRow2 = Math.round(height * 0.78)

  // 1-bit Floyd-Steinberg error diffusion buffer
  const gray = new Float32Array(width * height)
  for (let i = 0; i < n; i++) {
    const lum = luminance(linearRgb[i * 3], linearRgb[i * 3 + 1], linearRgb[i * 3 + 2])
    // High-contrast S-curve
    gray[i] = Math.min(1, Math.max(0, Math.pow(lum, 1.25)))
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const p = idx * 3

      // Check header area
      if (y < headerH) {
        if (y === headerH - 2) {
          // Horizontal divider line
          indices[idx] = 1
          outRgb[p] = outRgb[p + 1] = outRgb[p + 2] = 0
          continue
        }

        if (y >= 6 && y < 13) {
          const fontX = x - 12
          const fontY = y - 6
          const charIdx = Math.floor(fontX / 6)
          const px = fontX % 6
          if (charIdx >= 0 && charIdx < headerText.length && px < 5) {
            if (isFont5x7Pixel(headerText[charIdx], px, fontY)) {
              indices[idx] = 1
              outRgb[p] = outRgb[p + 1] = outRgb[p + 2] = 0
              continue
            }
          }
        }

        // Header paper background
        indices[idx] = 0
        outRgb[p] = outRgb[p + 1] = outRgb[p + 2] = 1
        continue
      }

      // Check scanline dropouts (corrupted horizontal transmission lines)
      if (y === dropoutRow1 || y === dropoutRow2) {
        // Line dropout gives blank paper gap
        indices[idx] = 0
        outRgb[p] = outRgb[p + 1] = outRgb[p + 2] = 1
        continue
      }

      // Vertical paper feed streaks
      let isStreak = false
      for (const sx of streakPositions) {
        if (x === sx) {
          // Continuous or semi-continuous dark streak
          if (hash2d(x, y, 77) < 0.88) {
            isStreak = true
            break
          }
        }
      }

      if (isStreak) {
        indices[idx] = 1
        outRgb[p] = outRgb[p + 1] = outRgb[p + 2] = 0
        continue
      }

      // Error diffusion thresholding
      const oldVal = gray[idx]
      const newVal = oldVal < 0.5 ? 0 : 1
      const err = oldVal - newVal

      indices[idx] = newVal === 0 ? 1 : 0
      outRgb[p] = outRgb[p + 1] = outRgb[p + 2] = newVal

      // Diffuse error
      if (x + 1 < width) gray[idx + 1] += err * (7 / 16)
      if (y + 1 < height) {
        if (x > 0) gray[idx + width - 1] += err * (3 / 16)
        gray[idx + width] += err * (5 / 16)
        if (x + 1 < width) gray[idx + width + 1] += err * (1 / 16)
      }
    }
  }

  return { indices, rgb: outRgb, paper: [255, 255, 255] }
}
