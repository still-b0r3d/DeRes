import { ApngWriter, encodeApng, type ApngFrame } from './apng'
import {
  encodeGif,
  encodeRgbGif,
  GifWriter,
  NearestColour,
  PaletteSamples,
  rgbFramesPalette,
  transparentAfter,
  withTransparentEntry,
  type GifFrame
} from './gif'
import { DEFAULT_FX, fxRenderer, type Fx } from './fx'
import { exportSize, MAX_EXPORT_PIXELS, type DeresSettings, type Rendered } from './pipeline'
import { FX_MIN_MULTIPLIER } from './export'
import { engineStep, signalFrame, type SignalImage } from './signal'

// Looping animation generators for b0r3d DeRes:
// 1. screen-fx: CRT beam scanline ripple, VHS tracking roll + noise, composite shimmer
// 2. compare-wipe: Before & after split wipe transition between original photo and retro art
// 3. dither-shimmer: Ordered Bayer / PS1 dither coordinate phase rotation
// 4. an animated GIF's own frames, each through the settings (generateFramesExport)
//
// With kept transparency (`seeThrough`), the frames keep their see-through
// pixels: an APNG goes RGBA (or gets a see-through palette entry), a GIF
// gets a transparent colour index, and every frame is cleared after it's
// shown, so the frame before never shows through.

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
  /**
   * The analog signal is on: one engine frame of a picture. Every loop frame
   * gets its own frame number, so the noise really moves.
   */
  signal?: (r: Rendered, frame: number) => SignalImage
  /** Length and speed of the Screen FX loop when the signal is on. */
  loop?: { frames: number; fps: number }
  /** Keep the picture's see-through pixels (the background 'transparent'). */
  seeThrough?: boolean
}

/** A full-colour frame at the export size, and which of its pixels show (null: all of them). */
interface Frame {
  rgb: Uint8Array
  alpha: Uint8Array | null
}

/** A picture at the export size through the screen effect. */
function fxFrame(r: Rendered, width: number, height: number, fx: Fx, phase: number): Frame {
  const render = fxRenderer({ rgb: r.rgb, width: r.width, height: r.height, paper: r.paper, alpha: r.alpha }, width, height, fx, phase)
  const rgb = new Uint8Array(width * height * 3)
  const alpha = r.alpha ? new Uint8Array(width * height) : null
  const row = new Uint8Array(width * 3)
  for (let y = 0; y < height; y++) {
    render(y, row, alpha?.subarray(y * width, (y + 1) * width))
    rgb.set(row, y * width * 3)
  }
  return { rgb, alpha }
}

/** A picture enlarged to the export size, nearest-neighbour. */
function enlarged(r: Rendered, width: number, height: number): Frame {
  return {
    rgb: upscaleRgb(r.rgb, r.width, r.height, width, height),
    alpha: r.alpha ? upscaleIndices(r.alpha, r.width, r.height, width, height) : null
  }
}

/** r, g, b, a per pixel (a missing mask: every pixel shows). */
function rgbaOf(f: Frame): Uint8Array {
  const n = f.rgb.length / 3
  const out = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    out[i * 4] = f.rgb[i * 3]
    out[i * 4 + 1] = f.rgb[i * 3 + 1]
    out[i * 4 + 2] = f.rgb[i * 3 + 2]
    out[i * 4 + 3] = f.alpha ? f.alpha[i] : 255
  }
  return out
}

/** An APNG frame from a full-colour one: RGBA when see-through pixels are kept. */
function apngFrame(f: Frame, width: number, height: number, delayMs: number, seeThrough: boolean): ApngFrame {
  return seeThrough ? { width, height, delayMs, rgba: rgbaOf(f) } : { width, height, delayMs, rgb: f.rgb }
}

/** Full-colour frames as a looping APNG or GIF. */
async function encodeFrames(
  frames: readonly Frame[],
  format: 'apng' | 'gif',
  width: number,
  height: number,
  delayMs: number,
  seeThrough: boolean
): Promise<AnimatedExportResult> {
  const frameCount = frames.length
  if (format === 'apng') {
    const data = await encodeApng(frames.map((f) => apngFrame(f, width, height, delayMs, seeThrough)))
    return { data, format: 'apng', mimeType: 'image/png', width, height, frameCount }
  }
  const data = encodeRgbGif(
    frames.map((f) => ({ width, height, delayMs, rgb: f.rgb, alpha: seeThrough ? f.alpha : null })),
    { loop: 0 }
  )
  return { data, format: 'gif', mimeType: 'image/gif', width, height, frameCount }
}

/**
 * The largest animation, in pixels per frame. Every frame is held in memory
 * (up to 16 of them), so this is far below the single PNG's limit: a phone
 * has to cope with it.
 */
export const MAX_ANIMATION_PIXELS = 1024 * 1024

/**
 * The most pixels a whole animation may hold (every frame together): the same
 * as 16 frames at the largest size, so longer signal loops trade size for
 * frames (48 frames fit up to about 640×480).
 */
export const MAX_ANIMATION_BUDGET = 16 * MAX_ANIMATION_PIXELS

/** Frames in each loop style, and how fast it plays (Screen FX: without the signal). */
export const STYLE_LOOPS: Readonly<Record<AnimationStyle, { frames: number; fps: number }>> = {
  'screen-fx': { frames: 12, fps: 10 },
  'compare-wipe': { frames: 16, fps: 10 },
  'dither-shimmer': { frames: 8, fps: 8 }
}

/** What an animation export is made of: a loop style, or an animated GIF's own frames. */
export type AnimationKind = AnimationStyle | 'gif-frames'

/**
 * How many frames an animation holds at once: a loop makes all of its frames
 * before they go into the file (`signalLoop`: the Screen FX loop's length
 * with the signal on, else null). An animated GIF's own frames count as
 * none: they're held only while they fit the budget, and stream past it
 * (see generateFramesExport).
 */
export function heldFrames(kind: AnimationKind, signalLoop: number | null): number {
  if (kind === 'gif-frames') return 0
  if (kind === 'screen-fx' && signalLoop !== null) return signalLoop
  return STYLE_LOOPS[kind].frames
}

/**
 * Why an animation of `held` frames at width × height won't fit: one frame
 * is too big, or all of them together are. Null when it fits.
 */
export function animationLimit(width: number, height: number, held: number): 'frame' | 'frames' | null {
  const px = width * height
  if (px > MAX_ANIMATION_PIXELS || px > MAX_EXPORT_PIXELS) return 'frame'
  return px * held > MAX_ANIMATION_BUDGET ? 'frames' : null
}

/**
 * The biggest of `multipliers`, no bigger than `chosen`, at which an
 * animation of `held` frames fits (see animationLimit); `size` gives the
 * export size at a multiplier. Null when not even the smallest fits.
 */
export function animationMultiplier(
  size: (m: number) => readonly [number, number],
  chosen: number,
  held: number,
  multipliers: readonly number[]
): number | null {
  let best: number | null = null
  for (const m of multipliers) {
    if (m > chosen) continue
    const [w, h] = size(m)
    if (animationLimit(w, h, held) === null && (best === null || m > best)) best = m
  }
  return best
}

/** Frames, speed and engine step of a loop with the signal on (Screen FX style). */
export function signalLoopTiming(loop: { frames: number; fps: number } | undefined): { frames: number; fps: number; step: number } {
  const frames = loop?.frames ?? 16
  const fps = loop?.fps ?? 15
  return { frames, fps, step: engineStep(fps) }
}

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

/** Which pixels of an RGBA image show (from half covered) at a target size, nearest-neighbour. */
function resampleAlpha(src: Uint8Array | Uint8ClampedArray, srcW: number, srcH: number, dstW: number, dstH: number): Uint8Array {
  const out = new Uint8Array(dstW * dstH)
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH))
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW))
      out[y * dstW + x] = src[(sy * srcW + sx) * 4 + 3] >= 128 ? 255 : 0
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

  const format = options.format
  const isApng = format === 'apng'
  const seeThrough = !!options.seeThrough
  const signal = options.signal
  // With the signal, the screen effect follows the PNG export's rule (from 3× up).
  const signalFx = options.fx && options.fx.screen !== 'off' && m >= FX_MIN_MULTIPLIER ? options.fx : null

  // --- STYLE 1 WITH THE SIGNAL: real moving noise, any loop length that fits ---
  if (options.style === 'screen-fx' && signal) {
    const { frames: frameCount, fps, step } = signalLoopTiming(options.loop)
    if (width * height * frameCount > MAX_ANIMATION_BUDGET) {
      throw new Error(`${frameCount} frames at that size is too much to hold at once. Pick fewer frames or a smaller size.`)
    }
    const delayMs = Math.round(1000 / fps)
    const frames: Frame[] = []
    for (let f = 0; f < frameCount; f++) {
      frames.push(signalFrame(signal(r, f * step), width, height, signalFx, f / frameCount, r.paper))
      progress(f + 1, frameCount)
    }
    return encodeFrames(frames, format, width, height, delayMs, seeThrough)
  }

  // --- STYLE 1: SCREEN FX LOOP ---
  if (options.style === 'screen-fx') {
    const frameCount = options.frameCount ?? STYLE_LOOPS['screen-fx'].frames
    const fps = options.fps ?? STYLE_LOOPS['screen-fx'].fps
    const delayMs = Math.round(1000 / fps)

    const activeFx: Fx =
      options.fx && options.fx.screen !== 'off'
        ? options.fx
        : { ...DEFAULT_FX, screen: 'crt' }

    const frames: Frame[] = []
    for (let f = 0; f < frameCount; f++) {
      frames.push(fxFrame(r, width, height, activeFx, f / frameCount))
      progress(f + 1, frameCount)
    }
    return encodeFrames(frames, format, width, height, delayMs, seeThrough)
  }

  // --- STYLE 2: BEFORE & AFTER A/B COMPARE WIPE ---
  if (options.style === 'compare-wipe') {
    const frameCount = options.frameCount ?? STYLE_LOOPS['compare-wipe'].frames
    const fps = options.fps ?? STYLE_LOOPS['compare-wipe'].fps
    const delayMs = Math.round(1000 / fps)

    // Render Deres at full size (with the signal: a new frame of it each time)
    const step = engineStep(fps)
    const deresAt = signal
      ? (f: number) => signalFrame(signal(r, f * step), width, height, signalFx, 0, r.paper)
      : null
    let deres: Frame
    if (deresAt) {
      deres = deresAt(0)
    } else if (options.fx && options.fx.screen !== 'off' && m >= FX_MIN_MULTIPLIER) {
      deres = fxFrame(r, width, height, options.fx, 0)
    } else {
      deres = enlarged(r, width, height)
    }

    // Render Original at full size (its see-through parts the same way:
    // a pixel shows from half covered).
    let orig: Frame
    if (options.sourceRgba && options.sourceWidth && options.sourceHeight) {
      orig = {
        rgb: resampleRgbaToRgb(options.sourceRgba, options.sourceWidth, options.sourceHeight, width, height),
        alpha: seeThrough ? resampleAlpha(options.sourceRgba, options.sourceWidth, options.sourceHeight, width, height) : null
      }
    } else {
      // Fallback: slightly desaturated/original approximation
      orig = { rgb: new Uint8Array(deres.rgb), alpha: deres.alpha }
    }

    const frames: Frame[] = []

    for (let f = 0; f < frameCount; f++) {
      if (deresAt && f > 0) deres = deresAt(f)
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
      const frameAlpha = seeThrough ? new Uint8Array(width * height) : null
      for (let y = 0; y < height; y++) {
        const rowOffset = y * width * 3
        for (let x = 0; x < width; x++) {
          const idx = rowOffset + x * 3
          const p = y * width + x
          if (splitX > 0 && splitX < width && (x === splitX - 1 || x === splitX)) {
            // Crisp divider line
            frameData[idx] = 255
            frameData[idx + 1] = 255
            frameData[idx + 2] = 255
            if (frameAlpha) frameAlpha[p] = 255
          } else {
            const side = x < splitX ? deres : orig
            frameData[idx] = side.rgb[idx]
            frameData[idx + 1] = side.rgb[idx + 1]
            frameData[idx + 2] = side.rgb[idx + 2]
            if (frameAlpha) frameAlpha[p] = side.alpha ? side.alpha[p] : 255
          }
        }
      }
      frames.push({ rgb: frameData, alpha: frameAlpha })
      progress(f + 1, frameCount)
    }

    return encodeFrames(frames, format, width, height, delayMs, seeThrough)
  }

  // --- STYLE 3: DITHER SHIMMER / PHASE CYCLE ---
  const frameCount = options.frameCount ?? STYLE_LOOPS['dither-shimmer'].frames
  const fps = options.fps ?? STYLE_LOOPS['dither-shimmer'].fps
  const delayMs = Math.round(1000 / fps)

  const ditherPhases: [number, number][] = [
    [0, 0], [2, 1], [1, 3], [3, 2],
    [2, 2], [0, 3], [3, 1], [1, 0]
  ]
  const renderAt = (f: number): Rendered =>
    renderDeres ? renderDeres({ ...settings, ditherOffset: ditherPhases[f % ditherPhases.length] }) : r

  const hasFx = !!(options.fx && options.fx.screen !== 'off' && m >= FX_MIN_MULTIPLIER)

  if (signal) {
    const step = engineStep(fps)
    const frames: Frame[] = []
    for (let f = 0; f < frameCount; f++) {
      const frameRender = renderAt(f)
      frames.push(signalFrame(signal(frameRender, f * step), width, height, signalFx, f / frameCount, frameRender.paper))
      progress(f + 1, frameCount)
    }
    return encodeFrames(frames, format, width, height, delayMs, seeThrough)
  }

  if (hasFx) {
    const frames: Frame[] = []
    for (let f = 0; f < frameCount; f++) {
      frames.push(fxFrame(renderAt(f), width, height, options.fx!, f / frameCount))
      progress(f + 1, frameCount)
    }
    return encodeFrames(frames, format, width, height, delayMs, seeThrough)
  }

  // Pure indexed dither shimmer (no screen effects). Kept see-through pixels
  // take one more palette entry; an APNG with a full palette goes RGBA instead.
  const colours = r.palette.length / 3
  const isIndexedPossible = colours <= 256 && colours > 0 && !(seeThrough && isApng && colours === 256)

  if (isIndexedPossible) {
    const indexedFrames: { indices: Uint8Array; alpha: Uint8Array | null }[] = []
    for (let f = 0; f < frameCount; f++) {
      const frameRender = renderAt(f)
      indexedFrames.push({
        indices: upscaleIndices(frameRender.indices, frameRender.width, frameRender.height, width, height),
        alpha: seeThrough && frameRender.alpha ? upscaleIndices(frameRender.alpha, frameRender.width, frameRender.height, width, height) : null
      })
      progress(f + 1, frameCount)
    }

    if (isApng) {
      const apngFrames: ApngFrame[] = indexedFrames.map(({ indices, alpha }) => {
        if (alpha) for (let i = 0; i < indices.length; i++) if (!alpha[i]) indices[i] = colours
        return { width, height, delayMs, indices }
      })
      const palette = seeThrough ? Uint8Array.from([...r.palette, 0, 0, 0]) : r.palette
      const data = await encodeApng(apngFrames, { palette, numPlays: 0, transparentIndex: seeThrough ? colours : undefined })
      return { data, format: 'apng', mimeType: 'image/png', width, height, frameCount }
    } else {
      const gifFrames: GifFrame[] = indexedFrames.map(({ indices, alpha }) => {
        if (!seeThrough) return { width, height, delayMs, indices }
        const t = withTransparentEntry(r.palette, indices, alpha ?? new Uint8Array(indices.length).fill(255))
        return { width, height, delayMs, indices: t.indices, palette: t.palette, transparentIndex: t.transparentIndex }
      })
      const data = encodeGif(gifFrames, { palette: gifFrames[0].palette ?? r.palette, loop: 0 })
      return { data, format: 'gif', mimeType: 'image/gif', width, height, frameCount }
    }
  }

  // Truecolour fallback for dither shimmer without FX
  const frames: Frame[] = []
  for (let f = 0; f < frameCount; f++) {
    frames.push(enlarged(renderAt(f), width, height))
    progress(f + 1, frameCount)
  }
  return encodeFrames(frames, format, width, height, delayMs, seeThrough)
}

export interface FramesExportOptions {
  format: 'apng' | 'gif'
  multiplier: number
  tv: boolean
  fx: Fx | null
  /** How long each frame shows, in milliseconds: one entry per frame. */
  delaysMs: readonly number[]
  /** The GIF's own loop count: 0 = forever, null = it plays once. */
  loopCount: number | null
  /** Frame k through the machine. */
  render: (k: number) => Rendered
  /** Frame k through the analog signal, when it's on. */
  signal?: (r: Rendered, k: number) => SignalImage
  /**
   * Whether the frames can go out as palette indices (no signal or screen
   * effect, and a machine whose pixels are its palette's colours), and
   * whether every frame shares one palette (needed for an indexed APNG).
   */
  indexed: boolean
  sharedPalette: boolean
  /** Frames done so far, of how many; `note` names a pass that only reads the frames. */
  onProgress?: (done: number, total: number, note?: string) => void
  /**
   * Pixels a full-colour GIF may hold at once (MAX_ANIMATION_BUDGET); past
   * it, the frames are made twice instead. A test can set it low.
   */
  budget?: number
  /** Keep the frames' see-through pixels (the background 'transparent'). */
  seeThrough?: boolean
}

/** APNG plays a loop count's worth of times plus the first; a GIF without one plays once. */
export function apngPlays(loopCount: number | null): number {
  return loopCount === null ? 1 : loopCount === 0 ? 0 : loopCount + 1
}

/**
 * An animated GIF's own frames, each through the current settings, as a GIF
 * or APNG with the GIF's delays and loop count. Frames go into the encoder
 * as they're made, so any number of them fit. A full-colour GIF needs every
 * frame for its shared palette: it holds them while they fit the budget,
 * and past it makes them twice (once for their colours, once to write).
 */
export async function generateFramesExport(o: FramesExportOptions): Promise<AnimatedExportResult> {
  const total = o.delaysMs.length
  if (total === 0) throw new Error('There are no frames to export.')
  const m = Math.max(1, Math.floor(o.multiplier))
  const first = o.render(0)
  const [width, height] = exportSize(first.width, first.height, first.geometry.par, m, o.tv)
  if (width * height > MAX_EXPORT_PIXELS || width * height > MAX_ANIMATION_PIXELS) {
    throw new Error('That size is too big for an animation. Pick a smaller size.')
  }
  const fx = o.fx && o.fx.screen !== 'off' && m >= FX_MIN_MULTIPLIER ? o.fx : null
  const indexed = o.indexed && !o.signal && !fx
  const seeThrough = !!o.seeThrough
  const progress = (done: number) => o.onProgress?.(done, total)
  const mimeType = o.format === 'apng' ? 'image/png' : 'image/gif'

  /** Frame k at the export size, full colour. */
  const rgbFrame = (r: Rendered, k: number): Frame => {
    const phase = k / total
    if (o.signal) return signalFrame(o.signal(r, k), width, height, fx, phase, r.paper)
    if (fx) return fxFrame(r, width, height, fx, phase)
    return enlarged(r, width, height)
  }
  const frameAt = (k: number) => (k === 0 ? first : o.render(k))
  /** Which of frame r's pixels show at the export size (null: all of them). */
  const alphaOf = (r: Rendered) => (seeThrough && r.alpha ? upscaleIndices(r.alpha, r.width, r.height, width, height) : null)

  if (o.format === 'apng') {
    // Kept see-through pixels in a shared palette take one more entry; a
    // full palette has no room, so those frames go RGBA instead.
    const colours = first.palette.length / 3
    const shared = indexed && o.sharedPalette && !(seeThrough && colours >= 256)
    const palette = shared && seeThrough ? Uint8Array.from([...first.palette, 0, 0, 0]) : first.palette
    const writer = new ApngWriter(width, height, {
      numPlays: apngPlays(o.loopCount),
      palette: shared ? palette : undefined,
      transparentIndex: shared && seeThrough ? colours : undefined
    })
    for (let k = 0; k < total; k++) {
      const r = frameAt(k)
      const delayMs = o.delaysMs[k]
      if (shared) {
        const indices = upscaleIndices(r.indices, r.width, r.height, width, height)
        const alpha = alphaOf(r)
        if (alpha) for (let i = 0; i < indices.length; i++) if (!alpha[i]) indices[i] = colours
        await writer.add({ width, height, delayMs, indices })
      } else await writer.add(apngFrame(rgbFrame(r, k), width, height, delayMs, seeThrough))
      progress(k + 1)
    }
    return { data: writer.finish(), format: 'apng', mimeType, width, height, frameCount: total }
  }

  if (indexed) {
    // Each frame with its own palette: a machine that picks colours from the
    // picture can pick different ones per frame (the GIF gives those frames
    // their own colour table).
    const writer = new GifWriter(width, height, { loop: o.loopCount })
    for (let k = 0; k < total; k++) {
      const r = frameAt(k)
      const indices = upscaleIndices(r.indices, r.width, r.height, width, height)
      if (seeThrough) {
        const t = withTransparentEntry(r.palette, indices, alphaOf(r) ?? new Uint8Array(indices.length).fill(255))
        writer.add({ width, height, delayMs: o.delaysMs[k], indices: t.indices, palette: t.palette, transparentIndex: t.transparentIndex })
      } else writer.add({ width, height, delayMs: o.delaysMs[k], indices, palette: r.palette })
      progress(k + 1)
    }
    return { data: writer.finish(), format: 'gif', mimeType, width, height, frameCount: total }
  }

  // Full colour: one palette for every frame (so still parts don't shimmer),
  // which needs every frame first. While they fit the budget they're held,
  // and each is let go once it's written. Kept see-through pixels get an
  // entry of their own after up to 255 colours.
  if (width * height * total > (o.budget ?? MAX_ANIMATION_BUDGET)) return streamRgbGif()
  const frames: (Frame | null)[] = []
  for (let k = 0; k < total; k++) {
    frames.push(rgbFrame(frameAt(k), k))
    progress(k + 1)
  }
  const held = frames as Frame[]
  const palette = rgbFramesPalette(
    held.map((f) => f.rgb),
    width * height,
    seeThrough ? held.map((f) => f.alpha) : undefined
  )
  return writeShared(palette, (k) => {
    const f = frames[k]!
    frames[k] = null
    return f
  })

  /**
   * Full colour past the budget: every frame is made twice. The first time
   * only its colours are sampled (the same samples the held frames give),
   * and it's let go; the second time it goes into the file with the shared
   * palette. One frame is held at a time.
   */
  function streamRgbGif(): AnimatedExportResult {
    const samples = new PaletteSamples(total * width * height)
    for (let k = 0; k < total; k++) {
      const f = rgbFrame(frameAt(k), k)
      samples.add(f.rgb, width * height, seeThrough ? f.alpha : null)
      o.onProgress?.(k + 1, total, 'reading the colours')
    }
    return writeShared(samples.palette(seeThrough ? 255 : 256), (k) => {
      const f = rgbFrame(frameAt(k), k)
      progress(k + 1)
      return f
    })
  }

  /** Every frame mapped to one palette (and its see-through entry, when kept). */
  function writeShared(colours: Uint8Array, frame: (k: number) => Frame): AnimatedExportResult {
    const t = seeThrough ? transparentAfter(colours) : null
    const nearest = new NearestColour(colours)
    const writer = new GifWriter(width, height, { loop: o.loopCount, palette: t?.palette ?? colours })
    for (let k = 0; k < total; k++) {
      const f = frame(k)
      const indices = nearest.map(f.rgb)
      if (t && f.alpha) for (let i = 0; i < indices.length; i++) if (!f.alpha[i]) indices[i] = t.index
      writer.add({ width, height, delayMs: o.delaysMs[k], indices, transparentIndex: t?.index })
    }
    return { data: writer.finish(), format: 'gif', mimeType, width, height, frameCount: total }
  }
}
