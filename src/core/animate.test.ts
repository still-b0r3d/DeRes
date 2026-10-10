import { describe, expect, it } from 'vitest'
import {
  animationLimit,
  animationMultiplier,
  generateAnimatedExport,
  heldFrames,
  MAX_ANIMATION_BUDGET,
  MAX_ANIMATION_PIXELS,
  STYLE_LOOPS
} from './animate'
import { DEFAULT_FX } from './fx'
import { exportSize, type DeresSettings, type Rendered } from './pipeline'
import { decodePng } from './png'
import { MULTIPLIERS } from '../ui/settings'

describe('the size an animation drops to', () => {
  /** The biggest Size at most `chosen` for a machine picture of w×h holding `held` frames. */
  const fit = (w: number, h: number, chosen: number, held: number, par: [number, number] = [1, 1], tv = false) =>
    animationMultiplier((m) => exportSize(w, h, par, m, tv), chosen, held, MULTIPLIERS)

  it('holds as many frames as the style makes', () => {
    expect(heldFrames('screen-fx', { signalLoop: null, gifFrames: 0 })).toBe(12)
    expect(heldFrames('screen-fx', { signalLoop: 48, gifFrames: 0 })).toBe(48)
    expect(heldFrames('compare-wipe', { signalLoop: 48, gifFrames: 0 })).toBe(16)
    expect(heldFrames('dither-shimmer', { signalLoop: 32, gifFrames: 0 })).toBe(8)
    expect(heldFrames('gif-frames', { signalLoop: 32, gifFrames: 58 })).toBe(58)
  })

  it('says whether one frame or all of them are too big', () => {
    expect(animationLimit(1024, 1024, 16)).toBeNull()
    expect(animationLimit(1025, 1024, 1)).toBe('frame')
    expect(animationLimit(1024, 1024, 17)).toBe('frames')
  })

  it('Deep Fry (480×360) with the 58-frame sample: only 1× fits', () => {
    expect(fit(480, 360, 4, 58)).toBe(1)
    expect(fit(480, 360, 1, 58)).toBe(1)
    expect(animationLimit(960, 720, 58)).toBe('frames')
  })

  it('Game Boy (160×144) with 58 frames: 3× is the biggest', () => {
    expect(fit(160, 144, 4, 58)).toBe(3)
    expect(fit(160, 144, 16, 58)).toBe(3)
    expect(fit(160, 144, 2, 58)).toBe(2)
  })

  it('VGA (320×200) at 8× with 16 frames drops to 4× (1280×800)', () => {
    expect(fit(320, 200, 8, 16)).toBe(4)
    const [w, h] = exportSize(320, 200, [1, 1], 4, false)
    expect(w * h).toBeLessThanOrEqual(MAX_ANIMATION_PIXELS)
    expect(w * h * 16).toBeLessThanOrEqual(MAX_ANIMATION_BUDGET)
  })

  it('counts the stretched width "as on a TV"', () => {
    // CGA 320×200 at 5:6: 6× is 1600×1200; 4× is 1067×800, which fits.
    expect(fit(320, 200, 6, 12, [5, 6], true)).toBe(4)
  })

  it('never goes past the chosen Size, or the PNG limit', () => {
    expect(fit(64, 64, 2, 16)).toBe(2)
    expect(animationMultiplier(() => [100, 100], 4, 1, [1, 2, 4])).toBe(4)
  })

  it('is null when not even 1× fits', () => {
    // A big picture in big blocks: one frame is already too big.
    expect(fit(2000, 1500, 4, 12)).toBeNull()
    // A long GIF on a big machine: every frame together is too much.
    expect(fit(480, 360, 4, 256)).toBeNull()
  })
})

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

  it('refuses animations bigger than a phone can hold, and says so', async () => {
    // 8×8 at 128× is 1024×1024 (just fits); at 129× it is past the limit.
    expect(MAX_ANIMATION_PIXELS).toBe(1024 * 1024)
    const opts = { style: 'screen-fx' as const, format: 'gif' as const, tv: false, fx: null, frameCount: 2 }
    await expect(generateAnimatedExport(dummyRendered, { ...opts, multiplier: 129 }, dummySettings)).rejects.toThrow(/too big for an animation/)
    await expect(generateAnimatedExport(dummyRendered, { ...opts, multiplier: 128 }, dummySettings)).resolves.toBeDefined()
  })

  it.each(['screen-fx', 'compare-wipe', 'dither-shimmer'] as const)('%s reports its progress frame by frame', async (style) => {
    const seen: [number, number][] = []
    const res = await generateAnimatedExport(
      dummyRendered,
      { style, format: 'gif', multiplier: 2, tv: false, fx: null, onProgress: (done, total) => seen.push([done, total]) },
      dummySettings
    )
    expect(res.frameCount).toBe(STYLE_LOOPS[style].frames)
    expect(seen.length).toBe(res.frameCount)
    expect(seen.map(([d]) => d)).toEqual(Array.from({ length: res.frameCount }, (_, i) => i + 1))
    expect(seen.every(([, t]) => t === res.frameCount)).toBe(true)
  })
})
