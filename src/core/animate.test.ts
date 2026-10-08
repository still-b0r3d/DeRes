import { describe, expect, it } from 'vitest'
import { generateAnimatedExport } from './animate'
import { DEFAULT_FX } from './fx'
import type { DeresSettings, Rendered } from './pipeline'
import { decodePng } from './png'

describe('animate core', () => {
  const dummyRendered: Rendered = {
    width: 8,
    height: 8,
    palette: Uint8Array.of(0, 0, 0, 255, 255, 255),
    indices: new Uint8Array(64),
    rgb: new Uint8Array(64 * 3),
    used: 2,
    geometry: {
      src: { x: 0, y: 0, w: 8, h: 8 },
      dst: { x: 0, y: 0, w: 8, h: 8 },
      width: 8,
      height: 8,
      par: [1, 1]
    },
    paper: [255, 255, 255]
  }

  const dummySettings: DeresSettings = {
    profileId: 'gameboy',
    fit: 'fill',
    resolution: 'native',
    block: 8,
    background: 'white',
    adjust: { brightness: 0, contrast: 1, saturation: 1, gamma: 1 },
    dither: 'bayer4',
    fx: { ...DEFAULT_FX },
    pixelShape: 'raw'
  }

  it('generates a Screen FX loop APNG and GIF', async () => {
    const apng = await generateAnimatedExport(
      dummyRendered,
      {
        style: 'screen-fx',
        format: 'apng',
        multiplier: 2,
        tv: false,
        fx: { ...DEFAULT_FX, screen: 'crt' },
        frameCount: 4,
        fps: 10
      },
      dummySettings
    )

    expect(apng.format).toBe('apng')
    expect(apng.frameCount).toBe(4)
    expect(apng.width).toBe(16)
    expect(apng.height).toBe(16)
    expect(apng.data.length).toBeGreaterThan(0)

    // Decodes cleanly with decodePng
    const decoded = await decodePng(apng.data)
    expect(decoded.width).toBe(16)
    expect(decoded.height).toBe(16)

    const gif = await generateAnimatedExport(
      dummyRendered,
      {
        style: 'screen-fx',
        format: 'gif',
        multiplier: 2,
        tv: false,
        fx: { ...DEFAULT_FX, screen: 'vhs' },
        frameCount: 4,
        fps: 10
      },
      dummySettings
    )

    expect(gif.format).toBe('gif')
    expect(gif.frameCount).toBe(4)
    expect(String.fromCharCode(...gif.data.subarray(0, 6))).toBe('GIF89a')
  })

  it('generates an A/B Compare Wipe loop', async () => {
    const sourceRgba = new Uint8Array(8 * 8 * 4)
    sourceRgba.fill(128)

    const apng = await generateAnimatedExport(
      dummyRendered,
      {
        style: 'compare-wipe',
        format: 'apng',
        multiplier: 1,
        tv: false,
        fx: null,
        frameCount: 8,
        sourceRgba,
        sourceWidth: 8,
        sourceHeight: 8
      },
      dummySettings
    )

    expect(apng.format).toBe('apng')
    expect(apng.frameCount).toBe(8)
    expect(apng.width).toBe(8)
    expect(apng.height).toBe(8)
  })

  it('generates an indexed Dither Shimmer loop', async () => {
    const gif = await generateAnimatedExport(
      dummyRendered,
      {
        style: 'dither-shimmer',
        format: 'gif',
        multiplier: 2,
        tv: false,
        fx: null,
        frameCount: 4
      },
      dummySettings
    )

    expect(gif.format).toBe('gif')
    expect(gif.frameCount).toBe(4)
    expect(String.fromCharCode(...gif.data.subarray(0, 6))).toBe('GIF89a')
  })
})
