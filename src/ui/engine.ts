import type { DeresSettings } from '../core/pipeline'
import type { FromWorker, RenderedMessage, ToWorker } from '../worker/protocol'
import type { WorkingCopy } from './loader'

// The page's side of the image worker. Rendering is "latest wins": one job in
// flight at a time; while it runs, only the newest settings are kept, and an
// answer about an older picture is dropped.

export interface RenderRequest {
  settings: DeresSettings
  fxScale: number
}

export class Engine {
  private readonly worker = new Worker(new URL('../worker/deres.worker.ts', import.meta.url), { type: 'module' })
  private gen = 0
  private job = 0
  private busy = false
  private queued: RenderRequest | null = null
  private exportId = 0
  private readonly exports = new Map<number, { resolve: (v: ExportResult) => void; reject: (e: Error) => void }>()
  private loading: ((hasAlpha: boolean) => void) | null = null

  onRendered: (r: RenderedMessage) => void = () => {}
  onError: (message: string) => void = () => {}
  onBusy: (busy: boolean) => void = () => {}

  constructor() {
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data)
    this.worker.onerror = () => this.onError('The image engine stopped. Reloading the page should fix it.')
  }

  /**
   * Hands a new picture to the worker (its pixel buffer moves there, so
   * copy.rgba is empty afterwards). Resolves with whether it has transparency.
   */
  load(copy: WorkingCopy): Promise<boolean> {
    this.gen++
    this.queued = null
    this.busy = false
    const rgba = copy.rgba.slice().buffer as ArrayBuffer
    this.post(
      {
        type: 'load',
        gen: this.gen,
        width: copy.width,
        height: copy.height,
        origW: copy.origW,
        origH: copy.origH,
        rgba
      },
      [rgba]
    )
    return new Promise((resolve) => (this.loading = resolve))
  }

  render(req: RenderRequest): void {
    if (this.gen === 0) return
    if (this.busy) {
      this.queued = req
      return
    }
    this.send(req)
  }

  export(settings: DeresSettings, multiplier: number, withFx: boolean, base: string): Promise<ExportResult> {
    const id = ++this.exportId
    this.post({ type: 'export', id, gen: this.gen, settings, multiplier, withFx, base })
    return new Promise((resolve, reject) => this.exports.set(id, { resolve, reject }))
  }

  private emuExportId = 0
  private readonly emuExports = new Map<number, { resolve: (v: EmulatorExportResult) => void; reject: (e: Error) => void }>()
  private wallpaperExportId = 0
  private readonly wallpaperExports = new Map<number, { resolve: (v: ExportResult) => void; reject: (e: Error) => void }>()

  exportEmulator(settings: DeresSettings, format: 'scr' | 'koa' | 'chr', base: string): Promise<EmulatorExportResult> {
    const id = ++this.emuExportId
    this.post({ type: 'export-emulator', id, gen: this.gen, settings, format, base })
    return new Promise((resolve, reject) => this.emuExports.set(id, { resolve, reject }))
  }

  exportWallpaper(
    settings: DeresSettings,
    preset: 'phone' | 'win95' | 'desktop-1080p',
    withFx: boolean,
    base: string
  ): Promise<ExportResult> {
    const id = ++this.wallpaperExportId
    this.post({ type: 'export-wallpaper', id, gen: this.gen, settings, preset, withFx, base })
    return new Promise((resolve, reject) => this.wallpaperExports.set(id, { resolve, reject }))
  }

  private animatedExportId = 0
  private readonly animatedExports = new Map<
    number,
    { resolve: (v: AnimatedExportResult) => void; reject: (e: Error) => void; onProgress?: (done: number, total: number) => void }
  >()

  exportAnimated(
    settings: DeresSettings,
    format: 'apng' | 'gif',
    animationStyle: 'screen-fx' | 'compare-wipe' | 'dither-shimmer',
    multiplier: number,
    withFx: boolean,
    base: string,
    onProgress?: (done: number, total: number) => void,
    loop?: { frames: number; fps: number }
  ): Promise<AnimatedExportResult> {
    const id = ++this.animatedExportId
    this.post({
      type: 'export-animated',
      id,
      gen: this.gen,
      settings,
      format,
      animationStyle,
      multiplier,
      withFx,
      base,
      loop
    })
    return new Promise((resolve, reject) => this.animatedExports.set(id, { resolve, reject, onProgress }))
  }

  private send(req: RenderRequest): void {
    this.busy = true
    this.onBusy(true)
    this.post({ type: 'render', job: ++this.job, gen: this.gen, settings: req.settings, fxScale: req.fxScale })
  }

  private post(msg: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer)
  }

  private receive(msg: FromWorker): void {
    switch (msg.type) {
      case 'loaded':
        if (msg.gen === this.gen) {
          this.loading?.(msg.hasAlpha)
          this.loading = null
        }
        return
      case 'rendered':
      case 'error': {
        if ('id' in msg && msg.id !== undefined) {
          const exp = this.exports.get(msg.id)
          if (exp) {
            exp.reject(new Error(msg.message))
            this.exports.delete(msg.id)
            return
          }
          const emuExp = this.emuExports.get(msg.id)
          if (emuExp) {
            emuExp.reject(new Error(msg.message))
            this.emuExports.delete(msg.id)
            return
          }
          const wallExp = this.wallpaperExports.get(msg.id)
          if (wallExp) {
            wallExp.reject(new Error(msg.message))
            this.wallpaperExports.delete(msg.id)
            return
          }
          const animExp = this.animatedExports.get(msg.id)
          if (animExp) {
            animExp.reject(new Error(msg.message))
            this.animatedExports.delete(msg.id)
            return
          }
        }
        if (msg.gen !== this.gen) return
        this.busy = false
        if (msg.type === 'rendered') this.onRendered(msg)
        else this.onError(msg.message)
        const next = this.queued
        this.queued = null
        if (next) this.send(next)
        else this.onBusy(false)
        return
      }
      case 'exported':
        this.exports.get(msg.id)?.resolve(msg)
        this.exports.delete(msg.id)
        return
      case 'exported-wallpaper':
        this.wallpaperExports.get(msg.id)?.resolve(msg)
        this.wallpaperExports.delete(msg.id)
        return
      case 'exported-emulator': {
        const item = this.emuExports.get(msg.id)
        if (item) {
          item.resolve({ data: new Uint8Array(msg.data), filename: msg.filename, mimeType: msg.mimeType })
          this.emuExports.delete(msg.id)
        }
        return
      }
      case 'progress':
        this.animatedExports.get(msg.id)?.onProgress?.(msg.done, msg.total)
        return
      case 'exported-animated': {
        const item = this.animatedExports.get(msg.id)
        if (item) {
          item.resolve(msg)
          this.animatedExports.delete(msg.id)
        }
        return
      }
    }
  }
}

export interface ExportResult {
  png: ArrayBuffer
  filename: string
  width: number
  height: number
}

export interface EmulatorExportResult {
  data: Uint8Array
  filename: string
  mimeType: string
}

export interface AnimatedExportResult {
  data: ArrayBuffer
  filename: string
  mimeType: 'image/png' | 'image/gif'
  width: number
  height: number
  frameCount: number
}
