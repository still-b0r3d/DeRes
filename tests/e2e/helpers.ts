import { readFileSync } from 'node:fs'
import { expect, type Download, type Locator, type Page } from '@playwright/test'
import { encodeRgbPng } from '../../src/core/png'

// Shared by the e2e specs. Test pictures are made up (no photos in this repo).

/** A colour gradient PNG. */
export async function gradientPng(w: number, h: number): Promise<Buffer> {
  const png = await encodeRgbPng(w, h, (y, row) => {
    for (let x = 0; x < w; x++) row.set([(x * 255) / (w - 1), (y * 255) / (h - 1), 128], x * 3)
  })
  return Buffer.from(png)
}

/** A real JPEG from the browser's own encoder: left half red, right half blue. */
export async function canvasJpeg(page: Page, w: number, h: number): Promise<Uint8Array> {
  const bytes = await page.evaluate(
    async ([w, h]) => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const g = c.getContext('2d')!
      g.fillStyle = '#ff0000'
      g.fillRect(0, 0, w / 2, h)
      g.fillStyle = '#0000ff'
      g.fillRect(w / 2, 0, w / 2, h)
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.95))
      return [...new Uint8Array(await blob.arrayBuffer())]
    },
    [w, h]
  )
  return Uint8Array.from(bytes)
}

/** The size the browser shows a picture at (it applies the EXIF rotation). */
export async function decodedSize(page: Page, bytes: Uint8Array, type: string): Promise<[number, number]> {
  return page.evaluate(
    async ([data, type]) => {
      const url = URL.createObjectURL(new Blob([new Uint8Array(data as number[])], { type: type as string }))
      const img = new Image()
      img.src = url
      await img.decode()
      URL.revokeObjectURL(url)
      return [img.naturalWidth, img.naturalHeight] as [number, number]
    },
    [[...bytes], type] as const
  )
}

export const readout = (page: Page) => page.getByTestId('readout')

export async function ready(page: Page, text: RegExp | string = /colours used/) {
  await expect(readout(page)).toContainText(text)
  await expect(page.locator('.busy')).toBeHidden()
}

/** Clicks and returns the download it starts, with its bytes. */
export async function download(page: Page, button: Locator): Promise<{ download: Download; bytes: Uint8Array }> {
  const pending = page.waitForEvent('download')
  await button.click()
  const d = await pending
  const path = await d.path()
  return { download: d, bytes: new Uint8Array(readFileSync(path!)) }
}

/** Opens the page fresh, with nothing remembered, and waits for the sample. */
export async function freshPage(page: Page) {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await ready(page)
}
