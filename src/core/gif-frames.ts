import { MAX_ANIMATION_BUDGET } from './animate'
import { GifError, GifReader, type GifLimits } from './gif-decode'
import { gifFrameCount } from './gif-info'
import { shrinkRgba } from './resample'

// Opening an animated GIF: every frame decoded, shrunk as it arrives so the
// whole animation fits the same budget as an exported one (a phone has to
// hold it), and kept one copy each. Frame 0 is "the picture" every control
// works on.

/** Frames are never shrunk below this long edge to make room; frames are cut instead. */
export const MIN_ANIMATION_EDGE = 256

export interface AnimatedGif {
  /** Size of every frame, after shrinking. */
  width: number
  height: number
  /** The GIF's own size. */
  origW: number
  origH: number
  /** r, g, b, a per pixel, one buffer per frame. */
  frames: Uint8ClampedArray[]
  delaysMs: number[]
  /** NETSCAPE2.0 loop count (0 = forever); null when the file has none (plays once). */
  loopCount: number | null
  /** Frames in the file; more than frames.length when some were cut. */
  total: number
  hasAlpha: boolean
}

/**
 * The size to hold an animation at, and how many of its frames fit: as big as
 * maxEdge allows while every frame fits the budget, shrinking to no less than
 * MIN_ANIMATION_EDGE on the long side (or the GIF's own size, if smaller);
 * past that, only the first `keep` frames.
 */
export function animationPlan(
  origW: number,
  origH: number,
  total: number,
  maxEdge: number,
  budget = MAX_ANIMATION_BUDGET
): { width: number; height: number; keep: number } {
  const long = Math.max(origW, origH)
  const most = Math.min(1, maxEdge / long)
  const least = Math.min(most, MIN_ANIMATION_EDGE / long)
  const fit = Math.sqrt(budget / (origW * origH * Math.max(1, total)))
  const s = Math.max(least, Math.min(most, fit))
  let width = Math.max(1, Math.round(origW * s))
  let height = Math.max(1, Math.round(origH * s))
  // Rounding up can tip a frame count that just fits over the budget.
  if (s === fit && width * height * total > budget) {
    width = Math.max(1, Math.floor(origW * s))
    height = Math.max(1, Math.floor(origH * s))
  }
  const keep = Math.max(1, Math.min(total, Math.floor(budget / (width * height))))
  return { width, height, keep }
}

/**
 * An animated GIF's frames, or null when it isn't one, can't be read, or has
 * fewer than two frames that decode (it then opens as a still, through the
 * browser).
 */
export function openAnimatedGif(
  bytes: Uint8Array,
  maxEdge: number,
  options: { budget?: number; limits?: Partial<GifLimits> } = {}
): AnimatedGif | null {
  const total = gifFrameCount(bytes)
  if (total < 2) return null
  let reader: GifReader
  try {
    reader = new GifReader(bytes, options.limits)
  } catch (err) {
    if (err instanceof GifError) return null
    throw err
  }
  const origW = reader.width
  const origH = reader.height
  const { width, height, keep } = animationPlan(origW, origH, total, maxEdge, options.budget)
  const frames: Uint8ClampedArray[] = []
  const delaysMs: number[] = []
  let hasAlpha = false
  for (const f of reader.frames()) {
    const frame = shrinkRgba(f.rgba, origW, origH, width, height)
    if (!hasAlpha) {
      for (let i = 3; i < frame.length; i += 4) {
        if (frame[i] < 255) {
          hasAlpha = true
          break
        }
      }
    }
    frames.push(frame)
    delaysMs.push(f.delayMs)
    if (frames.length >= keep) break
  }
  if (frames.length < 2) return null
  return { width, height, origW, origH, frames, delaysMs, loopCount: reader.loopCount, total: Math.max(total, frames.length), hasAlpha }
}
