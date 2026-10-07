import { describe, expect, it } from 'vitest'
import { exportC64Koala, exportGbChr, exportSpectrumScr } from './emulator-file'

describe('emulator file exports', () => {
  it('exports ZX Spectrum .scr with exact 6,912 bytes', () => {
    const w = 256
    const h = 192
    const rgb = new Float32Array(w * h * 3)
    for (let i = 0; i < w * h * 3; i++) rgb[i] = 0.5

    const file = exportSpectrumScr(rgb, w, h, 'test')
    expect(file.filename).toBe('test.scr')
    expect(file.mimeType).toBe('application/octet-stream')
    expect(file.data.length).toBe(6912)
  })

  it('exports C64 Koala .koa with exact 10,003 bytes and load address', () => {
    const w = 160
    const h = 200
    const rgb = new Float32Array(w * h * 3)
    for (let i = 0; i < w * h * 3; i++) rgb[i] = 0.5

    const file = exportC64Koala(rgb, w, h, 'photo')
    expect(file.filename).toBe('photo.koa')
    expect(file.data.length).toBe(10003)
    expect(file.data[0]).toBe(0x00)
    expect(file.data[1]).toBe(0x60)
  })

  it('exports Game Boy .chr in 16-byte multiples', () => {
    const w = 16
    const h = 16 // 4 tiles
    const indices = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) indices[i] = i % 4

    const file = exportGbChr(indices, w, h, 'sprite', false)
    expect(file.filename).toBe('sprite.chr')
    expect(file.data.length).toBe(4 * 16)
    expect(file.data.length % 16).toBe(0)
  })
})
