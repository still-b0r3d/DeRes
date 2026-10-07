import type { AsciiResult } from '../core/ascii'
import { h, show } from './dom'

interface CellToken {
  char: string
  fgHex: string
  bgHex: string
  isNewline?: boolean
}

export type BaudRate = 'instant' | '300' | '1200' | '2400' | '9600' | '14400' | '28800'

export class AsciiStage {
  readonly el: HTMLElement
  private readonly viewport: HTMLElement
  private readonly pre: HTMLPreElement
  private readonly statusMsg: HTMLElement
  private readonly readout: HTMLElement
  private readonly scanlineOverlay: HTMLElement
  private readonly baudSelect: HTMLSelectElement
  private readonly playBtn: HTMLButtonElement
  private readonly replayBtn: HTMLButtonElement
  private readonly progressEl: HTMLElement

  private fitMode: 'fit' | 'native' = 'fit'
  private scanlinesEnabled = false
  private currentResult: AsciiResult | null = null
  private tokens: CellToken[] = []
  private streamIndex = 0
  private isPlaying = false
  private baudRate: BaudRate = 'instant'
  private rafId: number | null = null
  private lastTime = 0

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

    // Baud playback simulation controls
    this.baudSelect = h(
      'select',
      {
        class: 'select-input baud-select',
        'data-testid': 'ascii-baud-select',
        onchange: () => this.onBaudChange()
      },
      h('option', { value: 'instant' }, 'Instant (Full)'),
      h('option', { value: '28800' }, '28.8k baud'),
      h('option', { value: '14400' }, '14.4k baud'),
      h('option', { value: '9600' }, '9600 baud'),
      h('option', { value: '2400' }, '2400 baud'),
      h('option', { value: '1200' }, '1200 baud'),
      h('option', { value: '300' }, '300 baud (Vintage)')
    ) as HTMLSelectElement

    this.playBtn = h(
      'button',
      {
        type: 'button',
        class: 'pill-btn baud-play-btn',
        'data-testid': 'ascii-play-btn',
        onclick: () => this.togglePlay()
      },
      'Play'
    ) as HTMLButtonElement

    this.replayBtn = h(
      'button',
      {
        type: 'button',
        class: 'pill-btn baud-replay-btn',
        'data-testid': 'ascii-replay-btn',
        onclick: () => this.replay()
      },
      'Replay'
    ) as HTMLButtonElement

    this.progressEl = h('span', {
      class: 'baud-progress',
      'data-testid': 'ascii-baud-progress'
    })

    const modemControls = h(
      'div',
      { class: 'baud-controls', 'data-testid': 'ascii-baud-controls' },
      h('span', { class: 'baud-label' }, 'Modem:'),
      this.baudSelect,
      this.playBtn,
      this.replayBtn,
      this.progressEl
    )

    const viewActions = h('div', { class: 'stage-actions' }, fitBtn, scanlinesBtn)

    const bar = h('div', { class: 'ascii-stage-bar' }, this.readout, modemControls, viewActions)

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
    this.pause()
    show(this.statusMsg, false)
    show(this.viewport, true)

    // Build linear token stream
    this.buildTokens(result)

    if (this.baudRate === 'instant') {
      this.streamIndex = this.tokens.length
      this.renderStream(this.tokens.length, false)
    } else {
      // Re-trigger streaming at current baud rate
      this.streamIndex = 0
      this.play()
    }

    const colorDesc =
      result.settings.colorMode === 'ansi16'
        ? `${result.colorCount} ANSI colours`
        : result.settings.colorMode === 'truecolor'
          ? `${result.colorCount} colours (RGB)`
          : result.settings.colorMode === 'c64'
            ? '16 C64 VIC-II colours'
            : result.settings.colorMode === 'teletext'
              ? '8 Teletext colours'
              : result.settings.colorMode
    this.readout.textContent = `${result.width}×${result.height} cells · ${colorDesc} · ${result.settings.mode}`

    this.updateProgress()
    this.applyFit()
  }

  message(text: string): void {
    this.pause()
    this.statusMsg.textContent = text
    this.statusMsg.classList.remove('problem')
    show(this.statusMsg, true)
    show(this.viewport, false)
  }

  problem(text: string): void {
    this.pause()
    this.statusMsg.textContent = text
    this.statusMsg.classList.add('problem')
    show(this.statusMsg, true)
    show(this.viewport, false)
  }

  private buildTokens(result: AsciiResult): void {
    this.tokens = []
    for (let r = 0; r < result.cells.length; r++) {
      const row = result.cells[r]
      for (let c = 0; c < row.length; c++) {
        const cell = row[c]
        this.tokens.push({
          char: cell.char,
          fgHex: rgbToHex(cell.fg),
          bgHex: rgbToHex(cell.bg)
        })
      }
      if (r < result.cells.length - 1) {
        this.tokens.push({
          char: '\n',
          fgHex: '',
          bgHex: '',
          isNewline: true
        })
      }
    }
  }

  private renderStream(count: number, showCursor: boolean): void {
    const frag = document.createDocumentFragment()
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

    const limit = Math.min(count, this.tokens.length)
    for (let i = 0; i < limit; i++) {
      const t = this.tokens[i]
      if (t.isNewline) {
        flush()
        frag.append(document.createTextNode('\n'))
        curSpanFg = ''
        curSpanBg = ''
      } else {
        if (t.fgHex !== curSpanFg || t.bgHex !== curSpanBg) {
          flush()
          curSpanFg = t.fgHex
          curSpanBg = t.bgHex
        }
        curSpanText += t.char
      }
    }
    flush()

    if (showCursor && limit < this.tokens.length) {
      const cursor = document.createElement('span')
      cursor.className = 'ascii-cursor'
      cursor.textContent = '█'
      frag.append(cursor)
    }

    this.pre.replaceChildren(frag)
  }

  private onBaudChange(): void {
    this.baudRate = this.baudSelect.value as BaudRate
    if (this.baudRate === 'instant') {
      this.pause()
      this.streamIndex = this.tokens.length
      this.renderStream(this.tokens.length, false)
      this.updateProgress()
    } else {
      this.replay()
    }
  }

  private togglePlay(): void {
    if (this.isPlaying) {
      this.pause()
    } else {
      if (this.streamIndex >= this.tokens.length) {
        this.streamIndex = 0
      }
      if (this.baudRate === 'instant') {
        this.baudRate = '9600'
        this.baudSelect.value = '9600'
      }
      this.play()
    }
  }

  private replay(): void {
    this.pause()
    this.streamIndex = 0
    if (this.baudRate === 'instant') {
      this.baudRate = '9600'
      this.baudSelect.value = '9600'
    }
    this.play()
  }

  private play(): void {
    if (this.isPlaying || this.tokens.length === 0) return
    this.isPlaying = true
    this.playBtn.textContent = 'Pause'
    this.lastTime = 0
    this.rafId = requestAnimationFrame((t) => this.step(t))
  }

  private pause(): void {
    this.isPlaying = false
    this.playBtn.textContent = 'Play'
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.lastTime = 0
  }

  private getCharsPerSec(): number {
    switch (this.baudRate) {
      case '300':
        return 30
      case '1200':
        return 120
      case '2400':
        return 240
      case '9600':
        return 960
      case '14400':
        return 1440
      case '28800':
        return 2880
      default:
        return 1000000
    }
  }

  private step(now: number): void {
    if (!this.isPlaying) return

    if (this.lastTime === 0) {
      this.lastTime = now
    }
    const elapsedSec = Math.max(0, (now - this.lastTime) / 1000)
    this.lastTime = now

    const charsPerSec = this.getCharsPerSec()
    const charsToAdd = Math.max(1, Math.round(charsPerSec * elapsedSec))
    this.streamIndex = Math.min(this.tokens.length, this.streamIndex + charsToAdd)

    const isComplete = this.streamIndex >= this.tokens.length
    this.renderStream(this.streamIndex, !isComplete)
    this.updateProgress()

    if (isComplete) {
      this.pause()
    } else {
      this.rafId = requestAnimationFrame((t) => this.step(t))
    }
  }

  private updateProgress(): void {
    const total = this.tokens.length
    if (total === 0) {
      this.progressEl.textContent = ''
      return
    }
    const pct = Math.round((this.streamIndex / total) * 100)
    const baudLabel = this.baudRate === 'instant' ? 'Instant' : `${this.baudRate} baud`
    this.progressEl.textContent = `${pct}% (${this.streamIndex}/${total}) · ${baudLabel}`
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
