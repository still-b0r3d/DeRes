import { expect, test, type Page } from '@playwright/test'
import { profileById } from '../../src/core/profiles'
import { download, freshPage, readout, ready } from './helpers'

// DeRes fixes from the 2026-10-07 review.

test.beforeEach(async ({ page }) => {
  await freshPage(page)
})

async function pick(page: Page, id: string) {
  const p = profileById(id)!
  await page.locator(`.card[data-profile="${id}"]`).click()
  await ready(page, p.height === 'auto' ? `${p.width}×` : `${p.width}×${p.height}`)
}

/** [used, total] from "N of M colours used". */
async function colours(page: Page): Promise<[number, number]> {
  const m = /(\d+) of (\d+) colours used/.exec((await readout(page).textContent()) ?? '')
  expect(m).not.toBeNull()
  return [Number(m![1]), Number(m![2])]
}

test("range and pool machines get their own number of colours, and the slider can't go past it", async ({ page }) => {
  const slider = page.locator('#custom-count')

  await pick(page, 'snes')
  await expect(slider).toHaveAttribute('max', '256')
  await expect(slider).toHaveValue('256')
  expect((await colours(page))[1]).toBeGreaterThan(16)

  // Fewer on request, and back to the machine's own count on the next pick.
  await slider.fill('8')
  await expect(readout(page)).toContainText(/of [2-8] colours used/)
  await pick(page, 'vga')
  await expect(slider).toHaveValue('256')
  expect((await colours(page))[1]).toBeGreaterThan(16)

  // Same size as VGA, so wait for the colours themselves.
  await pick(page, 'amstrad-cpc-1')
  await expect(slider).toHaveAttribute('max', '4')
  await expect.poll(async () => (await colours(page))[1]).toBeLessThanOrEqual(4)
})

test('a visitor with the old saved 16 is not capped at 16 any more', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('b0r3d-deres:settings', JSON.stringify({ profileId: 'snes', customCount: 16 })))
  await page.reload()
  await ready(page, '256×224')
  expect((await colours(page))[1]).toBeGreaterThan(16)
})

test('a grabbed palette stays with the Custom machine', async ({ page }) => {
  await pick(page, 'genesis')
  await page.locator('#custom-count').fill('6')
  await expect(readout(page)).toContainText(/of [2-6] colours used/)
  const grab = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Grab palette' }).click()
  await grab
  // Grabbing switches to Custom with those 6 colours.
  await expect(page.locator('.card[data-profile="custom"]')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await colours(page))[1]).toBe(6)
  // Other machines pick their own colours again.
  await pick(page, 'vga')
  await expect.poll(async () => (await colours(page))[1]).toBeGreaterThan(6)
  await pick(page, 'atari-st')
  await expect.poll(async () => (await colours(page))[1]).toBeGreaterThan(6)
})

test("a share link naming a machine this version doesn't have still opens the page", async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const raw = { p: 'future-machine', d: 'quantum', b: 0, m: 9999, cc: 100000, fx: ['hologram'] }
  await page.goto(`/#s=${Buffer.from(JSON.stringify(raw)).toString('base64url')}`)
  await ready(page)
  await expect(page.locator('.card[data-profile="gameboy"]')).toHaveAttribute('aria-pressed', 'true')
  // A good link opened afterwards (the hash changes) is applied.
  await page.evaluate((h) => (window.location.hash = h), `#s=${Buffer.from(JSON.stringify({ p: 'vga' })).toString('base64url')}`)
  await ready(page, '320×200')
  expect(errors).toEqual([])
})

test('the .scr and .koa downloads work every time, not just the first', async ({ page }) => {
  for (const [id, fmt, size] of [
    ['zx-spectrum', 'scr', 6912],
    ['c64-mc', 'koa', 10003]
  ] as const) {
    await pick(page, id)
    const first = (await download(page, page.getByTestId(`download-${fmt}`))).bytes
    const second = (await download(page, page.getByTestId(`download-${fmt}`))).bytes
    expect(first.length).toBe(size)
    expect(second.length).toBe(size)
    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true)
  }
})

test('.chr: NES tiles on NES (attributes), none on the plain NES look, and it says why', async ({ page }) => {
  await pick(page, 'nes-attr')
  const chr = page.getByTestId('download-chr')
  await expect(chr).toHaveText('Download .chr (NES tiles)')
  const { bytes } = await download(page, chr)
  expect(bytes.length % 16).toBe(0)
  await expect(page.getByTestId('export-note')).toBeHidden()

  await pick(page, 'nes')
  await expect(chr).toBeHidden()
  await expect(page.getByTestId('export-note')).toContainText('NES (attributes) makes one')

  await pick(page, 'gameboy')
  await expect(chr).toHaveText('Download .chr (Game Boy tiles)')
})

test("dithers that change nothing on a machine are greyed out, with a note why", async ({ page }) => {
  const btn = (id: string) => page.locator(`.dither[data-dither="${id}"]`)
  const note = page.getByTestId('dither-note')

  await pick(page, 'zx-spectrum')
  for (const id of ['none', 'bayer4', 'floyd', 'yliluoma']) await expect(btn(id)).toBeDisabled()
  await expect(note).toContainText('cell by cell')

  await pick(page, 'ps1')
  await expect(btn('none')).toBeEnabled()
  await expect(btn('ps1')).toBeEnabled()
  await expect(btn('floyd')).toBeDisabled()
  await expect(note).toContainText('PlayStation')

  await pick(page, 'gameboy')
  for (const id of ['none', 'bayer4', 'floyd', 'yliluoma']) await expect(btn(id)).toBeEnabled()
  await expect(note).toBeHidden()
})

test('animations stop at a size a phone can hold, and say how far along they are', async ({ page }) => {
  const size = (m: number) => page.locator(`.seg[aria-label="Size"] button[data-value="${m}"]`)
  await pick(page, 'vga')

  // 8× VGA is 2560×1600: fine as a PNG, too big for 16 frames in memory.
  await size(8).click()
  await expect(page.getByRole('button', { name: 'Download PNG' })).toBeEnabled()
  await expect(page.getByTestId('download-gif')).toBeDisabled()
  await expect(page.getByTestId('download-apng')).toBeDisabled()
  await expect(page.getByTestId('export-size')).toContainText('too big for an animation')

  // 2× fits; every status line on the way is kept to check the progress.
  await size(2).click()
  await expect(page.getByTestId('download-gif')).toBeEnabled()
  await expect(page.getByTestId('export-size')).not.toContainText('animation')
  await page.evaluate(() => {
    const w = window as unknown as { seen: string[] }
    w.seen = []
    const el = document.querySelector('.status')!
    new MutationObserver(() => w.seen.push(el.textContent ?? '')).observe(el, { childList: true, characterData: true, subtree: true })
  })
  const gif = page.waitForEvent('download')
  await page.getByTestId('download-gif').click()
  await gif
  await expect(page.locator('.status')).toContainText('Saved')
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen)
  expect(seen.some((t) => /frame 1 of \d+/.test(t))).toBe(true)
  expect(seen.some((t) => /frame (\d+) of \1\b/.test(t))).toBe(true)
})
