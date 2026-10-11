import { expect, test, type Page } from '@playwright/test'
import { inspectMetadata } from '../../src/core/exif'
import { fakeHeif, phoneStyleJpeg } from '../../src/test/fake-exif'
import { xmpApp1 } from '../../src/test/fake-tiff'
import { canvasJpeg, download, freshPage, gradientPng } from './helpers'

// The EXIF Injector, with made-up photos (fake camera, 0,0).

const FAKE_PHONE = { make: 'FakeCam', model: 'Test 1', orientation: 6, dateTime: '2000:01:01 00:00:00', gps: { lat: 0, lon: 0 } }
const field = (page: Page, name: string) => page.getByTestId(`injector-${name}`)

async function openJpeg(page: Page, name: string, bytes: Uint8Array) {
  await page.locator('#file-input').setInputFiles({ name, mimeType: 'image/jpeg', buffer: Buffer.from(bytes) })
  await page.getByTestId('tab-inject').click()
  await expect(page.getByTestId('inject-picture-info')).toContainText(name)
}

test.beforeEach(async ({ page }) => {
  await freshPage(page)
})

test('the tab opens on the sample, with the form filled from the sample', async ({ page }) => {
  const tabInject = page.getByTestId('tab-inject')
  await tabInject.click()

  await expect(tabInject).toHaveClass(/active/)
  await expect(tabInject).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('inject-controls')).toBeVisible()
  await expect(page.getByTestId('inject-picture-info')).toContainText('rukus.png')
  const table = page.getByTestId('scrub-table')
  await expect(table).toContainText('b0r3d optics')
  await expect(table).toContainText('b0r3d Prime 28mm f/1.4 Deluxe')
  await expect(table).toContainText('1/250s')
  await expect(table).toContainText('f/1.4')
  await expect(table).toContainText('Colour profile present')
  await expect(table).toContainText('Yes (may show the uncropped original)')

  await expect(field(page, 'make')).toHaveValue('b0r3d optics')
  await expect(field(page, 'software')).toHaveValue('b0r3d DeRes v0.8.5')
  await expect(field(page, 'orientation')).toHaveValue('1')
  await expect(field(page, 'lat')).toHaveValue('41.878113')
  await expect(field(page, 'desc')).toHaveValue('Rukus the Cat, Chief Executive Officer of b0r3d.org')
})

test('b0r3d Defaults, Clear fields and Reset to photo', async ({ page }) => {
  await page.getByTestId('tab-inject').click()

  await page.getByTestId('inject-clear-btn').click()
  for (const name of ['make', 'model', 'lens', 'artist', 'aperture', 'shutter', 'iso', 'focal', 'lat', 'lon', 'orientation']) {
    await expect(field(page, name)).toHaveValue('')
  }

  await page.getByTestId('inject-defaults-btn').click()
  await expect(field(page, 'make')).toHaveValue('b0r3d optics')
  await expect(field(page, 'model')).toHaveValue('Rukus-Cam 95 Deluxe')
  // The Defaults name the version running now (the sample keeps the one it was made with).
  await expect(field(page, 'software')).toHaveValue(/^b0r3d DeRes v/)
  await expect(field(page, 'shutter')).toHaveValue('1/250')
  await expect(field(page, 'lon')).toHaveValue('-87.629799')

  await field(page, 'make').fill('Something else')
  await page.getByTestId('inject-prefill-btn').click()
  await expect(field(page, 'make')).toHaveValue('b0r3d optics')
})

test('changing only the Artist keeps the rotation, camera, date and GPS', async ({ page }) => {
  const photo = phoneStyleJpeg(await canvasJpeg(page, 32, 16), FAKE_PHONE)
  await openJpeg(page, 'phone.jpg', photo)
  await expect(field(page, 'orientation')).toHaveValue('6')
  await expect(field(page, 'make')).toHaveValue('FakeCam')

  await field(page, 'artist').fill('still_b0r3d')
  const { download: d, bytes } = await download(page, page.getByTestId('inject-download-btn'))
  expect(d.suggestedFilename()).toBe('phone-injected.jpg')
  const meta = inspectMetadata(bytes)
  expect(meta.artist).toBe('still_b0r3d')
  expect(meta.orientation).toBe(6)
  expect(meta.make).toBe('FakeCam')
  expect(meta.dateTime).toBe('2000:01:01 00:00:00')
  expect(meta.gps).toBeDefined()
  await expect(page.getByTestId('inject-status')).toContainText('1 field changed')
  // The edited photo is now the one shown, and the form starts from it.
  await expect(page.getByTestId('scrub-table')).toContainText('still_b0r3d')
  await expect(field(page, 'artist')).toHaveValue('still_b0r3d')
})

test('a device preset fills the camera, lens and exposure, and the photo comes out as that phone', async ({ page }) => {
  const photo = phoneStyleJpeg(await canvasJpeg(page, 32, 16), FAKE_PHONE)
  await openJpeg(page, 'phone.jpg', photo)
  const preset = page.getByTestId('inject-preset')
  await expect(preset.locator('optgroup')).toHaveCount(3)
  await preset.selectOption('iphone-15-pro')
  await expect(field(page, 'make')).toHaveValue('Apple')
  await expect(field(page, 'model')).toHaveValue('iPhone 15 Pro')
  await expect(field(page, 'lens')).toHaveValue('iPhone 15 Pro back triple camera 6.765mm f/1.78')
  await expect(field(page, 'software')).toHaveValue('17.4.1')
  await expect(field(page, 'aperture')).toHaveValue('1.78')
  await expect(field(page, 'focal')).toHaveValue('6.765')
  // The date, place and rotation are the photo's own still.
  await expect(field(page, 'datetime')).toHaveValue('2000:01:01 00:00:00')
  await expect(field(page, 'orientation')).toHaveValue('6')
  await expect(page.getByTestId('inject-status')).toContainText('Filled in as iPhone 15 Pro')

  const { bytes } = await download(page, page.getByTestId('inject-download-btn'))
  const meta = inspectMetadata(bytes)
  expect(meta.make).toBe('Apple')
  expect(meta.model).toBe('iPhone 15 Pro')
  expect(meta.lensModel).toBe('iPhone 15 Pro back triple camera 6.765mm f/1.78')
  expect(meta.software).toBe('17.4.1')
  expect(meta.iso).toBe(64)
  expect(meta.allTags.find((t) => t.tagId === 0xa433)?.displayValue).toBe('Apple')
  expect(meta.orientation).toBe(6)
  expect(meta.dateTime).toBe('2000:01:01 00:00:00')
  expect(meta.gps).toBeDefined()
  // The form starts again from the new photo, with no preset picked.
  await expect(preset).toHaveValue('')
  await expect(field(page, 'make')).toHaveValue('Apple')
})

test('writes new tags and a location into a JPEG without EXIF', async ({ page }) => {
  await openJpeg(page, 'shot.jpg', await canvasJpeg(page, 32, 16))
  await field(page, 'make').fill('Leica')
  await field(page, 'model').fill('M11')
  await field(page, 'lat').fill('35.6983')
  await field(page, 'lon').fill('139.773')
  await field(page, 'alt').fill('10')

  const { download: d, bytes } = await download(page, page.getByTestId('inject-download-btn'))
  expect(d.suggestedFilename()).toBe('shot-injected.jpg')
  const meta = inspectMetadata(bytes)
  expect(meta.make).toBe('Leica')
  expect(meta.model).toBe('M11')
  expect(meta.gps?.latitude).toBeCloseTo(35.6983, 4)
  expect(meta.gps?.longitude).toBeCloseTo(139.773, 4)
  expect(meta.gps?.altitude).toBe(10)
})

test('writes the b0r3d Defaults into a PNG', async ({ page }) => {
  const photo = await gradientPng(32, 32)
  await page.locator('#file-input').setInputFiles({ name: 'art.png', mimeType: 'image/png', buffer: photo })
  await page.getByTestId('tab-inject').click()
  await page.getByTestId('inject-defaults-btn').click()
  const { download: d, bytes } = await download(page, page.getByTestId('inject-download-btn'))
  expect(d.suggestedFilename()).toBe('art-injected.png')
  const meta = inspectMetadata(bytes)
  expect(meta.format).toBe('png')
  expect(meta.make).toBe('b0r3d optics')
  expect(meta.gps?.latitude).toBeCloseTo(41.878113, 4)
})

test('bad values are refused with a message, and nothing is saved', async ({ page }) => {
  await openJpeg(page, 'shot.jpg', await canvasJpeg(page, 32, 16))
  let downloads = 0
  page.on('download', () => downloads++)
  const status = page.getByTestId('inject-status')

  await field(page, 'shutter').fill('abc')
  await page.getByTestId('inject-download-btn').click()
  await expect(status).toContainText('Shutter speed')
  await expect(status).toHaveClass(/is-error/)
  await expect(field(page, 'shutter')).toHaveAttribute('aria-invalid', 'true')
  await expect(field(page, 'shutter')).toBeFocused()

  await field(page, 'shutter').fill('')
  await field(page, 'iso').fill('70000')
  await page.getByTestId('inject-download-btn').click()
  await expect(status).toContainText('1 to 65535')

  await field(page, 'iso').fill('')
  await field(page, 'lat').fill('41')
  await page.getByTestId('inject-download-btn').click()
  await expect(status).toContainText('both latitude and longitude')

  await field(page, 'lat').fill('')
  await page.getByTestId('inject-download-btn').click()
  await expect(status).toContainText('Nothing has changed yet')
  expect(downloads).toBe(0)
})

test("formats it can't write are named up front", async ({ page }) => {
  const heic = fakeHeif('heic', ['mif1', 'heic'], FAKE_PHONE)
  await page.locator('#file-input').setInputFiles({ name: 'phone.heic', mimeType: 'image/heic', buffer: Buffer.from(heic) })
  await page.getByTestId('tab-inject').click()
  await expect(page.getByTestId('inject-picture-info')).toContainText('phone.heic')
  await expect(page.getByTestId('inject-format-note')).toContainText('This one is HEIC')
  await expect(page.getByTestId('inject-download-btn')).toBeDisabled()
})

test("offers to remove an XMP block that holds its own copy of the location", async ({ page }) => {
  const base = phoneStyleJpeg(await canvasJpeg(page, 32, 16), FAKE_PHONE)
  const afterApp1 = 4 + ((base[4] << 8) | base[5])
  const xmp = xmpApp1('<x:xmpmeta><rdf:Description exif:GPSLatitude="0,0N" exif:GPSLongitude="0,0E"/></x:xmpmeta>')
  const photo = new Uint8Array([...base.subarray(0, afterApp1), ...xmp, ...base.subarray(afterApp1)])
  await openJpeg(page, 'xmp.jpg', photo)

  const box = page.getByTestId('inject-remove-xmp')
  await expect(box).toBeVisible()
  await expect(box).toBeChecked()
  await field(page, 'lat').fill('10')
  await field(page, 'lon').fill('20')
  const { bytes } = await download(page, page.getByTestId('inject-download-btn'))
  const meta = inspectMetadata(bytes)
  expect(meta.xmpText).toBeUndefined()
  expect(meta.gps?.latitude).toBeCloseTo(10, 6)
  await expect(page.getByTestId('inject-status')).toContainText('XMP block removed')
})

test('in a batch, the edited photo takes its place in the batch', async ({ page }) => {
  const one = phoneStyleJpeg(await canvasJpeg(page, 32, 16), { ...FAKE_PHONE, make: 'CamOne' })
  const two = phoneStyleJpeg(await canvasJpeg(page, 16, 32), { ...FAKE_PHONE, make: 'CamTwo' })
  await page.locator('#file-input').setInputFiles([
    { name: 'one.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(one) },
    { name: 'two.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(two) }
  ])
  await page.getByTestId('tab-scrub').click()
  await page.getByTestId('scrub-batch-table').locator('tbody tr').nth(1).click()
  await page.getByTestId('tab-inject').click()
  await expect(page.getByTestId('inject-picture-info')).toContainText('two.jpg')
  await expect(field(page, 'make')).toHaveValue('CamTwo')

  await field(page, 'make').fill('CamTwoEdited')
  await download(page, page.getByTestId('inject-download-btn'))
  await page.getByTestId('tab-scrub').click()
  await expect(page.getByTestId('scrub-table')).toContainText('CamTwoEdited')
  await page.getByTestId('tab-inject').click()
  await expect(field(page, 'make')).toHaveValue('CamTwoEdited')
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('the inject button can be reached, and the tag filter does not pop the keyboard', async ({ page }) => {
    await page.getByTestId('tab-inject').click()
    const btn = page.getByTestId('inject-download-btn')
    await field(page, 'artist').fill('phone test')
    const pending = page.waitForEvent('download')
    await btn.click({ timeout: 5000 })
    await pending

    await page.getByTestId('scrub-tree-tab').click()
    const filter = page.getByTestId('scrub-filter-input')
    await expect(filter).toBeVisible()
    // Focus (and so the on-screen keyboard) only comes with a mouse.
    const mouse = await page.evaluate(() => matchMedia('(hover: hover) and (pointer: fine)').matches)
    if (mouse) await expect(filter).toBeFocused()
    else await expect(filter).not.toBeFocused()
  })
})
