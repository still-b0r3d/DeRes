import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'

// Shown in the footer. The version is bumped by hand for every live release
// (see README, Versioning); the build is the commit it was built from, which
// the hosting build passes in and a local build asks git for.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

function buildCommit(): string {
  if (process.env.CF_PAGES_COMMIT_SHA) return process.env.CF_PAGES_COMMIT_SHA
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return ''
  }
}

// Content-Security-Policy for the built page, as a <meta> tag so every copy of
// the build (the live site, `vite preview`, the verify script) runs under it.
// frame-ancestors can't go in a <meta>, so public/_headers sends that one.
// Inline scripts in index.html (there are none today) would be allowed by
// their hash, worked out here so an edit can't silently break the page.
const CSP_SOURCES: Record<string, string[]> = {
  'default-src': ["'self'"],
  // Cloudflare injects b0r3d.org's visitor-stats beacon into the live page.
  'script-src': ["'self'", 'https://static.cloudflareinsights.com'],
  // Styles come from the built stylesheet only; the app sets the few dynamic
  // ones (sizes, swatch colours) through element.style, which CSP allows.
  'style-src': ["'self'"],
  // blob: is the decoded photo being shown and the exported PNG.
  'img-src': ["'self'", 'blob:'],
  'font-src': ["'self'"],
  // The visitor-stats beacon reports back to Cloudflare.
  'connect-src': ["'self'", 'https://cloudflareinsights.com'],
  // The image engine runs in a worker built next to the page.
  'worker-src': ["'self'"],
  'manifest-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'none'"]
}

function contentSecurityPolicy(): Plugin {
  return {
    name: 'b0r3d-content-security-policy',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
        const hashes = inline.map(
          // Browsers turn CRLF into LF before hashing, so a Windows checkout
          // (CRLF) has to be hashed the same way.
          ([, code]) =>
            `'sha256-${createHash('sha256').update(code.replace(/\r\n?/g, '\n')).digest('base64')}'`
        )
        const sources = { ...CSP_SOURCES, 'script-src': [...CSP_SOURCES['script-src'], ...hashes] }
        const policy = Object.entries(sources)
          .map(([directive, values]) => `${directive} ${values.join(' ')}`)
          .join('; ')
        return html.replace(
          /<head>/,
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}">`
        )
      }
    }
  }
}

// The footer's "MIT" links to /LICENSE.txt, a copy of LICENSE made at build
// time (and served by the dev server), so the link works while the repository
// is private.
function licenseFile(): Plugin {
  const text = () => readFileSync(new URL('./LICENSE', import.meta.url), 'utf8')
  return {
    name: 'b0r3d-license-file',
    configureServer(server) {
      server.middlewares.use('/LICENSE.txt', (_req, res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end(text())
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'LICENSE.txt', source: text() })
    }
  }
}

export default defineConfig({
  // A multi-page app setup has no single-page fallback: a missing file is a
  // 404 in `vite dev` and `vite preview`, the same as on the live site with
  // public/404.html (see the note in public/_headers).
  appType: 'mpa',
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(version),
    'import.meta.env.VITE_BUILD_COMMIT': JSON.stringify(buildCommit())
  },
  build: {
    // Every asset stays a file of its own, so the policy above needs no data:.
    assetsInlineLimit: 0
  },
  worker: { format: 'es' },
  plugins: [contentSecurityPolicy(), licenseFile()]
})
