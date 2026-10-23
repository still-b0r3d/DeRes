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
    w: settings.customWidth,
    dt: settings.detail,
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
      fx.ghost,
      fx.vhsTracking,
      fx.vhsOsd
    ]
  }

  // The signal only when it's on (links made before v0.9 have none).
  const sig = settings.signal
  if (sig && sig.mode !== 'off') {
    minimal.sg = [sig.mode, sig.wear, sig.colour, sig.sharpen, sig.decoder]
    minimal.lp = [settings.loopFrames, settings.loopFps]
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
 * Decodes a URL hash into settings fields, as written (unchecked: run them
 * through checkSettings, as settingsFromHash does). Returns null if the hash
 * can't be read at all.
 */
export function decodeSettings(hash: string): Record<string, unknown> | null {
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

    const out: Record<string, unknown> = {}
    const set = (key: string, value: unknown) => {
      if (value !== undefined) out[key] = value
    }
    set('profileId', raw.p)
    set('fit', raw.f)
    set('resolution', raw.r)
    set('customWidth', raw.w)
    set('detail', raw.dt)
    set('background', raw.bg)
    set('dither', raw.d)
    set('pixelShape', raw.ps)
    set('multiplier', raw.m)
    if (typeof raw.ef === 'number' || typeof raw.ef === 'boolean') out.exportFx = !!raw.ef

    if (Array.isArray(raw.a)) {
      const [brightness, contrast, saturation, gamma] = raw.a
      out.adjust = { brightness, contrast, saturation, gamma }
    }

    // 7 entries before v0.8.3; the VHS tracking and OSD came after.
    if (Array.isArray(raw.fx)) {
      const [screen, mask, scanlines, curve, bloom, grid, ghost, vhsTracking, vhsOsd] = raw.fx
      out.fx = { screen, mask, scanlines, curve, bloom, grid, ghost, vhsTracking, vhsOsd }
    }

    if (Array.isArray(raw.sg)) {
      const [mode, wear, colour, sharpen, decoder] = raw.sg
      out.signal = { mode, wear, colour, sharpen, decoder }
    } else {
      // A link without one means no signal, whatever this browser last used.
      out.signal = { mode: 'off' }
    }
    if (Array.isArray(raw.lp)) {
      out.loopFrames = raw.lp[0]
      out.loopFps = raw.lp[1]
    }

    set('customCount', raw.cc)
    set('customPalette', raw.cp)

    return out
  } catch {
    return null
  }
}
