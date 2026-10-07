import { fxRenderer, type Fx } from './fx'
import { exportSize, MAX_EXPORT_PIXELS, type Rendered } from './pipeline'
import { encodeIndexedPng, encodeRgbPng } from './png'

// Export: the picture enlarged by a whole number, nearest-neighbour, so every
// pixel stays a crisp block. Without screen effects it's an indexed PNG
// holding the machine's exact palette (open it in a pixel-art editor and the
// palette is there). With them it's a full-colour PNG.

/** Screen effects only make it into exports from this size up. */
export const FX_MIN_MULTIPLIER = 3

export interface ExportOptions {
  multiplier: number
  /** Stretch to the machine's pixel shape. */
  tv: boolean
  /** The screen effect to bake in, or null. */
  fx: Fx | null
}

export async function exportPng(
  r: Rendered,
  o: ExportOptions
): Promise<{ png: Uint8Array<ArrayBuffer>; width: number; height: number; fx: boolean }> {
  const m = Math.max(1, Math.floor(o.multiplier))
  const [width, height] = exportSize(r.width, r.height, r.geometry.par, m, o.tv)
  if (width * height > MAX_EXPORT_PIXELS) throw new Error('That export would be too big')

  if (o.fx && o.fx.screen !== 'off' && m >= FX_MIN_MULTIPLIER) {
    const render = fxRenderer({ rgb: r.rgb, width: r.width, height: r.height, paper: r.paper }, width, height, o.fx)
    return { png: await encodeRgbPng(width, height, render), width, height, fx: true }
  }

  // Which picture column each output column shows.
  const column = new Int32Array(width)
  for (let x = 0; x < width; x++) column[x] = Math.min(r.width - 1, Math.floor((x * r.width) / width))

  if (r.palette.length / 3 > 256 || r.palette.length === 0) {
    const png = await encodeRgbPng(width, height, (y, out) => {
      const sy = Math.floor(y / m) * r.width
      for (let x = 0; x < width; x++) {
        const srcIdx = (sy + column[x]) * 3
        out[x * 3] = r.rgb[srcIdx]
        out[x * 3 + 1] = r.rgb[srcIdx + 1]
        out[x * 3 + 2] = r.rgb[srcIdx + 2]
      }
    })
    return { png, width, height, fx: false }
  }

  const png = await encodeIndexedPng(width, height, r.palette, (y, out) => {
    const sy = Math.floor(y / m) * r.width
    for (let x = 0; x < width; x++) out[x] = r.indices[sy + column[x]]
  })
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
  o: { tv: boolean; fx: Fx | null }
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

  if (o.fx && o.fx.screen !== 'off' && bestM >= FX_MIN_MULTIPLIER) {
    const fxRows: Uint8Array[] = []
    const fxGen = fxRenderer({ rgb: r.rgb, width: r.width, height: r.height, paper: r.paper }, scaledW, scaledH, o.fx)
    for (let sy = 0; sy < scaledH; sy++) {
      const row = new Uint8Array(scaledW * 3)
      fxGen(sy, row)
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
