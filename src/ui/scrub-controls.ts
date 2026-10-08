import type { ScrubBatchItem, ScrubOptions } from '../core/scrub'
import type { ExifInjectOptions } from '../core/inject'
import { normalizeExifDate } from '../core/inject'
import type { ImageMetadata } from '../core/exif'
import { h, show } from './dom'

export interface ScrubControlsContext {
  openFile(): void
  loadSample(): void
  getOptions(): ScrubOptions
  setOptions(opts: Partial<ScrubOptions>): void
  scrubAndDownload(): void
  downloadBatchZip(): void
  batchItems(): ScrubBatchItem[]
  clearBatch(): void
  picture(): { name: string; size: number } | null
  currentMeta?: () => ImageMetadata | null
  injectAndDownload?: (options: ExifInjectOptions) => void
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
  // 1. Image & Batch section
  const pictureInfo = h('p', { class: 'picture-info', 'data-testid': 'scrub-picture-info' })
  const chooseBtn = h('button', { type: 'button', class: 'choose', onclick: () => ctx.openFile() }, 'Choose photo(s)')
  const clearBatchBtn = h(
    'button',
    {
      type: 'button',
      class: 'linkish danger-link',
      'data-testid': 'scrub-clear-batch-btn',
      onclick: () => ctx.clearBatch()
    },
    'Clear batch'
  )

  const imageSec = section(
    'Image & Batch',
    true,
    chooseBtn,
    h(
      'p',
      { class: 'hint' },
      h('button', { type: 'button', class: 'linkish', onclick: () => ctx.loadSample() }, 'Try the sample'),
      h('span', { class: 'desktop-only' }, ' · or drop photos on the page, or paste one'),
      h('span', null, ' · '),
      clearBatchBtn
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
      h(
        'span',
        { class: 'radio-desc' },
        'Strips camera, lens, GPS, timestamps, comments, thumbnails, and trailers. Retains orientation and colour profile.'
      )
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
      h(
        'span',
        { class: 'radio-desc' },
        'Wipes GPS coordinates and trailers, but keeps camera model, lens, exposure settings, and date.'
      )
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

  // 3. EXIF Injector / Editor Section
  const inputMake = h('input', {
    type: 'text',
    class: 'injector-input',
    'data-testid': 'injector-make',
    placeholder: 'e.g. Nikon, Apple, Sony'
  }) as HTMLInputElement

  const inputModel = h('input', {
    type: 'text',
    class: 'injector-input',
    'data-testid': 'injector-model',
    placeholder: 'e.g. Z8, iPhone 15 Pro'
  }) as HTMLInputElement

  const inputArtist = h('input', {
    type: 'text',
    class: 'injector-input',
    'data-testid': 'injector-artist',
    placeholder: 'e.g. still_b0r3d'
  }) as HTMLInputElement

  const inputCopyright = h('input', {
    type: 'text',
    class: 'injector-input',
    'data-testid': 'injector-copyright',
    placeholder: 'e.g. 2026 still_b0r3d'
  }) as HTMLInputElement

  const inputSoftware = h('input', {
    type: 'text',
    class: 'injector-input',
    'data-testid': 'injector-software',
    placeholder: 'e.g. b0r3d DeRes'
  }) as HTMLInputElement

  const inputDateTime = h('input', {
    type: 'text',
    class: 'injector-input',
    'data-testid': 'injector-datetime',
    placeholder: 'YYYY:MM:DD HH:MM:SS'
  }) as HTMLInputElement

  const nowBtn = h(
    'button',
    {
      type: 'button',
      class: 'pill-btn injector-prefill-btn',
      title: 'Fill current time',
      onclick: () => {
        inputDateTime.value = normalizeExifDate()
      }
    },
    'Now'
  )

  const inputDesc = h('input', {
    type: 'text',
    class: 'injector-input',
    'data-testid': 'injector-desc',
    placeholder: 'Image caption / description'
  }) as HTMLInputElement

  const selectOrientation = h(
    'select',
    { class: 'injector-select', 'data-testid': 'injector-orientation' },
    h('option', { value: '1' }, 'Standard (1)'),
    h('option', { value: '2' }, 'Mirror Horizontal (2)'),
    h('option', { value: '3' }, 'Rotate 180° (3)'),
    h('option', { value: '4' }, 'Mirror Vertical (4)'),
    h('option', { value: '5' }, 'Mirror Horiz & Rotate 270° CW (5)'),
    h('option', { value: '6' }, 'Rotate 90° CW (6)'),
    h('option', { value: '7' }, 'Mirror Horiz & Rotate 90° CW (7)'),
    h('option', { value: '8' }, 'Rotate 90° CCW (8)')
  ) as HTMLSelectElement

  const inputLat = h('input', {
    type: 'number',
    step: 'any',
    class: 'injector-input',
    'data-testid': 'injector-lat',
    placeholder: 'Latitude (e.g. 37.7749)'
  }) as HTMLInputElement

  const inputLon = h('input', {
    type: 'number',
    step: 'any',
    class: 'injector-input',
    'data-testid': 'injector-lon',
    placeholder: 'Longitude (e.g. -122.4194)'
  }) as HTMLInputElement

  const inputAlt = h('input', {
    type: 'number',
    step: 'any',
    class: 'injector-input',
    'data-testid': 'injector-alt',
    placeholder: 'Alt (m)'
  }) as HTMLInputElement

  const prefillBtn = h(
    'button',
    {
      type: 'button',
      class: 'pill-btn injector-prefill-btn',
      'data-testid': 'injector-prefill-btn',
      onclick: () => {
        const meta = ctx.currentMeta ? ctx.currentMeta() : null
        if (!meta) return
        if (meta.make) inputMake.value = meta.make
        if (meta.model) inputModel.value = meta.model
        if (meta.artist) inputArtist.value = meta.artist
        if (meta.copyright) inputCopyright.value = meta.copyright
        if (meta.software) inputSoftware.value = meta.software
        if (meta.dateTime) inputDateTime.value = meta.dateTime
        if (meta.orientation) selectOrientation.value = String(meta.orientation)
        if (meta.gps) {
          inputLat.value = String(meta.gps.latitude.toFixed(6))
          inputLon.value = String(meta.gps.longitude.toFixed(6))
          if (meta.gps.altitude !== undefined) inputAlt.value = String(meta.gps.altitude)
        }
      }
    },
    'Pre-fill from photo'
  )

  const clearFieldsBtn = h(
    'button',
    {
      type: 'button',
      class: 'linkish',
      onclick: () => {
        inputMake.value = ''
        inputModel.value = ''
        inputArtist.value = ''
        inputCopyright.value = ''
        inputSoftware.value = ''
        inputDateTime.value = ''
        inputDesc.value = ''
        selectOrientation.value = '1'
        inputLat.value = ''
        inputLon.value = ''
        inputAlt.value = ''
      }
    },
    'Clear fields'
  )

  const injectBtn = h(
    'button',
    {
      type: 'button',
      class: 'download scrub-inject-btn',
      'data-testid': 'scrub-inject-btn',
      onclick: () => {
        const lat = inputLat.value.trim() ? parseFloat(inputLat.value) : undefined
        const lon = inputLon.value.trim() ? parseFloat(inputLon.value) : undefined
        const alt = inputAlt.value.trim() ? parseFloat(inputAlt.value) : undefined
        const orient = selectOrientation.value ? parseInt(selectOrientation.value, 10) : undefined

        const opts: ExifInjectOptions = {
          make: inputMake.value.trim() || undefined,
          model: inputModel.value.trim() || undefined,
          artist: inputArtist.value.trim() || undefined,
          copyright: inputCopyright.value.trim() || undefined,
          software: inputSoftware.value.trim() || undefined,
          dateTime: inputDateTime.value.trim() || undefined,
          description: inputDesc.value.trim() || undefined,
          orientation: orient,
          gps:
            lat !== undefined && lon !== undefined && !Number.isNaN(lat) && !Number.isNaN(lon)
              ? { latitude: lat, longitude: lon, altitude: alt }
              : undefined
        }

        if (ctx.injectAndDownload) {
          ctx.injectAndDownload(opts)
        }
      }
    },
    'Inject EXIF & Download'
  )

  const injectorForm = h(
    'div',
    { class: 'injector-form' },
    h(
      'p',
      { class: 'hint' },
      'Write custom tags directly into image bytes without altering pixels. Supports JPEG & PNG.'
    ),
    h('div', { class: 'injector-actions' }, prefillBtn, clearFieldsBtn),
    h(
      'div',
      { class: 'injector-grid-2' },
      h('div', { class: 'injector-row' }, h('label', null, 'Camera Make'), inputMake),
      h('div', { class: 'injector-row' }, h('label', null, 'Camera Model'), inputModel)
    ),
    h(
      'div',
      { class: 'injector-grid-2' },
      h('div', { class: 'injector-row' }, h('label', null, 'Artist / Creator'), inputArtist),
      h('div', { class: 'injector-row' }, h('label', null, 'Copyright'), inputCopyright)
    ),
    h(
      'div',
      { class: 'injector-grid-2' },
      h('div', { class: 'injector-row' }, h('label', null, 'Software'), inputSoftware),
      h('div', { class: 'injector-row' }, h('label', null, 'Orientation'), selectOrientation)
    ),
    h(
      'div',
      { class: 'injector-row' },
      h('label', null, 'Date & Time'),
      h('div', { class: 'injector-input-row' }, inputDateTime, nowBtn)
    ),
    h('div', { class: 'injector-row' }, h('label', null, 'Description / Title'), inputDesc),
    h(
      'div',
      { class: 'injector-grid-3' },
      h('div', { class: 'injector-row' }, h('label', null, 'GPS Latitude'), inputLat),
      h('div', { class: 'injector-row' }, h('label', null, 'GPS Longitude'), inputLon),
      h('div', { class: 'injector-row' }, h('label', null, 'Altitude'), inputAlt)
    ),
    injectBtn
  )

  const injectorSec = section('Inject / Edit EXIF', false, injectorForm)

  // 4. Export & Download
  const statusEl = h('p', { class: 'status-msg', 'data-testid': 'scrub-status' })

  const downloadSingleBtn = h(
    'button',
    {
      type: 'button',
      class: 'download scrub-download primary',
      'data-testid': 'scrub-download-btn',
      onclick: () => ctx.scrubAndDownload()
    },
    'Scrub & Download Clean Photo'
  )

  const downloadZipBtn = h(
    'button',
    {
      type: 'button',
      class: 'download scrub-download-zip primary',
      'data-testid': 'scrub-download-zip-btn',
      onclick: () => ctx.downloadBatchZip()
    },
    'Download Clean ZIP'
  )

  const actionSec = section(
    'Clean & Save',
    true,
    downloadSingleBtn,
    downloadZipBtn,
    statusEl
  )

  const el = h(
    'div',
    { class: 'controls-inner scrub-controls', 'data-testid': 'scrub-controls' },
    imageSec,
    optionsSec,
    injectorSec,
    actionSec
  )

  function sync(): void {
    const items = ctx.batchItems()
    const pic = ctx.picture()

    if (items.length > 1) {
      const totalKb = (items.reduce((acc, it) => acc + it.size, 0) / 1024).toFixed(1)
      const gpsCount = items.filter((it) => it.hasGps).length
      const gpsNote = gpsCount > 0 ? ` · ${gpsCount} with GPS` : ''
      pictureInfo.textContent = `${items.length} photos in batch (${totalKb} KB)${gpsNote}`
      show(downloadSingleBtn, false)
      show(downloadZipBtn, true)
      downloadZipBtn.disabled = false
      downloadZipBtn.textContent = `Download Clean ZIP (${items.length} photos)`
      show(clearBatchBtn, true)
      injectBtn.disabled = true
      prefillBtn.disabled = true
    } else if (pic) {
      pictureInfo.textContent = `${pic.name} · ${(pic.size / 1024).toFixed(1)} KB`
      show(downloadSingleBtn, true)
      downloadSingleBtn.disabled = false
      show(downloadZipBtn, false)
      show(clearBatchBtn, false)
      injectBtn.disabled = false
      prefillBtn.disabled = false
    } else {
      pictureInfo.textContent = 'No photo loaded.'
      downloadSingleBtn.disabled = true
      show(downloadSingleBtn, true)
      show(downloadZipBtn, false)
      show(clearBatchBtn, false)
      injectBtn.disabled = true
      prefillBtn.disabled = true
    }

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
