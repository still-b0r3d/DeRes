import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { SignalEngine } from '../core/signal'
import { default_settings_json, initSync, signal } from '../signal/wasm/deres_signal.js'

// The signal engine for unit tests: the same committed .wasm the site loads,
// instantiated from the file (Node has no fetch for file URLs).

let engine: SignalEngine | null = null

export function testSignalEngine(): SignalEngine {
  if (!engine) {
    initSync({ module: readFileSync(fileURLToPath(new URL('../signal/wasm/deres_signal_bg.wasm', import.meta.url))) })
    engine = { signal, defaultsJson: default_settings_json() }
  }
  return engine
}
