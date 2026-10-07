import { NEUTRAL } from '../core/adjust'
import { DITHERS, type DitherId } from '../core/dither'
import { DEFAULT_FX, type Fx } from '../core/fx'
import type { DeresSettings } from '../core/pipeline'
import { DEFAULT_PROFILE, profileById } from '../core/profiles'

// Everything the controls set, remembered in localStorage between visits.
// Never the picture. Storage can be missing or full (private windows, some
// embedded browsers), so every read and write is allowed to fail quietly.

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
    exportFx: false
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
  if (!raw || typeof raw !== 'object') return d
  const a = (raw.adjust ?? {}) as Record<string, unknown>
  const f = (raw.fx ?? {}) as Record<string, unknown>
  const fx: Fx = {
    screen: oneOf(f.screen, ['off', 'crt', 'lcd'] as const, d.fx.screen),
    mask: oneOf(f.mask, ['none', 'shadow', 'grille'] as const, d.fx.mask),
    scanlines: num(f.scanlines, 0, 1, d.fx.scanlines),
    curve: num(f.curve, 0, 1, d.fx.curve),
    bloom: num(f.bloom, 0, 1, d.fx.bloom),
    grid: num(f.grid, 0, 1, d.fx.grid),
    ghost: num(f.ghost, 0, 1, d.fx.ghost)
  }
  const profileId = profileById(String(raw.profileId)) ? String(raw.profileId) : d.profileId
  return {
    profileId,
    fit: oneOf(raw.fit, ['fill', 'fit', 'stretch'] as const, d.fit),
    resolution: oneOf(raw.resolution, ['native', 'custom'] as const, d.resolution),
    block: Math.round(num(raw.block, 2, 32, d.block)),
    background: oneOf(raw.background, ['white', 'black'] as const, d.background),
    adjust: {
      brightness: num(a.brightness, -0.5, 0.5, 0),
      contrast: num(a.contrast, 0, 2, 1),
      saturation: num(a.saturation, 0, 2, 1),
      gamma: num(a.gamma, 0.4, 2.5, 1)
    },
    dither: oneOf(raw.dither, DITHERS.map((x) => x.id) as DitherId[], profileById(profileId)!.dither),
    fx,
    pixelShape: oneOf(raw.pixelShape, ['raw', 'tv'] as const, d.pixelShape),
    multiplier: Math.round(num(raw.multiplier, 1, 16, d.multiplier)),
    exportFx: raw.exportFx === true
  }
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
