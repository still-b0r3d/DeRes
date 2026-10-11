import { animationMultiplier } from '../core/animate'
import {
  type AsciiColorMode,
  type AsciiMode,
  type AsciiRampPreset,
  type AsciiSettings
} from '../core/ascii'
import { asciiImageSize } from '../core/ascii-render'
import { framesText } from '../core/gif-info'
import { h, segmented, show, slider, twoStepButton } from './dom'
import { sampleLinks } from './samples'

/** The sizes the rendered picture (PNG, GIF, APNG) comes in. */
export const ASCII_SCALES = [1, 2, 4] as const
export type AsciiScale = (typeof ASCII_SCALES)[number]

/** The size an animated GIF or APNG of the art comes out at, as DeRes's AnimationFit. */
export interface AsciiAnimationFit {
  /** The chosen size, or the biggest smaller one that fits. Null when none fits. */
  multiplier: number | null
  /** The next size up that doesn't fit (the smallest, when none does); null when the chosen one fits. */
  next: number | null
}

/**
 * Animations stop short of the PNG's size (MAX_ANIMATION_PIXELS a frame):
 * they drop to the biggest size that fits instead. The frames go out one at
 * a time, so only one frame's size counts.
 */
export function asciiAnimationFit(columns: number, rows: number, chosen: number): AsciiAnimationFit {
  const size = (m: number) => asciiImageSize(columns, rows, m)
  const multiplier = animationMultiplier(size, chosen, 0, ASCII_SCALES)
  const next = ASCII_SCALES.find((m) => m <= chosen && (multiplier === null || m > multiplier)) ?? null
  return { multiplier, next }
}

/** The line by the GIF and APNG buttons when they can't be made at the chosen size: what they come out at, and why. */
export function asciiAnimationHint(columns: number, rows: number, chosen: number): string {
  const fit = asciiAnimationFit(columns, rows, chosen)
  if (fit.next === null) return ''
  if (fit.multiplier === null) {
    const [w, h] = asciiImageSize(columns, rows, fit.next)
    return `GIF and APNG can't be made: even ${fit.next}× (${w}×${h} px) is too big for an animation. Pick fewer columns.`
  }
  const [w, h] = asciiImageSize(columns, rows, fit.multiplier)
  return `GIF and APNG come out at ${fit.multiplier}× (${w}×${h} px): ${fit.next === chosen ? `${fit.next}× is` : `${fit.next}× and up are`} too big for an animation.`
}

export interface AsciiControlsContext {
  get(): AsciiSettings
  set(patch: Partial<AsciiSettings>): void
  openFile(): void
  loadSample(id?: string): void
  copyText(): void
  copyMarkdown(): void
  copyAnsi(): void
  copyHtml(): void
  downloadAns(): void
  downloadPetsciiSeq(): void
  downloadPetsciiPrg(): void
  downloadTeletext(): void
  /** The paused frame (or the picture) at the chosen size. */
  downloadPng(): void
  /** Every frame of the animated GIF, as the art. */
  downloadAnimated(format: 'apng' | 'gif'): void
  downloadAnsimation(): void
  /** The rendered picture's size (PNG, GIF, APNG). */
  scale(): AsciiScale
  setScale(scale: AsciiScale): void
  /** The size of the art on screen, in cells; null before there is any. */
  art(): { width: number; height: number } | null
  /** Every setting back to its default (the picture stays). */
  resetSettings(): void
  picture(): {
    name: string
    origW: number
    origH: number
    frames: number
    animation: { frames: number; total: number; durationMs: number } | null
  } | null
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
  /** Only the export sizes and buttons (the art changed size). */
  syncExport: () => void
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
      sampleLinks((id) => ctx.loadSample(id)),
      h('span', { class: 'sample-line desktop-only' }, 'Or drop a photo on the page, or paste one.')
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
    false,
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

  const rampSec = section('Character Ramp', false, rampPresets.el, customRampRow, invertRow)

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

  const teletextSec = section('Teletext Options', false, teletextHeaderRow, teletextSeparatedRow)

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

  const colorSec = section('Colour Profile', false, colorMode.el)

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

  // An animated GIF's every frame, drawn over each other (sync fills in the frame count).
  const downloadAnsimationBtn = h('button', {
    type: 'button',
    class: 'btn-download',
    'data-testid': 'ascii-download-ansimation',
    hidden: true,
    onclick: () => ctx.downloadAnsimation()
  })

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
    'Download .PRG (runs on a C64)'
  )

  const downloadTeletextBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn-download primary',
      'data-testid': 'ascii-download-txt',
      onclick: () => ctx.downloadTeletext()
    },
    'Download .TXT (Teletext as text)'
  )

  // The size is picked first (as in DeRes), then a PNG, GIF or APNG is made at it.
  const scales = segmented(
    'Picture size',
    ASCII_SCALES.map((m) => ({ value: String(m), text: `${m}×` })),
    (v) => ctx.setScale(Number(v) as AsciiScale)
  )
  scales.el.classList.add('cols-3')
  const sizeLine = h('p', { class: 'size-line', 'data-testid': 'ascii-export-size' })
  const downloadPngBtn = h(
    'button',
    { type: 'button', class: 'download', 'data-testid': 'ascii-download-png', onclick: () => ctx.downloadPng() },
    'Download PNG'
  )
  const downloadGifBtn = h(
    'button',
    { type: 'button', class: 'anim-btn', 'data-testid': 'ascii-download-gif', onclick: () => ctx.downloadAnimated('gif') },
    '🎞️ Download GIF'
  )
  const downloadApngBtn = h(
    'button',
    { type: 'button', class: 'anim-btn', 'data-testid': 'ascii-download-apng', onclick: () => ctx.downloadAnimated('apng') },
    '🎬 Download APNG'
  )
  const animActions = h('div', { class: 'anim-actions', hidden: true }, downloadGifBtn, downloadApngBtn)
  // When GIF and APNG can't be made at the chosen size: what they come out at, and why.
  const animHint = h('p', { class: 'hint anim-hint', 'data-testid': 'ascii-anim-hint', hidden: true })

  const exportSec = section(
    'Export & Clipboard',
    false,
    h('h4', { class: 'subhead' }, 'Copy to clipboard'),
    copyRow,
    h('h4', { class: 'subhead' }, 'BBS & Vintage download'),
    downloadAnsBtn,
    downloadAnsimationBtn,
    downloadPetsciiSeqBtn,
    downloadPetsciiPrgBtn,
    downloadTeletextBtn,
    h('h4', { class: 'subhead' }, 'Rendered picture (font graphics)'),
    h('div', { class: 'row' }, h('span', { class: 'row-label' }, 'Size'), scales.el),
    sizeLine,
    h('div', { class: 'export-actions' }, downloadPngBtn, animActions, animHint),
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
    exportSec,
    h(
      'div',
      { class: 'reset-row' },
      twoStepButton({
        label: 'Reset settings',
        confirmLabel: 'Reset everything?',
        testid: 'ascii-reset-settings',
        onConfirm: () => ctx.resetSettings()
      })
    )
  )

  const sync = () => {
    const s = ctx.get()
    const p = ctx.picture()

    if (p) {
      pictureInfo.textContent = [`${p.name} · ${p.origW}×${p.origH} px`, framesText(p.frames, p.animation)].filter(Boolean).join(' · ')
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
    syncExport()
  }

  function syncExport(): void {
    const s = ctx.get()
    const p = ctx.picture()
    const art = ctx.art()
    const scale = ctx.scale()
    scales.set(String(scale))
    const frames = p?.animation?.frames ?? 0
    const animated = frames > 1
    downloadAnsimationBtn.textContent = `Download ANSImation .ANS (${frames} frames)`
    show(downloadAnsimationBtn, animated && s.mode !== 'petscii' && s.mode !== 'teletext')
    show(animActions, animated)
    if (!p || !art) {
      sizeLine.textContent = ''
      show(animHint, false)
      downloadPngBtn.disabled = true
      downloadGifBtn.disabled = true
      downloadApngBtn.disabled = true
      return
    }
    // The size line is the PNG's; GIF and APNG have their own line by their buttons.
    const [w, hh] = asciiImageSize(art.width, art.height, scale)
    sizeLine.textContent = `${w}×${hh} px`
    downloadPngBtn.disabled = false
    const hint = animated ? asciiAnimationHint(art.width, art.height, scale) : ''
    animHint.textContent = hint
    show(animHint, hint !== '')
    const none = asciiAnimationFit(art.width, art.height, scale).multiplier === null
    downloadGifBtn.disabled = none
    downloadApngBtn.disabled = none
  }

  return {
    el: root,
    sync,
    syncExport,
    status(msg: string) {
      statusEl.textContent = msg
    }
  }
}
