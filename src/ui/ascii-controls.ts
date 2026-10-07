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
      { value: 'ramp', text: 'Character ramp' }
    ] as const,
    (v) => set({ mode: v })
  )

  const columnsPresets = segmented<string>(
    'Columns preset',
    [
      { value: '80', text: '80 cols (BBS)' },
      { value: '132', text: '132 cols' },
      { value: '160', text: '160 cols' },
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

  const layoutSec = section(
    'Mode & Columns',
    true,
    h('div', { class: 'row' }, h('span', { class: 'row-label' }, 'Style'), mode.el),
    h('div', { class: 'row' }, h('span', { class: 'row-label' }, 'Columns'), columnsPresets.el),
    columnsSlider.el,
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

  // 4. Colour Profile
  const colorMode = segmented<AsciiColorMode>(
    'Color profile',
    [
      { value: 'ansi16', text: 'ANSI 16-Colour' },
      { value: 'green', text: 'Green CRT' },
      { value: 'amber', text: 'Amber CRT' },
      { value: 'mono', text: 'Mono' },
      { value: 'truecolor', text: 'RGB Truecolor' }
    ] as const,
    (v) => set({ colorMode: v })
  )
  colorMode.el.classList.add('cols-2')

  const colorSec = section('Colour Profile', true, colorMode.el)

  // 5. Pre-adjustments
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

  // 6. Export & Clipboard Actions
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
      onclick: () => ctx.downloadAns()
    },
    'Download .ANS (with SAUCE record)'
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
    h('h4', { class: 'subhead' }, 'BBS download'),
    downloadAnsBtn,
    h('h4', { class: 'subhead' }, 'Rendered PNG (CP437 font)'),
    pngMultipliers.el,
    statusEl
  )

  const root = h('div', { class: 'controls-col', id: 'ascii-controls-col' }, imageSec, layoutSec, rampSec, colorSec, adjustSec, exportSec)

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

    if (s.columns === 80 || s.columns === 132 || s.columns === 160) {
      columnsPresets.set(String(s.columns))
    } else {
      columnsPresets.set('custom')
    }
    columnsSlider.set(s.columns)
    aspectCheckbox.checked = s.twoToOneAspect

    rampPresets.set(s.rampPreset)
    if (s.customRamp) customRampInput.value = s.customRamp
    invertCheckbox.checked = s.invertRamp

    colorMode.set(s.colorMode)

    contrastSlider.set(s.contrast)
    brightnessSlider.set(s.brightness)
    gammaSlider.set(s.gamma)
  }

  return {
    el: root,
    sync,
    status(msg: string) {
      statusEl.textContent = msg
    }
  }
}
