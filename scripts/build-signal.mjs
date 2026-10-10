// Rebuilds the signal engine (signal/ → src/signal/wasm/). The built files are
// committed, so the site build (`pnpm build`) never needs Rust; run this only
// after changing signal/ or moving the engine to a new commit.
//
//   pnpm build:signal
//
// Needs Rust with the wasm32-unknown-unknown target, and wasm-bindgen-cli at
// exactly the version signal/Cargo.toml pins (on PATH, or set WASM_BINDGEN to
// the program's path). Picks up RUSTUP_TOOLCHAIN and CARGO_TARGET_DIR as cargo
// does. The test suite checks the committed .wasm against the manifest written
// here (src/signal/signal-files.test.ts).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const crate = join(root, 'signal')
const out = join(root, 'src', 'signal', 'wasm')
const bindgen = process.env.WASM_BINDGEN || 'wasm-bindgen'
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', ...opts }).trim()

const cargoToml = readFileSync(join(crate, 'Cargo.toml'), 'utf8')
const pinned = cargoToml.match(/wasm-bindgen = "=([^"]+)"/)?.[1]
const engineRev = cargoToml.match(/rev = "([0-9a-f]{40})"/)?.[1]
const cli = run(bindgen, ['--version']).split(/\s+/)[1]
if (cli !== pinned) {
  console.error(`wasm-bindgen-cli is ${cli}, but signal/Cargo.toml pins ${pinned}. Install that version.`)
  process.exit(1)
}

const targetDir = process.env.CARGO_TARGET_DIR || join(crate, 'target')
// Panic messages carry the source paths of the engine and its libraries, which
// sit under the cargo home (C:\Users\<name>\.cargo); they go in as /cargo, so
// the committed file doesn't name the PC that built it.
const cargoHome = process.env.CARGO_HOME || join(homedir(), '.cargo')
// simd128 only: every browser DeRes supports has it (relaxed SIMD would be
// faster in Chromium, but Safari can't load it, and the two builds give
// slightly different pictures).
const rustflags = ['-C', 'target-feature=+simd128', `--remap-path-prefix=${cargoHome}=/cargo`]
execFileSync('cargo', ['build', '--release', '--locked', '--target', 'wasm32-unknown-unknown'], {
  cwd: crate,
  stdio: 'inherit',
  // The encoded form keeps a cargo home with spaces in it in one piece.
  env: { ...process.env, CARGO_TARGET_DIR: targetDir, CARGO_ENCODED_RUSTFLAGS: rustflags.join('\x1f') }
})

for (const f of readdirSync(out)) if (f.startsWith('deres_signal')) rmSync(join(out, f))
run(bindgen, [
  join(targetDir, 'wasm32-unknown-unknown', 'release', 'deres_signal.wasm'),
  '--target', 'web',
  '--out-dir', out,
  '--out-name', 'deres_signal'
])

const wasm = readFileSync(join(out, 'deres_signal_bg.wasm'))
const manifest = {
  engine: 'https://github.com/valadaptive/ntsc-rs (crates/ntscrs)',
  engineRev,
  wasmBindgen: pinned,
  rustc: run('rustc', ['--version']),
  target: 'wasm32-unknown-unknown +simd128',
  bytes: wasm.length,
  sha256: createHash('sha256').update(wasm).digest('hex')
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`signal engine built: ${(wasm.length / 1024).toFixed(0)} KiB, sha256 ${manifest.sha256.slice(0, 16)}…`)
