import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { decodeGifFrames } from '../../src/core/gif-decode'
import { decodePng } from '../../src/core/png'
import { download, freshPage, readout, ready } from './helpers'

// Playing an animated GIF in the preview, and exporting its own frames. These
// run headless: a hidden browser window can stall the timers playback uses.

const counter = (page: Page) => page.getByTestId('frame-counter')
const playbar = (page: Page) => page.locator('.playbar')

test.beforeEach(async ({ page }) => {
  await freshPage(page)
})

async function openSample(page: Page) {
  await page.locator('[data-sample="rukus-gif"]').first().click()
  await expect(page.getByTestId('picture-info')).toContainText('58 frames')
  await ready(page)
}

/** The result canvas's pixels, boiled down (to tell whether it changed). */
async function resultPixels(page: Page): Promise<string> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas.result')!
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let h = 0
    for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) | 0
    return `${c.width}x${c.height}:${h}`
  })
}

/** The frame the counter shows (from 1), or null while it says "Rendering". */
async function shownFrame(page: Page): Promise<number | null> {
  const m = /^(\d+) \/ 58$/.exec((await counter(page).textContent()) ?? '')
  return m ? Number(m[1]) : null
}

test('Play and Pause: the frames move at the GIF’s speed and stop where paused', async ({ page }) => {
  await openSample(page)
  await expect(playbar(page)).toBeVisible()
  await expect(counter(page)).toHaveText('1 / 58')
  const still = await resultPixels(page)
  await page.getByTestId('play').click()
  await expect(page.getByTestId('play')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.compare-btn')).toBeDisabled()
  // Every frame is made once, then it loops from what's kept.
  await expect(playbar(page)).toHaveAttribute('data-cached', '58', { timeout: 20_000 })
  await expect.poll(async () => (await shownFrame(page)) ?? 0).toBeGreaterThan(5)
  // 58 frames take 3.87 s: about 30 in two seconds. Never faster; a busy
  // machine (tests running side by side) can make it slower.
  const a = await shownFrame(page)
  await page.waitForTimeout(2000)
  const b = await shownFrame(page)
  const moved = (b! - a! + 58) % 58
  expect(moved).toBeGreaterThanOrEqual(12)
  expect(moved).toBeLessThanOrEqual(34)

  await page.getByTestId('play').click()
  await expect(page.getByTestId('play')).toHaveAttribute('aria-pressed', 'false')
  const paused = await shownFrame(page)
  await page.waitForTimeout(500)
  expect(await shownFrame(page)).toBe(paused)
  await expect(page.locator('.compare-btn')).toBeEnabled()
  await ready(page)
  // A later frame shows on its own (frame 2 happens to look just like frame 1 on a Game Boy).
  if (paused! > 2) expect(await resultPixels(page), `paused at ${paused}`).not.toBe(still)
})

test('the frame slider goes back to the first frame, or anywhere, paused or playing', async ({ page }) => {
  await openSample(page)
  const slider = page.getByTestId('frame-slider')
  await expect(slider).toBeVisible()
  await expect(slider).toHaveAttribute('max', '57')
  const first = await resultPixels(page)
  await page.getByTestId('play').click()
  await expect(playbar(page)).toHaveAttribute('data-cached', '58', { timeout: 20_000 })
  // The slider follows the frames.
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(5)
  await page.getByTestId('play').click()

  // Paused: back to the first frame, which is what the preview shows again.
  await slider.fill('0')
  await expect(counter(page)).toHaveText('1 / 58')
  await ready(page)
  expect(await resultPixels(page)).toBe(first)

  // Anywhere else: the downloads follow.
  await slider.fill('29')
  await expect(counter(page)).toHaveText('30 / 58')
  await ready(page)
  await page.locator('.seg[aria-label="Size"] button[data-value="1"]').click()
  const { download: d } = await download(page, page.getByRole('button', { name: 'Download PNG' }))
  expect(d.suggestedFilename()).toBe('rukus-breaks-out-frame30-gameboy-160x144-1x.png')

  // Playing: it jumps there and plays on.
  await page.getByTestId('play').click()
  await slider.fill('0')
  await expect(page.getByTestId('play')).toHaveAttribute('aria-pressed', 'true')
  expect(await shownFrame(page)).toBeLessThan(15)
  await expect.poll(async () => (await shownFrame(page)) ?? 0).toBeGreaterThan(3)

  // Dragging while playing pauses, and it plays on when let go.
  const box = (await slider.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2)
  await page.mouse.down()
  await expect(page.getByTestId('play')).toHaveAttribute('aria-pressed', 'false')
  await page.mouse.move(box.x + 2, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect(page.getByTestId('play')).toHaveAttribute('aria-pressed', 'true')
})

test('a settings change drops the frames made so far; an export setting doesn’t', async ({ page }) => {
  await openSample(page)
  await page.getByTestId('play').click()
  await expect(playbar(page)).toHaveAttribute('data-cached', '58', { timeout: 20_000 })
  // The export size doesn't change the preview.
  await page.locator('.seg[aria-label="Size"] button[data-value="2"]').click()
  await page.waitForTimeout(300)
  await expect(playbar(page)).toHaveAttribute('data-cached', '58')
  // A machine does.
  await page.locator('.card[data-profile="nes"]').click()
  await expect.poll(async () => Number(await playbar(page).getAttribute('data-cached'))).toBeLessThan(58)
  await expect(playbar(page)).toHaveAttribute('data-cached', '58', { timeout: 20_000 })
  await expect(readout(page)).toContainText('256×240')
})

test('the first pass says which frame it is rendering', async ({ page }) => {
  await openSample(page)
  // The signal makes each frame slow enough to catch it.
  await page.locator('details.sec > summary', { hasText: /^Signal$/ }).click()
  await page.locator('.seg[aria-label="Signal"] button', { hasText: 'VHS EP' }).click()
  await ready(page)
  const seen = new Set<string>()
  await page.getByTestId('play').click()
  for (let i = 0; i < 60 && (await playbar(page).getAttribute('data-cached')) !== '58'; i++) {
    seen.add((await counter(page).textContent()) ?? '')
    await page.waitForTimeout(20)
  }
  expect([...seen].some((t) => /^Rendering \d+ \/ 58…$/.test(t))).toBe(true)
})

test('paused, the downloads use the frame on screen', async ({ page }) => {
  await openSample(page)
  await page.getByTestId('play').click()
  await expect.poll(async () => (await shownFrame(page)) ?? 0).toBeGreaterThan(4)
  await page.getByTestId('play').click()
  const frame = (await shownFrame(page))!
  await ready(page)
  await page.locator('.seg[aria-label="Size"] button[data-value="1"]').click()
  const { download: d, bytes } = await download(page, page.getByRole('button', { name: 'Download PNG' }))
  expect(d.suggestedFilename()).toBe(`rukus-breaks-out-frame${frame}-gameboy-160x144-1x.png`)
  const png = await decodePng(bytes)
  const shown = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas.result')!
    return [...c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data]
  })
  expect([...png.rgba]).toEqual(shown)
})

test('the GIF frames choice: only for an animated GIF, and chosen by default', async ({ page }) => {
  const choice = page.locator('.seg[aria-label="Animation loop"] button[data-value="gif-frames"]')
  await expect(choice).toBeHidden()
  await openSample(page)
  await expect(choice).toBeVisible()
  await expect(choice).toHaveAttribute('aria-pressed', 'true')
  // 4× Game Boy is 640×576: one frame is fine, 58 of them too many.
  await page.locator('.seg[aria-label="Size"] button[data-value="4"]').click()
  await expect(page.getByTestId('export-size')).toContainText('too big for 58 frames')
  await expect(page.getByTestId('download-gif')).toBeDisabled()
  // Another style loops the paused frame, as before.
  await page.locator('.seg[aria-label="Animation loop"] button[data-value="screen-fx"]').click()
  await expect(choice).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('export-size')).not.toContainText('58 frames')
  await page.locator('[data-sample="rukus"]').first().click()
  await expect(choice).toBeHidden()
})

test('a GIF export with VHS EP keeps every frame and its delay', async ({ page }) => {
  await openSample(page)
  await page.locator('details.sec > summary', { hasText: /^Signal$/ }).click()
  await page.locator('.seg[aria-label="Signal"] button', { hasText: 'VHS EP' }).click()
  await page.locator('.seg[aria-label="Size"] button[data-value="2"]').click()
  await ready(page)
  const { download: d, bytes } = await download(page, page.getByTestId('download-gif'))
  expect(d.suggestedFilename()).toBe('rukus-breaks-out-gameboy-vhs-ep.gif')
  await expect(page.locator('.status')).toContainText('58 frames')
  const { reader, frames } = decodeGifFrames(bytes)
  expect([reader.width, reader.height]).toEqual([320, 288])
  expect(reader.loopCount).toBe(0)
  expect(frames).toHaveLength(58)
  const source = decodeGifFrames(new Uint8Array(readFileSync('b0r3d-brand/rukus-breaks-out.gif')))
  expect(frames.map((f) => f.delayMs)).toEqual(source.frames.map((f) => f.delayMs))
  // The tape noise moves: frames in a row differ.
  expect(Buffer.compare(Buffer.from(frames[10].rgba), Buffer.from(frames[11].rgba))).not.toBe(0)

  // The APNG: as many frames, playing forever.
  const apng = await download(page, page.getByTestId('download-apng'))
  expect(apng.download.suggestedFilename()).toBe('rukus-breaks-out-gameboy-vhs-ep-animated.png')
  const view = new DataView(apng.bytes.buffer, apng.bytes.byteOffset)
  const actl = Buffer.from(apng.bytes).indexOf('acTL')
  expect([view.getUint32(actl + 4), view.getUint32(actl + 8)]).toEqual([58, 0])
})
