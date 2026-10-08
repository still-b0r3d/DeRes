import { BYTE_TO_LINEAR } from './color'
import { quantizeRgb } from './quantize'

// Zero-dependency Animated GIF (GIF89a) encoder.
// Generates standard GIF89a binary streams with Logical Screen Descriptor,
// Netscape 2.0 loop extension block, Graphic Control Extension per frame,
// and pure-TypeScript LZW table compression with sub-block streaming.

export interface GifFrame {
  width: number
  height: number
  /** Delay in milliseconds (default: 100ms, i.e. 10 fps) */
  delayMs?: number
  /** Indices into the color palette (one byte per pixel) */
  indices: Uint8Array
  /** Optional local color table for this specific frame (r, g, b entries) */
  palette?: Uint8Array
  /** Optional transparent color index (-1 or undefined for none) */
  transparentIndex?: number
}

export interface GifOptions {
  /** 0 = loop forever (default: 0) */
  loop?: number
  /** Global color table (r, g, b per entry, up to 256 colors) */
  palette?: Uint8Array
}

export interface RgbGifFrame {
  width: number
  height: number
  delayMs?: number
  rgb: Uint8Array
}

/**
 * Packs LZW-compressed stream for a frame's pixel indices into 255-byte sub-blocks.
 */
function compressLzw(pixels: Uint8Array, minCodeSize: number): Uint8Array {
  const clearCode = 1 << minCodeSize
  const eoiCode = clearCode + 1

  const bytes: number[] = []
  const subBlock = new Uint8Array(255)
  let subLen = 0

  let accum = 0
  let accumBits = 0

  function flushSubBlock() {
    if (subLen > 0) {
      bytes.push(subLen)
      for (let i = 0; i < subLen; i++) bytes.push(subBlock[i])
      subLen = 0
    }
  }

  function writeByte(b: number) {
    subBlock[subLen++] = b
    if (subLen === 255) flushSubBlock()
  }

  function writeBits(val: number, bits: number) {
    accum |= val << accumBits
    accumBits += bits
    while (accumBits >= 8) {
      writeByte(accum & 0xff)
      accum >>>= 8
      accumBits -= 8
    }
  }

  function flushBits() {
    if (accumBits > 0) {
      writeByte(accum & 0xff)
      accum = 0
      accumBits = 0
    }
    flushSubBlock()
  }

  let codeSize = minCodeSize + 1
  let nextCode = clearCode + 2
  const table = new Map<number, number>()

  writeBits(clearCode, codeSize)

  if (pixels.length === 0) {
    writeBits(eoiCode, codeSize)
    flushBits()
    bytes.push(0x00) // Block terminator
    return new Uint8Array(bytes)
  }

  let prefix = pixels[0]

  for (let i = 1; i < pixels.length; i++) {
    const c = pixels[i]
    const key = (prefix << 8) | c
    const existing = table.get(key)
    if (existing !== undefined) {
      prefix = existing
    } else {
      writeBits(prefix, codeSize)
      if (nextCode < 4096) {
        table.set(key, nextCode)
        nextCode++
        if (nextCode === (1 << codeSize) + 1 && codeSize < 12) {
          codeSize++
        }
      } else {
        writeBits(clearCode, codeSize)
        table.clear()
        codeSize = minCodeSize + 1
        nextCode = clearCode + 2
      }
      prefix = c
    }
  }

  writeBits(prefix, codeSize)
  writeBits(eoiCode, codeSize)
  flushBits()
  bytes.push(0x00) // Block terminator

  return new Uint8Array(bytes)
}

function padPalette(palette: Uint8Array): { table: Uint8Array; depth: number } {
  const colours = Math.floor(palette.length / 3)
  let depth = 1
  while (1 << depth < colours && depth < 8) depth++
  const fullSize = 1 << depth
  const table = new Uint8Array(fullSize * 3)
  table.set(palette.subarray(0, Math.min(palette.length, fullSize * 3)))
  return { table, depth }
}

/**
 * Encodes an array of indexed frames into an Animated GIF (GIF89a).
 */
export function encodeGif(
  frames: readonly GifFrame[],
  options?: GifOptions
): Uint8Array<ArrayBuffer> {
  if (frames.length === 0) throw new Error('GIF requires at least one frame')

  const width = frames[0].width
  const height = frames[0].height
  const loop = options?.loop ?? 0

  const globalPalSource = options?.palette ?? frames[0].palette
  if (!globalPalSource || globalPalSource.length < 3) {
    throw new Error('GIF requires a color palette')
  }

  const { table: gct, depth: gctDepth } = padPalette(globalPalSource)
  const chunks: Uint8Array[] = []

  // 1. Header: GIF89a
  chunks.push(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))

  // 2. Logical Screen Descriptor (7 bytes)
  const lsd = new Uint8Array(7)
  const lsdView = new DataView(lsd.buffer)
  lsdView.setUint16(0, width, true)
  lsdView.setUint16(2, height, true)
  // GCT flag (bit 7) = 1, Color res (bits 4-6) = depth - 1, GCT size = depth - 1
  lsd[4] = 0x80 | (((gctDepth - 1) & 7) << 4) | ((gctDepth - 1) & 7)
  lsd[5] = 0x00 // Background color index
  lsd[6] = 0x00 // Pixel aspect ratio
  chunks.push(lsd)

  // 3. Global Color Table
  chunks.push(gct)

  // 4. Netscape 2.0 Looping Application Extension (19 bytes)
  const appExt = new Uint8Array([
    0x21, 0xff, 0x0b, // Extension introducer, label, block length 11
    0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, // 'NETSCAPE2.0'
    0x03, 0x01, // Sub-block length 3, sub-block ID 1
    loop & 0xff, (loop >> 8) & 0xff, // Loop count (0 = infinite)
    0x00 // Terminator
  ])
  chunks.push(appExt)

  // 5. Frames
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    const delayCs = Math.max(1, Math.round((frame.delayMs ?? 100) / 10))
    const hasTrans = frame.transparentIndex !== undefined && frame.transparentIndex >= 0

    // Graphic Control Extension (8 bytes)
    const gce = new Uint8Array(8)
    gce[0] = 0x21
    gce[1] = 0xf9
    gce[2] = 0x04 // Byte length
    // Disposal method 1 (do not dispose: 1 << 2 = 0x04), user input 0, trans flag
    gce[3] = 0x04 | (hasTrans ? 1 : 0)
    gce[4] = delayCs & 0xff
    gce[5] = (delayCs >> 8) & 0xff
    gce[6] = hasTrans ? frame.transparentIndex! : 0
    gce[7] = 0x00 // Terminator
    chunks.push(gce)

    // Image Descriptor (10 bytes)
    const hasLct = !!(frame.palette && frame.palette !== globalPalSource)
    const lctInfo = hasLct ? padPalette(frame.palette!) : null

    const id = new Uint8Array(10)
    const idView = new DataView(id.buffer)
    id[0] = 0x2c // Image separator
    idView.setUint16(1, 0, true) // Left
    idView.setUint16(3, 0, true) // Top
    idView.setUint16(5, frame.width, true)
    idView.setUint16(7, frame.height, true)
    id[9] = hasLct && lctInfo ? 0x80 | ((lctInfo.depth - 1) & 7) : 0x00
    chunks.push(id)

    if (hasLct && lctInfo) {
      chunks.push(lctInfo.table)
    }

    // Table-Based Image Data
    const minCodeSize = Math.max(2, (hasLct && lctInfo ? lctInfo.depth : gctDepth))
    chunks.push(new Uint8Array([minCodeSize]))
    chunks.push(compressLzw(frame.indices, minCodeSize))
  }

  // 6. Trailer: 0x3B
  chunks.push(new Uint8Array([0x3b]))

  // Total byte size
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
  const out = new Uint8Array(totalLength)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }

  return out
}

/**
 * Encodes an array of 24-bit RGB frames into an Animated GIF by quantizing
 * to a shared 256-color palette (or using provided palette).
 */
export function encodeRgbGif(
  frames: readonly RgbGifFrame[],
  options?: { loop?: number; palette?: Uint8Array }
): Uint8Array<ArrayBuffer> {
  if (frames.length === 0) throw new Error('GIF requires at least one frame')

  const width = frames[0].width
  const height = frames[0].height
  let palette = options?.palette

  if (!palette || palette.length === 0) {
    // Collect sample pixels from all frames
    const sampleLimit = 32768
    const pixelsPerFrame = width * height
    const totalPixels = frames.length * pixelsPerFrame
    const step = Math.max(1, Math.floor(totalPixels / sampleLimit))

    const linSamples: number[] = []
    let sampleCounter = 0
    for (const f of frames) {
      for (let p = 0; p < pixelsPerFrame; p++) {
        if (sampleCounter++ % step === 0) {
          const idx = p * 3
          linSamples.push(
            BYTE_TO_LINEAR[f.rgb[idx]],
            BYTE_TO_LINEAR[f.rgb[idx + 1]],
            BYTE_TO_LINEAR[f.rgb[idx + 2]]
          )
        }
      }
    }

    palette = quantizeRgb(new Float32Array(linSamples), 256, 8)
  }

  const palLength = palette.length / 3
  const palR = new Uint8Array(palLength)
  const palG = new Uint8Array(palLength)
  const palB = new Uint8Array(palLength)
  for (let i = 0; i < palLength; i++) {
    palR[i] = palette[i * 3]
    palG[i] = palette[i * 3 + 1]
    palB[i] = palette[i * 3 + 2]
  }

  // Map RGB pixels of each frame to nearest palette index. Each distinct
  // colour is searched for once and remembered: animation frames repeat the
  // same colours a great deal, and the search covers up to 256 entries.
  const nearest = new Map<number, number>()
  const indexedFrames: GifFrame[] = []
  for (const f of frames) {
    const pixelCount = f.width * f.height
    const indices = new Uint8Array(pixelCount)

    for (let p = 0; p < pixelCount; p++) {
      const r = f.rgb[p * 3]
      const g = f.rgb[p * 3 + 1]
      const b = f.rgb[p * 3 + 2]
      const key = (r << 16) | (g << 8) | b
      const known = nearest.get(key)
      if (known !== undefined) {
        indices[p] = known
        continue
      }

      let bestIdx = 0
      let bestDist = Infinity
      for (let i = 0; i < palLength; i++) {
        const dr = r - palR[i]
        const dg = g - palG[i]
        const db = b - palB[i]
        const dist = dr * dr + dg * dg + db * db
        if (dist < bestDist) {
          bestDist = dist
          bestIdx = i
          if (dist === 0) break
        }
      }
      nearest.set(key, bestIdx)
      indices[p] = bestIdx
    }

    indexedFrames.push({
      width: f.width,
      height: f.height,
      delayMs: f.delayMs,
      indices
    })
  }

  return encodeGif(indexedFrames, { loop: options?.loop ?? 0, palette })
}
