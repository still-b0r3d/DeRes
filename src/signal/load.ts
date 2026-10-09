import type { SignalEngine } from '../core/signal'

// Loads the signal engine (WebAssembly) the first time the signal is switched
// on. A dynamic import, so the page and the worker don't carry it otherwise.

let loading: Promise<SignalEngine> | null = null

export function loadSignalEngine(): Promise<SignalEngine> {
  loading ??= (async () => {
    const glue = await import('./wasm/deres_signal.js')
    await glue.default()
    return { signal: glue.signal, defaultsJson: glue.default_settings_json() }
  })().catch((err: unknown) => {
    loading = null
    throw new Error(`The signal engine didn't load (${(err as Error)?.message ?? err})`)
  })
  return loading
}
