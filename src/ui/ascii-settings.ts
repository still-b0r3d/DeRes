import { ASCII_RAMPS, DEFAULT_ASCII_SETTINGS, type AsciiColorMode, type AsciiMode, type AsciiRampPreset, type AsciiSettings } from '../core/ascii'

// The ASCII / ANSI Studio's settings, remembered in localStorage between
// visits. What's stored is checked field by field (as DeRes's settings are),
// so one odd saved value can't break the tab: it just falls back.

export const ASCII_STORAGE_KEY = 'b0r3d_ascii_settings'

const MODES: readonly AsciiMode[] = ['half-block', 'ramp', 'petscii', 'teletext']
const COLOUR_MODES: readonly AsciiColorMode[] = ['ansi16', 'c64', 'teletext', 'green', 'amber', 'mono', 'truecolor']
const RAMPS: readonly AsciiRampPreset[] = [...(Object.keys(ASCII_RAMPS) as AsciiRampPreset[]), 'custom']
/** A typed-in ramp longer than this is cut (a ramp is a handful of characters). */
const MAX_CUSTOM_RAMP = 256

const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback)
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)

/** ASCII settings checked field by field: anything missing or odd keeps base's value. */
export function checkAsciiSettings(loaded: unknown, base: AsciiSettings = DEFAULT_ASCII_SETTINGS): AsciiSettings {
  const l = (loaded && typeof loaded === 'object' ? loaded : {}) as Record<string, unknown>
  return {
    mode: oneOf(l.mode, MODES, base.mode),
    columns: Math.round(num(l.columns, 20, 200, base.columns)),
    rampPreset: oneOf(l.rampPreset, RAMPS, base.rampPreset),
    customRamp: typeof l.customRamp === 'string' ? [...l.customRamp].slice(0, MAX_CUSTOM_RAMP).join('') : base.customRamp,
    invertRamp: bool(l.invertRamp, base.invertRamp),
    colorMode: oneOf(l.colorMode, COLOUR_MODES, base.colorMode),
    contrast: num(l.contrast, -100, 100, base.contrast),
    brightness: num(l.brightness, -100, 100, base.brightness),
    gamma: num(l.gamma, 0.5, 2.5, base.gamma),
    twoToOneAspect: bool(l.twoToOneAspect, base.twoToOneAspect),
    teletextSeparated: bool(l.teletextSeparated, base.teletextSeparated ?? false),
    teletextHeader: bool(l.teletextHeader, base.teletextHeader ?? true)
  }
}

export function loadAsciiSettings(): AsciiSettings {
  try {
    const raw = localStorage.getItem(ASCII_STORAGE_KEY)
    if (raw) return checkAsciiSettings(JSON.parse(raw))
  } catch {
    // Storage disabled, or not JSON.
  }
  return { ...DEFAULT_ASCII_SETTINGS }
}

export function saveAsciiSettings(settings: AsciiSettings): void {
  try {
    localStorage.setItem(ASCII_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage disabled or quota
  }
}
