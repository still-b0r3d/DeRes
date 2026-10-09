import { expect, test } from '@playwright/test'
import { inspectMetadata } from '../../src/core/exif'
import { canvasJpeg, download, freshPage, gradientPng } from './helpers'

test.beforeEach(async ({ page }) => {
  await freshPage(page)
})

test('switches to EXIF Injector tab and shows loaded sample info', async ({ page }) => {
  const tabInject = page.getByTestId('tab-inject')
  await tabInject.click()

  await expect(tabInject).toHaveClass(/active/)
  await expect(tabInject).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('inject-controls')).toBeVisible()
  await expect(page.getByTestId('inject-picture-info')).toContainText('rukus.png')
  const table = page.getByTestId('scrub-table')
  await expect(table).toBeVisible()
  await expect(table).toContainText('b0r3d optics')
  await expect(table).toContainText('b0r3d Prime 28mm f/1.4 Deluxe')
  await expect(table).toContainText('1/250s')
  await expect(table).toContainText('f/1.4')
  await expect(table).toContainText('Colour profile present')
  await expect(table).toContainText('Yes (may show the uncropped original)')
})

test('b0r3d Defaults and Clear fields work as expected', async ({ page }) => {
  await page.getByTestId('tab-inject').click()

  // Click b0r3d Defaults
  await page.getByTestId('inject-defaults-btn').click()
  await expect(page.getByTestId('injector-make')).toHaveValue('b0r3d optics')
  await expect(page.getByTestId('injector-model')).toHaveValue('Rukus-Cam 95 Deluxe')
  await expect(page.getByTestId('injector-lens')).toHaveValue('b0r3d Prime 28mm f/1.4 Deluxe')
  await expect(page.getByTestId('injector-artist')).toHaveValue('still_b0r3d')
  await expect(page.getByTestId('injector-copyright')).toHaveValue('(c) 2026 b0r3d.org - All rights reserved')
  await expect(page.getByTestId('injector-aperture')).toHaveValue('1.4')
  await expect(page.getByTestId('injector-shutter')).toHaveValue('1/250')
  await expect(page.getByTestId('injector-iso')).toHaveValue('100')
  await expect(page.getByTestId('injector-focal')).toHaveValue('28')
  await expect(page.getByTestId('injector-lat')).toHaveValue('41.878113')
  await expect(page.getByTestId('injector-lon')).toHaveValue('-87.629799')
  await expect(page.getByTestId('injector-alt')).toHaveValue('182')

  // Clear fields
  await page.getByTestId('inject-clear-btn').click()
  await expect(page.getByTestId('injector-make')).toHaveValue('')
  await expect(page.getByTestId('injector-model')).toHaveValue('')
  await expect(page.getByTestId('injector-lens')).toHaveValue('')
  await expect(page.getByTestId('injector-artist')).toHaveValue('')
  await expect(page.getByTestId('injector-aperture')).toHaveValue('')
  await expect(page.getByTestId('injector-shutter')).toHaveValue('')
  await expect(page.getByTestId('injector-iso')).toHaveValue('')
  await expect(page.getByTestId('injector-focal')).toHaveValue('')
  await expect(page.getByTestId('injector-lat')).toHaveValue('')
  await expect(page.getByTestId('injector-lon')).toHaveValue('')
})

test('pre-fill from photo populates inputs from current metadata', async ({ page }) => {
  await page.getByTestId('tab-inject').click()

  // rukus.png has metadata
  await page.getByTestId('inject-prefill-btn').click()
  await expect(page.getByTestId('injector-make')).toHaveValue('b0r3d optics')
  await expect(page.getByTestId('injector-model')).toHaveValue('Rukus-Cam 95 Deluxe')
  await expect(page.getByTestId('injector-lens')).toHaveValue('b0r3d Prime 28mm f/1.4 Deluxe')
  await expect(page.getByTestId('injector-artist')).toHaveValue('still_b0r3d')
  await expect(page.getByTestId('injector-copyright')).toHaveValue('(c) 2026 b0r3d.org - All rights reserved')
  await expect(page.getByTestId('injector-aperture')).toHaveValue('1.4')
  await expect(page.getByTestId('injector-shutter')).toHaveValue('1/250')
  await expect(page.getByTestId('injector-iso')).toHaveValue('100')
  await expect(page.getByTestId('injector-focal')).toHaveValue('28')
  await expect(page.getByTestId('injector-lat')).toHaveValue('41.878113')
  await expect(page.getByTestId('injector-lon')).toHaveValue('-87.629799')
  await expect(page.getByTestId('injector-alt')).toHaveValue('182')
})

test('injects custom EXIF tags into JPEG and downloads modified file', async ({ page }) => {
  const photo = await canvasJpeg(page, 32, 16)
  await page.locator('#file-input').setInputFiles({ name: 'shot.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(photo) })
  await page.getByTestId('tab-inject').click()

  await page.getByTestId('injector-make').fill('Leica')
  await page.getByTestId('injector-model').fill('M11')
  await page.getByTestId('injector-artist').fill('still_b0r3d')
  await page.getByTestId('injector-lat').fill('35.698300')
  await page.getByTestId('injector-lon').fill('139.773000')
  await page.getByTestId('injector-alt').fill('10')

  const { download: d, bytes } = await download(page, page.getByTestId('inject-download-btn'))
  expect(d.suggestedFilename()).toBe('shot-injected.jpg')

  const meta = inspectMetadata(bytes)
  expect(meta.make).toBe('Leica')
  expect(meta.model).toBe('M11')
  expect(meta.artist).toBe('still_b0r3d')
  expect(meta.gps).toBeDefined()
  expect(meta.gps?.latitude).toBeCloseTo(35.6983, 4)
  expect(meta.gps?.longitude).toBeCloseTo(139.773, 4)
  expect(meta.gps?.altitude).toBe(10)
})

test('injects EXIF tags into PNG chunk and updates metadata preview', async ({ page }) => {
  const photo = await gradientPng(32, 32)
  await page.locator('#file-input').setInputFiles({ name: 'art.png', mimeType: 'image/png', buffer: Buffer.from(photo) })
  await page.getByTestId('tab-inject').click()

  await page.getByTestId('inject-defaults-btn').click()
  const { download: d, bytes } = await download(page, page.getByTestId('inject-download-btn'))
  expect(d.suggestedFilename()).toBe('art-injected.png')

  const meta = inspectMetadata(bytes)
  expect(meta.format).toBe('png')
  expect(meta.make).toBe('b0r3d optics')
  expect(meta.model).toBe('Rukus-Cam 95 Deluxe')
  expect(meta.artist).toBe('still_b0r3d')
  expect(meta.gps).toBeDefined()
  expect(meta.gps?.latitude).toBeCloseTo(41.878113, 4)
})
