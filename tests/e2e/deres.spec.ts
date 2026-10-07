import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { crc32, decodePng, encodeRgbPng } from '../../src/core/png'
import { paletteBytes } from '../../src/core/pipeline'
import { PROFILES, profileById } from '../../src/core/profiles'
import { parseSauce } from '../../src/core/sauce'

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
  await expect(readout(page)).toContainText('4 of 4 colours used · 160×144 · square pixels')
  await expect(page.getByTestId('picture-info')).toHaveText('rukus.png · 256×256')
  const gbPal = profileById('gameboy')!.palette
  expect(new Set(await canvasColours(page))).toEqual(new Set(gbPal.kind === 'fixed' ? gbPal.colours : []))
  await expect(page.getByTestId('app-version')).toContainText('b0r3d DeRes v0.7.0')
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

test('v0.3: ZX Spectrum renders attribute clash and offers .scr download', async ({ page }) => {
  await pick(page, 'zx-spectrum')
  await expect(page.getByTestId('tile-fit')).toBeVisible()
  await expect(page.getByTestId('tile-fit')).toContainText('tiles')
  await expect(page.getByTestId('download-scr')).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('download-scr').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('rukus-zx-spectrum.scr')
})

test('v0.3: C64 Multicolour renders and offers .koa download', async ({ page }) => {
  await pick(page, 'c64-mc')
  await expect(page.getByTestId('tile-fit')).toBeVisible()
  await expect(page.getByTestId('download-koa')).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('download-koa').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('rukus-c64-mc.koa')
})

test('v0.3: Game Boy offers .chr tile export', async ({ page }) => {
  await pick(page, 'gameboy')
  await expect(page.getByTestId('download-chr')).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('download-chr').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('rukus-gameboy.chr')
})

test('v0.3: Amiga HAM6 and N64 render authentically', async ({ page }) => {
  await pick(page, 'amiga-ham6')
  expect((await canvasColours(page)).length).toBeGreaterThan(0)
  await pick(page, 'n64')
  expect((await canvasColours(page)).length).toBeGreaterThan(0)
})

test('v0.4: tab switching between DeRes and ASCII / ANSI Studio', async ({ page }) => {
  await page.getByTestId('tab-ascii').click()
  await expect(page.getByTestId('tab-ascii')).toHaveClass(/active/)
  await expect(page.getByTestId('tab-ascii')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('ascii-readout')).toContainText('cells')

  const asciiArt = page.locator('pre.ascii-art')
  await expect(asciiArt).toBeVisible()
  const text = await asciiArt.textContent()
  expect(text).toContain('▀')

  await page.getByTestId('tab-deres').click()
  await expect(page.getByTestId('tab-deres')).toHaveClass(/active/)
  await expect(readout(page)).toBeVisible()
})

test('v0.4: ASCII studio supports mode and column preset switches', async ({ page }) => {
  await page.getByTestId('tab-ascii').click()
  await page.getByRole('button', { name: 'Character ramp' }).click()
  await page.getByRole('button', { name: 'Blocks' }).click()

  const asciiArt = page.locator('pre.ascii-art')
  await expect.poll(async () => await asciiArt.textContent()).toMatch(/[░▒▓█]/)

  await page.getByRole('button', { name: '132 cols' }).click()
  await expect(page.getByTestId('ascii-readout')).toContainText('132×')
})

test('v0.4: ASCII studio downloads .ans with valid SAUCE record and rendered PNG', async ({ page }) => {
  await page.getByTestId('tab-ascii').click()

  // 1. Download .ans with SAUCE
  const ansDownloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /Download \.ANS/ }).click()
  const ansDownload = await ansDownloadPromise
  expect(ansDownload.suggestedFilename()).toBe('rukus.ans')

  const ansPath = await ansDownload.path()
  if (ansPath) {
    const bytes = new Uint8Array(readFileSync(ansPath))
    const sauce = parseSauce(bytes)
    expect(sauce).not.toBeNull()
    expect(sauce?.author).toBe('still_b0r3d')
    expect(sauce?.fontName).toBe('IBM VGA')
  }

  // 2. Download rendered PNG
  const pngDownloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '2× (1280px)' }).click()
  const pngDownload = await pngDownloadPromise
  expect(pngDownload.suggestedFilename()).toContain('rukus-ansi-')
  expect(pngDownload.suggestedFilename()).toContain('-2x.png')

  const pngPath = await pngDownload.path()
  if (pngPath) {
    const pngBytes = new Uint8Array(readFileSync(pngPath))
    const decoded = await decodePng(pngBytes)
    expect(decoded.width).toBe(80 * 8 * 2) // 1280
  }
})

test('v0.4: ASCII studio clipboard buttons trigger status update', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-write', 'clipboard-read']).catch(() => {})
  await page.getByTestId('tab-ascii').click()
  const status = page.getByTestId('ascii-status')

  await page.getByRole('button', { name: 'Copy Text' }).click()
  await expect(status).toContainText(/(Copied plain text|clipboard)/)

  await page.getByRole('button', { name: 'Copy Markdown' }).click()
  await expect(status).toContainText(/(Copied Markdown|clipboard)/)

  await page.getByRole('button', { name: 'Copy ANSI' }).click()
  await expect(status).toContainText(/(Copied ANSI|clipboard)/)

  await page.getByRole('button', { name: 'Copy HTML' }).click()
  await expect(status).toContainText(/(Copied HTML|clipboard)/)
})

test('v0.5: switches to EXIF Scrubber tab and displays inspector and narrative', async ({ page }) => {
  await page.getByTestId('tab-scrub').click()
  await expect(page.getByTestId('tab-scrub')).toHaveClass(/active/)
  await expect(page.getByTestId('tab-scrub')).toHaveAttribute('aria-selected', 'true')

  // Inspector and preview
  await expect(page.getByTestId('scrub-preview-img')).toBeVisible()
  await expect(page.getByTestId('scrub-narrative')).toBeVisible()
  await expect(page.getByTestId('scrub-table')).toBeVisible()
  await expect(page.getByTestId('scrub-table')).toContainText('PNG')
  await expect(page.getByTestId('scrub-download-btn')).toBeEnabled()
})

test('v0.5: scrubs photo and downloads clean output with self-check verification', async ({ page }) => {
  await page.getByTestId('tab-scrub').click()

  // Verify options
  const radioAll = page.locator('#scrub-mode-all')
  await expect(radioAll).toBeChecked()

  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('scrub-download-btn').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('rukus-clean.png')

  // Self-check verification badge
  const check = page.getByTestId('scrub-self-check')
  await expect(check).toBeVisible()
  await expect(check).toContainText('✓ Verified Clean')
  await expect(check).toContainText('Checked: 0 GPS coordinates')

  const status = page.getByTestId('scrub-status')
  await expect(status).toContainText('Cleaned and saved')
})

test('v0.5: opens photo with GPS and displays coordinates with 1-click copy', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-write', 'clipboard-read']).catch(() => {})

  const basePng = await gradientPng(20, 20)
  // Build TIFF with GPS:
  const tiff = new Uint8Array(180)
  tiff[0] = 0x49; tiff[1] = 0x49; tiff[2] = 0x2a; tiff[3] = 0x00
  tiff[4] = 0x08; tiff[5] = 0x00; tiff[6] = 0x00; tiff[7] = 0x00
  // IFD0: 2 entries
  tiff[8] = 0x02; tiff[9] = 0x00
  // Entry 1: Make 0x010f, ASCII, count 5, offset 38
  tiff[10] = 0x0f; tiff[11] = 0x01; tiff[12] = 0x02; tiff[13] = 0x00
  tiff[14] = 0x05; tiff[15] = 0x00; tiff[16] = 0x00; tiff[17] = 0x00
  tiff[18] = 38; tiff[19] = 0x00; tiff[20] = 0x00; tiff[21] = 0x00
  // Entry 2: GPSInfo 0x8825, LONG, count 1, offset 44
  tiff[22] = 0x25; tiff[23] = 0x88; tiff[24] = 0x04; tiff[25] = 0x00
  tiff[26] = 0x01; tiff[27] = 0x00; tiff[28] = 0x00; tiff[29] = 0x00
  tiff[30] = 44; tiff[31] = 0x00; tiff[32] = 0x00; tiff[33] = 0x00
  // "Acme\0" at offset 38
  tiff[38] = 0x41; tiff[39] = 0x63; tiff[40] = 0x6d; tiff[41] = 0x65; tiff[42] = 0x00
  // GPS IFD at offset 44
  tiff[44] = 0x04; tiff[45] = 0x00 // 4 tags
  // G1: 0x0001 (LatRef), ASCII, count 2, value "N\0"
  tiff[46] = 0x01; tiff[47] = 0x00; tiff[48] = 0x02; tiff[49] = 0x00
  tiff[50] = 0x02; tiff[51] = 0x00; tiff[52] = 0x00; tiff[53] = 0x00
  tiff[54] = 0x4e; tiff[55] = 0x00; tiff[56] = 0x00; tiff[57] = 0x00
  // G2: 0x0002 (Lat), RATIONAL, count 3, offset 98
  tiff[58] = 0x02; tiff[59] = 0x00; tiff[60] = 0x05; tiff[61] = 0x00
  tiff[62] = 0x03; tiff[63] = 0x00; tiff[64] = 0x00; tiff[65] = 0x00
  tiff[66] = 98; tiff[67] = 0x00; tiff[68] = 0x00; tiff[69] = 0x00
  // G3: 0x0003 (LonRef), ASCII, count 2, value "W\0"
  tiff[70] = 0x03; tiff[71] = 0x00; tiff[72] = 0x02; tiff[73] = 0x00
  tiff[74] = 0x02; tiff[75] = 0x00; tiff[76] = 0x00; tiff[77] = 0x00
  tiff[78] = 0x57; tiff[79] = 0x00; tiff[80] = 0x00; tiff[81] = 0x00
  // G4: 0x0004 (Lon), RATIONAL, count 3, offset 122
  tiff[82] = 0x04; tiff[83] = 0x00; tiff[84] = 0x05; tiff[85] = 0x00
  tiff[86] = 0x03; tiff[87] = 0x00; tiff[88] = 0x00; tiff[89] = 0x00
  tiff[90] = 122; tiff[91] = 0x00; tiff[92] = 0x00; tiff[93] = 0x00
  // Latitude values at 98..121 (3 rationals: 37/1, 46/1, 29/1)
  const view = new DataView(tiff.buffer)
  view.setUint32(98, 37, true); view.setUint32(102, 1, true)
  view.setUint32(106, 46, true); view.setUint32(110, 1, true)
  view.setUint32(114, 29, true); view.setUint32(118, 1, true)
  // Longitude values at 122..145 (3 rationals: 122/1, 25/1, 9/1)
  view.setUint32(122, 122, true); view.setUint32(126, 1, true)
  view.setUint32(130, 25, true); view.setUint32(134, 1, true)
  view.setUint32(138, 9, true); view.setUint32(142, 1, true)

  const tiffSlice = tiff.subarray(0, 146)
  // PNG eXIf chunk: 4 len + 4 'eXIf' + payload + 4 crc
  const chunk = new Uint8Array(4 + 4 + tiffSlice.length + 4)
  const cView = new DataView(chunk.buffer)
  cView.setUint32(0, tiffSlice.length, false)
  chunk[4] = 0x65; chunk[5] = 0x58; chunk[6] = 0x49; chunk[7] = 0x66
  chunk.set(tiffSlice, 8)
  const crc = crc32(chunk.subarray(4, 8 + tiffSlice.length))
  cView.setUint32(8 + tiffSlice.length, crc, false)

  const pngWithGps = Buffer.concat([basePng.subarray(0, 33), chunk, basePng.subarray(33)])

  await page.locator('#file-input').setInputFiles({ name: 'photo-with-gps.png', mimeType: 'image/png', buffer: pngWithGps })
  await page.getByTestId('tab-scrub').click()

  // GPS alert visible
  const gpsAlert = page.getByTestId('scrub-gps-alert')
  await expect(gpsAlert).toBeVisible()
  const copyBtn = page.getByTestId('copy-gps-btn')
  await expect(copyBtn).toBeVisible()
  await copyBtn.click()
  await expect(copyBtn).toHaveText(/Copied!/)
})

test('v0.6: analog profiles (CCD, Deep Fry, Newspaper, Risograph, Fax) render correctly', async ({ page }) => {
  // Early CCD Camera
  await pick(page, 'ccd-early')
  await expect(readout(page)).toContainText('640×480')
  const ccdColours = await canvasColours(page)
  expect(ccdColours.length).toBeGreaterThan(10)

  // JPEG Deep Fry
  await pick(page, 'deepfry')
  await expect(readout(page)).toContainText('480×360')
  const dfColours = await canvasColours(page)
  expect(dfColours.length).toBeGreaterThan(10)

  // Newspaper Halftone
  await pick(page, 'newspaper')
  await expect(readout(page)).toContainText('400×500')
  const newsColours = await canvasColours(page)
  expect(newsColours.length).toBeGreaterThan(5)

  // Two-Ink Risograph
  await pick(page, 'risograph')
  await expect(readout(page)).toContainText('400×500')
  const risoColours = await canvasColours(page)
  expect(risoColours.length).toBeGreaterThan(5)

  // 1-Bit Fax Machine
  await pick(page, 'fax')
  await expect(readout(page)).toContainText('408×392')
  const faxColours = await canvasColours(page)
  expect(faxColours.length).toBeGreaterThanOrEqual(2)
})

test('v0.6: VHS mode applies tracking lines, PLAY ▶ OSD, and exports with effect baked in', async ({ page }) => {
  await pick(page, 'vhs')
  await expect(readout(page)).toContainText('320×240')

  // Open Screen details section
  const screenSummary = page.locator('details.sec summary', { hasText: 'Screen' })
  await screenSummary.click()

  // Verify VHS screen effect is selected
  const vhsScreenBtn = page.locator('.seg[aria-label="Screen effect"] button[data-value="vhs"]')
  if ((await vhsScreenBtn.getAttribute('aria-pressed')) !== 'true') {
    await vhsScreenBtn.click()
  }
  await expect(vhsScreenBtn).toHaveAttribute('aria-pressed', 'true')

  // Check that VHS controls are visible
  await expect(page.locator('#fx-vhs-tracking')).toBeVisible()
  await expect(page.locator('#fx-vhs-osd')).toBeVisible()

  // Export at 3× with screen effect
  await page.locator('.seg[aria-label="Size"] button[data-value="3"]').click()
  const fxCheck = page.locator('#export-fx')
  await expect(fxCheck).toBeEnabled()
  if (!(await fxCheck.isChecked())) {
    await fxCheck.click()
  }

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PNG' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toContain('vhs')
  expect(download.suggestedFilename()).toContain('fx')
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const png = await decodePng(Buffer.concat(chunks))
  expect(png.width).toBe(960)
  expect(png.height).toBe(720)
})

test('v0.6: Monochrome phosphors (P1 Green, P3 Amber, P4 White) and Composite chroma bleed render', async ({ page }) => {
  // Open Screen section
  await page.locator('details.sec summary', { hasText: 'Screen' }).click()

  // P1 Green
  await page.locator('.seg[aria-label="Screen effect"] button[data-value="p1-green"]').click()
  await page.waitForTimeout(100)
  const p1Colours = await canvasColours(page)
  expect(p1Colours.length).toBeGreaterThan(0)

  // P3 Amber
  await page.locator('.seg[aria-label="Screen effect"] button[data-value="p3-amber"]').click()
  await page.waitForTimeout(100)
  const p3Colours = await canvasColours(page)
  expect(p3Colours.length).toBeGreaterThan(0)

  // P4 White
  await page.locator('.seg[aria-label="Screen effect"] button[data-value="p4-white"]').click()
  await page.waitForTimeout(100)
  const p4Colours = await canvasColours(page)
  expect(p4Colours.length).toBeGreaterThan(0)

  // Composite
  await page.locator('.seg[aria-label="Screen effect"] button[data-value="composite"]').click()
  await page.waitForTimeout(100)
  const compColours = await canvasColours(page)
  expect(compColours.length).toBeGreaterThan(0)
})

test('v0.7: Extended hardware & handheld profiles render correctly', async ({ page }) => {
  // Nokia 3310
  await pick(page, 'nokia-3310')
  await expect(readout(page)).toContainText('84×48')
  const nokiaColours = await canvasColours(page)
  for (const c of nokiaColours) {
    expect(['#1c281a', '#879b6f']).toContain(c)
  }

  // Game Boy Color per-tile mode & .chr button
  await pick(page, 'gbc')
  await expect(readout(page)).toContainText('160×144')
  await expect(page.getByTestId('download-chr')).toBeVisible()

  // Virtual Boy
  await pick(page, 'virtualboy')
  await expect(readout(page)).toContainText('384×224')
  const vbColours = await canvasColours(page)
  for (const c of vbColours) {
    expect(['#000000', '#460000', '#8c0000', '#ff0000']).toContain(c)
  }

  // Atari ST
  await pick(page, 'atari-st')
  await expect(readout(page)).toContainText('320×200')

  // Amstrad CPC Modes 0 & 1
  await pick(page, 'amstrad-cpc-0')
  await expect(readout(page)).toContainText('160×200')
  await pick(page, 'amstrad-cpc-1')
  await expect(readout(page)).toContainText('320×200')

  // MSX Screen 2
  await pick(page, 'msx-screen2')
  await expect(readout(page)).toContainText('256×192')

  // CGA Composite
  await pick(page, 'cga-composite')
  await expect(readout(page)).toContainText('320×200')

  // Digipal LCD Pet
  await pick(page, 'digipal')
  await expect(readout(page)).toContainText('32×32')
  const digiColours = await canvasColours(page)
  for (const c of digiColours) {
    expect(['#1b2216', '#b8c599']).toContain(c)
  }
})

test('v0.7: Wallpaper presets download at expected dimensions', async ({ page }) => {
  // Test Phone wallpaper download
  const downloadPhonePromise = page.waitForEvent('download')
  await page.getByTestId('export-wall-phone').click()
  const phoneDownload = await downloadPhonePromise
  expect(phoneDownload.suggestedFilename()).toContain('phone-wallpaper')
  const phoneStream = await phoneDownload.createReadStream()
  const phoneChunks: Buffer[] = []
  for await (const chunk of phoneStream) phoneChunks.push(Buffer.from(chunk))
  const phonePng = await decodePng(Buffer.concat(phoneChunks))
  expect(phonePng.width).toBe(1080)
  expect(phonePng.height).toBe(2400)

  // Test Win95 wallpaper download
  const downloadWinPromise = page.waitForEvent('download')
  await page.getByTestId('export-wall-win95').click()
  const winDownload = await downloadWinPromise
  expect(winDownload.suggestedFilename()).toContain('win95-wallpaper')
  const winStream = await winDownload.createReadStream()
  const winChunks: Buffer[] = []
  for await (const chunk of winStream) winChunks.push(Buffer.from(chunk))
  const winPng = await decodePng(Buffer.concat(winChunks))
  expect(winPng.width).toBe(1024)
  expect(winPng.height).toBe(768)
})

test('v0.7: Surprise me randomizer button shuffles profile and settings', async ({ page }) => {
  const initialProfile = await page.locator('.card[aria-pressed="true"]').getAttribute('data-profile')
  expect(initialProfile).toBe('gameboy')
  const surpriseBtn = page.getByTestId('surprise-btn')
  await expect(surpriseBtn).toBeVisible()

  // Click surprise me multiple times if needed until a new profile is chosen
  await surpriseBtn.click()
  await ready(page)
  const newProfile = await page.locator('.card[aria-pressed="true"]').getAttribute('data-profile')
  expect(newProfile).toBeDefined()
})



