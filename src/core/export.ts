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
