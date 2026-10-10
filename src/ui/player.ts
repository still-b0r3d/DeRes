import { MAX_ANIMATION_BUDGET } from '../core/animate'
import type { DeresSettings } from '../core/pipeline'
import type { RenderedView } from '../worker/protocol'
import { h, show } from './dom'
import type { Engine } from './engine'

// Playing an animated GIF in the preview. Each frame goes through the current
// settings in the worker (signal and screen effects included), one at a time,
// a little ahead of the frame on screen; the results are kept for as long as
// the settings stay the same, so after the first pass it loops at the GIF's
// own speed. Any change drops them. The kept frames stay inside the same
// budget as an exported animation; past it, the rest are made again on each
// pass. Paused, the frame on screen is the one the downloads use.

export interface PlayerHost {
  /** The settings to play with, and the preview's enlargement while playing. */
  request(): { settings: DeresSettings; fxScale: number }
  /** Puts a frame on the stage. */
  show(view: RenderedView): void
  started(): void
  /** Playback stopped on this frame. */
  paused(frame: number): void
  problem(message: string): void
}

export class Player {
  readonly el: HTMLElement
  private readonly button: HTMLButtonElement
  private readonly counter: HTMLElement
  private delays: number[] = []
  private current = 0
  private isPlaying = false
  private cache: (RenderedView | null)[] = []
  private cachedPixels = 0
  /** A frame made when the cache was full, waiting to be shown. */
  private spare: RenderedView | null = null
  /** A frame didn't fit: from then on, only the frame due next is made. */
  private full = false
  /** Bumped by every change, so frames made for older settings are dropped. */
  private epoch = 0
  private inFlight: { frame: number; epoch: number } | null = null
  private shownAt = 0
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly engine: Engine,
    private readonly host: PlayerHost
  ) {
    this.button = h('button', { type: 'button', class: 'play-btn', 'data-testid': 'play', 'aria-pressed': 'false', onclick: () => this.toggle() }, '▶ Play')
    this.counter = h('span', { class: 'frame-counter', 'data-testid': 'frame-counter', 'aria-live': 'off' })
    this.el = h('div', { class: 'playbar', hidden: true }, this.button, this.counter)
  }

  /** The frame on screen (the one downloads use). */
  get frame(): number {
    return this.current
  }

  get playing(): boolean {
    return this.isPlaying
  }

  /** A new picture: the delays of its frames, or null for a still. */
  setAnimation(delaysMs: readonly number[] | null): void {
    this.stop()
    this.delays = delaysMs && delaysMs.length > 1 ? [...delaysMs] : []
    this.current = 0
    this.drop()
    show(this.el, this.delays.length > 1)
    this.update()
  }

  /** The settings (or the preview's size) changed: the frames made so far are no good. */
  invalidate(): void {
    if (this.delays.length < 2) return
    this.drop()
    this.update()
    if (this.isPlaying) this.pump()
  }

  toggle(): void {
    if (this.isPlaying) this.pause()
    else this.play()
  }

  play(): void {
    if (this.isPlaying || this.delays.length < 2) return
    this.isPlaying = true
    this.button.textContent = '❚❚ Pause'
    this.button.setAttribute('aria-pressed', 'true')
    this.host.started()
    this.shownAt = performance.now()
    this.pump()
  }

  pause(): void {
    if (!this.isPlaying) return
    this.stop()
    this.update()
    this.host.paused(this.current)
  }

  /** Stops quietly (a new picture is on its way), keeping the frame on screen. */
  halt(): void {
    this.stop()
    this.update()
  }

  private stop(): void {
    this.isPlaying = false
    clearTimeout(this.timer)
    this.button.textContent = '▶ Play'
    this.button.setAttribute('aria-pressed', 'false')
  }

  private drop(): void {
    this.epoch++
    this.cache = this.delays.map(() => null)
    this.cachedPixels = 0
    this.spare = null
    this.full = false
    this.el.dataset.cached = '0'
  }

  private ready(k: number): RenderedView | null {
    return this.cache[k] ?? (this.spare?.frame === k ? this.spare : null)
  }

  /** Shows the next frame when it's due and made; asks for frames ahead. */
  private pump(): void {
    clearTimeout(this.timer)
    if (!this.isPlaying) return
    const n = this.delays.length
    const next = (this.current + 1) % n
    const view = this.ready(next)
    const due = this.shownAt + this.delays[this.current]
    const now = performance.now()
    if (view && now >= due) {
      this.current = next
      if (this.spare === view) this.spare = null
      this.host.show(view)
      // Keep to the GIF's timing, unless the frame came late.
      this.shownAt = now - due < this.delays[next] ? due : now
      this.update()
      this.ask()
      this.timer = setTimeout(() => this.pump(), Math.max(0, this.shownAt + this.delays[next] - performance.now()))
      return
    }
    this.update(view ? null : next)
    this.ask()
    if (view) this.timer = setTimeout(() => this.pump(), due - now)
    // Otherwise the frame arriving calls pump().
  }

  /** Asks the worker for the next frame not yet made, if nothing's on its way. */
  private ask(): void {
    if (this.inFlight || !this.isPlaying) return
    const n = this.delays.length
    let frame = -1
    for (let i = 1; i <= n; i++) {
      const k = (this.current + i) % n
      if (this.ready(k)) continue
      // With no room left, only the frame that's due next is worth making.
      if (this.full && i > 1) break
      frame = k
      break
    }
    if (frame < 0) return
    const epoch = this.epoch
    const picture = this.engine.picture
    this.inFlight = { frame, epoch }
    const { settings, fxScale } = this.host.request()
    this.engine.renderFrame(settings, fxScale, frame).then(
      (view) => {
        this.inFlight = null
        if (epoch !== this.epoch || picture !== this.engine.picture) return this.pump()
        const pixels = view.width * view.height + (view.fx ? view.fx.width * view.fx.height : 0)
        if (this.cachedPixels + pixels <= MAX_ANIMATION_BUDGET) {
          this.cache[frame] = view
          this.cachedPixels += pixels
          this.el.dataset.cached = String(this.cache.filter(Boolean).length)
        } else {
          this.full = true
          this.spare = view
        }
        this.pump()
      },
      (err: Error) => {
        this.inFlight = null
        if (epoch !== this.epoch || picture !== this.engine.picture || !this.isPlaying) return
        this.pause()
        this.host.problem(`Something went wrong: ${err.message}`)
      }
    )
  }

  /** "12 / 58", or "Rendering 12 / 58…" while waiting for that frame. */
  private update(waitingFor: number | null = null): void {
    const n = this.delays.length
    this.counter.textContent = waitingFor !== null ? `Rendering ${waitingFor + 1} / ${n}…` : `${this.current + 1} / ${n}`
  }
}
