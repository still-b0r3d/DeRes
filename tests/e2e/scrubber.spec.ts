import { expect, test } from '@playwright/test'
import { inspectMetadata } from '../../src/core/exif'
import { jpegMarkers, phoneStyleJpeg } from '../../src/test/fake-exif'
import { canvasJpeg, decodedSize, download, freshPage, gradientPng, zipNames } from './helpers'

// The EXIF scrubber, with made-up phone-style photos (fake camera, 0,0).

const FAKE_PHONE = { make: 'FakeCam', model: 'Test 1', orientation: 6, dateTime: '2000:01:01 00:00:00', gps: { lat: 0, lon: 0 } }

test.beforeEach(async ({ page }) => {
  await freshPage(page)
})

test('a phone-style JPEG stays upright after scrubbing and ends at its last marker', async ({ page }) => {
  // 32 wide, 16 tall, tagged "rotate 90°": shown 16 wide, 32 tall.
  const photo = phoneStyleJpeg(await canvasJpeg(page, 32, 16), FAKE_PHONE)
  expect(await decodedSize(page, photo, 'image/jpeg')).toEqual([16, 32])

  await page.locator('#file-input').setInputFiles({ name: 'phone.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(photo) })
  await page.getByTestId('tab-scrub').click()
  await expect(page.getByTestId('scrub-gps-alert')).toBeVisible()

  const { download: d, bytes } = await download(page, page.getByTestId('scrub-download-btn'))
  expect(d.suggestedFilename()).toBe('phone-clean.jpg')
  expect(jpegMarkers(bytes)[0]).toBe(0xe1)
  expect([...bytes.subarray(-2)]).toEqual([0xff, 0xd9])
  const meta = inspectMetadata(bytes)
  expect(meta.orientation).toBe(6)
  expect(meta.gps).toBeUndefined()
  expect(meta.make).toBeUndefined()
  expect(await decodedSize(page, bytes, 'image/jpeg')).toEqual([16, 32])
  await expect(page.getByTestId('scrub-check-badge')).toHaveText('✓ Verified Clean')
  await expect(page.getByTestId('scrub-self-check')).not.toHaveClass(/fail/)
})

test('a batch is only the photos picked together, never the sample or an older batch', async ({ page }) => {
  const files = async (...names: string[]) =>
    Promise.all(names.map(async (name, i) => ({ name, mimeType: 'image/png', buffer: await gradientPng(20 + i, 20) })))
  const rows = page.getByTestId('scrub-batch-table').locator('tbody tr')
  const zipBtn = page.getByTestId('scrub-download-zip-btn')
  const singleBtn = page.getByTestId('scrub-download-btn')

  // Two photos picked after the sample: two rows, a ZIP of those two.
  await page.locator('#file-input').setInputFiles(await files('one.png', 'two.png'))
  await page.getByTestId('tab-scrub').click()
  await expect(rows).toHaveCount(2)
  await expect(page.getByTestId('scrub-batch-table')).not.toContainText('rukus')
  expect(zipNames((await download(page, zipBtn)).bytes)).toEqual(['one-clean.png', 'two-clean.png'])

  // A new pick replaces the batch.
  await page.locator('#file-input').setInputFiles(await files('three.png', 'four.png'))
  await expect(rows).toHaveCount(2)
  expect(zipNames((await download(page, zipBtn)).bytes)).toEqual(['three-clean.png', 'four-clean.png'])

  // One photo after a batch is single mode again, for that photo.
  await page.locator('#file-input').setInputFiles(await files('five.png'))
  await expect(page.getByTestId('scrub-picture-info')).toContainText('five.png')
  await expect(page.getByTestId('scrub-batch-panel')).toBeHidden()
  await expect(zipBtn).toBeHidden()
  await expect(singleBtn).toBeVisible()
  expect((await download(page, singleBtn)).download.suggestedFilename()).toBe('five-clean.png')

  // A drop of two works the same way, and the sample afterwards is single mode.
  await page.evaluate(async (data) => {
    const dt = new DataTransfer()
    for (const [name, bytes] of data) dt.items.add(new File([new Uint8Array(bytes)], name, { type: 'image/png' }))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, cancelable: true }))
  }, (await files('six.png', 'seven.png')).map((f) => [f.name, [...f.buffer]] as [string, number[]]))
  await expect(rows).toHaveCount(2)
  await page.getByRole('button', { name: 'Try the sample' }).last().click()
  await expect(page.getByTestId('scrub-picture-info')).toContainText('rukus.png')
  await expect(page.getByTestId('scrub-batch-panel')).toBeHidden()
})
