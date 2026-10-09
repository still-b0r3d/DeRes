import { describe, expect, it } from 'vitest'
import { testSignalEngine } from '../test/signal-engine'
import { defaultSettings, settingsFromHash } from '../ui/settings'
import { generateAnimatedExport, MAX_ANIMATION_BUDGET, signalLoopTiming } from './animate'
import { exportPng } from './export'
import { exportFilename } from './filename'
import { DEFAULT_FX } from './fx'
import type { DeresSettings, Rendered } from './pipeline'
import { decodePng } from './png'
import { encodeSettings } from './share'
import { DEFAULT_SIGNAL, runSignal, type SignalSettings } from './signal'

// The signal through the rest of DeRes: share links, saved settings, PNG
// exports and the animation loops.

const engine = testSignalEngine()

function picture(width = 32, height = 24): Rendered {
  const rgb = new Uint8Array(width * height * 3)
  for (let i = 0; i < rgb.length; i += 3) rgb.set([200, (i / 3) % 255, 60], i)
  return {
    width,
    height,
    rgb,
    indices: new Uint8Array(width * height),
    palette: Uint8Array.of(0, 0, 0, 255, 255, 255),
    used: 2,
    geometry: { width, height, src: { x: 0, y: 0, w: width, h: height }, dst: { x: 0, y: 0, w: width, h: height }, par: [1, 1] },
    paper: [255, 255, 255]
  }
}

const VHS: SignalSettings = { ...DEFAULT_SIGNAL, mode: 'vhs-sp' }
const settings: DeresSettings = {
  profileId: 'nes',
  fit: 'fill',
  resolution: 'native',
  block: 8,
  background: 'white',
  adjust: { brightness: 0, contrast: 1, saturation: 1, gamma: 1 },
  dither: 'bayer4',
  fx: { ...DEFAULT_FX },
  pixelShape: 'raw',
  signal: VHS
}
const signalFor = (s: SignalSettings) => (r: Rendered, frame: number) => runSignal(engine, r, 'nes', s, frame)!

describe('signal settings in links and storage', () => {
  it('travels in a share link when it is on', () => {
    const s = defaultSettings()
    s.signal = { mode: 'vhs-ep', wear: 0.8, colour: 0.6, sharpen: 0.1, decoder: 'comb' }
    s.loopFrames = 48
    s.loopFps = 30
    const back = settingsFromHash(encodeSettings(s), defaultSettings())!
    expect(back.signal).toEqual(s.signal)
    expect(back.loopFrames).toBe(48)
    expect(back.loopFps).toBe(30)
  })

  it('a link without it turns it off, keeping the rest of this browser\'s signal settings', () => {
    const mine = defaultSettings()
    mine.signal = { ...DEFAULT_SIGNAL, mode: 'rf', wear: 0.9 }
    const link = encodeSettings(defaultSettings())
    expect(link).not.toContain('sg')
    const back = settingsFromHash(link, mine)!
    expect(back.signal.mode).toBe('off')
    expect(back.signal.wear).toBe(0.9)
  })

  it('odd values in a link fall back', () => {
    const hash = `#s=${Buffer.from(JSON.stringify({ p: 'nes', sg: ['pal', 9, 'x', -2, 'y'], lp: [17, 60] })).toString('base64url')}`
    const back = settingsFromHash(hash, defaultSettings())!
    expect(back.signal).toEqual({ ...DEFAULT_SIGNAL, wear: 1, sharpen: 0 })
    expect(back.loopFrames).toBe(16)
    expect(back.loopFps).toBe(15)
  })
})

describe('exports with the signal', () => {
  it('a PNG export is the signal at the export size, in full colour', async () => {
    const r = picture()
    const sig = runSignal(engine, r, 'nes', VHS, 0)!
    const out = await exportPng(r, { multiplier: 4, tv: false, fx: null, signal: sig })
    expect([out.width, out.height]).toEqual([128, 96])
    const png = await decodePng(out.png)
    expect(png.colourType).toBe(2)
  })

  it('with a screen effect from 3× up, as without the signal', async () => {
    const r = picture()
    const sig = runSignal(engine, r, 'nes', VHS, 0)!
    expect((await exportPng(r, { multiplier: 4, tv: false, fx: { ...DEFAULT_FX, screen: 'crt' }, signal: sig })).fx).toBe(true)
    expect((await exportPng(r, { multiplier: 2, tv: false, fx: { ...DEFAULT_FX, screen: 'crt' }, signal: sig })).fx).toBe(false)
  })

  it('names the file for the connection', () => {
    expect(exportFilename({ base: 'cat', profileId: 'nes', width: 256, height: 240, multiplier: 4, tv: false, fx: false, signal: 'rf' })).toBe(
      'cat-nes-256x240-4x-rf.png'
    )
  })
})

describe('loops with the signal', () => {
  it('makes the chosen number of frames, with the noise moving between them', async () => {
    const res = await generateAnimatedExport(
      picture(),
      { style: 'screen-fx', format: 'apng', multiplier: 2, tv: false, fx: null, signal: signalFor(VHS), loop: { frames: 32, fps: 30 } },
      settings
    )
    expect(res.frameCount).toBe(32)
    expect([res.width, res.height]).toEqual([64, 48])
  })

  it('steps the engine two frames per loop frame at 15 fps', () => {
    expect(signalLoopTiming({ frames: 16, fps: 15 })).toEqual({ frames: 16, fps: 15, step: 2 })
    expect(signalLoopTiming(undefined)).toEqual({ frames: 16, fps: 15, step: 2 })
  })

  it('frames really differ (moving noise), and repeat for the same frame number', async () => {
    const r = picture()
    const seen: number[] = []
    const frames: Uint8Array[] = []
    await generateAnimatedExport(
      r,
      {
        style: 'screen-fx',
        format: 'gif',
        multiplier: 1,
        tv: false,
        fx: null,
        signal: (pic, frame) => {
          seen.push(frame)
          const img = signalFor(VHS)(pic, frame)
          frames.push(img.rgb)
          return img
        },
        loop: { frames: 16, fps: 15 }
      },
      settings
    )
    expect(seen).toEqual(Array.from({ length: 16 }, (_, f) => f * 2))
    expect(Buffer.from(frames[0]).equals(Buffer.from(frames[1]))).toBe(false)
    expect(Buffer.from(signalFor(VHS)(r, 0).rgb).equals(Buffer.from(frames[0]))).toBe(true)
  })

  it('refuses a loop that would hold too many pixels at once', async () => {
    const r = picture(320, 240)
    // 48 frames at 3× (960×720) is far over the budget.
    expect(3 * 320 * 3 * 240 * 48).toBeGreaterThan(MAX_ANIMATION_BUDGET)
    await expect(
      generateAnimatedExport(r, { style: 'screen-fx', format: 'gif', multiplier: 3, tv: false, fx: null, signal: signalFor(VHS), loop: { frames: 48, fps: 15 } }, settings)
    ).rejects.toThrow(/too much to hold/)
  })

  it('the wipe and the shimmer get the moving signal too', async () => {
    for (const style of ['compare-wipe', 'dither-shimmer'] as const) {
      let calls = 0
      const res = await generateAnimatedExport(
        picture(),
        {
          style,
          format: 'gif',
          multiplier: 2,
          tv: false,
          fx: null,
          signal: (pic, frame) => {
            calls++
            return signalFor(VHS)(pic, frame)
          }
        },
        settings
      )
      expect(calls).toBe(res.frameCount)
    }
  })
})
