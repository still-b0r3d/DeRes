import { rowRuns, sameRow, type PackedAscii } from '../core/ascii-pack'
import { h, show } from './dom'

// The ASCII studio's preview: the art as coloured text in a <pre>, so it can
// be selected and copied. One element per row: a new frame of an animated
// GIF only redraws the rows that changed (half the work of drawing it all,
// and far less on a big frame). The modem "dials up" and types the art out
// at a baud rate. It never runs alongside the GIF's playback: dialling calls
// onDial (the app pauses the GIF), and playback starting stops the typing.

interface CellToken {
  char: string
  fgHex: string
  bgHex: string
  isNewline?: boolean
}

export type BaudRate = 'instant' | '300' | '1200' | '2400' | '9600' | '14400' | '28800'

export class AsciiStage {
  readonly el: HTMLElement
  private readonly box: HTMLElement
  private readonly viewport: HTMLElement
  private readonly pre: HTMLPreElement
  private readonly statusMsg: HTMLElement
  private readonly readout: HTMLElement
  private readonly scanlineOverlay: HTMLElement
  private readonly baudSelect: HTMLSelectElement
  private readonly dialBtn: HTMLButtonElement
  private readonly redialBtn: HTMLButtonElement
  private readonly progressEl: HTMLElement

  private fitMode: 'fit' | 'native' = 'fit'
  private scanlinesEnabled = false
  /** The art on screen (or being typed out). */
  private art: PackedAscii | null = null
  /** The pre's rows, and the art they hold; empty after typing (the pre is then drawn whole again). */
  private rowEls: HTMLElement[] = []
  private rowsOf: PackedAscii | null = null
  /** The art as a stream of characters, made when the modem types it. */
  private tokens: CellToken[] | null = null
  private streamIndex = 0
  private typing = false
  private baudRate: BaudRate = 'instant'
  private rafId: number | null = null
  private lastTime = 0
  /** An animated GIF is playing: the readout waits (its colour count changes every frame, and would shift the buttons beside it). */
  private playing = false

  /** The modem started typing (an animated GIF's playback has to stop). */
  onDial: () => void = () => {}

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
        'aria-label': 'Modem speed',
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

    // Not "Play": that's the GIF's own button, under the art.
    this.dialBtn = h(
      'button',
      {
        type: 'button',
        class: 'pill-btn baud-play-btn',
        'data-testid': 'ascii-play-btn',
        'aria-pressed': 'false',
        onclick: () => this.toggleDial()
      },
      'Dial up'
    ) as HTMLButtonElement

    this.redialBtn = h(
      'button',
      {
        type: 'button',
        class: 'pill-btn baud-replay-btn',
        'data-testid': 'ascii-replay-btn',
        onclick: () => this.redial()
      },
      'Redial'
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
      this.dialBtn,
      this.redialBtn,
      this.progressEl
    )

    const viewActions = h('div', { class: 'stage-actions' }, fitBtn, scanlinesBtn)

    const bar = h('div', { class: 'ascii-stage-bar' }, this.readout, modemControls, viewActions)

    this.box = h('div', { class: 'ascii-stage' }, this.statusMsg, this.viewport)
    this.el = h('div', { class: 'ascii-stage-container' }, this.box, bar)

    window.addEventListener('resize', () => {
      if (this.art && this.fitMode === 'fit') {
        this.applyFit()
      }
    })
  }

  /** Puts an animated GIF's play bar under the art. */
  addPlaybar(el: HTMLElement): void {
    this.box.after(el)
  }

  /** New art (a new picture or new settings): typed out when a baud rate is picked, else shown whole. */
  show(art: PackedAscii): void {
    this.hangUp()
    this.put(art)
    if (this.baudRate === 'instant') {
      this.drawRows(art)
      this.streamIndex = this.total()
    } else {
      // Re-trigger streaming at current baud rate
      this.streamIndex = 0
      this.dial()
    }
    this.updateProgress()
  }

  /** A frame of an animated GIF (playing, or picked with the slider): always shown whole, at once. */
  showFrame(art: PackedAscii): void {
    this.hangUp()
    this.put(art)
    this.drawRows(art)
    this.streamIndex = this.total()
    this.updateProgress()
  }

  /**
   * An animated GIF starts or stops playing. Starting stops the modem (what
   * it had typed is shown whole); stopping brings the readout up to date.
   */
  setPlaying(on: boolean): void {
    this.playing = on
    if (on && this.typing) {
      this.hangUp()
      if (this.art) {
        this.drawRows(this.art)
        this.streamIndex = this.total()
        this.updateProgress()
      }
    }
    if (!on && this.art) setText(this.readout, readoutText(this.art))
  }

  message(text: string): void {
    this.hangUp()
    this.statusMsg.textContent = text
    this.statusMsg.classList.remove('problem')
    show(this.statusMsg, true)
    show(this.viewport, false)
  }

  problem(text: string): void {
    this.hangUp()
    this.statusMsg.textContent = text
    this.statusMsg.classList.add('problem')
    show(this.statusMsg, true)
    show(this.viewport, false)
  }

  /** Makes art the art on screen: the readout and the fit follow it. */
  private put(art: PackedAscii): void {
    const resized = !this.art || this.art.width !== art.width || this.art.height !== art.height
    this.art = art
    this.tokens = null
    show(this.statusMsg, false)
    show(this.viewport, true)
    if (!this.playing || resized) setText(this.readout, readoutText(art))
    if (resized) this.applyFit()
  }

  /** The whole art in the pre, redrawing only the rows that differ from what's there. */
  private drawRows(art: PackedAscii): void {
    const before = this.rowsOf
    if (!before || before.width !== art.width || before.height !== art.height || this.rowEls.length !== art.height) {
      this.rowEls = []
      const frag = document.createDocumentFragment()
      for (let y = 0; y < art.height; y++) {
        const row = h('span', { class: 'ascii-row' }, ...runSpans(art, y))
        this.rowEls.push(row)
        frag.append(row)
        if (y < art.height - 1) frag.append('\n')
      }
      this.pre.replaceChildren(frag)
    } else if (before !== art) {
      for (let y = 0; y < art.height; y++) {
        if (!sameRow(before, art, y)) this.rowEls[y].replaceChildren(...runSpans(art, y))
      }
    }
    this.rowsOf = art
  }

  /** Characters the modem sends: every cell, and a line break after each row but the last. */
  private total(): number {
    return this.art ? this.art.width * this.art.height + this.art.height - 1 : 0
  }

  private buildTokens(art: PackedAscii): CellToken[] {
    const tokens: CellToken[] = []
    for (let y = 0; y < art.height; y++) {
      for (const run of rowRuns(art, y)) {
        for (const char of run.text) tokens.push({ char, fgHex: run.fg, bgHex: run.bg })
      }
      if (y < art.height - 1) {
        tokens.push({
          char: '\n',
          fgHex: '',
          bgHex: '',
          isNewline: true
        })
      }
    }
    return tokens
  }

  private renderStream(count: number, showCursor: boolean): void {
    const tokens = this.tokens ?? []
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

    const limit = Math.min(count, tokens.length)
    for (let i = 0; i < limit; i++) {
      const t = tokens[i]
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

    if (showCursor && limit < tokens.length) {
      const cursor = document.createElement('span')
      cursor.className = 'ascii-cursor'
      cursor.textContent = '█'
      frag.append(cursor)
    }

    this.pre.replaceChildren(frag)
    // The rows are gone: the next whole frame is drawn from scratch.
    this.rowEls = []
    this.rowsOf = null
  }

  private onBaudChange(): void {
    this.baudRate = this.baudSelect.value as BaudRate
    if (this.baudRate === 'instant') {
      this.hangUp()
      if (this.art) this.drawRows(this.art)
      this.streamIndex = this.total()
      this.updateProgress()
    } else {
      this.redial()
    }
  }

  private toggleDial(): void {
    if (this.typing) {
      this.hangUp()
    } else {
      if (this.streamIndex >= this.total()) {
        this.streamIndex = 0
      }
      if (this.baudRate === 'instant') {
        this.baudRate = '9600'
        this.baudSelect.value = '9600'
      }
      this.dial()
    }
  }

  private redial(): void {
    this.hangUp()
    this.streamIndex = 0
    if (this.baudRate === 'instant') {
      this.baudRate = '9600'
      this.baudSelect.value = '9600'
    }
    this.dial()
  }

  /** Starts typing the art on screen out, from where it got to. */
  private dial(): void {
    if (this.typing || !this.art) return
    this.tokens ??= this.buildTokens(this.art)
    if (this.tokens.length === 0) return
    this.typing = true
    this.dialBtn.textContent = 'Hang up'
    this.dialBtn.setAttribute('aria-pressed', 'true')
    this.lastTime = 0
    this.rafId = requestAnimationFrame((t) => this.step(t))
    this.onDial()
  }

  /** Stops typing where it got to. */
  private hangUp(): void {
    this.typing = false
    this.dialBtn.textContent = 'Dial up'
    this.dialBtn.setAttribute('aria-pressed', 'false')
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
    if (!this.typing) return

    if (this.lastTime === 0) {
      this.lastTime = now
    }
    const elapsedSec = Math.max(0, (now - this.lastTime) / 1000)
    this.lastTime = now

    const total = this.total()
    const charsPerSec = this.getCharsPerSec()
    const charsToAdd = Math.max(1, Math.round(charsPerSec * elapsedSec))
    this.streamIndex = Math.min(total, this.streamIndex + charsToAdd)

    const isComplete = this.streamIndex >= total
    this.renderStream(this.streamIndex, !isComplete)
    this.updateProgress()

    if (isComplete) {
      this.hangUp()
    } else {
      this.rafId = requestAnimationFrame((t) => this.step(t))
    }
  }

  private updateProgress(): void {
    const total = this.total()
    if (total === 0) {
      setText(this.progressEl, '')
      return
    }
    const pct = Math.round((this.streamIndex / total) * 100)
    const baudLabel = this.baudRate === 'instant' ? 'Instant' : `${this.baudRate} baud`
    // Padded to its widest (the font is monospaced), so the buttons beside it stay put while it counts.
    const count = String(this.streamIndex).padStart(String(total).length)
    setText(this.progressEl, `${String(pct).padStart(3)}% (${count}/${total}) · ${baudLabel}`)
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
    if (!this.art) return
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
    const targetCharWidth = viewWidth / this.art.width
    // Clamped font size
    const fontSize = Math.max(6, Math.min(18, Math.floor(targetCharWidth * 2)))
    this.pre.style.fontSize = `${fontSize}px`
    this.pre.style.lineHeight = `${fontSize}px`
    this.pre.style.transform = ''
  }
}

/** One element per run of cells that share their colours. */
function runSpans(art: PackedAscii, y: number): HTMLElement[] {
  return rowRuns(art, y).map((run) => {
    const span = document.createElement('span')
    span.style.color = `#${run.fg}`
    span.style.backgroundColor = `#${run.bg}`
    span.textContent = run.text
    return span
  })
}

/** "80×30 cells · 9 ANSI colours · half-block". */
function readoutText(art: PackedAscii): string {
  const s = art.settings
  const colorDesc =
    s.colorMode === 'ansi16'
      ? `${art.colorCount} ANSI colours`
      : s.colorMode === 'truecolor'
        ? `${art.colorCount} colours (RGB)`
        : s.colorMode === 'c64'
          ? '16 C64 VIC-II colours'
          : s.colorMode === 'teletext'
            ? '8 Teletext colours'
            : s.colorMode
  return `${art.width}×${art.height} cells · ${colorDesc} · ${s.mode}`
}

/** Text that only changes when it has to (a frame that says the same thing costs no layout). */
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text
}
