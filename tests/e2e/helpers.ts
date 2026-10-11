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

/**
 * Catches what the page puts on the clipboard (the same in every browser,
 * with no permission asked); the function returns the last text copied.
 */
export async function catchClipboard(page: Page): Promise<() => Promise<string>> {
  await page.evaluate(() => {
    const store = window as unknown as { copied?: string }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => void (store.copied = text) }
    })
  })
  return () => page.evaluate(() => (window as unknown as { copied?: string }).copied ?? '')
}

/** The file names in a ZIP, from its central directory. */
export function zipNames(zip: Uint8Array): string[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const eocd = zip.length - 22
  expect(view.getUint32(eocd, true)).toBe(0x06054b50)
  const count = view.getUint16(eocd + 10, true)
  let p = view.getUint32(eocd + 16, true)
  const names: string[] = []
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(p, true)).toBe(0x02014b50)
    const n = view.getUint16(p + 28, true)
    const extra = view.getUint16(p + 30, true) + view.getUint16(p + 32, true)
    names.push(new TextDecoder().decode(zip.subarray(p + 46, p + 46 + n)))
    p += 46 + n + extra
  }
  return names
}

/**
 * Opens every settings section as it appears, on every page of the test
 * (reloads and second tabs too). The app starts with only Image open; most
 * tests reach into the other sections, and sections.spec.ts checks the
 * collapsed start without this. A section is opened once, so a test can
 * still close one.
 */
export async function openSections(page: Page) {
  await page.context().addInitScript(() => {
    const opened = new WeakSet<Element>()
    const openAll = () => {
      for (const d of document.querySelectorAll<HTMLDetailsElement>('details.sec')) {
        if (opened.has(d)) continue
        opened.add(d)
        d.open = true
      }
    }
    new MutationObserver(openAll).observe(document, { childList: true, subtree: true })
  })
}

/** Opens a settings section by its title, unless it's open already. */
export async function openSection(page: Page, title: string) {
  const sec = page.locator('details.sec', { has: page.locator('> summary', { hasText: new RegExp(`^${title}$`) }) }).first()
  if (!(await sec.evaluate((d: HTMLDetailsElement) => d.open))) await sec.locator('> summary').click()
}

/** Opens the page fresh, with nothing remembered and every section open, and waits for the sample. */
export async function freshPage(page: Page) {
  await openSections(page)
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await ready(page)
}
