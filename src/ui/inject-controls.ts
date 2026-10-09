// EXIF Injector Controls Pane
// Dedicated interface for byte-level EXIF tag editing and injection.

import type { ExifInjectOptions } from '../core/inject'
import { normalizeExifDate } from '../core/inject'
import type { ImageMetadata } from '../core/exif'
import { h, show } from './dom'

export interface InjectControlsContext {
  openFile(): void
  loadSample(): void
  picture(): { name: string; size: number } | null
  currentMeta(): ImageMetadata | null
  injectAndDownload(options: ExifInjectOptions): void
}

function section(title: string, open: boolean, ...body: (Node | null)[]): HTMLDetailsElement {
  return h(
    'details',
    { class: 'sec', open },
    h('summary', null, title),
    h('div', { class: 'sec-body' }, ...body)
  )
}

export function buildInjectControls(ctx: InjectControlsContext): {
  el: HTMLElement
  sync: () => void
  status: (t: string) => void
} {
  // 1. Photo Section
  const pictureInfo = h('p', { class: 'picture-info', 'data-testid': 'inject-picture-info' })
  const chooseBtn = h(
    'button',
    { type: 'button', class: 'choose', onclick: () => ctx.openFile() },
    'Choose photo(s)'
  )

  const imageSec = section(
    'Photo',
    true,
    chooseBtn,
    h(
      'p',
      { class: 'hint' },
      h('button', { type: 'button', class: 'linkish', onclick: () => ctx.loadSample() }, 'Try the sample'),
      h('span', { class: 'desktop-only' }, ' · or drop photos on the page, or paste one')
    ),
    pictureInfo
  )

  // 2. Camera & Creator Form Inputs
  const inputMake = h('input', {
    type: 'text',
    class: 'injector-input',
    'data-testid': 'injector-make',
    placeholder: 'e.g. Nikon, Apple, b0r3d optics'
  }) as HTMLInputElement

  const inputModel = h('input', {
    type: 'text',
    class: 'injector-input',
    'data-testid': 'injector-model',
    placeholder: 'e.g. Z8, iPhone 15 Pro, Rukus-Cam'
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
    placeholder: 'e.g. (c) 2026 b0r3d.org'
  }) as HTMLInputElement

  const inputSoftware = h('input', {
    type: 'text',
    class: 'injector-input',
    'data-testid': 'injector-software',
    placeholder: 'e.g. b0r3d DeRes v0.8.3'
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

  // 3. Date & Description Inputs
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
    placeholder: 'Photo title or description'
  }) as HTMLInputElement

  // 4. GPS Inputs
  const inputLat = h('input', {
    type: 'number',
    step: 'any',
    class: 'injector-input',
    'data-testid': 'injector-lat',
    placeholder: 'Latitude (e.g. 41.8781)'
  }) as HTMLInputElement

  const inputLon = h('input', {
    type: 'number',
    step: 'any',
    class: 'injector-input',
    'data-testid': 'injector-lon',
    placeholder: 'Longitude (e.g. -87.6298)'
  }) as HTMLInputElement

  const inputAlt = h('input', {
    type: 'number',
    step: 'any',
    class: 'injector-input',
    'data-testid': 'injector-alt',
    placeholder: 'Altitude (m)'
  }) as HTMLInputElement

  // Preset Buttons
  const prefillBtn = h(
    'button',
    {
      type: 'button',
      class: 'pill-btn injector-prefill-btn',
      'data-testid': 'inject-prefill-btn',
      onclick: () => {
        const meta = ctx.currentMeta()
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

  const siteDefaultsBtn = h(
    'button',
    {
      type: 'button',
      class: 'pill-btn injector-prefill-btn',
      'data-testid': 'inject-defaults-btn',
      onclick: () => {
        inputMake.value = 'b0r3d optics'
        inputModel.value = 'Rukus-Cam 95 Deluxe'
        inputArtist.value = 'still_b0r3d'
        inputCopyright.value = '(c) 2026 b0r3d.org - All rights reserved'
        inputSoftware.value = 'b0r3d DeRes v0.8.3'
        inputDateTime.value = normalizeExifDate()
        inputDesc.value = 'Rukus the Cat, Chief Executive Officer of b0r3d.org'
        selectOrientation.value = '1'
        inputLat.value = '41.878113'
        inputLon.value = '-87.629799'
        inputAlt.value = '182'
      }
    },
    'b0r3d Defaults'
  )

  const clearFieldsBtn = h(
    'button',
    {
      type: 'button',
      class: 'linkish danger-link',
      'data-testid': 'inject-clear-btn',
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

  // GPS Presets
  const setGps = (lat: number, lon: number, alt?: number) => {
    inputLat.value = String(lat)
    inputLon.value = String(lon)
    inputAlt.value = alt !== undefined ? String(alt) : ''
  }

  const gpsChicagoBtn = h(
    'button',
    {
      type: 'button',
      class: 'pill-btn injector-prefill-btn',
      title: 'Chicago, IL (b0r3d Pi Server)',
      onclick: () => setGps(41.878113, -87.629799, 182)
    },
    '📍 Chicago HQ'
  )

  const gpsTokyoBtn = h(
    'button',
    {
      type: 'button',
      class: 'pill-btn injector-prefill-btn',
      title: 'Akihabara Electric Town, Tokyo',
      onclick: () => setGps(35.698300, 139.773000, 10)
    },
    '📍 Akihabara'
  )

  const gpsNullIslandBtn = h(
    'button',
    {
      type: 'button',
      class: 'pill-btn injector-prefill-btn',
      title: '0°N 0°E (Null Island)',
      onclick: () => setGps(0, 0, 0)
    },
    '📍 Null Island'
  )

  const clearGpsBtn = h(
    'button',
    {
      type: 'button',
      class: 'linkish',
      onclick: () => {
        inputLat.value = ''
        inputLon.value = ''
        inputAlt.value = ''
      }
    },
    'Clear GPS'
  )

  // Primary Action Button
  const injectBtn = h(
    'button',
    {
      type: 'button',
      class: 'download scrub-inject-btn primary',
      'data-testid': 'inject-download-btn',
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

        ctx.injectAndDownload(opts)
      }
    },
    'Inject EXIF & Download'
  )

  // Status message
  const statusEl = h('p', { class: 'status-msg', 'data-testid': 'inject-status' })

  // Sections
  const cameraSec = section(
    'Camera & Creator',
    true,
    h('div', { class: 'injector-actions' }, prefillBtn, siteDefaultsBtn, clearFieldsBtn),
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
    )
  )

  const metaSec = section(
    'Timestamp & Caption',
    true,
    h(
      'div',
      { class: 'injector-row' },
      h('label', null, 'Date & Time'),
      h('div', { class: 'injector-input-row' }, inputDateTime, nowBtn)
    ),
    h('div', { class: 'injector-row' }, h('label', null, 'Description / Title'), inputDesc)
  )

  const gpsSec = section(
    'GPS Location',
    true,
    h(
      'div',
      { class: 'injector-grid-3' },
      h('div', { class: 'injector-row' }, h('label', null, 'GPS Latitude'), inputLat),
      h('div', { class: 'injector-row' }, h('label', null, 'GPS Longitude'), inputLon),
      h('div', { class: 'injector-row' }, h('label', null, 'Altitude (m)'), inputAlt)
    ),
    h(
      'div',
      { class: 'injector-actions' },
      gpsChicagoBtn,
      gpsTokyoBtn,
      gpsNullIslandBtn,
      clearGpsBtn
    )
  )

  const actionSec = section(
    'Inject & Save',
    true,
    h(
      'p',
      { class: 'hint' },
      'Injects clean TIFF 6.0 / Exif 2.32 bytes directly into your photo without re-encoding or altering pixels.'
    ),
    injectBtn,
    statusEl
  )

  const el = h(
    'div',
    { class: 'controls-inner inject-controls', 'data-testid': 'inject-controls' },
    imageSec,
    cameraSec,
    metaSec,
    gpsSec,
    actionSec
  )

  function sync(): void {
    const pic = ctx.picture()
    if (pic) {
      pictureInfo.textContent = `${pic.name} · ${(pic.size / 1024).toFixed(1)} KB`
      injectBtn.disabled = false
      prefillBtn.disabled = false
    } else {
      pictureInfo.textContent = 'No photo loaded.'
      injectBtn.disabled = true
      prefillBtn.disabled = true
    }
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
