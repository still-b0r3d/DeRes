import type { AsciiResult } from './ascii'
import { encodeRgbPng } from './png'

// Renders ASCII/ANSI art to PNG images with authentic 8x16 CP437 character cell proportions.
// Supports integer scaling multipliers (1x, 2x, 4x) for ultra-crisp display.

export const ASCII_CELL_WIDTH = 8
export const ASCII_CELL_HEIGHT = 16

/**
 * Renders half-block ANSI art directly to PNG using pixel drawing (exact 8x8 squares per half-block).
 */
export async function renderHalfBlockPng(
  result: AsciiResult,
  multiplier = 1
): Promise<{ png: Uint8Array<ArrayBuffer>; width: number; height: number }> {
  const m = Math.max(1, Math.floor(multiplier))
  const cellW = ASCII_CELL_WIDTH * m
  const cellH = ASCII_CELL_HEIGHT * m
  const halfH = cellH / 2

  const outW = result.width * cellW
  const outH = result.height * cellH

  const png = await encodeRgbPng(outW, outH, (y, out) => {
    const rowIdx = Math.floor(y / cellH)
    const isTop = (y % cellH) < halfH
    const row = result.cells[rowIdx]
    if (!row) return

    for (let x = 0; x < outW; x++) {
      const colIdx = Math.floor(x / cellW)
      const cell = row[colIdx]
      if (!cell) continue

      const rgb = isTop ? cell.fg : cell.bg
      out[x * 3] = rgb[0]
      out[x * 3 + 1] = rgb[1]
      out[x * 3 + 2] = rgb[2]
    }
  })

  return { png, width: outW, height: outH }
}

/**
 * Renders ASCII text art to a DOM canvas using the bundled CP437 font.
 */
export function renderAsciiToCanvas(
  result: AsciiResult,
  multiplier = 1,
  targetCanvas?: HTMLCanvasElement
): HTMLCanvasElement {
  const m = Math.max(1, Math.floor(multiplier))
  const cellW = ASCII_CELL_WIDTH * m
  const cellH = ASCII_CELL_HEIGHT * m
  const halfH = cellH / 2

  const width = result.width * cellW
  const height = result.height * cellH

  const canvas = targetCanvas ?? document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error("Couldn't get canvas 2d context")

  // Fill background
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, width, height)

  if (result.settings.mode === 'half-block') {
    // Pure pixel rectangles for half-blocks
    for (let r = 0; r < result.height; r++) {
      const y = r * cellH
      const row = result.cells[r]
      for (let c = 0; c < result.width; c++) {
        const x = c * cellW
        const cell = row[c]

        // Top half
        ctx.fillStyle = `rgb(${cell.fg[0]},${cell.fg[1]},${cell.fg[2]})`
        ctx.fillRect(x, y, cellW, halfH)

        // Bottom half
        ctx.fillStyle = `rgb(${cell.bg[0]},${cell.bg[1]},${cell.bg[2]})`
        ctx.fillRect(x, y + halfH, cellW, halfH)
      }
    }
    return canvas
  }

  // Character ramp mode: render with font
  ctx.font = `${cellH}px 'IBM VGA 8x16', 'WebPlus_IBM_VGA_8x16', 'Courier New', monospace`
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'

  for (let r = 0; r < result.height; r++) {
    const y = r * cellH
    const row = result.cells[r]
    for (let c = 0; c < result.width; c++) {
      const x = c * cellW
      const cell = row[c]

      // Fill cell background
      if (cell.bg[0] !== 0 || cell.bg[1] !== 0 || cell.bg[2] !== 0) {
        ctx.fillStyle = `rgb(${cell.bg[0]},${cell.bg[1]},${cell.bg[2]})`
        ctx.fillRect(x, y, cellW, cellH)
      }

      if (cell.char !== ' ') {
        ctx.fillStyle = `rgb(${cell.fg[0]},${cell.fg[1]},${cell.fg[2]})`
        ctx.fillText(cell.char, x, y)
      }
    }
  }

  return canvas
}
