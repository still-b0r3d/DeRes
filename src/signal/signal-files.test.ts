import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The engine is built by `pnpm build:signal` and committed (the site build has
// no Rust). This catches a .wasm that changed without a rebuild, or one that
// git mangled (line endings: .gitattributes marks it binary).

const file = (name: string) => readFileSync(new URL(`./wasm/${name}`, import.meta.url))

describe('committed signal engine', () => {
  const manifest = JSON.parse(file('manifest.json').toString('utf8'))

  it('matches the manifest written when it was built', () => {
    const wasm = file('deres_signal_bg.wasm')
    expect(wasm.length).toBe(manifest.bytes)
    expect(createHash('sha256').update(wasm).digest('hex')).toBe(manifest.sha256)
  })

  it('was built from the engine commit signal/Cargo.toml pins', () => {
    const cargo = readFileSync(new URL('../../signal/Cargo.toml', import.meta.url), 'utf8')
    expect(cargo).toContain(`rev = "${manifest.engineRev}"`)
    expect(cargo).toContain(`wasm-bindgen = "=${manifest.wasmBindgen}"`)
  })

  it('is small enough to load only when needed', () => {
    expect(manifest.bytes).toBeLessThan(300 * 1024)
  })
})
