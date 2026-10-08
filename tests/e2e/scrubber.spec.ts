import { expect, test } from '@playwright/test'
import { inspectMetadata } from '../../src/core/exif'
import { fakeHeif, jpegMarkers, phoneStyleJpeg } from '../../src/test/fake-exif'
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

test("a HEIC this browser can't show is still inspected, with nothing left over from the last photo", async ({ page }) => {
  const table = page.getByTestId('scrub-table')
  const older = phoneStyleJpeg(await canvasJpeg(page, 32, 16), { make: 'OldCam', model: 'Before' })
  await page.locator('#file-input').setInputFiles({ name: 'older.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(older) })
  await page.getByTestId('tab-scrub').click()
  await expect(table).toContainText('OldCam')

  // No browser can show this one (there is no real picture in it).
  const heic = fakeHeif('heic', ['mif1', 'heic'], FAKE_PHONE)
  await page.locator('#file-input').setInputFiles({ name: 'phone.heic', mimeType: 'image/heic', buffer: Buffer.from(heic) })
  await expect(page.getByTestId('scrub-picture-info')).toContainText('phone.heic')
  await expect(table).toContainText('HEIC')
  await expect(table).toContainText('FakeCam')
  await expect(table).not.toContainText('OldCam')
  await expect(page.getByTestId('scrub-gps-alert')).toBeVisible()
  await expect(page.getByTestId('scrub-preview-img')).toBeHidden()
  await expect(page.getByTestId('scrub-no-preview')).toBeVisible()

  await page.getByTestId('scrub-download-btn').click()
  await expect(page.getByTestId('scrub-status')).toContainText('HEIC files cannot be safely scrubbed')

  // DeRes says it can't open it and keeps the last picture.
  await page.getByTestId('tab-deres').click()
  await expect(page.locator('.stage-note')).toContainText("can't open that file")
  await expect(page.getByTestId('picture-info')).toHaveText('older.jpg · 32×16')
})

test('a damaged PNG leaves the page working', async ({ page }) => {
  // A real PNG with a chunk whose length has the top bit set, right after IHDR.
  const png = await gradientPng(20, 20)
  const bad = Buffer.concat([png.subarray(0, 33), Buffer.from([0xff, 0xff, 0xff, 0xf4, 0x74, 0x45, 0x58, 0x74, 1, 2, 3, 4]), png.subarray(33)])
  await page.locator('#file-input').setInputFiles({ name: 'damaged.png', mimeType: 'image/png', buffer: bad })
  await page.getByTestId('tab-scrub').click()
  await expect(page.getByTestId('scrub-picture-info')).toContainText('damaged.png', { timeout: 5000 })
  await expect(page.getByTestId('scrub-trailer-alert')).toBeVisible()
  // Still responsive: switching tools and opening another picture work.
  await page.getByTestId('tab-deres').click()
  await page.locator('#file-input').setInputFiles({ name: 'fine.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByTestId('picture-info')).toHaveText('fine.png · 20×20')
})

test('bytes after a WebP picture are cut, and the clean file still opens', async ({ page, browserName }) => {
  const webp = await page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 24
    c.height = 12
    c.getContext('2d')!.fillRect(0, 0, 12, 12)
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/webp', 0.9))
    return blob.type === 'image/webp' ? [...new Uint8Array(await blob.arrayBuffer())] : null
  })
  test.skip(!webp, `${browserName} can't make a WebP to test with`)
  const withTrailer = Buffer.concat([Buffer.from(webp!), Buffer.from('trailing secret')])
  await page.locator('#file-input').setInputFiles({ name: 'pic.webp', mimeType: 'image/webp', buffer: withTrailer })
  await page.getByTestId('tab-scrub').click()
  await expect(page.getByTestId('scrub-trailer-alert')).toBeVisible()
  const { bytes } = await download(page, page.getByTestId('scrub-download-btn'))
  expect(Buffer.from(bytes).toString('latin1')).not.toContain('trailing secret')
  expect(await decodedSize(page, bytes, 'image/webp')).toEqual([24, 12])
  await expect(page.getByTestId('scrub-check-badge')).toHaveText('✓ Verified Clean')
})

test('the inspector words only what it checked, and copying coordinates never pops up a prompt', async ({ page }) => {
  page.on('dialog', (d) => {
    throw new Error(`unexpected ${d.type()} dialog: ${d.message()}`)
  })
  const thumb = await canvasJpeg(page, 8, 4)
  const p = phoneStyleJpeg(await canvasJpeg(page, 32, 16), { ...FAKE_PHONE, thumbnail: thumb })
  // Add a (fake) ICC profile segment after the Exif one.
  const at = 4 + ((p[4] << 8) | p[5])
  const icc = [0xff, 0xe2, 0x00, 0x12, ...Buffer.from('ICC_PROFILE\0'), 0x01, 0x01, 0, 0]
  const photo = Buffer.concat([Buffer.from(p.subarray(0, at)), Buffer.from(icc), Buffer.from(p.subarray(at))])
  await page.locator('#file-input').setInputFiles({ name: 'phone.jpg', mimeType: 'image/jpeg', buffer: photo })
  await page.getByTestId('tab-scrub').click()

  const table = page.getByTestId('scrub-table')
  await expect(table).toContainText('Yes (may show the uncropped original)')
  await expect(table).toContainText('Colour profile present')
  await expect(table).not.toContainText('Display P3')
  await expect(page.getByTestId('scrub-thumb-alert')).toContainText('may still show')

  // A browser that refuses the clipboard: the coordinates go in the status line.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } })
  })
  await page.getByTestId('copy-gps-btn').click()
  await expect(page.getByTestId('scrub-status')).toContainText('0.000000, 0.000000')
})
