import { ColourCensus, entriesIn } from './census'
import { fxRenderer, type Fx } from './fx'
import { exportSize, MAX_EXPORT_PIXELS, type Rendered } from './pipeline'
import { encodeIndexedPng, encodeRgbaPng, encodeRgbPng } from './png'
import { signalRenderer, type SignalImage } from './signal'

// Export: the picture enlarged by a whole number, nearest-neighbour, so every
// pixel stays a crisp block. Without screen effects it's an indexed PNG
// holding the machine's exact palette (open it in a pixel-art editor and the
// palette is there). A look that makes its own colours (the PlayStation, HAM,
// the N64 filter, the analog looks) holds exactly the colours it uses
// instead, or goes full colour past 256 of them. With screen effects it's a
// full-colour PNG. A picture with see-through pixels keeps them: the indexed
// PNG gets one more palette entry that's see-through (or goes full colour
// with alpha when the palette is already 256 colours), the full-colour PNG
// gets alpha. A wallpaper stays solid: its see-through pixels take the
// wallpaper's own backdrop colour.

/** A row renderer that can also say which of its pixels show (1 byte each). */
type RowRenderer = (y: number, row: Uint8Array, alpha?: Uint8Array) => void

/** Rows from a renderer as a PNG: with alpha when `withAlpha`, else plain RGB. */
async function encodeRows(width: number, height: number, render: RowRenderer, withAlpha: boolean): Promise<Uint8Array<ArrayBuffer>> {
  if (!withAlpha) return encodeRgbPng(width, height, render)
  const row = new Uint8Array(width * 3)
  const alpha = new Uint8Array(width)
  return encodeRgbaPng(width, height, (y, out) => {
    render(y, row, alpha)
    for (let x = 0; x < width; x++) {
      out[x * 4] = row[x * 3]
      out[x * 4 + 1] = row[x * 3 + 1]
      out[x * 4 + 2] = row[x * 3 + 2]
      out[x * 4 + 3] = alpha[x]
    }
  })
}

/** A picture as exactly the colours that show, while there are no more than 256 (else null). */
function exactEntries(rgb: Uint8Array, alpha: Uint8Array | null): { palette: Uint8Array; indices: Uint8Array } | null {
  const census = new ColourCensus()
  census.add(rgb, alpha)
  const palette = census.palette()
  return palette && { palette, indices: entriesIn(palette, rgb, alpha) }
}

/** Screen effects only make it into exports from this size up. */
export const FX_MIN_MULTIPLIER = 3

export interface ExportOptions {
  multiplier: number
  /** Stretch to the machine's pixel shape. */
  tv: boolean
  /** The screen effect to bake in, or null. */
  fx: Fx | null
  /** The picture after the analog signal, when it's on (always kept in exports). */
  signal?: SignalImage | null
  /** Where the screen effect's moving parts are (0–1): an animation frame's place in its loop. */
  phase?: number
}

export async function exportPng(
  r: Rendered,
  o: ExportOptions
): Promise<{ png: Uint8Array<ArrayBuffer>; width: number; height: number; fx: boolean }> {
  const m = Math.max(1, Math.floor(o.multiplier))
  const [width, height] = exportSize(r.width, r.height, r.geometry.par, m, o.tv)
  if (width * height > MAX_EXPORT_PIXELS) throw new Error('That export would be too big')
  const withFx = !!(o.fx && o.fx.screen !== 'off' && m >= FX_MIN_MULTIPLIER)
  const alpha = r.alpha ?? null

  if (o.signal) {
    const render = signalRenderer(o.signal, width, height, withFx ? o.fx : null, o.phase ?? 0, r.paper)
    return { png: await encodeRows(width, height, render, !!o.signal.alpha), width, height, fx: withFx }
  }

  if (withFx && o.fx) {
    const render = fxRenderer({ rgb: r.rgb, width: r.width, height: r.height, paper: r.paper, alpha }, width, height, o.fx, o.phase)
    return { png: await encodeRows(width, height, render, !!alpha), width, height, fx: true }
  }

  // Which picture column each output column shows.
  const column = new Int32Array(width)
  for (let x = 0; x < width; x++) column[x] = Math.min(r.width - 1, Math.floor((x * r.width) / width))
  // The pixels as palette entries: the machine's own palette (every entry,
  // in its order) when its pixels are entries of it, else exactly the
  // colours that show.
  const entries = r.indexed ? { palette: r.palette, indices: r.indices } : exactEntries(r.rgb, alpha)
  const colours = entries ? entries.palette.length / 3 : 0

  // Full colour: too many colours for a palette, or a full palette with no
  // room left for a see-through entry.
  if (!entries || colours > 256 || colours === 0 || (alpha && colours === 256)) {
    const enlarged: RowRenderer = (y, out, a) => {
      const sy = Math.floor(y / m) * r.width
      for (let x = 0; x < width; x++) {
        const srcIdx = (sy + column[x]) * 3
        out[x * 3] = r.rgb[srcIdx]
        out[x * 3 + 1] = r.rgb[srcIdx + 1]
        out[x * 3 + 2] = r.rgb[srcIdx + 2]
        if (a) a[x] = alpha ? alpha[sy + column[x]] : 255
      }
    }
    return { png: await encodeRows(width, height, enlarged, !!alpha), width, height, fx: false }
  }

  // See-through pixels point at one more entry, after the machine's colours.
  const palette = alpha ? Uint8Array.from([...entries.palette, 0, 0, 0]) : entries.palette
  const indices = entries.indices
  const png = await encodeIndexedPng(
    width,
    height,
    palette,
    (y, out) => {
      const sy = Math.floor(y / m) * r.width
      for (let x = 0; x < width; x++) out[x] = alpha && !alpha[sy + column[x]] ? colours : indices[sy + column[x]]
    },
    alpha ? colours : undefined
  )
  return { png, width, height, fx: false }
}

export type WallpaperPresetId = 'phone' | 'win95' | 'desktop-1080p'

export interface WallpaperPreset {
  id: WallpaperPresetId
  name: string
  width: number
  height: number
}

export const WALLPAPER_PRESETS: readonly WallpaperPreset[] = [
  { id: 'phone', name: 'Phone (1080×2400)', width: 1080, height: 2400 },
  { id: 'win95', name: 'b0r3d 95 (1024×768)', width: 1024, height: 768 },
  { id: 'desktop-1080p', name: 'Desktop (1080p)', width: 1920, height: 1080 }
]

export function wallpaperPresetById(id: string): WallpaperPreset | undefined {
  return WALLPAPER_PRESETS.find((p) => p.id === id)
}

export async function exportWallpaper(
  r: Rendered,
  preset: WallpaperPreset,
  o: { tv: boolean; fx: Fx | null; signal?: SignalImage | null; phase?: number }
): Promise<{ png: Uint8Array<ArrayBuffer>; width: number; height: number }> {
  const targetW = preset.width
  const targetH = preset.height

  let bestM = 1
  for (let m = 1; m <= 32; m++) {
    const [sw, sh] = exportSize(r.width, r.height, r.geometry.par, m, o.tv)
    if (sw <= targetW && sh <= targetH) {
      bestM = m
    } else {
      break
    }
  }

  const [scaledW, scaledH] = exportSize(r.width, r.height, r.geometry.par, bestM, o.tv)
  const offsetX = Math.floor((targetW - scaledW) / 2)
  const offsetY = Math.floor((targetH - scaledH) / 2)

  let bgR = 0, bgG = 0, bgB = 0
  if (r.palette.length >= 3) {
    bgR = r.palette[0]
    bgG = r.palette[1]
    bgB = r.palette[2]
  }

  const withFx = !!(o.fx && o.fx.screen !== 'off' && bestM >= FX_MIN_MULTIPLIER)
  if (withFx || o.signal) {
    const fxRows: Uint8Array[] = []
    const fxGen = o.signal
      ? signalRenderer(o.signal, scaledW, scaledH, withFx ? o.fx : null, o.phase ?? 0, r.paper)
      : fxRenderer({ rgb: r.rgb, width: r.width, height: r.height, paper: r.paper, alpha: r.alpha }, scaledW, scaledH, o.fx!, o.phase)
    const shows = new Uint8Array(scaledW)
    for (let sy = 0; sy < scaledH; sy++) {
      const row = new Uint8Array(scaledW * 3)
      fxGen(sy, row, shows)
      // See-through pixels take the backdrop colour.
      for (let x = 0; x < scaledW; x++) if (!shows[x]) row.set([bgR, bgG, bgB], x * 3)
      fxRows.push(row)
    }

    const png = await encodeRgbPng(targetW, targetH, (y, out) => {
      if (y < offsetY || y >= offsetY + scaledH) {
        for (let x = 0; x < targetW; x++) {
          out[x * 3] = bgR
          out[x * 3 + 1] = bgG
          out[x * 3 + 2] = bgB
        }
      } else {
        const sy = y - offsetY
        const fxRow = fxRows[sy]
        for (let x = 0; x < targetW; x++) {
          if (x < offsetX || x >= offsetX + scaledW) {
            out[x * 3] = bgR
            out[x * 3 + 1] = bgG
            out[x * 3 + 2] = bgB
          } else {
            const sx = x - offsetX
            out[x * 3] = fxRow[sx * 3]
            out[x * 3 + 1] = fxRow[sx * 3 + 1]
            out[x * 3 + 2] = fxRow[sx * 3 + 2]
          }
        }
      }
    })
    return { png, width: targetW, height: targetH }
  }

  const column = new Int32Array(scaledW)
  for (let x = 0; x < scaledW; x++) column[x] = Math.min(r.width - 1, Math.floor((x * r.width) / scaledW))

  const png = await encodeRgbPng(targetW, targetH, (y, out) => {
    if (y < offsetY || y >= offsetY + scaledH) {
      for (let x = 0; x < targetW; x++) {
        out[x * 3] = bgR
        out[x * 3 + 1] = bgG
        out[x * 3 + 2] = bgB
      }
    } else {
      const sy = Math.floor((y - offsetY) / bestM) * r.width
      for (let x = 0; x < targetW; x++) {
        if (x < offsetX || x >= offsetX + scaledW) {
          out[x * 3] = bgR
          out[x * 3 + 1] = bgG
          out[x * 3 + 2] = bgB
        } else if (r.alpha && !r.alpha[sy + column[x - offsetX]]) {
          out[x * 3] = bgR
          out[x * 3 + 1] = bgG
          out[x * 3 + 2] = bgB
        } else {
          const sx = x - offsetX
          const srcIdx = (sy + column[sx]) * 3
          out[x * 3] = r.rgb[srcIdx]
          out[x * 3 + 1] = r.rgb[srcIdx + 1]
          out[x * 3 + 2] = r.rgb[srcIdx + 2]
        }
      }
    }
  })
  return { png, width: targetW, height: targetH }
}
