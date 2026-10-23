import { afterEach, describe, expect, it, vi } from 'vitest'
import { profileById } from '../core/profiles'
import {
  CAMERA_PREFS_KEY,
  cameraName,
  cameraProblem,
  checkCameraPrefs,
  CLIP_FRAMES,
  clipSize,
  DEFAULT_CAMERA_PREFS,
  FpsMeter,
  LIVE_FX_PIXELS,
  liveFxScale,
  liveInputSize,
  loadCameraPrefs,
  saveCameraPrefs
} from './camera-plan'
import { MAX_ANIMATION_BUDGET } from '../core/animate'

const choice = (id: string, more: Partial<{ resolution: 'native' | 'custom'; customWidth: number; fit: 'fill' | 'fit' | 'stretch' }> = {}) => ({
  profile: profileById(id)!,
  resolution: 'native' as const,
  fit: 'fill' as const,
  ...more
})

describe('liveInputSize', () => {
  it('grabs about 3 camera pixels per machine pixel of the part shown', () => {
    // Game Boy from a 1920×1080 camera: the middle 1200×1080 is shown at 160×144, so 0.4 of the frame.
    expect(liveInputSize(1920, 1080, choice('gameboy'))).toEqual({ width: 768, height: 432 })
  })

  it('never grabs more than the camera gives, or past 960 on the long side', () => {
    expect(liveInputSize(640, 480, choice('pc98'))).toEqual({ width: 640, height: 480 })
    const big = liveInputSize(3840, 2160, choice('vga'))
    expect(Math.max(big.width, big.height)).toBe(960)
  })

  it('goes up to 1280 for a wide custom size, so the width isn’t capped by the grab', () => {
    const r = liveInputSize(1920, 1080, choice('gameboy', { resolution: 'custom', customWidth: 640 }))
    expect(r).toEqual({ width: 1280, height: 720 })
    expect(liveInputSize(1920, 1080, choice('gameboy', { resolution: 'custom', customWidth: 200 })).width).toBeLessThanOrEqual(960)
  })
})

describe('liveFxScale', () => {
  it('steps the effect down to fit the live budget, never below 2×', () => {
    expect(liveFxScale(0, 320, 200, [1, 1], false)).toBe(0)
    expect(liveFxScale(3, 160, 144, [1, 1], false)).toBe(3)
    const s = liveFxScale(6, 320, 200, [1, 1], false)
    expect(320 * s * 200 * s).toBeLessThanOrEqual(LIVE_FX_PIXELS)
    expect(liveFxScale(8, 640, 480, [1, 1], false)).toBe(2)
  })
})

describe('clipSize', () => {
  it('holds 30 frames of the camera inside the animation budget', () => {
    const { width, height } = clipSize(1280, 720)
    expect(width * height * CLIP_FRAMES).toBeLessThanOrEqual(MAX_ANIMATION_BUDGET)
    expect(width / height).toBeCloseTo(16 / 9, 1)
    expect(clipSize(320, 240)).toEqual({ width: 320, height: 240 })
  })
})

describe('cameraProblem', () => {
  const err = (name: string) => Object.assign(new Error(name), { name })

  it('says what to do for each way the camera can fail', () => {
    expect(cameraProblem(err('NotAllowedError'), false)).toEqual({ text: expect.stringContaining('allow the camera for this site'), ownTab: false })
    expect(cameraProblem(err('NotFoundError'), false).text).toBe('No camera found.')
    expect(cameraProblem(err('OverconstrainedError'), false).text).toBe('No camera found.')
    expect(cameraProblem(err('NotReadableError'), false).text).toContain('busy in another app')
    expect(cameraProblem(err('AbortError'), true).text).toContain('busy in another app')
    expect(cameraProblem('weird', false).text).toContain('didn’t start')
  })

  it('inside another page, a refusal points at DeRes in its own tab', () => {
    expect(cameraProblem(err('NotAllowedError'), true)).toEqual({ text: 'The camera only works with DeRes open in its own tab.', ownTab: true })
  })
})

describe('cameraName', () => {
  it('names pictures and clips by the local time', () => {
    const d = new Date(2026, 9, 22, 21, 40, 5)
    expect(cameraName('camera', d)).toBe('camera-2026-10-22-2140-05')
    expect(cameraName('camera-clip', d)).toBe('camera-clip-2026-10-22-2140-05')
  })
})

describe('camera prefs', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('odd saved values fall back', () => {
    expect(checkCameraPrefs(null)).toEqual(DEFAULT_CAMERA_PREFS)
    expect(checkCameraPrefs({ facing: 'sideways', mirror: { user: 'yes', environment: true } })).toEqual({
      facing: 'environment',
      mirror: { user: true, environment: true }
    })
  })

  it('round-trips through storage, and a broken storage doesn’t throw', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) })
    saveCameraPrefs({ facing: 'user', mirror: { user: false, environment: false } })
    expect(JSON.parse(store.get(CAMERA_PREFS_KEY)!).facing).toBe('user')
    expect(loadCameraPrefs()).toEqual({ facing: 'user', mirror: { user: false, environment: false } })
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('no')
      },
      setItem: () => {
        throw new Error('no')
      }
    })
    expect(loadCameraPrefs()).toEqual(DEFAULT_CAMERA_PREFS)
    expect(() => saveCameraPrefs(DEFAULT_CAMERA_PREFS)).not.toThrow()
  })
})

describe('FpsMeter', () => {
  it('counts the frames of the last second, and calls a look slow after 2 s under 8', () => {
    const m = new FpsMeter()
    m.reset(0)
    for (let t = 0; t <= 1000; t += 40) m.frame(t)
    expect(m.fps(1000)).toBe(25)
    expect(m.slow(1000)).toBe(false)
    // Then 4 a second.
    for (let t = 1250; t <= 4000; t += 250) m.frame(t)
    expect(m.fps(4000)).toBe(4)
    expect(m.slow(4000)).toBe(true)
  })

  it('a look that never shows a frame is slow after 2 s', () => {
    const m = new FpsMeter()
    m.reset(100)
    expect(m.slow(1500)).toBe(false)
    expect(m.slow(2200)).toBe(true)
  })
})
