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
// budget as an exported animation (the preview plays smaller if need be, see
// playScale); past it, the rest are made again on each pass. A slider goes
// to any frame: while it's held, it shows the frames already made (making the
// one under it if need be), and dragging it while playing pauses until it's
// let go. Paused, the frame on screen is the one the downloads use.

export interface PlayerHost {
  /** The settings to play with, and the preview's enlargement while playing. */
  request(): { settings: DeresSettings; fxScale: number }
  /** Puts a frame on the stage. */
  show(view: RenderedView): void
  started(): void
  /** Playback stopped on this frame, or the slider moved to it (or was let go on it) while paused. */
  paused(frame: number): void
  problem(message: string): void
}

/**
 * The preview's enlargement while a GIF plays: `scale` if every frame fits
 * the budget at that size, else the biggest that does, so the frames are
 * kept and it loops smoothly. Whole steps down to 2× (even scanlines), then
 * tenths down to 1× (the picture's own size; the scanlines fade out on the
 * way). `size` gives a frame's size at an enlargement.
 */
export function playScale(
  scale: number,
  frames: number,
  size: (s: number) => readonly [number, number],
  budget = MAX_ANIMATION_BUDGET
): number {
  const fits = (s: number) => {
    const [w, h] = size(s)
    return w * h * frames <= budget
  }
  let s = scale
  while (s > 2 && !fits(s)) s--
  if (fits(s)) return s
  for (let t = Math.round(s * 10) - 1; t > 10; t--) if (fits(t / 10)) return t / 10
  return 1
}

export class Player {
  readonly el: HTMLElement
  private readonly button: HTMLButtonElement
  private readonly counter: HTMLElement
  private readonly slider: HTMLInputElement
  /** The slider is held down. */
  private dragging = false
  /** Playing when the slider was grabbed: it goes on when the slider is let go. */
  private resumeAfterDrag = false
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
    this.slider = h('input', { type: 'range', class: 'frame-slider', min: 0, max: 1, step: 1, value: 0, 'aria-label': 'Frame', 'data-testid': 'frame-slider' })
    this.slider.addEventListener('pointerdown', () => {
      if (this.delays.length < 2 || this.dragging) return
      this.dragging = true
      if (this.isPlaying) {
        // Paused only while it's held, so nothing else needs to know.
        this.resumeAfterDrag = true
        this.stop()
        this.update()
      }
      // Let go anywhere (even off the slider, or without moving it).
      window.addEventListener('pointerup', this.letGo)
      window.addEventListener('pointercancel', this.letGo)
    })
    this.slider.addEventListener('input', () => this.seek(Number(this.slider.value)))
    this.slider.addEventListener('change', this.letGo)
    this.el = h('div', { class: 'playbar', hidden: true }, this.button, this.slider, this.counter)
  }

  /** The frame on screen (the one downloads use). */
  get frame(): number {
    return this.current
  }

  get playing(): boolean {
    return this.isPlaying
  }

  /** The slider is held down (frames shown are the ones made at the playing size). */
  get holding(): boolean {
    return this.dragging
  }

  /** A new picture: the delays of its frames, or null for a still. */
  setAnimation(delaysMs: readonly number[] | null): void {
    this.stop()
    this.dragging = false
    this.resumeAfterDrag = false
    this.delays = delaysMs && delaysMs.length > 1 ? [...delaysMs] : []
    this.current = 0
    this.drop()
    show(this.el, this.delays.length > 1)
    // Room for the longest count ("58 / 58"), so the slider never changes width.
    const n = String(this.delays.length).length
    this.counter.style.width = `${n * 2 + 3}ch`
    this.update()
  }

  /** The settings (or the preview's size) changed: the frames made so far are no good. */
  invalidate(): void {
    if (this.delays.length < 2) return
    this.drop()
    this.update()
    if (this.isPlaying) this.pump()
    else if (this.dragging) this.ask()
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

  /**
   * Goes to frame k, shown straight away if it has been made. Playing, it
   * plays on from there; held, the frame under the slider is made at the
   * playing size if it hasn't been (a full-size one for every step would
   * come too late, after the slider moved on); paused, it's the frame the
   * downloads use.
   */
  seek(k: number): void {
    const n = this.delays.length
    if (n < 2) return
    this.current = Math.max(0, Math.min(n - 1, Math.round(k)))
    const view = this.ready(this.current)
    if (view) this.host.show(view)
    this.update(!view && this.dragging)
    if (this.isPlaying) {
      this.shownAt = performance.now()
      this.pump()
    } else if (this.dragging) {
      this.ask()
    } else {
      this.host.paused(this.current)
    }
  }

  /** Stops quietly (a new picture is on its way), keeping the frame on screen. */
  halt(): void {
    this.stop()
    this.update()
  }

  /** The slider was let go: playing goes on, or the frame it's on is the one paused on. */
  private readonly letGo = (): void => {
    window.removeEventListener('pointerup', this.letGo)
    window.removeEventListener('pointercancel', this.letGo)
    if (!this.dragging) return
    this.dragging = false
    if (this.resumeAfterDrag) {
      this.resumeAfterDrag = false
      this.play()
      return
    }
    this.update()
    this.host.paused(this.current)
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
    this.update(!view)
    this.ask()
    if (view) this.timer = setTimeout(() => this.pump(), due - now)
    // Otherwise the frame arriving calls pump().
  }

  /** The frame to make next, or -1: playing, the next one ahead not yet made; held, the one under the slider. */
  private wanted(): number {
    if (!this.isPlaying) return this.dragging && !this.ready(this.current) ? this.current : -1
    const n = this.delays.length
    for (let i = 1; i <= n; i++) {
      const k = (this.current + i) % n
      if (this.ready(k)) continue
      // With no room left, only the frame that's due next is worth making.
      if (this.full && i > 1) return -1
      return k
    }
    return -1
  }

  /** Asks the worker for the frame wanted next, if nothing's on its way. */
  private ask(): void {
    if (this.inFlight) return
    const frame = this.wanted()
    if (frame < 0) return
    const epoch = this.epoch
    const picture = this.engine.picture
    this.inFlight = { frame, epoch }
    const { settings, fxScale } = this.host.request()
    this.engine.renderFrame(settings, fxScale, frame).then(
      (view) => {
        this.inFlight = null
        const fresh = epoch === this.epoch && picture === this.engine.picture
        if (fresh) this.keep(frame, view)
        if (this.isPlaying) return this.pump()
        if (fresh && this.dragging && frame === this.current) {
          this.host.show(view)
          this.update()
        }
        this.ask()
      },
      (err: Error) => {
        this.inFlight = null
        if (epoch !== this.epoch || picture !== this.engine.picture || !this.isPlaying) return
        this.pause()
        this.host.problem(`Something went wrong: ${err.message}`)
      }
    )
  }

  /** Keeps a frame while there's room in the budget, else holds it until it's shown. */
  private keep(frame: number, view: RenderedView): void {
    // With a screen effect or the signal, the enlarged picture is all a frame holds.
    const pixels = view.fx ? view.fx.width * view.fx.height : view.width * view.height
    if (this.cachedPixels + pixels <= MAX_ANIMATION_BUDGET) {
      this.cache[frame] = view
      this.cachedPixels += pixels
      this.el.dataset.cached = String(this.cache.filter(Boolean).length)
    } else {
      this.full = true
      this.spare = view
    }
  }

  /** "12 / 58", dimmed while the next frame is still being made; the slider follows. */
  private update(waiting = false): void {
    const n = this.delays.length
    this.counter.textContent = `${this.current + 1} / ${n}`
    this.counter.classList.toggle('waiting', waiting)
    this.slider.max = String(Math.max(1, n - 1))
    this.slider.value = String(this.current)
  }
}
