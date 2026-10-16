import type { Rect } from '../core/resample'
import { h, show } from './dom'

// The preview. The result is drawn at its real size and enlarged by CSS
// (image-rendering: pixelated), at a whole-number scale when it fits, so
// pixels stay square and sharp. The original sits on top of it for comparing:
// behind a draggable divider, or all of it while the picture is held down.

export interface View {
  width: number
  height: number
  /** Null when fx is there: only that is drawn. */
  rgba: ArrayBuffer | null
  fx: { width: number; height: number; rgba: ArrayBuffer } | null
  par: readonly [number, number]
  src: Rect
  dst: Rect
}

/** Most pixels the screen-effect preview renders. */
const FX_PREVIEW_PIXELS = 2_500_000

/** The checkerboard behind see-through pixels: square size (CSS px) and colours, as `.frame.see-through` in style.css. */
const CHECKER = { size: 8, light: '#3a3a3a', dark: '#262626' }

export class Stage {
  readonly el: HTMLElement
  private readonly frame: HTMLElement
  private readonly result: HTMLCanvasElement
  private readonly original: HTMLCanvasElement
  private readonly divider: HTMLElement
  private readonly handle: HTMLButtonElement
  private readonly tags: { left: HTMLElement; right: HTMLElement }
  private readonly centre: HTMLElement
  private readonly note: HTMLElement
  readonly compareButton: HTMLButtonElement
  private view: View | null = null
  private copy: HTMLCanvasElement | null = null
  private tv = false
  /** What transparent parts of the original sit on; null: they stay see-through (a checkerboard). */
  private background: string | null = '#ffffff'
  private comparing = false
  private split = 0.5
  private holding = false
  private dragging = false
  private noteTimer: ReturnType<typeof setTimeout> | undefined
  private originalKey = ''
  private originalFrom: HTMLCanvasElement | null = null
  /** An animation is playing: there's no original to show for a moving frame. */
  private playing = false
  /** Called when the preview box changes size. */
  onResize: () => void = () => {}

  constructor() {
    this.result = h('canvas', { class: 'result', 'aria-label': 'Result', role: 'img' })
    this.original = h('canvas', { class: 'original', 'aria-hidden': 'true' })
    this.handle = h('button', {
      type: 'button',
      class: 'divider-handle',
      role: 'slider',
      'aria-label': 'Divider between the original and the result',
      'aria-valuemin': 0,
      'aria-valuemax': 100
    })
    this.divider = h('div', { class: 'divider', hidden: true }, this.handle)
    this.tags = {
      left: h('span', { class: 'tag tag-left', hidden: true }, 'Original'),
      right: h('span', { class: 'tag tag-right', hidden: true }, 'DeRes')
    }
    this.frame = h('div', { class: 'frame', hidden: true }, this.result, this.original, this.divider)
    this.centre = h('div', { class: 'stage-msg', role: 'status' })
    this.note = h('div', { class: 'stage-note', role: 'alert', hidden: true })
    this.compareButton = h(
      'button',
      { type: 'button', class: 'compare-btn', 'aria-pressed': 'false', disabled: true },
      'Compare'
    )
    this.compareButton.addEventListener('click', () => this.setComparing(!this.comparing))
    this.el = h(
      'div',
      { class: 'stage', id: 'stage' },
      this.frame,
      this.tags.left,
      this.tags.right,
      this.centre,
      this.note,
      this.compareButton
    )
    this.bindPointer()
    this.handle.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.02
      if (e.key === 'ArrowLeft') this.setSplit(this.split - step)
      else if (e.key === 'ArrowRight') this.setSplit(this.split + step)
      else return
      e.preventDefault()
    })
    new ResizeObserver(() => {
      this.layout()
      this.onResize()
    }).observe(this.el)
  }

  /** The working copy (or the paused frame of an animation), for showing the original. */
  setSource(copy: HTMLCanvasElement | null): void {
    this.copy = copy
    this.compareButton.disabled = !copy || this.playing
    this.drawOriginal()
  }

  /** While an animation plays, comparing is off; it comes back on the paused frame. */
  setPlaying(on: boolean): void {
    this.playing = on
    if (on) {
      this.holding = false
      this.setComparing(false)
    }
    this.compareButton.disabled = !this.copy || on
  }

  /**
   * Shows a result. `background` is what transparent parts of the original
   * sit on; null when they stay see-through, and the result's see-through
   * pixels show a checkerboard.
   */
  show(view: View, tv: boolean, background: string | null): void {
    const img = view.fx ?? (view.rgba ? { width: view.width, height: view.height, rgba: view.rgba } : null)
    if (!img) return
    this.view = view
    this.tv = tv
    this.background = background
    this.frame.classList.toggle('see-through', background === null)
    if (this.result.width !== img.width || this.result.height !== img.height) {
      this.result.width = img.width
      this.result.height = img.height
    }
    const ctx = this.result.getContext('2d')!
    ctx.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0)
    show(this.frame, true)
    this.message(null)
    this.layout()
  }

  /** A message in the middle (loading, or nothing loaded yet). */
  message(text: string | null): void {
    this.centre.textContent = text ?? ''
    show(this.centre, !!text)
  }

  /** A problem, shown over the top of the preview for a while. */
  problem(text: string): void {
    this.note.textContent = text
    show(this.note, true)
    clearTimeout(this.noteTimer)
    this.noteTimer = setTimeout(() => show(this.note, false), 9000)
  }

  hold(on: boolean): void {
    if (!this.copy || this.holding === on || (on && this.playing)) return
    this.holding = on
    this.updateOriginal()
  }

  /** Screen-effect enlargement that matches how big the preview is shown. */
  fxScaleFor(width: number, height: number, par: readonly [number, number], tv: boolean): number {
    const ratio = tv ? par[0] / par[1] : 1
    const { cssH } = this.fit(width * ratio, height, false)
    const dpr = window.devicePixelRatio || 1
    // At least 3 rows per picture row, so a scanline has room to show.
    let s = Math.max(3, Math.min(16, Math.ceil((cssH * dpr) / height)))
    while (s > 2 && width * s * ratio * height * s > FX_PREVIEW_PIXELS) s--
    return s
  }

  private setComparing(on: boolean): void {
    this.comparing = on
    this.compareButton.setAttribute('aria-pressed', String(on))
    show(this.divider, on)
    this.updateOriginal()
  }

  private setSplit(v: number): void {
    this.split = Math.min(1, Math.max(0, v))
    this.updateOriginal()
  }

  private bindPointer(): void {
    const frame = this.frame
    const splitAt = (e: PointerEvent) => {
      const r = frame.getBoundingClientRect()
      this.setSplit((e.clientX - r.left) / r.width)
    }
    frame.addEventListener('pointerdown', (e) => {
      if (!this.copy || e.button > 0) return
      if (this.comparing) {
        this.dragging = true
        frame.setPointerCapture(e.pointerId)
        splitAt(e)
      } else {
        this.hold(true)
      }
    })
    frame.addEventListener('pointermove', (e) => {
      if (this.dragging) splitAt(e)
    })
    const end = () => {
      this.dragging = false
      this.hold(false)
    }
    frame.addEventListener('pointerup', end)
    frame.addEventListener('pointercancel', end)
    frame.addEventListener('pointerleave', () => {
      if (!this.dragging) this.hold(false)
    })
    // A long press would otherwise open the phone's image menu.
    frame.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  private updateOriginal(): void {
    const visible = !!this.copy && (this.holding || this.comparing)
    show(this.original, visible)
    const clip = this.holding ? 'none' : `inset(0 ${(1 - this.split) * 100}% 0 0)`
    this.original.style.clipPath = clip
    this.divider.style.left = `${this.split * 100}%`
    this.handle.setAttribute('aria-valuenow', String(Math.round(this.split * 100)))
    show(this.tags.left, visible)
    show(this.tags.right, this.comparing && !this.holding)
  }

  private fit(w: number, h: number, crisp: boolean): { cssW: number; cssH: number; scale: number } {
    const style = getComputedStyle(this.el)
    const bw = this.el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const bh = this.el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
    let scale = Math.max(0.01, Math.min(bw / w, bh / h))
    if (crisp) {
      // Whole device pixels per picture pixel keep every pixel the same
      // size; worth it unless it would shrink the picture by more than a
      // quarter (512 px wide on a 1× screen would drop to 1×).
      const dpr = window.devicePixelRatio || 1
      const k = Math.floor(scale * dpr)
      if (k >= 1 && k / (scale * dpr) >= 0.75) scale = k / dpr
    }
    return { cssW: Math.round(w * scale), cssH: Math.round(h * scale), scale }
  }

  private layout(): void {
    const v = this.view
    if (!v) return
    const ratio = this.tv ? v.par[0] / v.par[1] : 1
    const crisp = !v.fx && ratio === 1
    const { cssW, cssH, scale } = this.fit(v.width * ratio, v.height, crisp)
    this.frame.style.width = `${cssW}px`
    this.frame.style.height = `${cssH}px`
    // Sharp blocks when enlarging; smooth when shrinking (or showing the
    // already-detailed screen effect), which avoids moiré.
    const dpr = window.devicePixelRatio || 1
    this.result.classList.toggle('smooth', !!v.fx || scale * dpr < 1)
    this.drawOriginal()
  }

  private drawOriginal(): void {
    const v = this.view
    const copy = this.copy
    if (!v || !copy) {
      this.updateOriginal()
      return
    }
    const dpr = window.devicePixelRatio || 1
    const fw = this.frame.clientWidth
    const fh = this.frame.clientHeight
    if (!fw || !fh) return
    const w = Math.min(4096, Math.round(fw * dpr))
    const hgt = Math.min(4096, Math.round(fh * dpr))
    // Only redrawn when the framing or size changes, not on every slider move.
    const key = JSON.stringify([v.src, v.dst, v.width, v.height, w, hgt, this.background])
    if (key === this.originalKey && copy === this.originalFrom) {
      this.updateOriginal()
      return
    }
    this.originalKey = key
    this.originalFrom = copy
    this.original.width = w
    this.original.height = hgt
    const ctx = this.original.getContext('2d')!
    const sx = w / v.width
    const sy = hgt / v.height
    if (this.background === null) {
      // Kept transparency: the same checkerboard as behind the result, bars
      // included (they're see-through too). Drawn in, so the original covers
      // the result under it.
      ctx.fillStyle = checkerPattern(ctx, CHECKER.size * dpr)
      ctx.fillRect(0, 0, w, hgt)
    } else {
      // Black where "fit" leaves bars; the chosen background under the photo,
      // so its transparent parts match the result.
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, w, hgt)
      ctx.fillStyle = this.background
      ctx.fillRect(v.dst.x * sx, v.dst.y * sy, v.dst.w * sx, v.dst.h * sy)
    }
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(copy, v.src.x, v.src.y, v.src.w, v.src.h, v.dst.x * sx, v.dst.y * sy, v.dst.w * sx, v.dst.h * sy)
    this.updateOriginal()
  }
}

/** The checkerboard as a canvas fill, squares of `size` device pixels. */
function checkerPattern(ctx: CanvasRenderingContext2D, size: number): CanvasPattern | string {
  const s = Math.max(1, Math.round(size))
  const tile = document.createElement('canvas')
  tile.width = tile.height = s * 2
  const t = tile.getContext('2d')
  if (!t) return CHECKER.dark
  t.fillStyle = CHECKER.dark
  t.fillRect(0, 0, s * 2, s * 2)
  t.fillStyle = CHECKER.light
  t.fillRect(0, 0, s, s)
  t.fillRect(s, s, s, s)
  return ctx.createPattern(tile, 'repeat') ?? CHECKER.dark
}
