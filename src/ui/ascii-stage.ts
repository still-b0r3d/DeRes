import type { AsciiResult } from '../core/ascii'
import { h, show } from './dom'

export class AsciiStage {
  readonly el: HTMLElement
  private readonly viewport: HTMLElement
  private readonly pre: HTMLPreElement
  private readonly statusMsg: HTMLElement
  private readonly readout: HTMLElement
  private readonly scanlineOverlay: HTMLElement
  private fitMode: 'fit' | 'native' = 'fit'
  private scanlinesEnabled = false
  private currentResult: AsciiResult | null = null

  constructor() {
    this.pre = h('pre', {
      class: 'ascii-art',
      tabindex: 0,
      'aria-label': 'Rendered ASCII Art'
    })

    this.scanlineOverlay = h('div', { class: 'ascii-scanlines', hidden: true })

    this.viewport = h('div', { class: 'ascii-viewport' }, this.pre, this.scanlineOverlay)

    this.statusMsg = h('p', { class: 'stage-msg', hidden: true })

    this.readout = h('p', { class: 'readout', 'data-testid': 'ascii-readout' })

    const fitBtn = h(
      'button',
      {
        type: 'button',
        class: 'pill-btn',
        onclick: () => this.toggleFit()
      },
      'Fit width'
    )

    const scanlinesBtn = h(
      'button',
      {
        type: 'button',
        class: 'pill-btn',
        onclick: () => this.toggleScanlines(scanlinesBtn)
      },
      'Scanlines: Off'
    )

    const bar = h('div', { class: 'ascii-stage-bar' }, this.readout, h('div', { class: 'stage-actions' }, fitBtn, scanlinesBtn))

    this.el = h(
      'div',
      { class: 'ascii-stage-container' },
      h('div', { class: 'ascii-stage' }, this.statusMsg, this.viewport),
      bar
    )

    window.addEventListener('resize', () => {
      if (this.currentResult && this.fitMode === 'fit') {
        this.applyFit()
      }
    })
  }

  show(result: AsciiResult): void {
    this.currentResult = result
    show(this.statusMsg, false)
    show(this.viewport, true)

    // Render HTML colored spans inside pre
    const frag = document.createDocumentFragment()
    for (let r = 0; r < result.cells.length; r++) {
      const row = result.cells[r]
      let curSpanText = ''
      let curSpanFg = ''
      let curSpanBg = ''

      const flush = () => {
        if (!curSpanText) return
        const span = document.createElement('span')
        span.style.color = `#${curSpanFg}`
        span.style.backgroundColor = `#${curSpanBg}`
        span.textContent = curSpanText
        frag.append(span)
        curSpanText = ''
      }

      for (const cell of row) {
        const fgHex = rgbToHex(cell.fg)
        const bgHex = rgbToHex(cell.bg)
        if (fgHex !== curSpanFg || bgHex !== curSpanBg) {
          flush()
          curSpanFg = fgHex
          curSpanBg = bgHex
        }
        curSpanText += cell.char
      }
      flush()
      if (r < result.cells.length - 1) {
        frag.append(document.createTextNode('\n'))
      }
    }

    this.pre.replaceChildren(frag)

    const colorDesc =
      result.settings.colorMode === 'ansi16'
        ? `${result.colorCount} ANSI colours`
        : result.settings.colorMode === 'truecolor'
          ? `${result.colorCount} colours (RGB)`
          : result.settings.colorMode
    this.readout.textContent = `${result.width}×${result.height} cells · ${colorDesc} · ${result.settings.mode}`

    this.applyFit()
  }

  message(text: string): void {
    this.statusMsg.textContent = text
    this.statusMsg.classList.remove('problem')
    show(this.statusMsg, true)
    show(this.viewport, false)
  }

  problem(text: string): void {
    this.statusMsg.textContent = text
    this.statusMsg.classList.add('problem')
    show(this.statusMsg, true)
    show(this.viewport, false)
  }

  private toggleFit(): void {
    this.fitMode = this.fitMode === 'fit' ? 'native' : 'fit'
    this.applyFit()
  }

  private toggleScanlines(btn: HTMLButtonElement): void {
    this.scanlinesEnabled = !this.scanlinesEnabled
    show(this.scanlineOverlay, this.scanlinesEnabled)
    btn.textContent = `Scanlines: ${this.scanlinesEnabled ? 'On' : 'Off'}`
  }

  private applyFit(): void {
    if (!this.currentResult) return
    if (this.fitMode === 'native') {
      this.pre.style.transform = ''
      this.pre.style.fontSize = '14px'
      this.pre.style.lineHeight = '14px'
      return
    }

    // Auto-fit to viewport width
    const viewWidth = this.viewport.clientWidth - 24
    if (viewWidth <= 0) return

    // An 8x16 font cell at 1em has width ~0.55em to 0.6em depending on font
    // For IBM VGA 8x16, width is 8px and height is 16px (0.5 ratio)
    const targetCharWidth = viewWidth / this.currentResult.width
    // Clamped font size
    const fontSize = Math.max(6, Math.min(18, Math.floor(targetCharWidth * 2)))
    this.pre.style.fontSize = `${fontSize}px`
    this.pre.style.lineHeight = `${fontSize}px`
    this.pre.style.transform = ''
  }
}

function rgbToHex(rgb: [number, number, number]): string {
  return (
    rgb[0].toString(16).padStart(2, '0') +
    rgb[1].toString(16).padStart(2, '0') +
    rgb[2].toString(16).padStart(2, '0')
  )
}
