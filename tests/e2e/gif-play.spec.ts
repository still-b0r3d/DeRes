import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { decodeGifFrames } from '../../src/core/gif-decode'
import { decodePng } from '../../src/core/png'
import { download, freshPage, openSection, readout, ready } from './helpers'

// Playing an animated GIF in the preview, and exporting its own frames. These
// run headless: a hidden browser window can stall the timers playback uses.

const counter = (page: Page) => page.getByTestId('frame-counter')
// DeRes's play bar (the ASCII studio has its own).
const playbar = (page: Page) => page.locator('.deres-stage-slot .playbar')

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

/** The frame the counter shows (from 1). */
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

test('while a frame is still being made the counter dims, and the slider never changes width', async ({ page }) => {
  await openSample(page)
  // The signal makes each frame slow enough to catch it.
  await openSection(page, 'Signal')
  await page.locator('.seg[aria-label="Signal"] button', { hasText: 'VHS EP' }).click()
  await ready(page)
  // Every change of the counter, with the slider's width at that moment.
  await page.evaluate(() => {
    const seen: [string, boolean, number][] = []
    ;(window as unknown as { seen: typeof seen }).seen = seen
    const c = document.querySelector('.deres-stage-slot .frame-counter')!
    const s = document.querySelector('.deres-stage-slot .frame-slider')!
    new MutationObserver(() => seen.push([c.textContent ?? '', c.classList.contains('waiting'), s.getBoundingClientRect().width])).observe(c, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true
    })
  })
  await page.getByTestId('play').click()
  await expect(playbar(page)).toHaveAttribute('data-cached', '58', { timeout: 30_000 })
  await page.waitForTimeout(1500)
  const seen = await page.evaluate(() => (window as unknown as { seen: [string, boolean, number][] }).seen)
  expect(seen.length).toBeGreaterThan(20)
  expect(seen.some(([, waiting]) => waiting)).toBe(true)
  expect(seen.every(([text]) => /^\d+ \/ 58$/.test(text))).toBe(true)
  expect([...new Set(seen.map(([, , w]) => w))]).toHaveLength(1)
})

test('held, the slider shows the frames already made, and the sharp one comes once it’s let go', async ({ page }) => {
  await openSample(page)
  await openSection(page, 'Screen')
  await page.locator('.seg[aria-label="Screen effect"] button[data-value="crt"]').click()
  const shown = () =>
    page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('canvas.result')!
      return `${c.width}x${c.height}`
    })
  await expect.poll(shown).not.toBe('160x144')
  await ready(page)
  // Every picture the preview draws, by size.
  await page.evaluate(() => {
    const drawn: string[] = []
    ;(window as unknown as { drawn: string[] }).drawn = drawn
    const proto = CanvasRenderingContext2D.prototype as unknown as { putImageData: (this: CanvasRenderingContext2D, img: ImageData, ...rest: number[]) => void }
    const put = proto.putImageData
    proto.putImageData = function (img, ...rest) {
      if (this.canvas.classList.contains('result')) drawn.push(`${img.width}x${img.height}`)
      put.call(this, img, ...rest)
    }
  })
  const drawn = () => page.evaluate(() => (window as unknown as { drawn: string[] }).drawn.splice(0))
  const slider = page.getByTestId('frame-slider')
  const box = (await slider.boundingBox())!
  const drag = async () => {
    await page.mouse.move(box.x + 11, box.y + box.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 20; i++) {
      await page.mouse.move(box.x + 11 + ((box.width - 22) * i) / 20, box.y + box.height / 2)
      await page.waitForTimeout(40)
    }
  }

  // Never played: frames are made at the playing size as the slider passes them.
  await drawn()
  await drag()
  await page.waitForTimeout(500)
  const first = await drawn()
  expect(first.length).toBeGreaterThan(0)
  expect([...new Set(first)], JSON.stringify(first)).toHaveLength(1)
  await page.mouse.up()
  await ready(page)
  await expect(counter(page)).toHaveText('58 / 58')

  // Played once, then paused: the drag shows only kept frames, all one size,
  // and the full-size frame comes after.
  await page.getByTestId('play').click()
  await expect(playbar(page)).toHaveAttribute('data-cached', '58', { timeout: 30_000 })
  await page.getByTestId('play').click()
  await ready(page)
  await drawn()
  await drag()
  const held = await drawn()
  expect(held.length).toBeGreaterThan(10)
  expect([...new Set(held)], JSON.stringify(held)).toHaveLength(1)
  await page.mouse.up()
  await expect.poll(shown).not.toBe(held[0])
  await ready(page)
})

test('on a 320×240 machine with a screen effect, every frame is kept, so it loops smoothly', async ({ page }) => {
  await openSample(page)
  await page.locator('.card[data-profile="vhs"]').click()
  await ready(page, '320×240')
  await page.getByTestId('play').click()
  // Before, only 43 of the 58 fitted and the rest were made again on every pass.
  await expect(playbar(page)).toHaveAttribute('data-cached', '58', { timeout: 30_000 })
  // Playing a little under 2×, all in memory.
  const size = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas.result')!
    return [c.width, c.height]
  })
  expect(size).toEqual([608, 456])
})

test('the play bar fits in the window with the top of the page, and the pinned phone preview stays its size', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await openSample(page)
  const bottom = await page.evaluate(() => document.querySelector('.deres-stage-slot .playbar')!.getBoundingClientRect().bottom)
  expect(bottom).toBeLessThanOrEqual(768)

  // On a phone, the pinned part (preview, play bar, readout) is as tall as with a still.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.scrollTo(0, 0))
  const pinned = () => page.evaluate(() => Math.round(document.querySelector('.stage-col')!.getBoundingClientRect().height))
  const withGif = await pinned()
  await page.locator('[data-sample="rukus"]').first().click()
  await ready(page)
  await expect(playbar(page)).toBeHidden()
  expect(Math.abs((await pinned()) - withGif)).toBeLessThanOrEqual(2)
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
  // The GIF's frames go out one at a time, so only one frame's size counts:
  // 4× Game Boy (640×576) fits, and 16× drops to 6× (960×864).
  await page.locator('.seg[aria-label="Size"] button[data-value="16"]').click()
  await expect(page.getByTestId('anim-hint')).toHaveText('GIF and APNG come out at 6× (960×864 px): 8× and up are too big for an animation.')
  await page.locator('.seg[aria-label="Size"] button[data-value="4"]').click()
  await expect(page.getByTestId('anim-hint')).toBeHidden()
  await expect(page.getByTestId('download-gif')).toBeEnabled()
  // Another style loops the paused frame, as before (12 frames fit at 4×).
  await page.locator('.seg[aria-label="Animation loop"] button[data-value="screen-fx"]').click()
  await expect(choice).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('anim-hint')).toBeHidden()
  await page.locator('[data-sample="rukus"]').first().click()
  await expect(choice).toBeHidden()
})

test('Deep Fry at 4×: GIF and APNG stay on, come out at 2× with every frame, and say why by the buttons', async ({ page }) => {
  await openSample(page)
  await page.locator('.card[data-profile="deepfry"]').click()
  await ready(page, '480×360')
  await expect(page.locator('.seg[aria-label="Size"] button[data-value="4"]')).toHaveAttribute('aria-pressed', 'true')
  // The size line is the PNG's; the hint by the buttons is the animation's.
  await expect(page.getByTestId('export-size')).toHaveText(/^1920×1440 px · [^·]+$/)
  await expect(page.getByTestId('anim-hint')).toHaveText('GIF and APNG come out at 2× (960×720 px): 3× and up are too big for an animation.')
  await expect(page.getByTestId('download-gif')).toBeEnabled()
  await expect(page.getByTestId('download-apng')).toBeEnabled()
  const { download: d, bytes } = await download(page, page.getByTestId('download-gif'))
  expect(d.suggestedFilename()).toBe('rukus-breaks-out-deepfry.gif')
  await expect(page.locator('.status')).toContainText('(960×720, 58 frames)')
  // 58 frames at 960×720 are past what's held at once: they streamed, each
  // with its own palette, and every one is there with its delay.
  const { reader, frames } = decodeGifFrames(bytes)
  expect([reader.width, reader.height]).toEqual([960, 720])
  expect(reader.loopCount).toBe(0)
  expect(frames).toHaveLength(58)
  const source = decodeGifFrames(new Uint8Array(readFileSync('b0r3d-brand/rukus-breaks-out.gif')))
  expect(frames.map((f) => f.delayMs)).toEqual(source.frames.map((f) => f.delayMs))

  // The screen effect starts at 3×, so the hint says the animation goes without it.
  await openSection(page, 'Screen')
  await page.locator('.seg[aria-label="Screen effect"] button[data-value="crt"]').click()
  await page.locator('#export-fx').check()
  await expect(page.getByTestId('anim-hint')).toContainText('(960×720 px), without the screen effect: ')
})

test('a GIF export with VHS EP keeps every frame and its delay', async ({ page }) => {
  await openSample(page)
  await openSection(page, 'Signal')
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
