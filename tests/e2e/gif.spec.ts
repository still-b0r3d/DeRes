import { expect, test } from '@playwright/test'
import { buildGif } from '../../src/test/gif-builder'
import { freshPage, ready } from './helpers'

// Animated GIFs in the real page: DeRes's own decoder against the browser's,
// and what opening one says in the picture info.

const RGBK = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]

test.beforeEach(async ({ page }) => {
  await freshPage(page)
})

test('the decoder reads the sample exactly as the browser does', async ({ page }, info) => {
  const result = await page.evaluate(async () => {
    // The decoder straight from the dev server's source.
    const url = '/src/core/gif-decode.ts'
    const { GifReader } = (await import(/* @vite-ignore */ url)) as typeof import('../../src/core/gif-decode')
    const bytes = new Uint8Array(await (await fetch('/b0r3d-brand/rukus-breaks-out.gif')).arrayBuffer())
    const ours: Uint8ClampedArray[] = []
    for (const f of new GifReader(bytes).frames()) ours.push(f.rgba.slice())

    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 384
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const differences = (theirs: CanvasImageSource, mine: Uint8ClampedArray) => {
      ctx.clearRect(0, 0, 512, 384)
      ctx.drawImage(theirs, 0, 0)
      const data = ctx.getImageData(0, 0, 512, 384).data
      let n = 0
      for (let i = 0; i < data.length; i++) if (data[i] !== mine[i]) n++
      return n
    }
    // The browser's own decode of a GIF is its first frame.
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/gif' }))
    const first = differences(bitmap, ours[0])
    bitmap.close()

    // Where the browser can hand out every frame (WebCodecs), compare them all.
    let each: number[] | null = null
    if ('ImageDecoder' in window) {
      const decoder = new ImageDecoder({ data: bytes, type: 'image/gif' })
      await decoder.tracks.ready
      each = []
      for (let i = 0; i < decoder.tracks.selectedTrack!.frameCount; i++) {
        const { image } = await decoder.decode({ frameIndex: i })
        each.push(differences(image, ours[i]))
        image.close()
      }
      decoder.close()
    }
    return { frames: ours.length, first, each }
  })
  expect(result.frames).toBe(58)
  expect(result.first).toBe(0)
  // Chromium has ImageDecoder, so there every frame is compared.
  if (info.project.name === 'chromium') expect(result.each).not.toBeNull()
  if (result.each) {
    expect(result.each).toHaveLength(58)
    expect(result.each.every((n) => n === 0)).toBe(true)
  }
})

test('the sample GIF opens with all its frames', async ({ page }) => {
  await page.locator('[data-sample="rukus-gif"]').first().click()
  await expect(page.getByTestId('picture-info')).toHaveText('rukus-breaks-out.gif · 512×384 · 58 frames · 3.9 s')
  await ready(page)
  await page.getByRole('tab', { name: 'ASCII / ANSI Studio' }).click()
  await expect(page.getByTestId('ascii-picture-info')).toHaveText('rukus-breaks-out.gif · 512×384 px · 58 frames · 3.9 s')
})

test('a long GIF keeps the first frames that fit and says so', async ({ page }) => {
  // 300 frames at 256×256: the smallest size frames shrink to, and 256 of them fit.
  const blocks = Array.from({ length: 300 }, (_, k) => ({ width: 256, height: 256, indices: new Array(256 * 256).fill(k % 4) }))
  const gif = buildGif({ width: 256, height: 256, globalTable: RGBK, loop: 0, blocks })
  await page.locator('#file-input').setInputFiles({ name: 'long.gif', mimeType: 'image/gif', buffer: Buffer.from(gif) })
  await expect(page.getByTestId('picture-info')).toHaveText('long.gif · 256×256 · first 256 of 300 frames · 26 s')
  await ready(page)
})

test('a GIF whose second frame is damaged opens as a still', async ({ page }) => {
  const gif = buildGif({
    width: 8,
    height: 8,
    globalTable: RGBK,
    blocks: [
      { width: 8, height: 8, indices: new Array(64).fill(1) },
      { width: 8, height: 8, indices: [], rawData: Uint8Array.of(2, 0xff, 0xff, 0) }
    ]
  })
  await page.locator('#file-input').setInputFiles({ name: 'broken.gif', mimeType: 'image/gif', buffer: Buffer.from(gif) })
  await expect(page.getByTestId('picture-info')).toHaveText('broken.gif · 8×8 · first of 2 frames')
  await ready(page)
})
