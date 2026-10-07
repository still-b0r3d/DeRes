import type { Settings } from '../ui/settings'

// Encodes and decodes app settings to/from URL hash fragments.
// Holds only the settings, never the image.

function toBase64Url(str: string): string {
  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(str)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
  }
  return Buffer.from(str, 'utf8').toString('base64url')
}

function fromBase64Url(b64: string): string {
  let standard = b64.replace(/-/g, '+').replace(/_/g, '/')
  while (standard.length % 4 !== 0) standard += '='
  if (typeof atob === 'function') {
    return decodeURIComponent(escape(atob(standard)))
  }
  return Buffer.from(standard, 'base64').toString('utf8')
}

/**
 * Encodes settings into a compact URL hash fragment (e.g. "#s=...").
 */
export function encodeSettings(settings: Settings): string {
  const minimal: Record<string, unknown> = {
    p: settings.profileId,
    f: settings.fit,
    r: settings.resolution,
    b: settings.block,
    bg: settings.background,
    d: settings.dither,
    ps: settings.pixelShape,
    m: settings.multiplier,
    ef: settings.exportFx ? 1 : 0
  }

  // Adjustments only if non-neutral
  const adj = settings.adjust
  if (adj.brightness !== 0 || adj.contrast !== 1 || adj.saturation !== 1 || adj.gamma !== 1) {
    minimal.a = [adj.brightness, adj.contrast, adj.saturation, adj.gamma]
  }

  // FX only if active
  const fx = settings.fx
  if (fx.screen !== 'off') {
    minimal.fx = [
      fx.screen,
      fx.mask,
      fx.scanlines,
      fx.curve,
      fx.bloom,
      fx.grid,
      fx.ghost
    ]
  }

  if (settings.customCount) {
    minimal.cc = settings.customCount
  }

  if (settings.customPalette && settings.customPalette.length > 0) {
    minimal.cp = settings.customPalette
  }

  const json = JSON.stringify(minimal)
  return `#s=${toBase64Url(json)}`
}

/**
 * Decodes a URL hash into a Partial<Settings>. Returns null if invalid.
 */
export function decodeSettings(hash: string): Partial<Settings> | null {
  if (!hash) return null
  const cleaned = hash.replace(/^#/, '').trim()
  if (!cleaned) return null

  let b64 = ''
  if (cleaned.startsWith('s=')) {
    b64 = cleaned.slice(2)
  } else if (cleaned.startsWith('settings=')) {
    b64 = cleaned.slice(9)
  } else {
    b64 = cleaned
  }

  try {
    const raw = JSON.parse(fromBase64Url(b64))
    if (!raw || typeof raw !== 'object') return null

    const out: Partial<Settings> = {}
    if (typeof raw.p === 'string') out.profileId = raw.p
    if (['fill', 'fit', 'stretch'].includes(raw.f)) out.fit = raw.f
    if (['native', 'custom'].includes(raw.r)) out.resolution = raw.r
    if (typeof raw.b === 'number') out.block = raw.b
    if (['white', 'black'].includes(raw.bg)) out.background = raw.bg
    if (typeof raw.d === 'string') out.dither = raw.d as Settings['dither']
    if (['raw', 'tv'].includes(raw.ps)) out.pixelShape = raw.ps
    if (typeof raw.m === 'number') out.multiplier = raw.m
    if (typeof raw.ef === 'number' || typeof raw.ef === 'boolean') out.exportFx = !!raw.ef

    if (Array.isArray(raw.a) && raw.a.length === 4) {
      out.adjust = {
        brightness: Number(raw.a[0]) || 0,
        contrast: Number(raw.a[1]) || 1,
        saturation: Number(raw.a[2]) || 1,
        gamma: Number(raw.a[3]) || 1
      }
    }

    if (Array.isArray(raw.fx) && raw.fx.length === 7) {
      out.fx = {
        screen: raw.fx[0],
        mask: raw.fx[1],
        scanlines: Number(raw.fx[2]) || 0,
        curve: Number(raw.fx[3]) || 0,
        bloom: Number(raw.fx[4]) || 0,
        grid: Number(raw.fx[5]) || 0,
        ghost: Number(raw.fx[6]) || 0
      }
    }

    if (typeof raw.cc === 'number') out.customCount = raw.cc
    if (Array.isArray(raw.cp)) out.customPalette = raw.cp.filter((c: unknown) => typeof c === 'string')

    return out
  } catch {
    return null
  }
}
