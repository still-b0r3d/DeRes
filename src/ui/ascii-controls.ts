import {
  type AsciiColorMode,
  type AsciiMode,
  type AsciiRampPreset,
  type AsciiSettings
} from '../core/ascii'
import { h, segmented, show, slider } from './dom'

export interface AsciiControlsContext {
  get(): AsciiSettings
  set(patch: Partial<AsciiSettings>): void
  openFile(): void
  loadSample(): void
  copyText(): void
  copyMarkdown(): void
  copyAnsi(): void
  copyHtml(): void
  downloadAns(): void
  downloadPetsciiSeq(): void
  downloadPetsciiPrg(): void
  downloadTeletext(): void
  downloadPng(multiplier: number): void
  picture(): { name: string; origW: number; origH: number } | null
}

function section(title: string, open: boolean, ...body: (Node | null)[]): HTMLDetailsElement {
  return h(
    'details',
    { class: 'sec', open },
    h('summary', null, title),
    h('div', { class: 'sec-body' }, ...body)
  )
}

export function buildAsciiControls(ctx: AsciiControlsContext): {
  el: HTMLElement
  sync: () => void
  status: (t: string) => void
} {
  const set = ctx.set

  // 1. Image section
  const pictureInfo = h('p', { class: 'picture-info', 'data-testid': 'ascii-picture-info' })
  const imageSec = section(
    'Image',
    true,
    h('button', { type: 'button', class: 'choose', onclick: () => ctx.openFile() }, 'Choose photo'),
    h(
      'p',
      { class: 'hint' },
      h('button', { type: 'button', class: 'linkish', onclick: () => ctx.loadSample() }, 'Try the sample'),
      h('span', { class: 'desktop-only' }, ' · or drop a photo on the page, or paste one')
    ),
    pictureInfo
  )

  // 2. Mode & Resolution
  const mode = segmented<AsciiMode>(
    'Render mode',
    [
      { value: 'half-block', text: 'Half-block (▀)' },
      { value: 'ramp', text: 'Character ramp' },
      { value: 'petscii', text: 'PETSCII (C64)' },
      { value: 'teletext', text: 'Teletext (Ceefax)' }
    ] as const,
    (v) => {
      if (v === 'petscii') {
        set({ mode: v, colorMode: 'c64', columns: 40 })
      } else if (v === 'teletext') {
        set({ mode: v, colorMode: 'teletext', columns: 40 })
      } else {
        set({ mode: v })
      }
    }
  )

  const columnsPresets = segmented<string>(
    'Columns preset',
    [
      { value: '40', text: '40 cols (C64/Ceefax)' },
      { value: '80', text: '80 cols (BBS)' },
      { value: '132', text: '132 cols' },
      { value: 'custom', text: 'Custom' }
    ] as const,
    (v) => {
      if (v !== 'custom') {
        const num = Number(v)
        set({ columns: num })
      }
    }
  )

  const columnsSlider = slider({
    id: 'ascii-columns',
    label: 'Columns width',
    min: 20,
    max: 200,
    step: 2,
    format: (v) => `${v} cols`,
    onInput: (v) => set({ columns: v })
  })

  const aspectCheckbox = h('input', {
    type: 'checkbox',
    id: 'ascii-aspect',
    checked: true,
    onchange: () => set({ twoToOneAspect: aspectCheckbox.checked })
  })
  const aspectRow = h(
    'label',
    { class: 'checkbox-row', for: 'ascii-aspect' },
    aspectCheckbox,
    h('span', null, '2:1 cell aspect ratio (terminal character compensation)')
  )

  const columnsRow = h('div', { class: 'row' }, h('span', { class: 'row-label' }, 'Columns'), columnsPresets.el)
  const c64Note = h(
    'p',
    { class: 'hint', 'data-testid': 'ascii-c64-note', hidden: true },
    'A C64 screen is 40 columns by 25 rows, so PETSCII always fits the picture into that.'
  )
  const layoutSec = section(
    'Mode & Columns',
    true,
    h('div', { class: 'row' }, h('span', { class: 'row-label' }, 'Style'), mode.el),
    columnsRow,
    columnsSlider.el,
    c64Note,
    aspectRow
  )

  // 3. Character Ramp (shown in ramp mode)
  const rampPresets = segmented<AsciiRampPreset>(
    'Ramp presets',
    [
      { value: 'standard', text: 'Standard' },
      { value: 'detailed', text: 'Detailed' },
      { value: 'blocks', text: 'Blocks' },
      { value: 'katakana', text: 'Katakana' },
      { value: 'binary', text: 'Binary' },
      { value: 'custom', text: 'Custom' }
    ] as const,
    (v) => set({ rampPreset: v })
  )
  rampPresets.el.classList.add('cols-3')

  const customRampInput = h('input', {
    type: 'text',
    class: 'text-input',
    placeholder: 'Enter characters for ramp…',
    oninput: () => set({ customRamp: customRampInput.value, rampPreset: 'custom' })
  })
  const customRampRow = h(
    'div',
    { class: 'row' },
    h('span', { class: 'row-label' }, 'Custom ramp'),
    customRampInput
  )

  const invertCheckbox = h('input', {
    type: 'checkbox',
    id: 'ascii-invert',
    checked: false,
    onchange: () => set({ invertRamp: invertCheckbox.checked })
  })
  const invertRow = h(
    'label',
    { class: 'checkbox-row', for: 'ascii-invert' },
    invertCheckbox,
    h('span', null, 'Invert character density (light on dark)')
  )

  const rampSec = section('Character Ramp', true, rampPresets.el, customRampRow, invertRow)

  // 4. Teletext Options
  const teletextSeparatedCheckbox = h('input', {
    type: 'checkbox',
    id: 'teletext-separated',
    checked: false,
    onchange: () => set({ teletextSeparated: teletextSeparatedCheckbox.checked })
  })
  const teletextSeparatedRow = h(
    'label',
    { class: 'checkbox-row', for: 'teletext-separated' },
    teletextSeparatedCheckbox,
    h('span', null, 'Separated mosaics (gap mode)')
  )

  const teletextHeaderCheckbox = h('input', {
    type: 'checkbox',
    id: 'teletext-header',
    checked: true,
    onchange: () => set({ teletextHeader: teletextHeaderCheckbox.checked })
  })
  const teletextHeaderRow = h(
    'label',
    { class: 'checkbox-row', for: 'teletext-header' },
    teletextHeaderCheckbox,
    h('span', null, 'Ceefax broadcast header (Page 100)')
  )

  const teletextSec = section('Teletext Options', true, teletextHeaderRow, teletextSeparatedRow)

  // 5. Colour Profile
  const colorMode = segmented<AsciiColorMode>(
    'Color profile',
    [
      { value: 'ansi16', text: 'ANSI 16-Colour' },
      { value: 'c64', text: 'C64 VIC-II' },
      { value: 'teletext', text: 'Teletext 8-Col' },
      { value: 'green', text: 'Green CRT' },
      { value: 'amber', text: 'Amber CRT' },
      { value: 'mono', text: 'Mono' },
      { value: 'truecolor', text: 'RGB Truecolor' }
    ] as const,
    (v) => set({ colorMode: v })
  )
  colorMode.el.classList.add('cols-2')

  const colorSec = section('Colour Profile', true, colorMode.el)

  // 6. Pre-adjustments
  const contrastSlider = slider({
    id: 'ascii-contrast',
    label: 'Contrast',
    min: -100,
    max: 100,
    step: 5,
    format: (v) => `${v > 0 ? '+' : ''}${v}%`,
    onInput: (v) => set({ contrast: v })
  })

  const brightnessSlider = slider({
    id: 'ascii-brightness',
    label: 'Brightness',
    min: -100,
    max: 100,
    step: 5,
    format: (v) => `${v > 0 ? '+' : ''}${v}%`,
    onInput: (v) => set({ brightness: v })
  })

  const gammaSlider = slider({
    id: 'ascii-gamma',
    label: 'Gamma',
    min: 0.5,
    max: 2.5,
    step: 0.1,
    format: (v) => `${v.toFixed(1)}×`,
    onInput: (v) => set({ gamma: v })
  })

  const adjustSec = section('Adjustments', false, contrastSlider.el, brightnessSlider.el, gammaSlider.el)

  // 7. Export & Clipboard Actions
  const statusEl = h('p', { class: 'status-msg', 'data-testid': 'ascii-status' })

  const copyRow = h(
    'div',
    { class: 'actions-grid' },
    h('button', { type: 'button', class: 'btn-action', onclick: () => ctx.copyText() }, 'Copy Text'),
    h('button', { type: 'button', class: 'btn-action', onclick: () => ctx.copyMarkdown() }, 'Copy Markdown'),
    h('button', { type: 'button', class: 'btn-action', onclick: () => ctx.copyAnsi() }, 'Copy ANSI Escapes'),
    h('button', { type: 'button', class: 'btn-action', onclick: () => ctx.copyHtml() }, 'Copy HTML')
  )

  const downloadAnsBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn-download primary',
      'data-testid': 'ascii-download-ans',
      onclick: () => ctx.downloadAns()
    },
    'Download .ANS (with SAUCE record)'
  )

  const downloadPetsciiSeqBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn-download primary',
      'data-testid': 'ascii-download-seq',
      onclick: () => ctx.downloadPetsciiSeq()
    },
    'Download .SEQ (PETSCII stream)'
  )

  const downloadPetsciiPrgBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn-download',
      'data-testid': 'ascii-download-prg',
      onclick: () => ctx.downloadPetsciiPrg()
    },
    'Download .PRG (C64 Screen RAM)'
  )

  const downloadTeletextBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn-download primary',
      'data-testid': 'ascii-download-ttx',
      onclick: () => ctx.downloadTeletext()
    },
    'Download .TTX (Ceefax page)'
  )

  const pngMultipliers = segmented<'1' | '2' | '4'>(
    'PNG scale',
    [
      { value: '1', text: '1× (640px)' },
      { value: '2', text: '2× (1280px)' },
      { value: '4', text: '4× (2560px)' }
    ] as const,
    (v) => ctx.downloadPng(Number(v))
  )

  const exportSec = section(
    'Export & Clipboard',
    true,
    h('h4', { class: 'subhead' }, 'Copy to clipboard'),
    copyRow,
    h('h4', { class: 'subhead' }, 'BBS & Vintage download'),
    downloadAnsBtn,
    downloadPetsciiSeqBtn,
    downloadPetsciiPrgBtn,
    downloadTeletextBtn,
    h('h4', { class: 'subhead' }, 'Rendered PNG (Font graphics)'),
    pngMultipliers.el,
    statusEl
  )

  const root = h(
    'div',
    { class: 'controls-col', id: 'ascii-controls-col' },
    imageSec,
    layoutSec,
    rampSec,
    teletextSec,
    colorSec,
    adjustSec,
    exportSec
  )

  const sync = () => {
    const s = ctx.get()
    const p = ctx.picture()

    if (p) {
      pictureInfo.textContent = `${p.name} · ${p.origW}×${p.origH} px`
    } else {
      pictureInfo.textContent = 'No picture loaded.'
    }

    mode.set(s.mode)
    show(rampSec, s.mode === 'ramp')
    show(teletextSec, s.mode === 'teletext')

    if (s.columns === 40 || s.columns === 80 || s.columns === 132) {
      columnsPresets.set(String(s.columns))
    } else {
      columnsPresets.set('custom')
    }
    columnsSlider.set(s.columns)
    // PETSCII is always a 40×25 C64 screen.
    show(columnsRow, s.mode !== 'petscii')
    show(columnsSlider.el, s.mode !== 'petscii')
    show(c64Note, s.mode === 'petscii')
    aspectCheckbox.checked = s.twoToOneAspect

    rampPresets.set(s.rampPreset)
    if (s.customRamp) customRampInput.value = s.customRamp
    invertCheckbox.checked = s.invertRamp

    teletextSeparatedCheckbox.checked = !!s.teletextSeparated
    teletextHeaderCheckbox.checked = s.teletextHeader !== false

    colorMode.set(s.colorMode)

    contrastSlider.set(s.contrast)
    brightnessSlider.set(s.brightness)
    gammaSlider.set(s.gamma)

    show(downloadPetsciiSeqBtn, s.mode === 'petscii')
    show(downloadPetsciiPrgBtn, s.mode === 'petscii')
    show(downloadTeletextBtn, s.mode === 'teletext')
    show(downloadAnsBtn, s.mode !== 'petscii' && s.mode !== 'teletext')
  }

  return {
    el: root,
    sync,
    status(msg: string) {
      statusEl.textContent = msg
    }
  }
}
