import { expect, test, type Locator, type Page } from '@playwright/test'
import { ready } from './helpers'

// Every load starts with only the Image section open (and, in the EXIF
// tools, the one with their main button). Unlike the other specs, these
// tests don't open the sections for themselves.

const openTitles = (controls: Locator) => controls.locator('details.sec[open] > summary').allTextContents()

async function load(page: Page) {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await ready(page)
}

test('each tool opens with only its Image section open', async ({ page }) => {
  await load(page)
  const deres = page.getByTestId('deres-controls')
  expect(await openTitles(deres)).toEqual(['Image'])
  await expect(deres.locator('details.sec > summary')).toHaveText(['Image', 'Hardware', 'Adjust', 'Dither', 'Signal', 'Screen', 'Export'])

  await page.getByTestId('tab-ascii').click()
  expect(await openTitles(page.locator('#ascii-controls-col'))).toEqual(['Image'])

  // The EXIF tools keep the section with their one button open too.
  await page.getByTestId('tab-scrub').click()
  expect(await openTitles(page.getByTestId('scrub-controls'))).toEqual(['Image & Batch', 'Clean & Save'])
  await page.getByTestId('tab-inject').click()
  expect(await openTitles(page.getByTestId('inject-controls'))).toEqual(['Photo', 'Inject & Save'])
})

test('a section opened in one visit is closed again on the next', async ({ page }) => {
  await load(page)
  const deres = page.getByTestId('deres-controls')
  await deres.locator('details.sec > summary', { hasText: /^Hardware$/ }).click()
  await expect(deres.locator('.card[data-profile="nes"]')).toBeVisible()
  // Picking a machine is remembered; the open section isn't.
  await deres.locator('.card[data-profile="nes"]').click()
  await ready(page)
  await page.reload()
  await ready(page)
  expect(await openTitles(deres)).toEqual(['Image'])
  await expect(deres.locator('.card[data-profile="nes"]')).toBeHidden()
  await expect(page.getByTestId('readout')).toContainText('256×240')
})
