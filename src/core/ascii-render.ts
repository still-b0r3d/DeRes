import type { AsciiResult } from './ascii'
import { encodeRgbPng } from './png'

// Renders ASCII/ANSI art to PNG images with authentic 8x16 CP437 character cell proportions.
// Supports integer scaling multipliers (1x, 2x, 4x) for ultra-crisp display.

export const ASCII_CELL_WIDTH = 8
export const ASCII_CELL_HEIGHT = 16

/** The size of the rendered picture (PNG, GIF, APNG) of art `columns` × `rows` cells at a multiplier. */
export function asciiImageSize(columns: number, rows: number, multiplier: number): [number, number] {
  const m = Math.max(1, Math.floor(multiplier))
  return [columns * ASCII_CELL_WIDTH * m, rows * ASCII_CELL_HEIGHT * m]
}

/**
 * Whether the rendered picture is drawn with the font (on a canvas, see
 * renderAsciiToCanvas); half-block art is plain pixels (asciiPixels), so it
 * can be made anywhere.
 */
export function drawnWithFont(result: AsciiResult): boolean {
  return result.settings.mode !== 'half-block'
}

/**
 * Renders half-block or Teletext mosaic art directly to PNG using pixel drawing.
 */
export async function renderHalfBlockPng(
  result: AsciiResult,
  multiplier = 1
): Promise<{ png: Uint8Array<ArrayBuffer>; width: number; height: number }> {
  const [outW, outH] = asciiImageSize(result.width, result.height, multiplier)
  const png = await encodeRgbPng(outW, outH, pixelRow(result, multiplier))
  return { png, width: outW, height: outH }
}

/** Half-block or Teletext mosaic art as r, g, b pixels: the same as its PNG (one frame of a GIF or APNG). */
export function asciiPixels(result: AsciiResult, multiplier = 1): Uint8Array {
  const [w, h] = asciiImageSize(result.width, result.height, multiplier)
  const rgb = new Uint8Array(w * h * 3)
  const row = pixelRow(result, multiplier)
  for (let y = 0; y < h; y++) row(y, rgb.subarray(y * w * 3, (y + 1) * w * 3))
  return rgb
}

/** Fills one row of the pixel-drawn picture (r, g, b). */
function pixelRow(result: AsciiResult, multiplier: number): (y: number, out: Uint8Array) => void {
  const m = Math.max(1, Math.floor(multiplier))
  const cellW = ASCII_CELL_WIDTH * m
  const cellH = ASCII_CELL_HEIGHT * m
  const halfH = cellH / 2
  const outW = result.width * cellW

  return (y, out) => {
    const rowIdx = Math.floor(y / cellH)
    const row = result.cells[rowIdx]
    if (!row) return

    if (result.settings.mode === 'teletext') {
      const inCellY = y % cellH
      const subY = Math.min(2, Math.floor((inCellY * 3) / cellH))
      const sep = result.settings.teletextSeparated && m >= 2

      for (let x = 0; x < outW; x++) {
        const colIdx = Math.floor(x / cellW)
        const cell = row[colIdx]
        if (!cell) continue

        const inCellX = x % cellW
        const subX = Math.min(1, Math.floor((inCellX * 2) / cellW))
        const bit = subY * 2 + subX
        const mask = cell.teletextMask ?? 0

        // If separated mosaics, create 1px gap between sub-blocks
        const isSepBorder =
          sep &&
          (inCellX === 0 ||
            inCellX === Math.floor(cellW / 2) ||
            inCellY === 0 ||
            inCellY === Math.floor(cellH / 3) ||
            inCellY === Math.floor((cellH * 2) / 3))

        const lit = !isSepBorder && (mask & (1 << bit)) !== 0
        const rgb = lit ? cell.fg : cell.bg
        out[x * 3] = rgb[0]
        out[x * 3 + 1] = rgb[1]
        out[x * 3 + 2] = rgb[2]
      }
      return
    }

    const isTop = (y % cellH) < halfH
    for (let x = 0; x < outW; x++) {
      const colIdx = Math.floor(x / cellW)
      const cell = row[colIdx]
      if (!cell) continue

      const rgb = isTop ? cell.fg : cell.bg
      out[x * 3] = rgb[0]
      out[x * 3 + 1] = rgb[1]
      out[x * 3 + 2] = rgb[2]
    }
  }
}

/**
 * Renders ASCII, PETSCII or Teletext art to a DOM canvas using bundled fonts or geometric mosaics.
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

  if (result.settings.mode === 'teletext') {
    const subW = cellW / 2
    const subH = cellH / 3
    const sep = result.settings.teletextSeparated && m >= 2 ? 1 : 0

    for (let r = 0; r < result.height; r++) {
      const y = r * cellH
      const row = result.cells[r]
      for (let c = 0; c < result.width; c++) {
        const x = c * cellW
        const cell = row[c]
        const mask = cell.teletextMask ?? 0

        ctx.fillStyle = `rgb(${cell.bg[0]},${cell.bg[1]},${cell.bg[2]})`
        ctx.fillRect(x, y, cellW, cellH)

        ctx.fillStyle = `rgb(${cell.fg[0]},${cell.fg[1]},${cell.fg[2]})`
        for (let sy = 0; sy < 3; sy++) {
          for (let sx = 0; sx < 2; sx++) {
            const bit = sy * 2 + sx
            if (mask & (1 << bit)) {
              ctx.fillRect(
                x + sx * subW + sep,
                y + sy * subH + sep,
                subW - sep * 2,
                subH - sep * 2
              )
            }
          }
        }
      }
    }
    return canvas
  }

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

  // Character ramp & PETSCII mode: render with font
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
