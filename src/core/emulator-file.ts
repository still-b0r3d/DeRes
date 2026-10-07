import { processSpectrum, processC64Multicolour } from './cell'
import { encodeGbChr } from './tiles'

// Emulator file exporters:
// 1. ZX Spectrum .scr (standard 6,912-byte snapshot: 6,144 bytes bitmap + 768 bytes attributes)
// 2. C64 Koala .koa (10,003 bytes: load address $6000 + 8,000 bitmap + 1,000 screen + 1,000 color + 1 bg)
// 3. Game Boy .chr (2BPP planar tiles, 16 bytes per 8×8 tile)

export interface EmulatorExport {
  filename: string
  mimeType: string
  data: Uint8Array
}

/**
 * Exports a 256×192 image as a ZX Spectrum .scr file (exactly 6,912 bytes).
 */
export function exportSpectrumScr(
  linearRgb: Float32Array,
  width = 256,
  height = 192,
  baseName = 'spectrum'
): EmulatorExport {
  const { bitmap, attributes } = processSpectrum(linearRgb, width, height)
  const data = new Uint8Array(6912)
  data.set(bitmap, 0)
  data.set(attributes, 6144)

  return {
    filename: `${baseName}.scr`,
    mimeType: 'application/octet-stream',
    data
  }
}

/**
 * Exports a 160×200 image as a C64 Koala Painter .koa file (exactly 10,003 bytes).
 */
export function exportC64Koala(
  linearRgb: Float32Array,
  width = 160,
  height = 200,
  baseName = 'c64'
): EmulatorExport {
  const { koalaData } = processC64Multicolour(linearRgb, width, height)

  return {
    filename: `${baseName}.koa`,
    mimeType: 'application/octet-stream',
    data: koalaData
  }
}

/**
 * Exports an image as Game Boy 2BPP planar tiles (.chr file).
 */
export function exportGbChr(
  indices: Uint8Array,
  width: number,
  height: number,
  baseName = 'gameboy',
  deduplicate = true
): EmulatorExport {
  const data = encodeGbChr(indices, width, height, deduplicate)

  return {
    filename: `${baseName}.chr`,
    mimeType: 'application/octet-stream',
    data
  }
}
