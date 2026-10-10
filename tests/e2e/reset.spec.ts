import { expect, test, type Page } from '@playwright/test'
import { DEFAULT_ASCII_SETTINGS } from '../../src/core/ascii'
import { defaultSettings } from '../../src/ui/settings'
import { freshPage, readout, ready } from './helpers'

// The "Reset settings" buttons: DeRes and the ASCII studio, two presses each.

const seg = (page: Page, label: string, value: string) => page.locator(`.seg[aria-label="${label}"] button[data-value="${value}"]`)
const pressed = (page: Page, label: string) => page.locator(`.seg[aria-label="${label}"] button[aria-pressed="true"]`)

async function openSection(page: Page, title: string) {
  const sec = page.locator('details.sec', { has: page.locator('> summary', { hasText: new RegExp(`^${title}$`) }) }).first()
  if (!(await sec.evaluate((d: HTMLDetailsElement) => d.open))) await sec.locator('> summary').click()
}

/** What's saved in storage, as the page wrote it. */
const stored = (page: Page, key: string) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), key)

test.beforeEach(async ({ page }) => {
  await freshPage(page)
})

/** Everything DeRes shows is at its default (the sample's Game Boy look). */
async function expectDeresDefaults(page: Page) {
  const d = defaultSettings()
  await expect(page.locator('.card[aria-pressed="true"]')).toHaveAttribute('data-profile', d.profileId)
  await expect(page.locator(`.dither[data-dither="${d.dither}"]`)).toHaveAttribute('aria-pressed', 'true')
  for (const id of ['brightness', 'contrast', 'saturation', 'gamma'] as const) {
    expect(Number(await page.locator(`#${id}`).inputValue())).toBeCloseTo(d.adjust[id], 5)
  }
  await expect(pressed(page, 'Signal')).toHaveAttribute('data-value', 'off')
  await expect(pressed(page, 'Screen effect')).toHaveAttribute('data-value', 'off')
  await expect(pressed(page, 'Size')).toHaveAttribute('data-value', String(d.multiplier))
  await expect(pressed(page, 'Animation loop')).toHaveAttribute('data-value', d.animationStyle)
  await expect(pressed(page, 'Resolution')).toHaveAttribute('data-value', 'native')
  await expect(page.locator('#export-fx')).not.toBeChecked()
  await expect(readout(page)).toContainText('160×144')
}

test('DeRes: change a lot, reset, and every control is back to its default', async ({ page }) => {
  const info = await page.getByTestId('picture-info').textContent()
  // Machine (via a grabbed palette: the Custom machine), dither, adjust, signal, screen, size, loop.
  await page.locator('.card[data-profile="genesis"]').click()
  await page.locator('#custom-count').fill('6')
  await ready(page, /of [2-6] colours used/)
  const grab = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Grab palette' }).click()
  await grab
  await expect(page.locator('.card[data-profile="custom"]')).toHaveAttribute('aria-pressed', 'true')
  await page.locator('.dither[data-dither="atkinson"]').click()
  await page.locator('#brightness').fill('0.2')
  await page.locator('#gamma').fill('1.6')
  await openSection(page, 'Signal')
  await page.locator('.seg[aria-label="Signal"] button', { hasText: 'VHS LP' }).click()
  await page.locator('#signal-wear').fill('0.9')
  await openSection(page, 'Screen')
  await seg(page, 'Screen effect', 'crt').click()
  await seg(page, 'Size', '2').click()
  await seg(page, 'Loop length', '32').click()
  await seg(page, 'Resolution', 'custom').click()
  await page.locator('#block').fill('12')
  await ready(page, /colours/)
  // A share link puts the settings in the address.
  await page.getByRole('button', { name: 'Copy share link' }).click()
  await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#s=/)

  const reset = page.getByTestId('reset-settings')
  await expect(reset).toHaveText('Reset settings')
  await reset.click()
  await expect(reset).toHaveText('Reset everything?')
  await reset.click()
  await expect(reset).toHaveText('Reset settings')
  await expect(page.locator('.status')).toHaveText('Settings reset.')
  await ready(page)
  await expectDeresDefaults(page)

  // Saved as the defaults, the share link gone, the picture the same.
  const saved = await stored(page, 'b0r3d-deres:settings')
  expect(saved).toEqual(JSON.parse(JSON.stringify(defaultSettings())))
  expect(await page.evaluate(() => location.hash)).toBe('')
  await expect(page.getByTestId('picture-info')).toHaveText(info!)
  // The grabbed palette is gone from the Custom machine too.
  await page.locator('.card[data-profile="custom"]').click()
  await ready(page, /colours used/)
  await expect(readout(page)).toContainText(/of 16 colours used/)

  // A reload stays on the defaults.
  await page.locator('.card[data-profile="gameboy"]').click()
  await page.reload()
  await ready(page)
  await expectDeresDefaults(page)
})

test('DeRes: one press only asks, and the question goes away after a few seconds', async ({ page }) => {
  await page.locator('.card[data-profile="nes"]').click()
  await ready(page, '256×240')
  const reset = page.getByTestId('reset-settings')
  await reset.click()
  await expect(reset).toHaveText('Reset everything?')
  await expect(reset).toHaveText('Reset settings', { timeout: 6000 })
  await reset.click()
  await page.waitForTimeout(300)
  await expect(page.locator('.card[aria-pressed="true"]')).toHaveAttribute('data-profile', 'nes')
})

test('ASCII studio: reset puts every control back, saves the defaults, and survives a reload', async ({ page }) => {
  await page.getByRole('tab', { name: 'ASCII / ANSI Studio' }).click()
  await seg(page, 'Render mode', 'ramp').click()
  await seg(page, 'Columns preset', '132').click()
  await seg(page, 'Ramp presets', 'detailed').click()
  await page.locator('#ascii-invert').check()
  await seg(page, 'Color profile', 'green').click()
  await openSection(page, 'Adjustments')
  await page.locator('#ascii-contrast').fill('50')
  await page.locator('#ascii-gamma').fill('2')
  await page.locator('#ascii-aspect').uncheck()

  const reset = page.getByTestId('ascii-reset-settings')
  await reset.click()
  await expect(reset).toHaveText('Reset everything?')
  await reset.click()
  await expect(page.getByTestId('ascii-status')).toHaveText('Settings reset.')

  const d = DEFAULT_ASCII_SETTINGS
  const check = async () => {
    await expect(pressed(page, 'Render mode')).toHaveAttribute('data-value', d.mode)
    await expect(pressed(page, 'Columns preset')).toHaveAttribute('data-value', String(d.columns))
    await expect(pressed(page, 'Color profile')).toHaveAttribute('data-value', d.colorMode)
    await expect(page.locator('#ascii-aspect')).toBeChecked()
    expect(Number(await page.locator('#ascii-contrast').inputValue())).toBe(d.contrast)
    expect(Number(await page.locator('#ascii-gamma').inputValue())).toBe(d.gamma)
    await expect(page.getByTestId('ascii-picture-info')).toHaveText('rukus.png · 256×256 px')
  }
  await check()
  expect(await stored(page, 'b0r3d_ascii_settings')).toEqual(d)
  await page.reload()
  await ready(page)
  await page.getByRole('tab', { name: 'ASCII / ANSI Studio' }).click()
  await check()
  await seg(page, 'Render mode', 'ramp').click()
  await expect(pressed(page, 'Ramp presets')).toHaveAttribute('data-value', d.rampPreset)
  await expect(page.locator('#ascii-invert')).not.toBeChecked()
})

test('ASCII studio: a bad saved value falls back instead of breaking the tab', async ({ page }) => {
  await page.evaluate(() =>
    localStorage.setItem('b0r3d_ascii_settings', JSON.stringify({ mode: 'ramp', columns: 'lots', gamma: 99, colorMode: 'plaid', rampPreset: 7 }))
  )
  await page.reload()
  await ready(page)
  await page.getByRole('tab', { name: 'ASCII / ANSI Studio' }).click()
  await expect(pressed(page, 'Render mode')).toHaveAttribute('data-value', 'ramp')
  await expect(pressed(page, 'Columns preset')).toHaveAttribute('data-value', '80')
  await expect(pressed(page, 'Color profile')).toHaveAttribute('data-value', 'ansi16')
  expect(Number(await page.locator('#ascii-gamma').inputValue())).toBe(2.5)
  await expect(page.locator('.ascii-stage pre, .ascii-stage canvas').first()).toBeVisible()
})
