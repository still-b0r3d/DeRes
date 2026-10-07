import type { ScrubOptions } from '../core/scrub'
import { h, show } from './dom'

export interface ScrubControlsContext {
  openFile(): void
  loadSample(): void
  getOptions(): ScrubOptions
  setOptions(opts: Partial<ScrubOptions>): void
  scrubAndDownload(): void
  picture(): { name: string; size: number } | null
}

function section(title: string, open: boolean, ...body: (Node | null)[]): HTMLDetailsElement {
  return h(
    'details',
    { class: 'sec', open },
    h('summary', null, title),
    h('div', { class: 'sec-body' }, ...body)
  )
}

export function buildScrubControls(ctx: ScrubControlsContext): {
  el: HTMLElement
  sync: () => void
  status: (t: string) => void
} {
  // 1. Image section
  const pictureInfo = h('p', { class: 'picture-info', 'data-testid': 'scrub-picture-info' })
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

  // 2. Scrub Options
  const radioAll = h('input', {
    type: 'radio',
    name: 'scrub-mode',
    id: 'scrub-mode-all',
    value: 'all',
    checked: true,
    onchange: () => ctx.setOptions({ mode: 'all' })
  }) as HTMLInputElement

  const radioLocationOnly = h('input', {
    type: 'radio',
    name: 'scrub-mode',
    id: 'scrub-mode-location',
    value: 'location_only',
    onchange: () => ctx.setOptions({ mode: 'location_only' })
  }) as HTMLInputElement

  const labelAll = h(
    'label',
    { for: 'scrub-mode-all', class: 'radio-option' },
    radioAll,
    h(
      'div',
      { class: 'radio-text' },
      h('strong', null, 'Remove all metadata (Recommended)'),
      h('span', { class: 'radio-desc' }, 'Strips camera, lens, GPS, timestamps, comments, thumbnails, and trailers. Retains orientation and colour profile.')
    )
  )

  const labelLocation = h(
    'label',
    { for: 'scrub-mode-location', class: 'radio-option' },
    radioLocationOnly,
    h(
      'div',
      { class: 'radio-text' },
      h('strong', null, 'Remove location only'),
      h('span', { class: 'radio-desc' }, 'Wipes GPS coordinates and trailers, but keeps camera model, lens, exposure settings, and date.')
    )
  )

  const checkOrientation = h('input', {
    type: 'checkbox',
    id: 'scrub-preserve-orientation',
    checked: true,
    onchange: (e: Event) => ctx.setOptions({ preserveOrientation: (e.target as HTMLInputElement).checked })
  }) as HTMLInputElement

  const labelOrientation = h(
    'label',
    { for: 'scrub-preserve-orientation', class: 'checkbox-option' },
    checkOrientation,
    h(
      'div',
      { class: 'checkbox-text' },
      h('strong', null, 'Preserve orientation tag'),
      h('span', { class: 'radio-desc' }, 'Ensures vertical phone photos render upright in image viewers.')
    )
  )

  const optionsSec = section(
    'Scrubbing Options',
    true,
    h('div', { class: 'scrub-radio-group' }, labelAll, labelLocation),
    h('div', { class: 'scrub-checkbox-group' }, labelOrientation)
  )

  // 3. Export & Download
  const statusEl = h('p', { class: 'status-msg', 'data-testid': 'scrub-status' })
  const downloadBtn = h(
    'button',
    {
      type: 'button',
      class: 'download scrub-download',
      'data-testid': 'scrub-download-btn',
      onclick: () => ctx.scrubAndDownload()
    },
    'Scrub & Download Clean Photo'
  )

  const actionSec = section(
    'Clean & Save',
    true,
    downloadBtn,
    statusEl
  )

  const el = h('div', { class: 'controls-inner scrub-controls', 'data-testid': 'scrub-controls' }, imageSec, optionsSec, actionSec)

  function sync(): void {
    const pic = ctx.picture()
    if (!pic) {
      pictureInfo.textContent = 'No photo loaded.'
      downloadBtn.disabled = true
      return
    }
    const sizeKb = (pic.size / 1024).toFixed(1)
    pictureInfo.textContent = `${pic.name} · ${sizeKb} KB`
    downloadBtn.disabled = false

    const opts = ctx.getOptions()
    radioAll.checked = opts.mode !== 'location_only'
    radioLocationOnly.checked = opts.mode === 'location_only'
    checkOrientation.checked = opts.preserveOrientation !== false
  }

  let statusTimer: ReturnType<typeof setTimeout> | undefined
  function status(t: string): void {
    clearTimeout(statusTimer)
    statusEl.textContent = t
    show(statusEl, true)
    statusTimer = setTimeout(() => show(statusEl, false), 6000)
  }

  return { el, sync, status }
}
