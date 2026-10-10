import { expect, test, type Page } from '@playwright/test'
import { inspectMetadata } from '../../src/core/exif'
import { decodeGifFrames } from '../../src/core/gif-decode'
import { buildGif, gifApp, gifComment, gifXmp, xmpPacket } from '../../src/test/gif-builder'
import { download, freshPage, zipNames } from './helpers'

// GIFs in the EXIF Scrubber and Injector: made-up GIFs with a comment, a
// colour profile and an XMP location (Chicago), before and after scrubbing.

const RGBK = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]
const CHICAGO = xmpPacket({ 'exif:GPSLatitude': '41,52.8N', 'exif:GPSLongitude': '87,37.8W' })

function taggedGif(): Buffer {
  const frame = (k: number) => ({ width: 8, height: 6, indices: new Array(48).fill(k), delay: 7 + k })
  return Buffer.from(
    buildGif({
      width: 8,
      height: 6,
      globalTable: RGBK,
      loop: 0,
      blocks: [gifComment('made on a Tuesday'), gifXmp(CHICAGO), gifApp('ICCRGBG1012', new Array(300).fill(5)), frame(0), frame(1), frame(2)]
    })
  )
}

/** Every frame's pixels and delay. */
function frames(bytes: Uint8Array): string[] {
  return decodeGifFrames(bytes).frames.map((f) => `${f.delayMs}:${Buffer.from(f.rgba).toString('base64')}`)
}

async function openGif(page: Page, name = 'tagged.gif') {
  await page.locator('#file-input').setInputFiles({ name, mimeType: 'image/gif', buffer: taggedGif() })
  await page.getByTestId('tab-scrub').click()
  await expect(page.getByTestId('scrub-picture-info')).toContainText(name)
}

test.beforeEach(async ({ page }) => {
  await freshPage(page)
})

test('the scrubber reads a GIF: frames, loop, comment and the location in its XMP', async ({ page }) => {
  await openGif(page)
  await expect(page.getByTestId('scrub-narrative')).toHaveText(
    "A GIF with 3 frames that loops forever. GIFs don't record a camera or date; its XMP gives a location: 41.880000, -87.630000, and a comment."
  )
  await expect(page.getByTestId('scrub-gps-alert')).toBeVisible()
  const table = page.getByTestId('scrub-table')
  await expect(table).toContainText('GIF (89a)')
  await expect(table).toContainText('Forever')
  await expect(table).toContainText('Colour profile present')
  await expect(page.getByTestId('scrub-preview-img')).toBeVisible()
  await page.getByTestId('scrub-tree-tab').click()
  await expect(table).toContainText('made on a Tuesday')
  await expect(table).toContainText('ICCRGBG1012')
})

test('Remove everything: a clean GIF with every frame as it was, and its colour profile', async ({ page }) => {
  await openGif(page)
  const { download: d, bytes } = await download(page, page.getByTestId('scrub-download-btn'))
  expect(d.suggestedFilename()).toBe('tagged-clean.gif')
  await expect(page.getByTestId('scrub-check-badge')).toHaveText('✓ Verified Clean')
  const meta = inspectMetadata(bytes)
  expect(meta.format).toBe('gif')
  expect([meta.rawTagCount, meta.gif?.comments, meta.hasIccProfile, meta.gps]).toEqual([0, 0, true, undefined])
  expect(frames(bytes)).toEqual(frames(taggedGif()))
  // And the browser still opens it.
  const size = await page.evaluate(async (data) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/gif' }))
    return [bitmap.width, bitmap.height]
  }, [...bytes])
  expect(size).toEqual([8, 6])
})

test('Location only: the XMP location goes, the comment and colour profile stay', async ({ page }) => {
  await openGif(page)
  await page.locator('#scrub-mode-location').check()
  const { bytes } = await download(page, page.getByTestId('scrub-download-btn'))
  const meta = inspectMetadata(bytes)
  expect(meta.gps).toBeUndefined()
  expect(meta.xmpText).toBeUndefined()
  expect(meta.gif?.comments).toBe(1)
  expect(meta.hasIccProfile).toBe(true)
  expect(frames(bytes)).toEqual(frames(taggedGif()))
  await expect(page.getByTestId('scrub-check-badge')).toHaveText('✓ Verified Clean')
})

test('GIFs go into a batch and its ZIP', async ({ page }) => {
  await page.locator('#file-input').setInputFiles([
    { name: 'a.gif', mimeType: 'image/gif', buffer: taggedGif() },
    { name: 'b.gif', mimeType: 'image/gif', buffer: taggedGif() }
  ])
  await page.getByTestId('tab-scrub').click()
  const rows = page.getByTestId('scrub-batch-table').locator('tbody tr')
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toContainText('GIF')
  await expect(rows.first()).toContainText('Yes')
  const { bytes } = await download(page, page.getByTestId('scrub-download-zip-btn'))
  expect(zipNames(bytes)).toEqual(['a-clean.gif', 'b-clean.gif'])
  await expect(page.getByTestId('scrub-status')).toContainText('2 clean photos')
})

test('the Injector says plainly that a GIF holds no EXIF', async ({ page }) => {
  await page.locator('#file-input').setInputFiles({ name: 'tagged.gif', mimeType: 'image/gif', buffer: taggedGif() })
  await page.getByRole('tab', { name: 'EXIF Injector' }).click()
  await expect(page.getByTestId('inject-format-note')).toHaveText("GIFs can't hold EXIF, so there's nothing to edit here.")
  await expect(page.getByTestId('inject-download-btn')).toBeDisabled()
})
