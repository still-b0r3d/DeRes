import { NEUTRAL } from '../core/adjust'
import { DITHERS, type DitherId } from '../core/dither'
import { DEFAULT_FX, type Fx } from '../core/fx'
import type { DeresSettings } from '../core/pipeline'
import { DEFAULT_PROFILE, profileById } from '../core/profiles'

// Everything the controls set, remembered in localStorage between visits.
// Never the picture. Storage can be missing or full (private windows, some
// embedded browsers), so every read and write is allowed to fail quietly.

import { decodeSettings } from '../core/share'
import type { AnimationStyle } from '../core/animate'
import { checkSignal, DEFAULT_SIGNAL, LOOP_FPS, LOOP_FRAMES, type LoopFps, type LoopFrames, type SignalSettings } from '../core/signal'

export interface Settings extends DeresSettings {
  multiplier: number
  exportFx: boolean
  animationStyle: AnimationStyle
  signal: SignalSettings
  /** Frames in a signal loop (the Screen FX animation with the signal on). */
  loopFrames: LoopFrames
  loopFps: LoopFps
}

export const SETTINGS_KEY = 'b0r3d-deres:settings'
const KEY = SETTINGS_KEY

export function defaultSettings(): Settings {
  const p = profileById(DEFAULT_PROFILE)!
  return {
    profileId: p.id,
    fit: 'fill',
    resolution: 'native',
    block: 8,
    background: 'white',
    adjust: { ...NEUTRAL },
    dither: p.dither,
    fx: { ...DEFAULT_FX },
    pixelShape: 'raw',
    multiplier: 4,
    exportFx: false,
    animationStyle: 'screen-fx',
    signal: { ...DEFAULT_SIGNAL },
    loopFrames: 16,
    loopFps: 15,
    // The colours slider: unset means the machine's own count.
    customCount: undefined,
    customPalette: undefined
  }
}

/** The export sizes offered (× the machine's resolution). */
export const MULTIPLIERS = [1, 2, 3, 4, 6, 8, 12, 16] as const

const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
const oneOf = <T extends string | number>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback
const HEX = /^#[0-9a-f]{6}$/i

/**
 * Settings checked field by field: anything missing or odd keeps base's
 * value. Saved settings and share links both come through here, so a link
 * from a newer version (an unknown machine, say) can never break the page.
 */
export function checkSettings(loaded: Record<string, unknown>, base: Settings): Settings {
  const a = (loaded.adjust && typeof loaded.adjust === 'object' ? loaded.adjust : {}) as Record<string, unknown>
  const f = (loaded.fx && typeof loaded.fx === 'object' ? loaded.fx : {}) as Record<string, unknown>
  const fx: Fx = {
    screen: oneOf(
      f.screen,
      ['off', 'crt', 'lcd', 'vhs', 'composite', 'p1-green', 'p3-amber', 'p4-white'] as const,
      base.fx.screen
    ),
    mask: oneOf(f.mask, ['none', 'shadow', 'grille'] as const, base.fx.mask),
    scanlines: num(f.scanlines, 0, 1, base.fx.scanlines),
    curve: num(f.curve, 0, 1, base.fx.curve),
    bloom: num(f.bloom, 0, 1, base.fx.bloom),
    grid: num(f.grid, 0, 1, base.fx.grid),
    ghost: num(f.ghost, 0, 1, base.fx.ghost),
    vhsTracking: num(f.vhsTracking, 0, 1, base.fx.vhsTracking ?? 0.8),
    vhsOsd: typeof f.vhsOsd === 'boolean' ? f.vhsOsd : base.fx.vhsOsd !== false
  }
  const profileId = typeof loaded.profileId === 'string' && profileById(loaded.profileId) ? loaded.profileId : base.profileId
  const ditherFallback = profileId === base.profileId ? base.dither : profileById(profileId)!.dither
  // Palette indices are 8-bit: never more than 256 colours.
  let customPalette = base.customPalette
  if (Array.isArray(loaded.customPalette)) {
    const colours = loaded.customPalette.filter((c): c is string => typeof c === 'string' && HEX.test(c)).slice(0, 256)
    customPalette = colours.length > 0 ? colours : undefined
  }

  return {
    profileId,
    fit: oneOf(loaded.fit, ['fill', 'fit', 'stretch'] as const, base.fit),
    resolution: oneOf(loaded.resolution, ['native', 'custom'] as const, base.resolution),
    block: Math.round(num(loaded.block, 2, 32, base.block)),
    background: oneOf(loaded.background, ['white', 'black', 'transparent'] as const, base.background),
    adjust: {
      brightness: num(a.brightness, -0.5, 0.5, base.adjust.brightness),
      contrast: num(a.contrast, 0, 2, base.adjust.contrast),
      saturation: num(a.saturation, 0, 2, base.adjust.saturation),
      gamma: num(a.gamma, 0.4, 2.5, base.adjust.gamma)
    },
    dither: oneOf(loaded.dither, DITHERS.map((x) => x.id) as DitherId[], ditherFallback),
    fx,
    pixelShape: oneOf(loaded.pixelShape, ['raw', 'tv'] as const, base.pixelShape),
    multiplier: oneOf(loaded.multiplier, MULTIPLIERS, base.multiplier as (typeof MULTIPLIERS)[number]),
    exportFx: typeof loaded.exportFx === 'boolean' ? loaded.exportFx : base.exportFx,
    animationStyle: oneOf(
      loaded.animationStyle,
      ['screen-fx', 'compare-wipe', 'dither-shimmer'] as const,
      base.animationStyle
    ),
    signal: checkSignal(loaded.signal, base.signal),
    loopFrames: oneOf(loaded.loopFrames, LOOP_FRAMES, base.loopFrames),
    loopFps: oneOf(loaded.loopFps, LOOP_FPS, base.loopFps),
    customCount:
      typeof loaded.customCount === 'number' && Number.isFinite(loaded.customCount)
        ? Math.round(num(loaded.customCount, 2, 256, 16))
        : base.customCount,
    customPalette
  }
}

/** The settings in a share link, on top of base; null if the link can't be read. */
export function settingsFromHash(hash: string, base: Settings): Settings | null {
  const raw = decodeSettings(hash)
  return raw ? checkSettings(raw, base) : null
}

/** Settings from storage, checked field by field (anything odd falls back). */
export function loadSettings(): Settings {
  let raw: unknown = null
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || 'null')
  } catch {
    raw = null
  }
  const stored = checkSettings(raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}, defaultSettings())
  // The colours slider resets whenever a machine is picked, so a saved value
  // is only kept for the Custom machine. (Before v0.8.3 every visitor had 16
  // saved, which capped every range machine at 16.)
  if (stored.profileId !== 'custom') stored.customCount = undefined

  // If a share link with hash settings was opened, it takes precedence
  if (typeof window !== 'undefined' && window.location.hash) {
    return settingsFromHash(window.location.hash, stored) ?? stored
  }
  return stored
}

let timer: ReturnType<typeof setTimeout> | undefined
/** Settings waiting to be written. */
let pending: Settings | null = null

function writePending(): void {
  clearTimeout(timer)
  if (!pending) return
  try {
    localStorage.setItem(KEY, JSON.stringify(pending))
  } catch {
    // Storage unavailable: settings just won't be remembered.
  }
  pending = null
}

// Leaving or reloading the page right after a change still keeps it.
if (typeof window !== 'undefined') window.addEventListener('pagehide', writePending)

/** Saves a moment later, so a slider drag writes once (or straight away, when `now`). */
export function saveSettings(s: Settings, now = false): void {
  pending = s
  clearTimeout(timer)
  if (now) writePending()
  else timer = setTimeout(writePending, 300)
}
