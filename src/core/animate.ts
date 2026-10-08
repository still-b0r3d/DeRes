import { encodeApng, type ApngFrame } from './apng'
import { encodeGif, encodeRgbGif, type GifFrame, type RgbGifFrame } from './gif'
import { DEFAULT_FX, fxRenderer, type Fx } from './fx'
import { exportSize, MAX_EXPORT_PIXELS, type DeresSettings, type Rendered } from './pipeline'
import { FX_MIN_MULTIPLIER } from './export'

// Looping animation generators for b0r3d DeRes:
// 1. screen-fx: CRT beam scanline ripple, VHS tracking roll + noise, composite shimmer
// 2. compare-wipe: Before & after split wipe transition between original photo and retro art
// 3. dither-shimmer: Ordered Bayer / PS1 dither coordinate phase rotation

export type AnimationStyle = 'screen-fx' | 'compare-wipe' | 'dither-shimmer'

export interface AnimatedExportOptions {
  style: AnimationStyle
  format: 'apng' | 'gif'
  multiplier: number
  tv: boolean
  fx: Fx | null
  frameCount?: number
  fps?: number
  sourceRgba?: Uint8Array | Uint8ClampedArray
  sourceWidth?: number
  sourceHeight?: number
  /** Called after each frame is made: frames done so far, and how many in all. */
  onProgress?: (done: number, total: number) => void
}

/**
 * The largest animation, in pixels per frame. Every frame is held in memory
 * (up to 16 of them), so this is far below the single PNG's limit: a phone
 * has to cope with it.
 */
export const MAX_ANIMATION_PIXELS = 1024 * 1024

export interface AnimatedExportResult {
  data: Uint8Array<ArrayBuffer>
  format: 'apng' | 'gif'
  mimeType: 'image/png' | 'image/gif'
  width: number
  height: number
  frameCount: number
}

/**
 * Resamples an RGBA image buffer to a target width and height using nearest-neighbour.
 */
function resampleRgbaToRgb(
  src: Uint8Array | Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8Array {
  const out = new Uint8Array(dstW * dstH * 3)
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH))
    const rowOffset = y * dstW * 3
    const srcRowOffset = sy * srcW * 4
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW))
      const srcIdx = srcRowOffset + sx * 4
      const dstIdx = rowOffset + x * 3
      out[dstIdx] = src[srcIdx]
      out[dstIdx + 1] = src[srcIdx + 1]
      out[dstIdx + 2] = src[srcIdx + 2]
    }
  }
  return out
}

/**
 * Upscales a retro picture (r.rgb) to export dimensions using nearest-neighbour.
 */
function upscaleRgb(
  srcRgb: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8Array {
  const out = new Uint8Array(dstW * dstH * 3)
  const colMap = new Int32Array(dstW)
  for (let x = 0; x < dstW; x++) colMap[x] = Math.min(srcW - 1, Math.floor((x * srcW) / dstW))

  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH)) * srcW * 3
    const dstRow = y * dstW * 3
    for (let x = 0; x < dstW; x++) {
      const srcIdx = sy + colMap[x] * 3
      const dstIdx = dstRow + x * 3
      out[dstIdx] = srcRgb[srcIdx]
      out[dstIdx + 1] = srcRgb[srcIdx + 1]
      out[dstIdx + 2] = srcRgb[srcIdx + 2]
    }
  }
  return out
}

/**
 * Upscales retro palette indices to export dimensions.
 */
function upscaleIndices(
  srcIndices: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8Array {
  const out = new Uint8Array(dstW * dstH)
  const colMap = new Int32Array(dstW)
  for (let x = 0; x < dstW; x++) colMap[x] = Math.min(srcW - 1, Math.floor((x * srcW) / dstW))

  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH)) * srcW
    const dstRow = y * dstW
    for (let x = 0; x < dstW; x++) {
      out[dstRow + x] = srcIndices[sy + colMap[x]]
    }
  }
  return out
}

/**
 * Generates an animated looping image (APNG or GIF) for the current picture.
 */
export async function generateAnimatedExport(
  r: Rendered,
  options: AnimatedExportOptions,
  settings: DeresSettings,
  renderDeres?: (s: DeresSettings) => Rendered
): Promise<AnimatedExportResult> {
  const m = Math.max(1, Math.floor(options.multiplier))
  const [width, height] = exportSize(r.width, r.height, r.geometry.par, m, options.tv)
  if (width * height > MAX_EXPORT_PIXELS || width * height > MAX_ANIMATION_PIXELS) {
    throw new Error('That size is too big for an animation. Pick a smaller size.')
  }
  const progress = (done: number, total: number) => options.onProgress?.(done, total)

  const isApng = options.format === 'apng'

  // --- STYLE 1: SCREEN FX LOOP ---
  if (options.style === 'screen-fx') {
    const frameCount = options.frameCount ?? 12
    const fps = options.fps ?? 10
    const delayMs = Math.round(1000 / fps)

    const activeFx: Fx =
      options.fx && options.fx.screen !== 'off'
        ? options.fx
        : { ...DEFAULT_FX, screen: 'crt' }

    const rgbFrames: Uint8Array[] = []
    const row = new Uint8Array(width * 3)

    for (let f = 0; f < frameCount; f++) {
      const phase = f / frameCount
      const renderer = fxRenderer(
        { rgb: r.rgb, width: r.width, height: r.height, paper: r.paper },
        width,
        height,
        activeFx,
        phase
      )
      const frameData = new Uint8Array(width * height * 3)
      for (let y = 0; y < height; y++) {
        renderer(y, row)
        frameData.set(row, y * width * 3)
      }
      rgbFrames.push(frameData)
      progress(f + 1, frameCount)
    }

    if (isApng) {
      const apngFrames: ApngFrame[] = rgbFrames.map((rgb) => ({ width, height, delayMs, rgb }))
      const data = await encodeApng(apngFrames)
      return { data, format: 'apng', mimeType: 'image/png', width, height, frameCount }
    } else {
      const gifFrames: RgbGifFrame[] = rgbFrames.map((rgb) => ({ width, height, delayMs, rgb }))
      const data = encodeRgbGif(gifFrames, { loop: 0 })
      return { data, format: 'gif', mimeType: 'image/gif', width, height, frameCount }
    }
  }

  // --- STYLE 2: BEFORE & AFTER A/B COMPARE WIPE ---
  if (options.style === 'compare-wipe') {
    const frameCount = options.frameCount ?? 16
    const fps = options.fps ?? 10
    const delayMs = Math.round(1000 / fps)

    // Render Deres at full size
    let deresRgb: Uint8Array
    if (options.fx && options.fx.screen !== 'off' && m >= FX_MIN_MULTIPLIER) {
      const renderer = fxRenderer(
        { rgb: r.rgb, width: r.width, height: r.height, paper: r.paper },
        width,
        height,
        options.fx,
        0
      )
      deresRgb = new Uint8Array(width * height * 3)
      const row = new Uint8Array(width * 3)
      for (let y = 0; y < height; y++) {
        renderer(y, row)
        deresRgb.set(row, y * width * 3)
      }
    } else {
      deresRgb = upscaleRgb(r.rgb, r.width, r.height, width, height)
    }

    // Render Original at full size
    let origRgb: Uint8Array
    if (options.sourceRgba && options.sourceWidth && options.sourceHeight) {
      origRgb = resampleRgbaToRgb(
        options.sourceRgba,
        options.sourceWidth,
        options.sourceHeight,
        width,
        height
      )
    } else {
      // Fallback: slightly desaturated/original approximation
      origRgb = new Uint8Array(deresRgb)
    }

    const rgbFrames: Uint8Array[] = []

    for (let f = 0; f < frameCount; f++) {
      let splitX = 0
      if (f === 0 || f === 15) {
        // Full original
        splitX = 0
      } else if (f >= 1 && f <= 7) {
        // Wipe forward from left to right
        splitX = Math.round((f / 8) * width)
      } else if (f >= 8 && f <= 9) {
        // Full retro hold
        splitX = width
      } else {
        // Wipe backward from right to left (f: 10..14)
        splitX = Math.round(((15 - f) / 6) * width)
      }

      const frameData = new Uint8Array(width * height * 3)
      for (let y = 0; y < height; y++) {
        const rowOffset = y * width * 3
        for (let x = 0; x < width; x++) {
          const idx = rowOffset + x * 3
          if (splitX > 0 && splitX < width && (x === splitX - 1 || x === splitX)) {
            // Crisp divider line
            frameData[idx] = 255
            frameData[idx + 1] = 255
            frameData[idx + 2] = 255
          } else if (x < splitX) {
            frameData[idx] = deresRgb[idx]
            frameData[idx + 1] = deresRgb[idx + 1]
            frameData[idx + 2] = deresRgb[idx + 2]
          } else {
            frameData[idx] = origRgb[idx]
            frameData[idx + 1] = origRgb[idx + 1]
            frameData[idx + 2] = origRgb[idx + 2]
          }
        }
      }
      rgbFrames.push(frameData)
      progress(f + 1, frameCount)
    }

    if (isApng) {
      const apngFrames: ApngFrame[] = rgbFrames.map((rgb) => ({ width, height, delayMs, rgb }))
      const data = await encodeApng(apngFrames)
      return { data, format: 'apng', mimeType: 'image/png', width, height, frameCount }
    } else {
      const gifFrames: RgbGifFrame[] = rgbFrames.map((rgb) => ({ width, height, delayMs, rgb }))
      const data = encodeRgbGif(gifFrames, { loop: 0 })
      return { data, format: 'gif', mimeType: 'image/gif', width, height, frameCount }
    }
  }

  // --- STYLE 3: DITHER SHIMMER / PHASE CYCLE ---
  const frameCount = options.frameCount ?? 8
  const fps = options.fps ?? 8
  const delayMs = Math.round(1000 / fps)

  const ditherPhases: [number, number][] = [
    [0, 0], [2, 1], [1, 3], [3, 2],
    [2, 2], [0, 3], [3, 1], [1, 0]
  ]

  const hasFx = !!(options.fx && options.fx.screen !== 'off' && m >= FX_MIN_MULTIPLIER)

  if (hasFx) {
    const rgbFrames: Uint8Array[] = []
    const row = new Uint8Array(width * 3)

    for (let f = 0; f < frameCount; f++) {
      const offset = ditherPhases[f % ditherPhases.length]
      const frameRender = renderDeres
        ? renderDeres({ ...settings, ditherOffset: offset })
        : r

      const renderer = fxRenderer(
        { rgb: frameRender.rgb, width: frameRender.width, height: frameRender.height, paper: frameRender.paper },
        width,
        height,
        options.fx!,
        f / frameCount
      )
      const frameData = new Uint8Array(width * height * 3)
      for (let y = 0; y < height; y++) {
        renderer(y, row)
        frameData.set(row, y * width * 3)
      }
      rgbFrames.push(frameData)
      progress(f + 1, frameCount)
    }

    if (isApng) {
      const apngFrames: ApngFrame[] = rgbFrames.map((rgb) => ({ width, height, delayMs, rgb }))
      const data = await encodeApng(apngFrames)
      return { data, format: 'apng', mimeType: 'image/png', width, height, frameCount }
    } else {
      const gifFrames: RgbGifFrame[] = rgbFrames.map((rgb) => ({ width, height, delayMs, rgb }))
      const data = encodeRgbGif(gifFrames, { loop: 0 })
      return { data, format: 'gif', mimeType: 'image/gif', width, height, frameCount }
    }
  }

  // Pure indexed dither shimmer (no screen effects)
  const isIndexedPossible = r.palette.length / 3 <= 256 && r.palette.length > 0
  const indexedFrames: Uint8Array[] = []

  for (let f = 0; isIndexedPossible && f < frameCount; f++) {
    const offset = ditherPhases[f % ditherPhases.length]
    const frameRender = renderDeres
      ? renderDeres({ ...settings, ditherOffset: offset })
      : r

    const scaledIndices = upscaleIndices(
      frameRender.indices,
      frameRender.width,
      frameRender.height,
      width,
      height
    )
    indexedFrames.push(scaledIndices)
    progress(f + 1, frameCount)
  }

  if (isIndexedPossible) {
    if (isApng) {
      const apngFrames: ApngFrame[] = indexedFrames.map((indices) => ({
        width,
        height,
        delayMs,
        indices
      }))
      const data = await encodeApng(apngFrames, { palette: r.palette, numPlays: 0 })
      return { data, format: 'apng', mimeType: 'image/png', width, height, frameCount }
    } else {
      const gifFrames: GifFrame[] = indexedFrames.map((indices) => ({
        width,
        height,
        delayMs,
        indices
      }))
      const data = encodeGif(gifFrames, { palette: r.palette, loop: 0 })
      return { data, format: 'gif', mimeType: 'image/gif', width, height, frameCount }
    }
  }

  // Truecolour fallback for dither shimmer without FX
  const rgbFrames: Uint8Array[] = []
  for (let f = 0; f < frameCount; f++) {
    const offset = ditherPhases[f % ditherPhases.length]
    const frameRender = renderDeres
      ? renderDeres({ ...settings, ditherOffset: offset })
      : r
    rgbFrames.push(upscaleRgb(frameRender.rgb, frameRender.width, frameRender.height, width, height))
    progress(f + 1, frameCount)
  }

  if (isApng) {
    const apngFrames: ApngFrame[] = rgbFrames.map((rgb) => ({ width, height, delayMs, rgb }))
    const data = await encodeApng(apngFrames)
    return { data, format: 'apng', mimeType: 'image/png', width, height, frameCount }
  } else {
    const gifFrames: RgbGifFrame[] = rgbFrames.map((rgb) => ({ width, height, delayMs, rgb }))
    const data = encodeRgbGif(gifFrames, { loop: 0 })
    return { data, format: 'gif', mimeType: 'image/gif', width, height, frameCount }
  }
}
