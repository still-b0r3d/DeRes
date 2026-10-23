import { describe, expect, it } from 'vitest'
import { NEUTRAL } from './adjust'
import { exportPng, exportWallpaper, wallpaperPresetById, WALLPAPER_PRESETS } from './export'
import { DEFAULT_FX } from './fx'
import { Deres, type DeresSettings } from './pipeline'
import { decodePng } from './png'

function testPicture(w: number, h: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      px[i] = (x * 17) % 256
      px[i + 1] = (y * 23) % 256
      px[i + 2] = ((x + y) * 11) % 256
      px[i + 3] = 255
    }
  }
  return px
}

const settings = (over: Partial<DeresSettings> = {}): DeresSettings => ({
  profileId: 'gameboy',
  fit: 'fill',
  resolution: 'native',
  background: 'white',
  adjust: { ...NEUTRAL },
  dither: 'floyd',
  fx: { ...DEFAULT_FX },
  pixelShape: 'raw',
  ...over
})

describe('wallpaper presets and export', () => {
  it('defines 3 distinct wallpaper presets', () => {
    expect(WALLPAPER_PRESETS.length).toBe(3)
    const ids = WALLPAPER_PRESETS.map((p) => p.id)
    expect(ids).toContain('phone')
    expect(ids).toContain('win95')
    expect(ids).toContain('desktop-1080p')

    expect(wallpaperPresetById('phone')?.width).toBe(1080)
    expect(wallpaperPresetById('phone')?.height).toBe(2400)
    expect(wallpaperPresetById('win95')?.width).toBe(1024)
    expect(wallpaperPresetById('win95')?.height).toBe(768)
    expect(wallpaperPresetById('desktop-1080p')?.width).toBe(1920)
    expect(wallpaperPresetById('desktop-1080p')?.height).toBe(1080)
    expect(wallpaperPresetById('unknown')).toBeUndefined()
  })

  it('exports crisp integer-centered wallpaper for win95 preset', async () => {
    const d = new Deres()
    d.setSource(testPicture(160, 144), 160, 144, 160, 144)
    const rendered = d.render(settings({ profileId: 'gameboy' }))

    const preset = wallpaperPresetById('win95')!
    const out = await exportWallpaper(rendered, preset, { tv: false, fx: null })

    expect(out.width).toBe(1024)
    expect(out.height).toBe(768)
    expect(out.png.length).toBeGreaterThan(0)

    const decoded = await decodePng(out.png)
    expect(decoded.width).toBe(1024)
    expect(decoded.height).toBe(768)
  })

  it('exports wallpaper with fx enabled', async () => {
    const d = new Deres()
    d.setSource(testPicture(84, 48), 84, 48, 84, 48)
    const rendered = d.render(settings({ profileId: 'nokia-3310' }))

    const preset = wallpaperPresetById('phone')!
    const out = await exportWallpaper(rendered, preset, {
      tv: false,
      fx: { ...DEFAULT_FX, screen: 'lcd' }
    })

    expect(out.width).toBe(1080)
    expect(out.height).toBe(2400)
    const decoded = await decodePng(out.png)
    expect(decoded.width).toBe(1080)
    expect(decoded.height).toBe(2400)
  })

  it('exports standard png correctly', async () => {
    const d = new Deres()
    d.setSource(testPicture(84, 48), 84, 48, 84, 48)
    const rendered = d.render(settings({ profileId: 'nokia-3310' }))
    const out = await exportPng(rendered, { multiplier: 2, tv: false, fx: null })
    expect(out.width).toBe(168)
    expect(out.height).toBe(96)
  })
})
