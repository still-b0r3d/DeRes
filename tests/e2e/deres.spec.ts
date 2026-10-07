import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { decodePng, encodeRgbPng } from '../../src/core/png'
import { paletteBytes } from '../../src/core/pipeline'
import { PROFILES, profileById } from '../../src/core/profiles'

// End-to-end: the real page, its worker and its controls. Results are checked
// by reading canvas pixels and decoding exported PNGs, never by comparing
// screenshots (those differ from one operating system to the next).

/** A made-up test picture (no photos in this repo): a colour gradient. */
async function gradientPng(w: number, h: number): Promise<Buffer> {
  const png = await encodeRgbPng(w, h, (y, row) => {
    for (let x = 0; x < w; x++) row.set([(x * 255) / (w - 1), (y * 255) / (h - 1), 128], x * 3)
  })
  return Buffer.from(png)
}

const readout = (page: Page) => page.getByTestId('readout')

async function ready(page: Page, text: RegExp | string = /colours used/) {
  await expect(readout(page)).toContainText(text)
  await expect(page.locator('.busy')).toBeHidden()
}

/** The colours on the result canvas, as #rrggbb. */
async function canvasColours(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas.result')!
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    const seen = new Set<string>()
    for (let i = 0; i < d.length; i += 4) {
      seen.add('#' + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join(''))
    }
    return [...seen]
  })
}

async function pick(page: Page, id: string) {
  const p = profileById(id)!
  await page.locator(`.card[data-profile="${id}"]`).click()
  await ready(page, p.height === 'auto' ? `${p.width}×` : `${p.width}×${p.height}`)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await ready(page)
})

test('loads the sample and shows the Game Boy look', async ({ page }) => {
  await expect(readout(page)).toHaveText('4 of 4 colours used · 160×144 · square pixels')
  await expect(page.getByTestId('picture-info')).toHaveText('rukus.png · 256×256')
  const gbPal = profileById('gameboy')!.palette
  expect(new Set(await canvasColours(page))).toEqual(new Set(gbPal.kind === 'fixed' ? gbPal.colours : []))
  await expect(page.getByTestId('app-version')).toContainText('b0r3d DeRes v0.2.0')
  await expect(page.locator('footer a', { hasText: '← b0r3d.org' })).toHaveAttribute('href', 'https://b0r3d.org')
})

test('every machine renders at its size using only its colours', async ({ page }) => {
  for (const p of PROFILES) {
    await pick(page, p.id)
    if (p.palette.kind === 'fixed') {
      const allowed = new Set(p.palette.colours)
      // Some machines share a size, so wait for the colours themselves.
      await expect
        .poll(async () => (await canvasColours(page)).filter((c) => !allowed.has(c)), { message: p.id })
        .toEqual([])
    } else {
      await expect
        .poll(async () => (await canvasColours(page)).length, { message: p.id })
        .toBeGreaterThan(0)
    }
    await expect(page.locator(`.card[data-profile="${p.id}"]`)).toHaveAttribute('aria-pressed', 'true')
  }
})

test('every dither renders, and the camera dither is only offered on the camera', async ({ page }) => {
  await pick(page, 'c64-hires')
  await expect(page.locator('.dither[data-dither="gbcam"]')).toBeHidden()
  const seen = new Set<string>()
  for (const id of ['none', 'bayer2', 'bayer4', 'bayer8', 'floyd', 'atkinson', 'yliluoma']) {
    await page.locator(`.dither[data-dither="${id}"]`).click()
    await expect(page.locator(`.dither[data-dither="${id}"]`)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.busy')).toBeHidden()
    await page.waitForTimeout(100)
    seen.add(
      await page.evaluate(() => document.querySelector<HTMLCanvasElement>('canvas.result')!.toDataURL())
    )
  }
  expect(seen.size).toBe(7)
  await pick(page, 'gameboy-camera')
  await expect(page.locator('.dither[data-dither="gbcam"]')).toHaveAttribute('aria-pressed', 'true')
})

test('opens a picture from the file button, by paste and by drag and drop', async ({ page }) => {
  const png = await gradientPng(300, 200)
  await page.locator('#file-input').setInputFiles({ name: 'Test Card.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByTestId('picture-info')).toHaveText('Test Card.png · 300×200')
  await ready(page)

  const bytes = [...(await gradientPng(120, 90))]
  // Paste (what Ctrl+V / Cmd+V does with an image on the clipboard).
  await page.evaluate((data) => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(data)], 'image.png', { type: 'image/png' }))
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
  }, bytes)
  await expect(page.getByTestId('picture-info')).toHaveText('photo.png · 120×90')

  // Drag and drop onto the page.
  await page.evaluate((data) => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(data)], 'dropped.png', { type: 'image/png' }))
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt }))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, cancelable: true }))
  }, bytes)
  await expect(page.getByTestId('picture-info')).toHaveText('dropped.png · 120×90')
  await expect(page.locator('.drop-overlay')).toBeHidden()
})

test("says so when a file isn't a picture", async ({ page }) => {
  await page.locator('#file-input').setInputFiles({
    name: 'not-a-picture.png',
    mimeType: 'image/png',
    buffer: Buffer.from('definitely not a png')
  })
  await expect(page.locator('.stage-note')).toContainText("can't open that file")
  // The previous picture stays.
  await expect(page.getByTestId('picture-info')).toHaveText('rukus.png · 256×256')
})

test('exports a crisp indexed PNG with the exact palette', async ({ page }, info) => {
  await pick(page, 'cga-1')
  await page.locator('.seg[aria-label="Size"] button[data-value="3"]').click()
  await expect(page.getByTestId('export-size')).toHaveText('960×600 px · 4-colour palette')
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PNG' }).click()
  const download = await pending
  expect(download.suggestedFilename()).toBe('rukus-cga-1-320x200-3x.png')
  const file = info.outputPath('export.png')
  await download.saveAs(file)
  const png = await decodePng(new Uint8Array(readFileSync(file)))
  expect([png.width, png.height, png.colourType, png.bitDepth]).toEqual([960, 600, 3, 2])
  expect(png.palette).toEqual(paletteBytes(profileById('cga-1')!))
  // Every picture pixel is a 3×3 block.
  let broken = 0
  for (let y = 0; y < 600; y += 3) {
    for (let x = 0; x < 960; x += 3) {
      const v = png.indices![y * 960 + x]
      for (let d = 0; d < 9; d++) if (png.indices![(y + ((d / 3) | 0)) * 960 + x + (d % 3)] !== v) broken++
    }
  }
  expect(broken).toBe(0)
  await expect(page.locator('.status')).toContainText('Saved rukus-cga-1-320x200-3x.png')
})

test('"as on a TV" stretches the export to the pixel shape', async ({ page }) => {
  await pick(page, 'cga-1')
  await page.locator('.seg[aria-label="Pixel shape"] button[data-value="tv"]').click()
  await page.locator('.seg[aria-label="Size"] button[data-value="6"]').click()
  await expect(page.getByTestId('export-size')).toHaveText('1600×1200 px · 4-colour palette')
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PNG' }).click()
  expect((await pending).suggestedFilename()).toBe('rukus-cga-1-320x200-6x-tv.png')
})

test('sizes past ~16 megapixels are greyed out', async ({ page }) => {
  await pick(page, 'web-safe')
  await expect(page.locator('.seg[aria-label="Size"] button[data-value="6"]')).toBeEnabled()
  await expect(page.locator('.seg[aria-label="Size"] button[data-value="8"]')).toBeDisabled()
  await expect(page.locator('.seg[aria-label="Size"] button[data-value="16"]')).toBeDisabled()
})

test('screen effects: CRT and LCD previews, kept in the export from 3× up', async ({ page }) => {
  await pick(page, 'nes')
  await page.locator('summary', { hasText: 'Screen' }).click()
  await page.locator('.seg[aria-label="Screen effect"] button[data-value="crt"]').click()
  await expect
    .poll(() => page.evaluate(() => document.querySelector<HTMLCanvasElement>('canvas.result')!.width))
    .toBeGreaterThan(256 * 2)
  await page.locator('.seg[aria-label="Size"] button[data-value="2"]').click()
  await expect(page.locator('#export-fx')).toBeDisabled()
  await page.locator('.seg[aria-label="Size"] button[data-value="3"]').click()
  await page.locator('#export-fx').check()
  await expect(page.getByTestId('export-size')).toHaveText('768×720 px · full colour')
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PNG' }).click()
  expect((await pending).suggestedFilename()).toBe('rukus-nes-256x240-3x-fx.png')

  // Picking a handheld switches the effect to its LCD.
  await pick(page, 'gameboy')
  await expect(page.locator('.seg[aria-label="Screen effect"] button[data-value="lcd"]')).toHaveAttribute(
    'aria-pressed',
    'true'
  )
})

test('custom block size, framing and the transparent background', async ({ page }) => {
  await page.locator('.seg[aria-label="Resolution"] button[data-value="custom"]').click()
  await page.locator('#block').fill('16')
  await ready(page, '16×16')
  await expect(page.locator('output[for="block"]')).toHaveText('16 px → 16×16')
  await page.locator('.seg[aria-label="Resolution"] button[data-value="native"]').click()
  await ready(page, '160×144')

  // Rukus has a transparent background: white or black behind it.
  const corner = () =>
    page.evaluate(() => [...document.querySelector<HTMLCanvasElement>('canvas.result')!.getContext('2d')!.getImageData(0, 0, 1, 1).data])
  const light = await corner()
  await page.locator('.seg[aria-label="Transparent areas"] button[data-value="black"]').click()
  await expect.poll(corner).not.toEqual(light)

  // "Fit, with bars" puts the darkest colour above and below a wide photo.
  await page.locator('#file-input').setInputFiles({ name: 'wide.png', mimeType: 'image/png', buffer: await gradientPng(400, 100) })
  await expect(page.getByTestId('picture-info')).toHaveText('wide.png · 400×100')
  await page.locator('.seg[aria-label="Framing"] button[data-value="fit"]').click()
  await expect.poll(corner).toEqual([8, 24, 32, 255])
})

test('compare: divider and hold to see the original', async ({ page }) => {
  const original = page.locator('canvas.original')
  await expect(original).toBeHidden()
  // Hold.
  const frame = page.locator('.frame')
  const box = (await frame.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await expect(original).toBeVisible()
  await page.mouse.up()
  await expect(original).toBeHidden()
  // Space works too.
  await page.locator('body').focus()
  await page.keyboard.down('Space')
  await expect(original).toBeVisible()
  await page.keyboard.up('Space')
  await expect(original).toBeHidden()
  // Divider: drag it to a quarter of the way across.
  await page.getByRole('button', { name: 'Compare' }).click()
  await expect(page.locator('.divider')).toBeVisible()
  await page.mouse.move(box.x + box.width / 2, box.y + 10)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 4, box.y + 10)
  await page.mouse.up()
  const clip = await original.evaluate((el) => el.style.clipPath)
  expect(clip).toMatch(/inset\(0(px)? 7[45]/)
})

test('remembers settings, never the picture', async ({ page }) => {
  await page.locator('#file-input').setInputFiles({ name: 'mine.png', mimeType: 'image/png', buffer: await gradientPng(200, 150) })
  await expect(page.getByTestId('picture-info')).toHaveText('mine.png · 200×150')
  await pick(page, 'pico8')
  await page.locator('.dither[data-dither="atkinson"]').click()
  await page.locator('#contrast').fill('1.5')
  await page.waitForTimeout(400)
  await page.reload()
  await ready(page, '128×128')
  await expect(page.locator('.card[data-profile="pico8"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.dither[data-dither="atkinson"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('output[for="contrast"]')).toHaveText('150%')
  // The picture is the sample again: yours was never stored.
  await expect(page.getByTestId('picture-info')).toHaveText('rukus.png · 256×256')
  const stored = await page.evaluate(() => JSON.stringify(localStorage))
  expect(stored.length).toBeLessThan(2000)
})

test('phone layout: preview pinned on top, controls below, nothing wider than the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await ready(page)
  await expect(page.getByRole('button', { name: 'Choose photo' })).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 900))
  const top = await page.locator('.stage-col').evaluate((el) => el.getBoundingClientRect().top)
  expect(top).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('loads nothing from any other site', async ({ page }) => {
  const outside: string[] = []
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !/^(data|blob):/.test(r.url())) outside.push(r.url())
  })
  await page.reload()
  await ready(page)
  await pick(page, 'nes')
  await page.locator('#file-input').setInputFiles({ name: 'x.png', mimeType: 'image/png', buffer: await gradientPng(64, 64) })
  await ready(page)
  expect(outside).toEqual([])
})

test('PS1 renders with hardware dither', async ({ page }) => {
  await pick(page, 'ps1')
  await expect(page.locator('.dither[data-dither="ps1"]')).toBeVisible()
  await expect(page.locator('.dither[data-dither="ps1"]')).toHaveAttribute('aria-pressed', 'true')
  expect((await canvasColours(page)).length).toBeGreaterThan(0)
})

test('share link preserves settings in URL hash', async ({ page }) => {
  await pick(page, 'snes')
  await page.getByRole('button', { name: 'Copy share link' }).click()
  await expect(page.locator('.status')).toContainText(/Share (link copied|URL)/)
  const hash = await page.evaluate(() => window.location.hash)
  expect(hash).toContain('#s=')
})

