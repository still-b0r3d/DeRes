import { expect, test, type Page } from '@playwright/test'
import { decodeGifFrames } from '../../src/core/gif-decode'
import { decodePng } from '../../src/core/png'
import { readApng } from '../../src/test/apng-frames'
import { download, freshPage, gradientPng, mugPng, openSection, ready } from './helpers'

// Kept transparency ("Transparent areas: Keep"): the preview shows a
// checkerboard through the see-through pixels, and the downloads keep them.
// Checked by reading canvas pixels and decoding the files.

const keep = (page: Page) => page.locator('.seg[aria-label="Transparent areas"] button[data-value="transparent"]')

async function openMug(page: Page) {
  await page.locator('#file-input').setInputFiles({ name: 'mug.png', mimeType: 'image/png', buffer: await mugPng(320) })
  await expect(page.getByTestId('picture-info')).toHaveText('mug.png · 320×320')
  await ready(page)
}

/** The result canvas's alpha at a spot, given as fractions of its size. */
function resultAlpha(page: Page, fx: number, fy: number): Promise<number> {
  return page.evaluate(
    ([fx, fy]) => {
      const c = document.querySelector<HTMLCanvasElement>('canvas.result')!
      return c.getContext('2d')!.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data[3]
    },
    [fx, fy]
  )
}

/** Alpha at a spot of a decoded picture (r, g, b, a per pixel), as fractions of its size. */
function alphaAt(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, fx: number, fy: number): number {
  return rgba[(Math.floor(height * fy) * width + Math.floor(width * fx)) * 4 + 3]
}

// The mug: its body's middle at (0.42, 0.5), see-through in the top left corner.
const BODY: [number, number] = [0.42, 0.5]
const CORNER: [number, number] = [0.03, 0.03]

test.beforeEach(async ({ page }) => {
  await freshPage(page)
  await openMug(page)
})

test('keep: the preview shows the checkerboard through, and a plain PNG keeps it', async ({ page }) => {
  // White by default, as before.
  await expect.poll(() => resultAlpha(page, ...CORNER)).toBe(255)
  await expect(page.getByTestId('keep-note')).toBeHidden()

  await keep(page).click()
  await expect(keep(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('keep-note')).toBeVisible()
  await expect(page.locator('.frame')).toHaveClass(/see-through/)
  expect(await page.locator('.frame').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('conic-gradient')
  await expect.poll(() => resultAlpha(page, ...CORNER)).toBe(0)
  expect(await resultAlpha(page, ...BODY)).toBe(255)

  // The Game Boy's 4 colours and one see-through entry.
  const { bytes } = await download(page, page.getByRole('button', { name: 'Download PNG' }))
  const png = await decodePng(bytes)
  expect(png.colourType).toBe(3)
  expect(png.palette!.length / 3).toBe(5)
  expect(alphaAt(png.rgba, png.width, png.height, ...CORNER)).toBe(0)
  expect(alphaAt(png.rgba, png.width, png.height, ...BODY)).toBe(255)
  expect(new Set(png.rgba.filter((_, i) => i % 4 === 3))).toEqual(new Set([0, 255]))
})

test('keep: through the CRT, in the preview and the PNG', async ({ page }) => {
  await keep(page).click()
  await openSection(page, 'Screen')
  await page.locator('.seg[aria-label="Screen effect"] button[data-value="crt"]').click()
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLCanvasElement>('canvas.result')!.width)).toBeGreaterThan(160 * 2)
  await expect.poll(() => resultAlpha(page, ...CORNER)).toBe(0)
  expect(await resultAlpha(page, ...BODY)).toBe(255)

  await page.locator('.seg[aria-label="Size"] button[data-value="3"]').click()
  await page.locator('#export-fx').check()
  const { download: d, bytes } = await download(page, page.getByRole('button', { name: 'Download PNG' }))
  expect(d.suggestedFilename()).toBe('mug-gameboy-160x144-3x-fx.png')
  const png = await decodePng(bytes)
  expect(png.colourType).toBe(6)
  expect(alphaAt(png.rgba, png.width, png.height, ...CORNER)).toBe(0)
  expect(alphaAt(png.rgba, png.width, png.height, ...BODY)).toBe(255)
})

test('keep: GIF and APNG loops', async ({ page }) => {
  await keep(page).click()
  await page.locator('.seg[aria-label="Size"] button[data-value="2"]').click()
  for (const style of ['screen-fx', 'dither-shimmer'] as const) {
    await page.locator(`.seg[aria-label="Animation loop"] button[data-value="${style}"]`).click()

    const gif = await download(page, page.getByTestId('download-gif'))
    const { frames, reader } = decodeGifFrames(gif.bytes)
    expect(frames.length).toBeGreaterThan(1)
    for (const f of frames) {
      expect(f.disposal, style).toBe(2)
      expect(alphaAt(f.rgba, reader.width, reader.height, ...CORNER), style).toBe(0)
      expect(alphaAt(f.rgba, reader.width, reader.height, ...BODY), style).toBe(255)
    }
    await expect(page.locator('.status')).toContainText('Saved')

    const apng = await readApng((await download(page, page.getByTestId('download-apng'))).bytes)
    expect(apng.frames.length).toBeGreaterThan(1)
    for (const f of apng.frames) {
      expect(alphaAt(f.rgba, apng.width, apng.height, ...CORNER), style).toBe(0)
      expect(alphaAt(f.rgba, apng.width, apng.height, ...BODY), style).toBe(255)
    }
    await expect(page.locator('.status')).toContainText('Saved')
  }
})

test('keep: Compare shows the original on the same checkerboard', async ({ page }) => {
  await keep(page).click()
  await expect.poll(() => resultAlpha(page, ...CORNER)).toBe(0)
  const frame = page.locator('.frame')
  const box = (await frame.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  const original = page.locator('canvas.original')
  await expect(original).toBeVisible()
  const corner = await original.evaluate((c: HTMLCanvasElement) => [...c.getContext('2d')!.getImageData(1, 1, 1, 1).data])
  await page.mouse.up()
  // Solid (it covers the result), and one of the checkerboard's two greys.
  expect(corner[3]).toBe(255)
  expect([0x3a, 0x26]).toContain(corner[0])
})

test('a photo with nothing see-through has no choice to make, and comes out as before', async ({ page }) => {
  await keep(page).click()
  await page.locator('#file-input').setInputFiles({ name: 'flat.png', mimeType: 'image/png', buffer: await gradientPng(320, 288) })
  await expect(page.getByTestId('picture-info')).toHaveText('flat.png · 320×288')
  await ready(page)
  await expect(page.locator('.seg[aria-label="Transparent areas"]')).toBeHidden()
  await expect(page.locator('.frame')).not.toHaveClass(/see-through/)
  const { bytes } = await download(page, page.getByRole('button', { name: 'Download PNG' }))
  const png = await decodePng(bytes)
  expect(png.palette!.length / 3).toBe(4)
  expect(png.rgba.filter((_, i) => i % 4 === 3).every((v) => v === 255)).toBe(true)
})
