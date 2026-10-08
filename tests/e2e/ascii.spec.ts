import { expect, test } from '@playwright/test'
import { freshPage } from './helpers'

// ASCII / ANSI studio fixes from the 2026-10-07 review.

test.beforeEach(async ({ page }) => {
  await freshPage(page)
  await page.getByTestId('tab-ascii').click()
})

test('PETSCII is always a 40×25 C64 screen, and says so', async ({ page }) => {
  await page.getByRole('button', { name: '80 cols (BBS)' }).click()
  await page.getByRole('button', { name: 'PETSCII (C64)' }).click()
  await expect(page.getByTestId('ascii-readout')).toContainText(/^40×\d+ cells/)
  await expect(page.getByTestId('ascii-c64-note')).toBeVisible()
  await expect(page.getByRole('button', { name: '80 cols (BBS)' })).toBeHidden()
  await page.getByRole('button', { name: 'Half-block (▀)' }).click()
  await expect(page.getByTestId('ascii-c64-note')).toBeHidden()
  await expect(page.getByRole('button', { name: '80 cols (BBS)' })).toBeVisible()
})
