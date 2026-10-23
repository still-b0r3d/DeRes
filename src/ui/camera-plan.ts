import { animationPlan } from '../core/gif-frames'
import { planGeometry, type GeometryInput } from '../core/geometry'
import { WORKING_MAX } from './loader'

// The live camera's sums and words, kept apart from the camera itself so they
// can be tested without one: how big a frame to grab, how far to enlarge the
// screen effect while live, what to say when the camera can't be had, and
// what the camera's pictures and clips are called.

/** The machine's choices that decide the picture's size and framing. */
export type LiveGeometryChoice = Pick<GeometryInput, 'profile' | 'resolution' | 'customWidth' | 'fit'>

/** Photo pixels grabbed per machine pixel: enough for the area average and Detail to have something to work on. */
export const LIVE_DETAIL = 3
/** Longest side grabbed from the camera for the live view (custom widths past LIVE_WIDE_FROM get LIVE_MAX_WIDE). */
export const LIVE_MAX = 960
export const LIVE_MAX_WIDE = 1280
export const LIVE_WIDE_FROM = 320
/** Most pixels the screen effect is drawn at while live (a whole frame, every frame). */
export const LIVE_FX_PIXELS = 600_000
/** Below this many frames a second for SLOW_AFTER_MS, the live view says the look is slow. */
export const SLOW_FPS = 8
export const SLOW_AFTER_MS = 2000
/** A clip: 3 seconds at 10 frames a second (GIF delays are hundredths, so 100 ms is exact). */
export const CLIP_FRAMES = 30
export const CLIP_DELAY_MS = 100

/**
 * The size to grab a camera frame at for the live view: the part the machine
 * shows is about LIVE_DETAIL photo pixels across for every machine pixel,
 * never more than the camera gives, and no side past LIVE_MAX (LIVE_MAX_WIDE
 * for wide custom sizes).
 */
export function liveInputSize(videoW: number, videoH: number, o: LiveGeometryChoice): { width: number; height: number } {
  const g = planGeometry({ srcW: videoW, srcH: videoH, origW: videoW, origH: videoH, ...o })
  const want = LIVE_DETAIL * Math.max(g.dst.w / g.src.w, g.dst.h / g.src.h)
  const wide = o.resolution === 'custom' && (o.customWidth ?? o.profile.width) > LIVE_WIDE_FROM
  const s = Math.min(1, want, (wide ? LIVE_MAX_WIDE : LIVE_MAX) / Math.max(videoW, videoH))
  return { width: Math.max(1, Math.round(videoW * s)), height: Math.max(1, Math.round(videoH * s)) }
}

/**
 * The screen effect's enlargement while live: the preview's own (`base`),
 * stepped down until a frame is at most LIVE_FX_PIXELS, never below 2× (a
 * CRT at 2× still shows its mask). 0 stays 0 (no effect).
 */
export function liveFxScale(base: number, width: number, height: number, par: readonly [number, number], tv: boolean): number {
  if (base <= 0) return 0
  const ratio = tv ? par[0] / par[1] : 1
  let s = base
  while (s > 2 && width * s * ratio * height * s > LIVE_FX_PIXELS) s--
  return s
}

/** The clip's frame size: as an animated GIF of 30 frames from this camera would be held. */
export function clipSize(videoW: number, videoH: number): { width: number; height: number } {
  const { width, height } = animationPlan(videoW, videoH, CLIP_FRAMES, WORKING_MAX)
  return { width, height }
}

/**
 * What to say when the camera can't be had. `framed`: DeRes is inside
 * another page (b0r3d 95's Navigator), which hasn't passed the camera on, so
 * the way out is DeRes in its own tab (`ownTab`).
 */
export function cameraProblem(err: unknown, framed: boolean): { text: string; ownTab: boolean } {
  const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return framed
      ? { text: 'The camera only works with DeRes open in its own tab.', ownTab: true }
      : { text: 'The camera wasn’t allowed. To use it, allow the camera for this site in your browser’s settings, then try again.', ownTab: false }
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return { text: 'No camera found.', ownTab: false }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return { text: 'The camera is busy in another app or tab. Close it and try again.', ownTab: false }
  }
  return { text: 'The camera didn’t start. Try again, or choose a photo instead.', ownTab: false }
}

const two = (n: number) => String(n).padStart(2, '0')

/** A camera picture's or clip's name, from the local time: "camera-2026-10-22-2140-05". */
export function cameraName(kind: 'camera' | 'camera-clip', d: Date): string {
  return `${kind}-${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}-${two(d.getSeconds())}`
}

export type Facing = 'user' | 'environment'

/** The camera last used, and whether each one's picture is mirrored. */
export interface CameraPrefs {
  facing: Facing
  mirror: Record<Facing, boolean>
}

export const CAMERA_PREFS_KEY = 'b0r3d-deres:camera'

/** The back camera first (point the phone at something); selfies mirrored, like a phone's own camera. */
export const DEFAULT_CAMERA_PREFS: CameraPrefs = { facing: 'environment', mirror: { user: true, environment: false } }

/** Saved camera choices, checked field by field (anything odd falls back). */
export function checkCameraPrefs(raw: unknown): CameraPrefs {
  const l = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const m = (l.mirror && typeof l.mirror === 'object' ? l.mirror : {}) as Record<string, unknown>
  const d = DEFAULT_CAMERA_PREFS
  return {
    facing: l.facing === 'user' || l.facing === 'environment' ? l.facing : d.facing,
    mirror: {
      user: typeof m.user === 'boolean' ? m.user : d.mirror.user,
      environment: typeof m.environment === 'boolean' ? m.environment : d.mirror.environment
    }
  }
}

export function loadCameraPrefs(): CameraPrefs {
  try {
    return checkCameraPrefs(JSON.parse(localStorage.getItem(CAMERA_PREFS_KEY) || 'null'))
  } catch {
    return checkCameraPrefs(null)
  }
}

export function saveCameraPrefs(p: CameraPrefs): void {
  try {
    localStorage.setItem(CAMERA_PREFS_KEY, JSON.stringify(p))
  } catch {
    // Storage can be missing or full: the choice just isn't kept.
  }
}

export function forgetCameraPrefs(): void {
  try {
    localStorage.removeItem(CAMERA_PREFS_KEY)
  } catch {
    // Nothing to forget.
  }
}

/** Frames shown per second over the last second, and whether the look has been slow for a while. */
export class FpsMeter {
  private shown: number[] = []
  private fastAt = 0

  /** A new start (the camera came on, or the look changed): no history. */
  reset(now: number): void {
    this.shown = []
    this.fastAt = now
  }

  /** A frame was shown at `now` (ms). */
  frame(now: number): void {
    this.shown.push(now)
    while (this.shown.length > 0 && this.shown[0] <= now - 1000) this.shown.shift()
    if (this.fps(now) >= SLOW_FPS) this.fastAt = now
  }

  fps(now: number): number {
    return this.shown.filter((t) => t > now - 1000).length
  }

  /** Under SLOW_FPS for the last SLOW_AFTER_MS. */
  slow(now: number): boolean {
    return now - this.fastAt >= SLOW_AFTER_MS
  }
}
