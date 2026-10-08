import { expect, test } from '@playwright/test'
import { inspectMetadata } from '../../src/core/exif'
import { jpegMarkers, phoneStyleJpeg } from '../../src/test/fake-exif'
import { canvasJpeg, decodedSize, download, freshPage } from './helpers'

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
})
