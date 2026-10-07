import { describe, expect, it } from 'vitest'
import { generateAscii } from './ascii'
import { ASCII_CELL_HEIGHT, ASCII_CELL_WIDTH, renderHalfBlockPng } from './ascii-render'
import { decodePng } from './png'

describe('ASCII renderer', () => {
  it('renders half-block ANSI result to valid PNG with exact dimensions', async () => {
    const w = 4
    const h = 4
    const rgba = new Uint8ClampedArray(w * h * 4).fill(255)
    const ascii = generateAscii(rgba, w, h, {
      mode: 'half-block',
      columns: 4,
      colorMode: 'ansi16'
    })

    const { png, width, height } = await renderHalfBlockPng(ascii, 2)
    expect(width).toBe(4 * ASCII_CELL_WIDTH * 2)
    expect(height).toBe(2 * ASCII_CELL_HEIGHT * 2)

    // Verify PNG header and decode roundtrip
    const decoded = await decodePng(png)
    expect(decoded.width).toBe(width)
    expect(decoded.height).toBe(height)
  })
})
