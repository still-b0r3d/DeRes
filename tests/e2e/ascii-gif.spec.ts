import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { DEFAULT_ASCII_SETTINGS, exportPetsciiPrg, generateAscii, toAnsiBytes, toAnsiText, type AsciiSettings } from '../../src/core/ascii'
import { decodeGifFrames } from '../../src/core/gif-decode'
import { decodePng } from '../../src/core/png'
import { parseSauce } from '../../src/core/sauce'
import { readApng } from '../../src/test/apng-frames'
import { playAnsi } from '../../src/test/ansi-screen'
import { catchClipboard, download, freshPage, ready } from './helpers'

// An animated GIF in the ASCII / ANSI studio: playing it as text art, the
// paused frame as "the" result, the modem not clashing with the play bar,
// and the animated exports (GIF, APNG, ANSImation). Headless, as the timers
// playback uses can stall in a hidden window.

const counter = (page: Page) => page.getByTestId('ascii-frame-counter')
const playbar = (page: Page) => page.locator('.ascii-stage-container .playbar')
const play = (page: Page) => page.getByTestId('ascii-play')
const art = (page: Page) => page.locator('pre.ascii-art')

// The sample, decoded here: the page holds its frames at full size (512×384),
// so the art of frame k is generateAscii of the same pixels.
const SOURCE = decodeGifFrames(new Uint8Array(readFileSync('b0r3d-brand/rukus-breaks-out.gif')))
const asciiOf = (k: number, s: Partial<AsciiSettings> = {}) => generateAscii(SOURCE.frames[k].rgba, 512, 384, { ...DEFAULT_ASCII_SETTINGS, ...s })
/** A .ans without its SAUCE record (which has today's date in it). */
const ansBody = (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, parseSauce(bytes)!.fileSize))

test.beforeEach(async ({ page }) => {
  await freshPage(page)
  await page.locator('[data-sample="rukus-gif"]').first().click()
  await expect(page.getByTestId('picture-info')).toContainText('58 frames')
  await ready(page)
  await page.getByTestId('tab-ascii').click()
  await expect(page.getByTestId('ascii-readout')).toContainText('80×30 cells')
})

/** The frame the counter shows (from 1). */
async function shownFrame(page: Page): Promise<number> {
  const m = /^(\d+) \/ 58$/.exec((await counter(page).textContent()) ?? '')
  return m ? Number(m[1]) : 0
}

/** Waits for frame n (from 1) to be the art on screen. */
async function onScreen(page: Page, n: number): Promise<void> {
  await expect(page.locator('.ascii-stage-container')).toHaveAttribute('data-frame', String(n - 1))
}

/** Pauses on frame n (from 1) with the slider, and waits for its art. */
async function pauseOn(page: Page, n: number): Promise<void> {
  await page.getByTestId('ascii-frame-slider').fill(String(n - 1))
  await expect(counter(page)).toHaveText(`${n} / 58`)
  await onScreen(page, n)
}

/** The art on screen, colours and all. */
const shownArt = (page: Page) => art(page).innerHTML()

test('Play and Pause: the text art moves at the GIF’s speed, from memory after the first pass', async ({ page }) => {
  await expect(playbar(page)).toBeVisible()
  await expect(counter(page)).toHaveText('1 / 58')
  // The modem's buttons say something else, so the two can't be mixed up.
  await expect(play(page)).toHaveText('▶ Play')
  await expect(page.getByTestId('ascii-play-btn')).toHaveText('Dial up')
  const first = await shownArt(page)

  await play(page).click()
  await expect(play(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(playbar(page)).toHaveAttribute('data-cached', '58', { timeout: 20_000 })
  await expect.poll(() => shownFrame(page)).toBeGreaterThan(5)
  // 58 frames take 3.87 s: about 30 in two seconds, never faster. Meanwhile
  // the buttons beside the readout stay put (the colour count waits for a pause).
  const a = await shownFrame(page)
  const xs: number[] = []
  for (let i = 0; i < 8; i++) {
    xs.push((await page.getByTestId('ascii-play-btn').boundingBox())!.x)
    await page.waitForTimeout(250)
  }
  const b = await shownFrame(page)
  expect(new Set(xs).size).toBe(1)
  const moved = (b - a + 58) % 58
  expect(moved).toBeGreaterThanOrEqual(12)
  expect(moved).toBeLessThanOrEqual(34)

  await play(page).click()
  await expect(play(page)).toHaveAttribute('aria-pressed', 'false')
  const paused = await shownFrame(page)
  await onScreen(page, paused)
  const html = await shownArt(page)
  await page.waitForTimeout(500)
  expect(await shownFrame(page)).toBe(paused)
  expect(await shownArt(page)).toBe(html)
  if (paused > 3) expect(html).not.toBe(first)
})

test('a settings change drops the kept frames and plays on with the new ones', async ({ page }) => {
  await play(page).click()
  await expect(playbar(page)).toHaveAttribute('data-cached', '58', { timeout: 20_000 })
  // The picture size is for the downloads only: the frames stay.
  await page.locator('.seg[aria-label="Picture size"] button[data-value="2"]').click()
  await page.waitForTimeout(300)
  await expect(playbar(page)).toHaveAttribute('data-cached', '58')
  await page.getByRole('button', { name: '40 cols (C64/Ceefax)' }).click()
  await expect.poll(async () => Number(await playbar(page).getAttribute('data-cached'))).toBeLessThan(58)
  await expect(playbar(page)).toHaveAttribute('data-cached', '58', { timeout: 20_000 })
  await expect(play(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('ascii-readout')).toContainText('40×15 cells')
  // Every row of the art on screen is 40 characters.
  const rows = (await art(page).textContent())!.split('\n')
  expect(new Set(rows.map((r) => r.length))).toEqual(new Set([40]))
})

test('paused, copies and downloads are of the frame on screen, named for it', async ({ page }) => {
  const clipboard = await catchClipboard(page)
  await pauseOn(page, 30)
  await page.getByRole('button', { name: 'Copy ANSI Escapes' }).click()
  await expect(page.getByTestId('ascii-status')).toHaveText('Copied ANSI escape sequence text of frame 30 to clipboard.')
  expect(await clipboard()).toBe(toAnsiText(asciiOf(29)))
  expect(toAnsiText(asciiOf(29))).not.toBe(toAnsiText(asciiOf(0)))

  const ans = await download(page, page.getByTestId('ascii-download-ans'))
  expect(ans.download.suggestedFilename()).toBe('rukus-breaks-out-frame30.ans')
  expect(ansBody(ans.bytes)).toEqual(ansBody(toAnsiBytes(asciiOf(29))))
  const png = await download(page, page.getByTestId('ascii-download-png'))
  expect(png.download.suggestedFilename()).toBe('rukus-breaks-out-frame30-ansi-640x480-1x.png')

  // The first frame's files carry no frame number.
  await pauseOn(page, 1)
  await page.getByRole('button', { name: 'Copy ANSI Escapes' }).click()
  await expect(page.getByTestId('ascii-status')).toHaveText('Copied ANSI escape sequence text to clipboard.')
  expect(await clipboard()).toBe(toAnsiText(asciiOf(0)))
  const ans0 = await download(page, page.getByTestId('ascii-download-ans'))
  expect(ans0.download.suggestedFilename()).toBe('rukus-breaks-out.ans')

  // PETSCII's .prg and .seq, and Teletext's .txt, too.
  await page.getByRole('button', { name: 'PETSCII (C64)' }).click()
  await pauseOn(page, 12)
  const prg = await download(page, page.getByTestId('ascii-download-prg'))
  expect(prg.download.suggestedFilename()).toBe('rukus-breaks-out-frame12.prg')
  expect(Buffer.from(prg.bytes)).toEqual(Buffer.from(exportPetsciiPrg(asciiOf(11, { mode: 'petscii', colorMode: 'c64', columns: 40 }))))
  const seq = await download(page, page.getByTestId('ascii-download-seq'))
  expect(seq.download.suggestedFilename()).toBe('rukus-breaks-out-frame12.seq')
  await page.getByRole('button', { name: 'Teletext (Ceefax)' }).click()
  await onScreen(page, 12)
  const txt = await download(page, page.getByTestId('ascii-download-txt'))
  expect(txt.download.suggestedFilename()).toBe('rukus-breaks-out-frame12.txt')
})

test('the animated GIF and APNG: every frame with the GIF’s delays, the same pixels as each frame’s PNG', async ({ page }) => {
  test.setTimeout(120_000)
  // At 2× a frame is past an animation's limit: they drop to 1× and say so.
  await page.locator('.seg[aria-label="Picture size"] button[data-value="2"]').click()
  await expect(page.getByTestId('ascii-export-size')).toHaveText('1280×960 px')
  await expect(page.getByTestId('ascii-anim-hint')).toHaveText('GIF and APNG come out at 1× (640×480 px): 2× is too big for an animation.')
  await expect(page.getByTestId('ascii-download-gif')).toBeEnabled()
  const gif = await download(page, page.getByTestId('ascii-download-gif'))
  expect(gif.download.suggestedFilename()).toBe('rukus-breaks-out-ansi-640x480-1x.gif')
  await expect(page.getByTestId('ascii-status')).toHaveText('Saved rukus-breaks-out-ansi-640x480-1x.gif (640×480, 58 frames).')
  const { reader, frames } = decodeGifFrames(gif.bytes)
  expect([reader.width, reader.height]).toEqual([640, 480])
  expect(reader.loopCount).toBe(SOURCE.reader.loopCount)
  expect(frames).toHaveLength(58)
  expect(frames.map((f) => f.delayMs)).toEqual(SOURCE.frames.map((f) => f.delayMs))
  // ANSI art: at most 16 colours, so one small table (4 bits a pixel at most).
  expect(gif.bytes[10] & 0x07).toBeLessThanOrEqual(3)

  // Frame 30 at 1× as a PNG: the same pixels as the GIF's frame 30.
  await page.locator('.seg[aria-label="Picture size"] button[data-value="1"]').click()
  await expect(page.getByTestId('ascii-anim-hint')).toBeHidden()
  await pauseOn(page, 30)
  const png = await decodePng((await download(page, page.getByTestId('ascii-download-png'))).bytes)
  expect(Buffer.from(frames[29].rgba).equals(Buffer.from(png.rgba))).toBe(true)
  expect(Buffer.from(frames[0].rgba).equals(Buffer.from(png.rgba))).toBe(false)

  const apng = await download(page, page.getByTestId('ascii-download-apng'))
  expect(apng.download.suggestedFilename()).toBe('rukus-breaks-out-ansi-640x480-1x-animated.png')
  const read = await readApng(apng.bytes)
  expect([read.width, read.height, read.frameCount]).toEqual([640, 480, 58])
  // Indexed with the art's own colours; it plays as often as the GIF.
  expect(read.colourType).toBe(3)
  expect(read.paletteColours).toBeLessThanOrEqual(16)
  expect(read.numPlays).toBe(SOURCE.reader.loopCount === null ? 1 : SOURCE.reader.loopCount === 0 ? 0 : SOURCE.reader.loopCount + 1)
  expect(read.frames.map((f) => f.delayMs)).toEqual(SOURCE.frames.map((f) => f.delayMs))
  expect(Buffer.from(read.frames[29].rgba).equals(Buffer.from(png.rgba))).toBe(true)
})

test('the character ramp (drawn with the font) animates too, frame for frame like its PNG', async ({ page }) => {
  test.setTimeout(120_000)
  await page.getByRole('button', { name: 'Character ramp' }).click()
  await page.getByRole('button', { name: '40 cols (C64/Ceefax)' }).click()
  await expect(page.getByTestId('ascii-readout')).toContainText('40×15 cells')
  const gif = await download(page, page.getByTestId('ascii-download-gif'))
  expect(gif.download.suggestedFilename()).toBe('rukus-breaks-out-ascii-320x240-1x.gif')
  const { frames } = decodeGifFrames(gif.bytes)
  expect(frames).toHaveLength(58)
  await pauseOn(page, 20)
  const png = await decodePng((await download(page, page.getByTestId('ascii-download-png'))).bytes)
  expect([png.width, png.height]).toEqual([320, 240])
  // Exact when the font's edges leave 256 colours or fewer (the GIF is then indexed with exactly them).
  const exact = Buffer.from(frames[19].rgba).equals(Buffer.from(png.rgba))
  const diff = frames[19].rgba.reduce((n, v, i) => n + Math.abs(v - png.rgba[i]), 0) / png.rgba.length
  expect(exact || diff < 2, `mean difference ${diff}`).toBe(true)
})

test('the ANSImation: every frame drawn over the last, one SAUCE record', async ({ page }) => {
  const btn = page.getByTestId('ascii-download-ansimation')
  await expect(btn).toHaveText('Download ANSImation .ANS (58 frames)')
  const { download: d, bytes } = await download(page, btn)
  expect(d.suggestedFilename()).toBe('rukus-breaks-out-animated.ans')
  await expect(page.getByTestId('ascii-status')).toContainText('Saved rukus-breaks-out-animated.ans (58 frames, ')
  const sauce = parseSauce(bytes)!
  expect([sauce.tInfo1, sauce.tInfo2, sauce.author, sauce.group, sauce.title]).toEqual([80, 30, '', 'b0r3d.org', 'rukus-breaks-out'])
  const played = playAnsi(bytes, 80, 30)
  expect(played.frames).toHaveLength(58)
  // One clear screen, at the start.
  expect(played.codes.J).toBe(1)
  // Every screen is that frame's own .ans, colour for colour.
  for (const k of [0, 1, 29, 57]) expect(played.frames[k], `frame ${k + 1}`).toEqual(playAnsi(toAnsiBytes(asciiOf(k)), 80, 30).frames[0])
  expect(played.frames[29]).not.toEqual(played.frames[0])
  // PETSCII and Teletext have no .ans.
  await page.getByRole('button', { name: 'PETSCII (C64)' }).click()
  await expect(btn).toBeHidden()
})

test('the modem and the play bar never run together, and the modem types out the frame on screen', async ({ page }) => {
  const dial = page.getByTestId('ascii-play-btn')
  const progress = page.getByTestId('ascii-baud-progress')
  await play(page).click()
  await expect.poll(() => shownFrame(page)).toBeGreaterThan(3)
  // Dialling pauses the GIF.
  await dial.click()
  await expect(dial).toHaveText('Hang up')
  await expect(play(page)).toHaveAttribute('aria-pressed', 'false')
  const frame = await shownFrame(page)
  await page.waitForTimeout(400)
  expect(await shownFrame(page)).toBe(frame)
  await expect(progress).toContainText('9600 baud')
  await expect(progress).not.toContainText('100%')
  // Playing stops the modem, and the frame shows whole.
  await play(page).click()
  await expect(dial).toHaveText('Dial up')
  await expect(progress).toContainText('100%')
  await play(page).click()

  // Paused on frame 30, the fastest modem types out frame 30.
  await pauseOn(page, 30)
  const whole = await shownArt(page)
  await page.getByTestId('ascii-baud-select').selectOption('28800')
  await expect(dial).toHaveText('Hang up')
  await expect(progress).not.toContainText('100%')
  // The count is padded, so the buttons stay put while it goes up.
  const boxes = [await progress.boundingBox(), await dial.boundingBox()]
  await page.waitForTimeout(200)
  if (!(await progress.textContent())!.includes('100%')) expect([await progress.boundingBox(), await dial.boundingBox()]).toEqual(boxes)
  await expect(progress).toContainText('100%', { timeout: 10_000 })
  await expect(dial).toHaveText('Dial up')
  await expect(counter(page)).toHaveText('30 / 58')
  // The same characters in the same colours (typed out, they're no longer split into rows).
  const colours = (html: string) => [...html.matchAll(/style="([^"]*)">([^<]*)</g)].map(([, style, text]) => [...text].map(() => style)).flat()
  expect(colours(await shownArt(page))).toEqual(colours(whole))
  // A frame picked on the play bar shows at once, not typed out.
  await pauseOn(page, 10)
  await expect(progress).toContainText('100%')
  await expect(dial).toHaveText('Dial up')
})

test('each preview opens on the frame the other was paused on; switching tabs pauses playback', async ({ page }) => {
  await play(page).click()
  await expect.poll(() => shownFrame(page)).toBeGreaterThan(3)
  await page.getByTestId('tab-deres').click()
  await expect(play(page)).toHaveAttribute('aria-pressed', 'false')
  const ascii = await shownFrame(page)
  // DeRes opens on the ASCII studio's frame, and downloads it.
  await expect(page.getByTestId('frame-counter')).toHaveText(`${ascii} / 58`)
  await ready(page)
  await page.locator('.seg[aria-label="Size"] button[data-value="1"]').click()
  const { download: d } = await download(page, page.getByRole('button', { name: 'Download PNG' }))
  expect(d.suggestedFilename()).toBe(ascii === 1 ? 'rukus-breaks-out-gameboy-160x144-1x.png' : `rukus-breaks-out-frame${ascii}-gameboy-160x144-1x.png`)

  // And the other way round.
  await page.getByTestId('frame-slider').fill('41')
  await expect(page.getByTestId('frame-counter')).toHaveText('42 / 58')
  await ready(page)
  await page.getByTestId('tab-ascii').click()
  await expect(counter(page)).toHaveText('42 / 58')
  await onScreen(page, 42)
  const ans = await download(page, page.getByTestId('ascii-download-ans'))
  expect(ans.download.suggestedFilename()).toBe('rukus-breaks-out-frame42.ans')
  expect(ansBody(ans.bytes)).toEqual(ansBody(toAnsiBytes(asciiOf(41))))
})

test('a still picture has no play bar and no animated downloads', async ({ page }) => {
  await page.locator('#ascii-controls-col [data-sample="rukus"]').click()
  await expect(page.getByTestId('ascii-picture-info')).toHaveText(/^rukus\.png · /)
  await expect(playbar(page)).toBeHidden()
  await expect(page.getByTestId('ascii-download-gif')).toBeHidden()
  await expect(page.getByTestId('ascii-download-ansimation')).toBeHidden()
  await expect(page.getByTestId('ascii-anim-hint')).toBeHidden()
  await expect(page.getByTestId('ascii-download-png')).toBeEnabled()
})
