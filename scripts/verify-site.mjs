// Whole-site check. Serves (or visits) the built app in headless Chromium and
// logs every request, including the image worker's, while it loads the
// sample, renders every machine, exports a PNG and decodes it, opens a
// picture of its own, and checks the footer, the 404 page and LICENSE.txt.
// Fails if any request goes to another origin, except b0r3d.org's site-wide
// visitor stats beacon, if a missing file is answered with anything but a
// 404 (what blanked qr.b0r3d.org on 2026-10-05), or if the
// Content-Security-Policy blocks anything except Cloudflare's injected bot
// detection script.
//
//   pnpm build && pnpm verify:site            # serves dist/ itself
//   pnpm verify:site https://img.b0r3d.org    # check the live site
//
// Needs Playwright's Chromium (`pnpm exec playwright install chromium`).
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import fs from 'fs'
import net from 'net'
import path from 'path'
import process from 'process'
import { fileURLToPath } from 'url'
import { chromium } from 'playwright'
import { PNG } from 'pngjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version

// b0r3d.org has Bot Fight Mode on, so Cloudflare adds its JavaScript Detections
// snippet (an inline script, plus one inside a hidden iframe) to every page it
// serves. Its contents change per request, so the CSP can't allow it by hash,
// and Cloudflare only adds a nonce when the policy comes in a response header.
// Blocking it is accepted (owner's call for qr.b0r3d.org, 2026-10-05): nothing
// on this plan acts on its result. Those violations are listed but don't fail
// the check; anything else still does.
const CF_BOT_DETECTION = /__CF\$cv\$params|\/cdn-cgi\/challenge-platform\//

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

async function waitFor(url, timeoutMs = 30_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`${url} did not come up within ${timeoutMs / 1000}s`)
}

/** Runs fn(baseUrl) on the URL given, or on dist/ served by `vite preview`. */
async function withSite(fn) {
  const given = process.argv[2]
  if (given) return fn(given.endsWith('/') ? given : `${given}/`, true)
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    throw new Error('dist/ not found. Run `pnpm build` first, or pass a URL.')
  }
  const port = await freePort()
  const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  const server = spawn(process.execPath, [vite, 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT,
    stdio: 'ignore'
  })
  const base = `http://127.0.0.1:${port}/`
  try {
    await waitFor(base)
    return await fn(base, false)
  } finally {
    server.kill()
  }
}

/** A made-up gradient picture (no photos in this repo). */
function gradientPng(w, h) {
  const png = new PNG({ width: w, height: h })
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) png.data.set([(x * 255) / (w - 1), (y * 255) / (h - 1), 140, 255], (y * w + x) * 4)
  return PNG.sync.write(png)
}

async function run(base, remote) {
  const out = path.join(ROOT, 'test-results', 'verify-site')
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })
  const origin = new URL(base).origin
  const results = []
  const check = (name, ok, detail = '') => {
    results.push(ok)
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  }

  const browser = await chromium.launch()
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } })
  const requests = []
  context.on('request', (r) => requests.push(r.url()))
  const cspViolations = []
  const ownInlineHashes = new Set()
  let cloudflareInjected = false
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      const code = e.target instanceof HTMLScriptElement ? e.target.textContent || '' : ''
      const cloudflare = /__CF\$cv\$params|\/cdn-cgi\/challenge-platform\//.test(code)
      console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI}` + (cloudflare ? ' [Cloudflare bot detection]' : ''))
    })
  })
  context.on('console', (m) => {
    if (/CSP violation|Content Security Policy|Refused to/i.test(m.text())) cspViolations.push(m.text())
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(e.message))
  const readout = page.getByTestId('readout')
  const settle = async (text) => {
    await page.waitForFunction((t) => document.querySelector('[data-testid=readout]')?.textContent.includes(t), text, { timeout: 15000 }).catch(() => {})
    await page.waitForFunction(() => document.querySelector('.busy')?.hidden !== false, null, { timeout: 15000 }).catch(() => {})
  }

  try {
    const resp = await page.goto(base)
    for (const [, code] of (await resp.text()).matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
      if (CF_BOT_DETECTION.test(code)) cloudflareInjected = true
      else ownInlineHashes.add(createHash('sha256').update(code.replace(/\r\n?/g, '\n')).digest('base64'))
    }
    const title = await page.title()
    check('page loads', resp.status() === 200 && title === 'b0r3d DeRes', `status ${resp.status()}, title "${title}"`)
    if (remote) {
      const h = resp.headers()
      check('security headers sent', /camera=\(\)/.test(h['permissions-policy'] || '') && h['x-content-type-options'] === 'nosniff')
    }

    await settle('colours used')
    check('sample renders', (await readout.textContent()).includes('of 4 colours used · 160×144'), await readout.textContent())
    const back = await page.locator('footer a', { hasText: '← b0r3d.org' }).getAttribute('href')
    check('footer links back to b0r3d.org', back === 'https://b0r3d.org')
    const versionLine = (await page.getByTestId('app-version').innerText()).trim()
    check(
      'footer shows the version and build',
      versionLine.includes(`b0r3d DeRes v${PKG_VERSION}`) && /build [0-9a-f]{7}/.test(versionLine) && versionLine.includes('MIT'),
      versionLine
    )
    const workerReqs = requests.filter((u) => /worker[^/]*\.js(\?|$)/.test(u))
    check('image worker loads from this site', workerReqs.length > 0 && workerReqs.every((u) => u.startsWith(origin)), workerReqs[0] || 'no worker request')

    // Every machine, colours checked against its palette.
    const cards = await page.$$eval('.card', (cs) =>
      cs.map((c) => ({ id: c.dataset.profile, kind: c.dataset.kind, palette: c.dataset.palette.split(',') }))
    )
    let wrong = []
    for (const { id, kind, palette } of cards) {
      await page.click(`.card[data-profile="${id}"]`)
      const ok = await page
        .waitForFunction(
          ({ allowed, kind }) => {
            const c = document.querySelector('canvas.result')
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
            if (kind === 'fixed') {
              for (let i = 0; i < d.length; i += 4) {
                const hex = '#' + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')
                if (!allowed.includes(hex)) return false
              }
            } else {
              let nonZero = 0
              for (let i = 0; i < d.length; i += 4) {
                if (d[i] > 0 || d[i + 1] > 0 || d[i + 2] > 0) nonZero++
              }
              if (nonZero === 0) return false
            }
            return true
          },
          { allowed: palette, kind },
          { timeout: 10000 }
        )
        .then(() => true)
        .catch(() => false)
      if (!ok) wrong.push(id)
    }
    check(`all ${cards.length} machines render in their own colours`, wrong.length === 0, wrong.join(', '))

    // Export, decoded.
    await page.click('.card[data-profile="ega"]')
    await settle('320×200')
    await page.click('.seg[aria-label="Size"] button[data-value="4"]')
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download PNG' }).click()
    const d = await pending
    const file = path.join(out, d.suggestedFilename())
    await d.saveAs(file)
    const png = PNG.sync.read(fs.readFileSync(file))
    check('export is named for what it holds', d.suggestedFilename() === 'rukus-ega-320x200-4x.png', d.suggestedFilename())
    check('export is the picture at 4×', png.width === 1280 && png.height === 800, `${png.width}×${png.height}`)
    const raw = fs.readFileSync(file)
    check('export is an indexed PNG', raw[25] === 3, `colour type ${raw[25]}`)

    // A picture of its own.
    await page.locator('#file-input').setInputFiles({ name: 'gradient.png', mimeType: 'image/png', buffer: gradientPng(640, 360) })
    await page.waitForFunction(() => document.querySelector('[data-testid=picture-info]')?.textContent === 'gradient.png · 640×360', null, { timeout: 10000 }).catch(() => {})
    await settle('colours used')
    check('opens a picture from a file', (await page.getByTestId('picture-info').textContent()) === 'gradient.png · 640×360')

    // Phone width: nothing wider than the screen.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(400)
    const sw = await page.evaluate(() => document.documentElement.scrollWidth)
    check('fits a phone screen', sw <= 390, `scroll width ${sw}`)
    await page.setViewportSize({ width: 1440, height: 1000 })

    // Missing files are 404s, never the page (see public/_headers).
    const missing = await page.request.get(new URL('assets/index-doesnotexist.js', base).href)
    check('a missing script is a 404', missing.status() === 404, `status ${missing.status()}`)
    const lost = await page.request.get(new URL('no/such/page', base).href)
    check('a missing page is a 404', lost.status() === 404, `status ${lost.status()}`)
    if (remote) {
      check('the 404 page is ours', (await lost.text()).includes('back to b0r3d DeRes'))
      const js = requests.find((u) => /\/assets\/index-[^/]+\.js$/.test(u))
      const cache = js ? (await page.request.get(js)).headers()['cache-control'] || '' : 'no script found'
      check('scripts are not cached as immutable', !/immutable/.test(cache), cache)
    }
    const lic = await page.request.get(new URL('LICENSE.txt', base).href)
    check('LICENSE.txt is served', lic.status() === 200 && (await lic.text()).startsWith('MIT License'))
  } finally {
    await browser.close()
  }

  // A blocked inline script is Cloudflare's if the listener saw its code, or,
  // for the copy in Cloudflare's iframe where the listener doesn't run, if its
  // hash isn't one of the app's own and Cloudflare injected its snippet.
  const fromCloudflare = (msg) => {
    if (msg.includes('[Cloudflare bot detection]')) return true
    const hash = /a hash \('sha256-([^']+)'\)/.exec(msg)?.[1]
    return Boolean(hash && cloudflareInjected && !ownInlineHashes.has(hash))
  }
  const blocked = cspViolations.filter((m) => !fromCloudflare(m))
  check('nothing blocked by the Content-Security-Policy', blocked.length === 0, blocked.slice(0, 3).join(' | '))
  const cloudflareBlocked = cspViolations.length - blocked.length
  if (cloudflareBlocked) console.log(`      ${cloudflareBlocked} blocked from Cloudflare's bot detection (not the app)`)

  // b0r3d.org's visitor stats are switched on for the whole domain, so the live
  // site gets this beacon injected. It isn't part of the app and is kept on
  // purpose; it's listed but doesn't fail the check.
  const siteStats = (u) => u.startsWith('https://static.cloudflareinsights.com/') || u.startsWith('https://cloudflareinsights.com/')
  const outside = requests.filter((u) => !u.startsWith(origin) && !/^(data|blob):/.test(u))
  const foreign = outside.filter((u) => !siteStats(u))
  check('no request left the site', foreign.length === 0, `${requests.length} requests, ${foreign.length} to other origins`)
  for (const u of foreign) console.log(`      FOREIGN ${u}`)
  for (const u of outside.filter(siteStats)) console.log(`      site-wide visitor stats (not the app) ${u}`)
  check('no script errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  const passed = results.filter(Boolean).length
  console.log(`\n${passed}/${results.length} checks passed`)
  return passed === results.length
}

withSite(run)
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
