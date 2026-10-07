import { NEUTRAL } from '../core/adjust'
import { DITHERS, type DitherId } from '../core/dither'
import { DEFAULT_FX, type Fx } from '../core/fx'
import type { DeresSettings } from '../core/pipeline'
import { DEFAULT_PROFILE, profileById } from '../core/profiles'

// Everything the controls set, remembered in localStorage between visits.
// Never the picture. Storage can be missing or full (private windows, some
// embedded browsers), so every read and write is allowed to fail quietly.

import { decodeSettings } from '../core/share'

export interface Settings extends DeresSettings {
  multiplier: number
  exportFx: boolean
}

const KEY = 'b0r3d-deres:settings'

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
    customCount: 16,
    customPalette: undefined
  }
}

const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback

/** Settings from storage, checked field by field (anything odd falls back). */
export function loadSettings(): Settings {
  const d = defaultSettings()
  let raw: Record<string, unknown> | null = null
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || 'null')
  } catch {
    raw = null
  }
  const loaded = raw && typeof raw === 'object' ? raw : {}
  const a = (loaded.adjust ?? {}) as Record<string, unknown>
  const f = (loaded.fx ?? {}) as Record<string, unknown>
  const fx: Fx = {
    screen: oneOf(
      f.screen,
      ['off', 'crt', 'lcd', 'vhs', 'composite', 'p1-green', 'p3-amber', 'p4-white'] as const,
      d.fx.screen
    ),
    mask: oneOf(f.mask, ['none', 'shadow', 'grille'] as const, d.fx.mask),
    scanlines: num(f.scanlines, 0, 1, d.fx.scanlines),
    curve: num(f.curve, 0, 1, d.fx.curve),
    bloom: num(f.bloom, 0, 1, d.fx.bloom),
    grid: num(f.grid, 0, 1, d.fx.grid),
    ghost: num(f.ghost, 0, 1, d.fx.ghost),
    vhsTracking: num(f.vhsTracking, 0, 1, d.fx.vhsTracking ?? 0.8),
    vhsOsd: f.vhsOsd !== false
  }
  const profileId = profileById(String(loaded.profileId)) ? String(loaded.profileId) : d.profileId
  const customCount = typeof loaded.customCount === 'number' ? Math.round(num(loaded.customCount, 2, 256, 16)) : d.customCount
  const customPalette = Array.isArray(loaded.customPalette)
    ? (loaded.customPalette.filter((c) => typeof c === 'string') as string[])
    : undefined

  const base: Settings = {
    profileId,
    fit: oneOf(loaded.fit, ['fill', 'fit', 'stretch'] as const, d.fit),
    resolution: oneOf(loaded.resolution, ['native', 'custom'] as const, d.resolution),
    block: Math.round(num(loaded.block, 2, 32, d.block)),
    background: oneOf(loaded.background, ['white', 'black'] as const, d.background),
    adjust: {
      brightness: num(a.brightness, -0.5, 0.5, 0),
      contrast: num(a.contrast, 0, 2, 1),
      saturation: num(a.saturation, 0, 2, 1),
      gamma: num(a.gamma, 0.4, 2.5, 1)
    },
    dither: oneOf(loaded.dither, DITHERS.map((x) => x.id) as DitherId[], profileById(profileId)!.dither),
    fx,
    pixelShape: oneOf(loaded.pixelShape, ['raw', 'tv'] as const, d.pixelShape),
    multiplier: Math.round(num(loaded.multiplier, 1, 16, d.multiplier)),
    exportFx: loaded.exportFx === true,
    customCount,
    customPalette
  }

  // If a share link with hash settings was opened, it takes precedence
  if (typeof window !== 'undefined' && window.location.hash) {
    const fromHash = decodeSettings(window.location.hash)
    if (fromHash) {
      return { ...base, ...fromHash }
    }
  }

  return base
}

let timer: ReturnType<typeof setTimeout> | undefined

/** Saves a moment later, so a slider drag writes once. */
export function saveSettings(s: Settings): void {
  clearTimeout(timer)
  timer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s))
    } catch {
      // Storage unavailable: settings just won't be remembered.
    }
  }, 300)
}
