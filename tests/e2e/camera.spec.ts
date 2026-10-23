import { expect, test, type Page } from '@playwright/test'
import { decodeGifFrames } from '../../src/core/gif-decode'
import { decodePng } from '../../src/core/png'
import { CAMERA_PREFS_KEY } from '../../src/ui/camera-plan'
import { download, freshPage, readout, ready } from './helpers'

// The live camera. The camera tests run in the chromium-camera project
// (playwright.config.ts), whose Chromium has a fake camera (a moving test
// pattern) and says yes to it. Playwright's WebKit build for Windows has no
// camera API at all: there the button mustn't show. A real phone is the
// owner's check.

const live = (page: Page) => expect(readout(page)).toContainText(/ · \d+ fps$/)

test.describe('with a camera', () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium-camera', 'needs the fake camera')
    await freshPage(page)
  })

  test('Use camera: a live view through the machine, every control live, Stop brings the picture back', async ({ page }) => {
    const use = page.getByTestId('camera-use')
    await expect(use).toBeVisible()
    await expect(page.getByTestId('camera-info')).toHaveText('The camera picture stays on this device.')
    await use.click()
    await live(page)
    await expect(readout(page)).toContainText('160×144')
    await expect(use).toBeHidden()
    await expect(page.getByTestId('camera-stop')).toBeVisible()
    await expect(page.getByTestId('picture-info')).toHaveText(/^(Back camera|Front camera|Camera) · \d+×\d+$/)
    await expect(page.getByTestId('resolution-info')).toContainText('Each pixel averages')
    // Picking a photo and downloading wait for Stop or a snap.
    await expect(page.locator('.choose-row')).toBeHidden()
    await expect(page.getByTestId('live-export-note')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Download PNG' })).toBeDisabled()
    await expect(page.getByTestId('download-gif')).toBeDisabled()
    await expect(page.locator('.compare-btn')).toBeDisabled()
    // Frames keep coming.
    await expect.poll(async () => Number(await readout(page).getAttribute('data-fps')), { timeout: 10_000 }).toBeGreaterThan(1)

    // Another machine and a screen effect, live.
    await page.locator('.card[data-profile="nes"]').click()
    await expect(readout(page)).toContainText(/256×240 · .* fps$/)
    await page.locator('.seg[aria-label="Screen effect"] button[data-value="crt"]').click()
    const fxSize = () =>
      page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('canvas.result')!
        return c.width * c.height
      })
    // The effect is drawn smaller while live: at most 300k pixels a frame, never below 2×.
    await expect.poll(fxSize).toBeGreaterThanOrEqual(256 * 2 * 240 * 2)
    expect(await fxSize()).toBeLessThanOrEqual(300_000)

    await page.getByTestId('camera-stop').click()
    await expect(use).toBeVisible()
    await expect(page.getByTestId('picture-info')).toHaveText('rukus.png · 256×256')
    await ready(page, '256×240')
    await expect(readout(page)).not.toContainText('fps')
    expect(await page.evaluate(() => document.querySelector<HTMLVideoElement>('video.camera-video')?.srcObject ?? null)).toBeNull()
  })

  test('Snap: the frame becomes the picture, a fresh PNG, and the downloads work on it', async ({ page }) => {
    await page.getByTestId('camera-use').click()
    await live(page)
    const [w, h] = await page.evaluate(() => {
      const v = document.querySelector<HTMLVideoElement>('video.camera-video')!
      return [v.videoWidth, v.videoHeight]
    })
    await page.getByTestId('camera-snap').click()
    await expect(page.getByTestId('picture-info')).toHaveText(new RegExp(`^camera-\\d{4}-\\d{2}-\\d{2}-\\d{4}-\\d{2}\\.png · ${w}×${h}$`))
    await ready(page, '160×144')
    await expect(readout(page)).not.toContainText('fps')
    await expect(page.getByTestId('camera-use')).toBeVisible()
    expect(await page.evaluate(() => document.querySelector<HTMLVideoElement>('video.camera-video')?.srcObject ?? null)).toBeNull()

    const png = await download(page, page.getByRole('button', { name: 'Download PNG' }))
    expect(png.download.suggestedFilename()).toMatch(/^camera-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-gameboy-160x144-4x\.png$/)
    const decoded = await decodePng(png.bytes)
    expect([decoded.width, decoded.height]).toEqual([640, 576])

    // The EXIF tools see the snap: a PNG with nothing in it.
    await page.locator('#tab-scrub').click()
    // (innerText: what's shown; the last photo's hidden panels are still in the page.)
    const shown = () => page.locator('.scrub-stage-slot').evaluate((el) => (el as HTMLElement).innerText)
    await expect.poll(shown).toContain('Total Raw Tags')
    expect(await shown()).not.toContain('Embedded GPS Location Found')
    expect(await shown()).toMatch(/Total Raw Tags\s+0 metadata fields/)
  })

  test('Record: 3 seconds at 10 frames a second open like an animated GIF, and export as one', async ({ page }) => {
    test.setTimeout(120_000)
    await page.getByTestId('camera-use').click()
    await live(page)
    await page.getByTestId('camera-record').click()
    await expect(page.getByTestId('camera-record')).toHaveText(/^Recording [1-3]…$/)
    await expect(page.getByTestId('camera-snap')).toBeDisabled()
    await expect(page.getByTestId('picture-info')).toHaveText(/^camera-clip-\d{4}-\d{2}-\d{2}-\d{4}-\d{2} · \d+×\d+ · 30 frames · 3\.0 s$/, { timeout: 20_000 })
    await expect(page.getByTestId('camera-use')).toBeVisible()
    await expect(page.getByTestId('frame-counter')).toHaveText('1 / 30')
    await ready(page, '160×144')
    // The scrubber has no file for it.
    await page.locator('#tab-scrub').click()
    await expect(page.locator('.scrub-stage-slot')).toContainText('Made by the camera here: there’s no metadata to scrub.')
    await page.locator('#tab-deres').click()

    const gif = await download(page, page.getByTestId('download-gif'))
    expect(gif.download.suggestedFilename()).toMatch(/^camera-clip-.*-gameboy\.gif$/)
    const { frames } = decodeGifFrames(gif.bytes)
    expect(frames).toHaveLength(30)
    expect(new Set(frames.map((f) => f.delayMs))).toEqual(new Set([100]))
  })

  test('Mirror is remembered, Reset forgets it; leaving the tab or hiding the page turns the camera off', async ({ page }) => {
    await page.getByTestId('camera-use').click()
    await live(page)
    const mirror = page.getByTestId('camera-mirror')
    const before = await mirror.getAttribute('aria-pressed')
    await mirror.click()
    await expect(mirror).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true')
    expect(await page.evaluate((k) => localStorage.getItem(k), CAMERA_PREFS_KEY)).toContain('mirror')

    // Another tab: off.
    await page.locator('#tab-ascii').click()
    await page.locator('#tab-deres').click()
    await expect(page.getByTestId('camera-use')).toBeVisible()
    await ready(page, '160×144')
    expect(await page.evaluate(() => document.querySelector<HTMLVideoElement>('video.camera-video')?.srcObject ?? null)).toBeNull()

    // A hidden page: off.
    await page.getByTestId('camera-use').click()
    await live(page)
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await expect(page.getByTestId('camera-use')).toBeVisible()
    expect(await page.evaluate(() => document.querySelector<HTMLVideoElement>('video.camera-video')?.srcObject ?? null)).toBeNull()

    // Reset forgets the camera choices.
    const reset = page.getByTestId('reset-settings')
    await reset.click()
    await reset.click()
    expect(await page.evaluate((k) => localStorage.getItem(k), CAMERA_PREFS_KEY)).toBeNull()
  })

  test('a refused camera says what to do', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('no', 'NotAllowedError'))
    })
    await page.reload()
    await ready(page)
    await page.getByTestId('camera-use').click()
    await expect(page.getByTestId('camera-info')).toContainText('allow the camera for this site')
    await expect(page.locator('.stage-note')).toContainText('allow the camera for this site')
    await expect(page.getByTestId('camera-use')).toBeVisible()
  })

  test('inside a page that hasn’t passed the camera on, it points at DeRes in its own tab', async ({ page, baseURL }) => {
    // A frame with the camera off, as in b0r3d 95's Navigator (its frames don't pass the camera on).
    const host = `${baseURL}navigator-test.html`
    await page.route(host, (r) =>
      r.fulfill({ contentType: 'text/html', body: `<iframe src="${baseURL}" allow="camera 'none'" width="1200" height="900"></iframe>` })
    )
    await page.goto(host)
    const frame = page.frameLocator('iframe')
    await expect(frame.getByTestId('readout')).toContainText('colours used')
    await frame.getByTestId('camera-use').click()
    await expect(frame.getByTestId('camera-info')).toContainText('The camera only works with DeRes open in its own tab.')
    await expect(frame.getByTestId('camera-own-tab')).toHaveAttribute('target', '_blank')
  })
})

test('no camera API (Playwright’s WebKit on Windows): no camera button, and nothing else changes', async ({ page }, info) => {
  test.skip(info.project.name !== 'webkit', 'only WebKit here has no camera API')
  await freshPage(page)
  await expect(page.getByTestId('camera-use')).toBeHidden()
  await expect(page.getByTestId('camera-panel')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Choose photo' })).toBeVisible()
})
