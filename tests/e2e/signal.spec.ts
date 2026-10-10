import { expect, test, type Page } from '@playwright/test'
import { decodePng } from '../../src/core/png'
import { profileById } from '../../src/core/profiles'
import { download, readout, ready } from './helpers'

// The Signal step in the real page: the engine (WebAssembly) loads in the
// worker only when the signal is switched on, the preview shows it, and the
// PNG, the loops and share links carry it.

const signalButton = (page: Page, name: string) => page.locator('.seg[aria-label="Signal"] button', { hasText: name })

async function openSignal(page: Page) {
  const sec = page.locator('details.sec', { has: page.locator('> summary', { hasText: /^Signal$/ }) })
  if (!(await sec.evaluate((d: HTMLDetailsElement) => d.open))) await sec.locator('> summary').click()
}

/** How many colours the preview shows (a palette picture has a few; the signal hundreds). */
async function previewColours(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas.result')!
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    const seen = new Set<number>()
    for (let i = 0; i < d.length; i += 4) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
    return seen.size
  })
}

async function pick(page: Page, id: string) {
  const p = profileById(id)!
  await page.locator(`.card[data-profile="${id}"]`).click()
  await ready(page, `${p.width}×${p.height}`)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await ready(page)
})

test('the engine loads only when the signal is turned on, and the preview shows it', async ({ page }) => {
  const wasm: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('deres_signal')) wasm.push(r.url())
  })
  const before = await previewColours(page)
  expect(before).toBeLessThanOrEqual(4)
  expect(wasm).toEqual([])

  await pick(page, 'nes')
  await openSignal(page)
  await signalButton(page, "Machine's own").click()
  await expect(page.getByTestId('signal-note')).toHaveText(/^The NES over RF \(aerial socket\)\./)
  await expect.poll(() => previewColours(page), { timeout: 20_000 }).toBeGreaterThan(200)
  expect(wasm.some((u) => u.endsWith('.wasm'))).toBe(true)
  await expect(readout(page)).toContainText('256×240')

  // Off again: back to the machine's own colours.
  await signalButton(page, 'Off').click()
  await expect.poll(() => previewColours(page)).toBeLessThanOrEqual(55)
})

test('a PNG export carries the signal and says so in its name', async ({ page }) => {
  await pick(page, 'genesis')
  await openSignal(page)
  await signalButton(page, 'VHS SP').click()
  await expect(page.getByTestId('export-size')).toContainText('through a VHS tape (SP)')
  await page.locator('.seg[aria-label="Size"] button[data-value="2"]').click()
  const { download: d, bytes } = await download(page, page.getByRole('button', { name: 'Download PNG' }))
  expect(d.suggestedFilename()).toBe('rukus-genesis-320x224-2x-vhs-sp.png')
  const png = await decodePng(bytes)
  expect([png.width, png.height]).toEqual([640, 448])
  expect(png.colourType).toBe(2)
})

test('a signal loop is as long as asked, within what a phone can hold', async ({ page }) => {
  await pick(page, 'nes')
  await openSignal(page)
  await signalButton(page, 'Composite').click()
  const rows = page.getByTestId('loop-rows')
  await expect(rows).toBeVisible()
  await page.locator('.seg[aria-label="Size"] button[data-value="2"]').click()
  await page.locator('.seg[aria-label="Loop length"] button[data-value="32"]').click()

  // 4× NES (1024×960) is fine for one frame but not for 32 of them: the
  // loop comes out at 2×, and says so by the buttons.
  await page.locator('.seg[aria-label="Size"] button[data-value="4"]').click()
  await expect(page.getByTestId('export-size')).not.toContainText('frames')
  await expect(page.getByTestId('anim-hint')).toHaveText('GIF and APNG come out at 2× (512×480 px): 3× and up are too big for 32 frames.')
  await expect(page.getByTestId('download-gif')).toBeEnabled()
  const { download: d, bytes } = await download(page, page.getByTestId('download-gif'))
  expect(d.suggestedFilename()).toBe('rukus-nes-screen-fx-composite-loop.gif')
  await expect(page.locator('.status')).toContainText('(512×480, 32 frames)')
  expect([bytes[6] | (bytes[7] << 8), bytes[8] | (bytes[9] << 8)]).toEqual([512, 480])
  // Count the GIF's frames: one image descriptor (0x2C) after each graphic control block.
  let frames = 0
  for (let i = 0; i + 8 < bytes.length; i++) {
    if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04 && bytes[i + 7] === 0x00 && bytes[i + 8] === 0x2c) frames++
  }
  expect(frames).toBe(32)

  // The loop rows only matter for the Screen FX loop with the signal on.
  await page.locator('.seg[aria-label="Animation loop"] button[data-value="compare-wipe"]').click()
  await expect(rows).toBeHidden()
})

test('the signal travels in a share link', async ({ page, context }) => {
  await pick(page, 'snes')
  await openSignal(page)
  await signalButton(page, 'VHS EP').click()
  await page.getByRole('button', { name: 'Copy share link' }).click()
  const hash = await page.evaluate(() => window.location.hash)

  const other = await context.newPage()
  await other.goto('/')
  await other.evaluate(() => localStorage.clear())
  await other.goto(`/${hash}`)
  await ready(other, '256×224')
  await openSignal(other)
  await expect(signalButton(other, 'VHS EP')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => previewColours(other), { timeout: 20_000 }).toBeGreaterThan(200)
})

test('CGA composite gets its colours from the signal', async ({ page }) => {
  await pick(page, 'cga-composite')
  await openSignal(page)
  await signalButton(page, "Machine's own").click()
  await expect(page.getByTestId('signal-note')).toContainText('each one is a pattern of black and white dots')
  await expect.poll(() => previewColours(page), { timeout: 20_000 }).toBeGreaterThan(200)
})
