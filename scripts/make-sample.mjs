// Rebuilds the sample photo, b0r3d-brand/rukus.png, with made-up,
// site-themed metadata, so every tool has something to show when "Try the
// sample" is used: EXIF (camera, lens, exposure, date, a GPS location and a
// thumbnail) and an sRGB colour profile. The pixels are not touched: every
// chunk except the picture's own is dropped first, then the metadata is
// written with the app's own injector.
//
//   pnpm sample
//
// The Software tag names the DeRes version the sample was made with. It is
// baked in on purpose and stays as it is until the sample is rebuilt; bump
// SOFTWARE below only when that happens.
//
// Needs Playwright's Chromium (for the JPEG thumbnail).
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { deflateSync } from 'zlib'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FILE = path.join(ROOT, 'b0r3d-brand', 'rukus.png')
const SOFTWARE = 'b0r3d DeRes v0.8.5'
const THUMB_SIZE = 160

/** The chunks that make up the picture itself; everything else is metadata. */
const PICTURE_CHUNKS = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'])

function pictureOnly(png) {
  const out = [png.subarray(0, 8)]
  for (let p = 8; p + 12 <= png.length; ) {
    const len = png.readUInt32BE(p)
    const type = png.toString('latin1', p + 4, p + 8)
    if (PICTURE_CHUNKS.has(type)) out.push(png.subarray(p, p + 12 + len))
    p += 12 + len
    if (type === 'IEND') break
  }
  return Buffer.concat(out)
}

/**
 * A small ICC v2 display profile for sRGB: the sRGB primaries adapted to
 * D50, and the sRGB tone curve as a 1024-step table shared by red, green
 * and blue. Built here from the published sRGB numbers, so nobody else's
 * profile file is copied.
 */
function srgbProfile() {
  const s15 = (x) => {
    const b = Buffer.alloc(4)
    b.writeInt32BE(Math.round(x * 65536))
    return b
  }
  const xyz = (x, y, z) => Buffer.concat([Buffer.from('XYZ \0\0\0\0', 'latin1'), s15(x), s15(y), s15(z)])
  const curve = (() => {
    const n = 1024
    const b = Buffer.alloc(12 + n * 2)
    b.write('curv', 0, 'latin1')
    b.writeUInt32BE(n, 8)
    for (let i = 0; i < n; i++) {
      const v = i / (n - 1)
      const linear = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
      b.writeUInt16BE(Math.round(linear * 65535), 12 + i * 2)
    }
    return b
  })()
  const desc = (() => {
    const text = Buffer.from('sRGB\0', 'latin1')
    const b = Buffer.alloc(12 + text.length + 4 + 4 + 2 + 1 + 67)
    b.write('desc', 0, 'latin1')
    b.writeUInt32BE(text.length, 8)
    text.copy(b, 12)
    return b
  })()
  const cprt = Buffer.from('text\0\0\0\0No copyright, use freely\0', 'latin1')

  const tags = [
    ['desc', desc],
    ['cprt', cprt],
    ['wtpt', xyz(0.9642, 1.0, 0.8249)],
    ['rXYZ', xyz(0.4360747, 0.2225045, 0.0139322)],
    ['gXYZ', xyz(0.3850649, 0.7168786, 0.0971045)],
    ['bXYZ', xyz(0.1430804, 0.0606169, 0.7141733)],
    ['rTRC', curve],
    ['gTRC', curve],
    ['bTRC', curve]
  ]
  const pad4 = (n) => (n + 3) & ~3
  const tableEnd = 128 + 4 + tags.length * 12
  const placed = new Map()
  const blocks = []
  let cursor = pad4(tableEnd)
  const table = Buffer.alloc(4 + tags.length * 12)
  table.writeUInt32BE(tags.length, 0)
  tags.forEach(([sig, data], i) => {
    if (!placed.has(data)) {
      placed.set(data, cursor)
      blocks.push([cursor, data])
      cursor = pad4(cursor + data.length)
    }
    table.write(sig, 4 + i * 12, 'latin1')
    table.writeUInt32BE(placed.get(data), 8 + i * 12)
    table.writeUInt32BE(data.length, 12 + i * 12)
  })
  const profile = Buffer.alloc(cursor)
  profile.writeUInt32BE(cursor, 0)
  profile.writeUInt32BE(0x02100000, 8) // version 2.1
  profile.write('mntrRGB XYZ ', 12, 'latin1')
  ;[2026, 10, 8, 0, 0, 0].forEach((v, i) => profile.writeUInt16BE(v, 24 + i * 2))
  profile.write('acsp', 36, 'latin1')
  s15(0.9642).copy(profile, 68)
  s15(1.0).copy(profile, 72)
  s15(0.8249).copy(profile, 76)
  table.copy(profile, 128)
  for (const [at, data] of blocks) data.copy(profile, at)
  return profile
}

/** The thumbnail: the cat on white (its background is see-through), as a JPEG. */
async function thumbnail(png) {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const dataUrl = await page.evaluate(
      async ({ b64, size }) => {
        const img = new Image()
        img.src = `data:image/png;base64,${b64}`
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        const g = canvas.getContext('2d')
        g.fillStyle = '#ffffff'
        g.fillRect(0, 0, size, size)
        g.imageSmoothingQuality = 'high'
        g.drawImage(img, 0, 0, size, size)
        return canvas.toDataURL('image/jpeg', 0.85)
      },
      { b64: png.toString('base64'), size: THUMB_SIZE }
    )
    return Buffer.from(dataUrl.split(',')[1], 'base64')
  } finally {
    await browser.close()
  }
}

const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const { injectExifPng } = await vite.ssrLoadModule('/src/core/inject.ts')
  const { chunk } = await vite.ssrLoadModule('/src/core/png.ts')
  const { inspectMetadata } = await vite.ssrLoadModule('/src/core/exif.ts')

  const picture = pictureOnly(fs.readFileSync(FILE))
  // The colour profile goes right after IHDR (it must come before the picture data).
  const iccp = chunk('iCCP', Buffer.concat([Buffer.from('sRGB\0\0', 'latin1'), deflateSync(srgbProfile())]))
  const withProfile = Buffer.concat([picture.subarray(0, 33), iccp, picture.subarray(33)])
  const out = injectExifPng(withProfile, {
    make: 'b0r3d optics',
    model: 'Rukus-Cam 95 Deluxe',
    lensModel: 'b0r3d Prime 28mm f/1.4 Deluxe',
    artist: 'still_b0r3d',
    copyright: '(c) 2026 b0r3d.org - All rights reserved',
    software: SOFTWARE,
    description: 'Rukus the Cat, Chief Executive Officer of b0r3d.org',
    dateTime: '1995:08:24 09:05:00',
    orientation: 1,
    iso: 100,
    fNumber: 1.4,
    exposureTime: '1/250',
    focalLength: 28,
    gps: { latitude: 41.878113, longitude: -87.629799, altitude: 182 },
    thumbnail: await thumbnail(picture)
  })
  fs.writeFileSync(FILE, out)

  const meta = inspectMetadata(new Uint8Array(out))
  console.log(`Wrote ${path.relative(ROOT, FILE)}: ${out.length.toLocaleString()} bytes`)
  console.log(`  ${meta.make} ${meta.model}, ${meta.software}, ${meta.dateTime}`)
  console.log(`  ${meta.rawTagCount} EXIF tags, thumbnail ${meta.thumbnail?.data.length} bytes, colour profile ${meta.hasIccProfile}`)
} finally {
  await vite.close()
}
