import type { DeresSettings } from '../core/pipeline'
import type { AnimationStyle, FromWorker, LoadedGif, RenderedMessage, RenderedView, ToWorker } from '../worker/protocol'
import type { WorkingCopy } from './loader'

// The page's side of the image worker. Rendering is "latest wins": one job in
// flight at a time; while it runs, only the newest settings are kept, and an
// answer about an older picture is dropped. Everything else (exports, the
// frames of an animated GIF) is a request that gets its own answer.

export interface RenderRequest {
  settings: DeresSettings
  fxScale: number
  /** The frame of an animated GIF (0 for a still). */
  frame: number
}

interface Pending {
  resolve: (v: never) => void
  reject: (e: Error) => void
  onProgress?: (done: number, total: number) => void
}

export class Engine {
  private readonly worker = new Worker(new URL('../worker/deres.worker.ts', import.meta.url), { type: 'module' })
  private gen = 0
  private job = 0
  private busy = false
  private queued: RenderRequest | null = null
  private requestId = 0
  private readonly pending = new Map<number, Pending>()
  private loading: ((hasAlpha: boolean) => void) | null = null
  private loadingGif: ((gif: LoadedGif | null) => void) | null = null

  onRendered: (r: RenderedMessage) => void = () => {}
  onError: (message: string) => void = () => {}
  onBusy: (busy: boolean) => void = () => {}

  constructor() {
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data)
    this.worker.onerror = () => this.onError('The image engine stopped. Reloading the page should fix it.')
  }

  /** Answers about the current picture carry this; it changes with every picture. */
  get picture(): number {
    return this.gen
  }

  /**
   * Hands a new picture to the worker (its pixel buffer moves there, so
   * copy.rgba is empty afterwards). Resolves with whether it has transparency.
   */
  load(copy: WorkingCopy): Promise<boolean> {
    this.newPicture()
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

  /**
   * Hands an animated GIF's bytes to the worker, which decodes every frame
   * and keeps them. Resolves with frame 0 and the timing, or null when it
   * doesn't open as an animation (then load() it as a still).
   */
  loadGif(bytes: Uint8Array, maxEdge: number): Promise<LoadedGif | null> {
    this.newPicture()
    const copy = bytes.slice().buffer as ArrayBuffer
    this.post({ type: 'load-gif', gen: this.gen, bytes: copy, maxEdge }, [copy])
    return new Promise((resolve) => (this.loadingGif = resolve))
  }

  render(req: RenderRequest): void {
    if (this.gen === 0) return
    if (this.busy) {
      this.queued = req
      return
    }
    this.send(req)
  }

  /** One frame of an animated GIF, for playback. Rejects if the picture changes first. */
  renderFrame(settings: DeresSettings, fxScale: number, frame: number): Promise<RenderedView> {
    return this.request((id) => ({ type: 'render-frame', id, gen: this.gen, settings, fxScale, frame }))
  }

  /** A frame of the animated GIF as it was opened, r, g, b, a per pixel. */
  sourceFrame(frame: number): Promise<{ width: number; height: number; rgba: ArrayBuffer }> {
    return this.request((id) => ({ type: 'source-frame', id, gen: this.gen, frame }))
  }

  export(settings: DeresSettings, multiplier: number, withFx: boolean, base: string, frame = 0): Promise<ExportResult> {
    return this.request((id) => ({ type: 'export', id, gen: this.gen, settings, multiplier, withFx, base, frame }))
  }

  exportEmulator(settings: DeresSettings, format: 'scr' | 'koa' | 'chr', base: string, frame = 0): Promise<EmulatorExportResult> {
    return this.request((id) => ({ type: 'export-emulator', id, gen: this.gen, settings, format, base, frame }))
  }

  exportWallpaper(
    settings: DeresSettings,
    preset: 'phone' | 'win95' | 'desktop-1080p',
    withFx: boolean,
    base: string,
    frame = 0
  ): Promise<ExportResult> {
    return this.request((id) => ({ type: 'export-wallpaper', id, gen: this.gen, settings, preset, withFx, base, frame }))
  }

  exportAnimated(
    settings: DeresSettings,
    format: 'apng' | 'gif',
    animationStyle: AnimationStyle,
    multiplier: number,
    withFx: boolean,
    base: string,
    onProgress?: (done: number, total: number) => void,
    loop?: { frames: number; fps: number },
    frame = 0
  ): Promise<AnimatedExportResult> {
    return this.request(
      (id) => ({ type: 'export-animated', id, gen: this.gen, settings, format, animationStyle, multiplier, withFx, base, loop, frame }),
      onProgress
    )
  }

  private request<T>(make: (id: number) => ToWorker, onProgress?: (done: number, total: number) => void): Promise<T> {
    const id = ++this.requestId
    this.post(make(id))
    return new Promise<T>((resolve, reject) => this.pending.set(id, { resolve: resolve as (v: never) => void, reject, onProgress }))
  }

  private settle(id: number, value: unknown): void {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    p.resolve(value as never)
  }

  private newPicture(): void {
    this.gen++
    this.queued = null
    this.busy = false
    this.loading = null
    this.loadingGif?.(null)
    this.loadingGif = null
  }

  private send(req: RenderRequest): void {
    this.busy = true
    this.onBusy(true)
    this.post({ type: 'render', job: ++this.job, gen: this.gen, settings: req.settings, fxScale: req.fxScale, frame: req.frame })
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
      case 'loaded-gif':
        if (msg.gen === this.gen) {
          this.loadingGif?.(msg.gif)
          this.loadingGif = null
        }
        return
      case 'rendered':
      case 'error': {
        if (msg.type === 'error' && msg.id !== undefined) {
          const p = this.pending.get(msg.id)
          if (p) {
            this.pending.delete(msg.id)
            p.reject(new Error(msg.message))
          }
          return
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
      case 'rendered-frame':
        this.settle(msg.id, msg.view)
        return
      case 'source-frame':
        this.settle(msg.id, { width: msg.width, height: msg.height, rgba: msg.rgba })
        return
      case 'exported':
      case 'exported-wallpaper':
      case 'exported-animated':
        this.settle(msg.id, msg)
        return
      case 'exported-emulator':
        this.settle(msg.id, { data: new Uint8Array(msg.data), filename: msg.filename, mimeType: msg.mimeType })
        return
      case 'progress':
        this.pending.get(msg.id)?.onProgress?.(msg.done, msg.total)
        return
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
