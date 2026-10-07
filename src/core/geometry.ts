import type { Profile } from './profiles'
import type { Rect } from './resample'

// Where the photo goes in the output: which part of it is used (src, in
// working-copy pixels) and where it lands (dst, in output pixels).
//
// Native resolution is the main control. "Custom" keeps the old block-size
// idea: one output pixel per block of the original photo, square pixels, the
// photo's own shape.

export type Fit = 'fill' | 'fit' | 'stretch'

export interface Geometry {
  width: number
  height: number
  src: Rect
  dst: Rect
  /** Pixel width : height. */
  par: readonly [number, number]
}

export interface GeometryInput {
  /** Working copy size. */
  srcW: number
  srcH: number
  /** The photo's real size (the working copy may be smaller). */
  origW: number
  origH: number
  profile: Profile
  resolution: 'native' | 'custom'
  block: number
  fit: Fit
}

/** Largest output side for custom block sizes. */
export const CUSTOM_MAX = 1024
/** Tallest strip the receipt printer makes. */
export const AUTO_MAX = 4096

export function planGeometry(o: GeometryInput): Geometry {
  const whole: Rect = { x: 0, y: 0, w: o.srcW, h: o.srcH }

  if (o.resolution === 'custom') {
    const block = Math.max(1, o.block)
    let w = Math.max(1, Math.round(o.origW / block))
    let h = Math.max(1, Math.round(o.origH / block))
    const cap = Math.min(CUSTOM_MAX, Math.max(o.srcW, o.srcH))
    const s = Math.min(1, cap / Math.max(w, h))
    w = Math.max(1, Math.round(w * s))
    h = Math.max(1, Math.round(h * s))
    return { width: w, height: h, src: whole, dst: { x: 0, y: 0, w, h }, par: [1, 1] }
  }

  const p = o.profile
  const par = p.par
  const ratio = par[0] / par[1]
  const width = p.width
  if (p.height === 'auto') {
    const height = Math.min(AUTO_MAX, Math.max(1, Math.round((width * o.srcH) / o.srcW / ratio)))
    return { width, height, src: whole, dst: { x: 0, y: 0, w: width, h: height }, par }
  }
  const height = p.height
  const full: Rect = { x: 0, y: 0, w: width, h: height }
  // Shapes as seen on the machine's screen.
  const screenAspect = (width * ratio) / height
  const photoAspect = o.srcW / o.srcH

  // Same shape (within rounding): nothing to crop or pad.
  if (o.fit === 'stretch' || Math.abs(photoAspect / screenAspect - 1) < 1e-9) {
    return { width, height, src: whole, dst: full, par }
  }

  if (o.fit === 'fill') {
    // Crop the middle of the photo to the screen's shape.
    if (photoAspect > screenAspect) {
      const w = o.srcH * screenAspect
      return { width, height, src: { x: (o.srcW - w) / 2, y: 0, w, h: o.srcH }, dst: full, par }
    }
    const h = o.srcW / screenAspect
    return { width, height, src: { x: 0, y: (o.srcH - h) / 2, w: o.srcW, h }, dst: full, par }
  }

  // Fit: the whole photo, with bars.
  if (photoAspect > screenAspect) {
    const h = Math.max(1, Math.min(height, Math.round((width * ratio) / photoAspect)))
    return { width, height, src: whole, dst: { x: 0, y: Math.floor((height - h) / 2), w: width, h }, par }
  }
  const w = Math.max(1, Math.min(width, Math.round((height * photoAspect) / ratio)))
  return { width, height, src: whole, dst: { x: Math.floor((width - w) / 2), y: 0, w, h: height }, par }
}
