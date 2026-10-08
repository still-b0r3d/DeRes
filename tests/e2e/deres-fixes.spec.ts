import { expect, test, type Page } from '@playwright/test'
import { profileById } from '../../src/core/profiles'
import { freshPage, readout, ready } from './helpers'

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
