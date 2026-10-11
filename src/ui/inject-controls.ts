// EXIF Injector controls
// The form starts with what the photo already has. Only fields that are
// changed get written; an emptied field removes that tag; everything the
// form doesn't show stays in the photo as it was.

import {
  DEVICE_PRESETS,
  formShowsPreset,
  presetById,
  presetExtras,
  PRESET_FIELD_KEYS,
  type DevicePreset
} from '../core/device-presets'
import type { ImageMetadata } from '../core/exif'
import {
  canInject,
  editsFromFields,
  EMPTY_FIELDS,
  normalizeExifDate,
  readInjectorFields,
  xmpCopies,
  type ExifEdits,
  type InjectOptions,
  type InjectorFields
} from '../core/inject'
import { h, show } from './dom'

export interface InjectControlsContext {
  openFile(): void
  loadSample(): void
  /** The photo being edited (the open one, or the selected one in a batch). */
  current(): { name: string; bytes: Uint8Array; meta: ImageMetadata } | null
  injectAndDownload(edits: ExifEdits, options: InjectOptions): void
}

function section(title: string, open: boolean, ...body: (Node | null)[]): HTMLDetailsElement {
  return h(
    'details',
    { class: 'sec', open },
    h('summary', null, title),
    h('div', { class: 'sec-body' }, ...body)
  )
}

/** Labels, for messages and the form. */
const LABELS: Record<keyof InjectorFields, string> = {
  make: 'Camera Make',
  model: 'Camera Model',
  lens: 'Lens Model',
  artist: 'Artist / Creator',
  copyright: 'Copyright',
  software: 'Software',
  orientation: 'Orientation',
  aperture: 'Aperture (f-stop)',
  shutter: 'Shutter Speed',
  iso: 'ISO',
  focal: 'Focal Length (mm)',
  dateTime: 'Date & Time',
  description: 'Description / Title',
  lat: 'GPS Latitude',
  lon: 'GPS Longitude',
  alt: 'Altitude (m)'
}

export function buildInjectControls(ctx: InjectControlsContext): {
  el: HTMLElement
  sync: () => void
  status: (t: string, isError?: boolean) => void
} {
  // 1. Photo
  const pictureInfo = h('p', { class: 'picture-info', 'data-testid': 'inject-picture-info' })
  const formatNote = h('p', { class: 'hint', 'data-testid': 'inject-format-note', hidden: true })
  const imageSec = section(
    'Photo',
    true,
    h('button', { type: 'button', class: 'choose', onclick: () => ctx.openFile() }, 'Choose photo(s)'),
    h(
      'p',
      { class: 'hint' },
      h('button', { type: 'button', class: 'linkish', onclick: () => ctx.loadSample() }, 'Try the sample'),
      h('span', { class: 'desktop-only' }, ' · or drop photos on the page, or paste one')
    ),
    pictureInfo,
    formatNote
  )

  // 2. The fields
  const text = (key: keyof InjectorFields, placeholder: string): HTMLInputElement =>
    h('input', {
      type: 'text',
      class: 'injector-input',
      'data-testid': `injector-${key === 'dateTime' ? 'datetime' : key === 'description' ? 'desc' : key}`,
      'aria-label': LABELS[key],
      placeholder
    }) as HTMLInputElement
  // type=number brings up a keyboard with a minus sign on phones. A browser
  // reads anything that isn't a number in it as "", so badInput is checked
  // before that could look like a cleared field.
  const number = (key: keyof InjectorFields, placeholder: string): HTMLInputElement =>
    h('input', {
      type: 'number',
      step: 'any',
      class: 'injector-input',
      'data-testid': `injector-${key}`,
      'aria-label': LABELS[key],
      placeholder
    }) as HTMLInputElement

  const orientation = h(
    'select',
    { class: 'injector-select', 'data-testid': 'injector-orientation', 'aria-label': LABELS.orientation },
    h('option', { value: '' }, 'Not set'),
    h('option', { value: '1' }, 'Standard (1)'),
    h('option', { value: '2' }, 'Mirror Horizontal (2)'),
    h('option', { value: '3' }, 'Rotate 180° (3)'),
    h('option', { value: '4' }, 'Mirror Vertical (4)'),
    h('option', { value: '5' }, 'Mirror Horiz & Rotate 270° CW (5)'),
    h('option', { value: '6' }, 'Rotate 90° CW (6)'),
    h('option', { value: '7' }, 'Mirror Horiz & Rotate 90° CW (7)'),
    h('option', { value: '8' }, 'Rotate 90° CCW (8)')
  ) as HTMLSelectElement

  const inputs: Record<keyof InjectorFields, HTMLInputElement | HTMLSelectElement> = {
    make: text('make', 'e.g. Nikon, Apple, b0r3d optics'),
    model: text('model', 'e.g. Z8, iPhone 15 Pro, Rukus-Cam'),
    lens: text('lens', 'e.g. b0r3d Prime 28mm f/1.4 Deluxe'),
    artist: text('artist', 'e.g. still_b0r3d'),
    copyright: text('copyright', 'e.g. (c) 2026 b0r3d.org'),
    software: text('software', 'e.g. b0r3d DeRes'),
    orientation,
    aperture: number('aperture', 'e.g. 1.4, 2.8'),
    shutter: text('shutter', 'e.g. 1/250, 0.5, 2'),
    iso: number('iso', 'e.g. 100, 400'),
    focal: number('focal', 'e.g. 28, 4.25'),
    dateTime: text('dateTime', 'YYYY:MM:DD HH:MM:SS'),
    description: text('description', 'Photo title or description'),
    lat: number('lat', 'e.g. 41.8781'),
    lon: number('lon', 'e.g. -87.6298'),
    alt: number('alt', 'e.g. 182')
  }
  const keys = Object.keys(inputs) as (keyof InjectorFields)[]

  for (const input of Object.values(inputs)) {
    input.addEventListener('input', () => input.removeAttribute('aria-invalid'))
  }

  /** What the photo had when it was opened; unchanged fields are left alone. */
  let loaded: InjectorFields = { ...EMPTY_FIELDS }
  let loadedBytes: Uint8Array | null = null

  function fill(values: InjectorFields): void {
    for (const k of keys) {
      inputs[k].value = values[k]
      inputs[k].removeAttribute('aria-invalid')
    }
    forgetPreset()
  }
  function read(): InjectorFields {
    const out = { ...EMPTY_FIELDS }
    for (const k of keys) out[k] = inputs[k].value
    return out
  }

  // Presets
  const resetBtn = h(
    'button',
    {
      type: 'button',
      class: 'pill-btn injector-prefill-btn',
      'data-testid': 'inject-prefill-btn',
      title: 'Put back what the photo has',
      onclick: () => fill(loaded)
    },
    'Reset to photo'
  )
  const defaultsBtn = h(
    'button',
    {
      type: 'button',
      class: 'pill-btn injector-prefill-btn',
      'data-testid': 'inject-defaults-btn',
      onclick: () =>
        fill({
          make: 'b0r3d optics',
          model: 'Rukus-Cam 95 Deluxe',
          lens: 'b0r3d Prime 28mm f/1.4 Deluxe',
          artist: 'still_b0r3d',
          copyright: '(c) 2026 b0r3d.org - All rights reserved',
          software: `b0r3d DeRes v${import.meta.env.VITE_APP_VERSION || 'dev'}`,
          orientation: '1',
          aperture: '1.4',
          shutter: '1/250',
          iso: '100',
          focal: '28',
          dateTime: normalizeExifDate(),
          description: 'Rukus the Cat, Chief Executive Officer of b0r3d.org',
          lat: '41.878113',
          lon: '-87.629799',
          alt: '182'
        })
    },
    'b0r3d Defaults'
  )
  const clearBtn = h(
    'button',
    {
      type: 'button',
      class: 'linkish danger-link',
      'data-testid': 'inject-clear-btn',
      title: 'Empty every field (injecting then removes those tags)',
      onclick: () => fill(EMPTY_FIELDS)
    },
    'Clear fields'
  )

  const setGps = (lat: string, lon: string, alt: string) => {
    inputs.lat.value = lat
    inputs.lon.value = lon
    inputs.alt.value = alt
  }
  const gpsBtn = (label: string, title: string, lat: string, lon: string, alt: string) =>
    h('button', { type: 'button', class: 'pill-btn injector-prefill-btn', title, onclick: () => setGps(lat, lon, alt) }, label)

  // 3. Removing the XMP block, when the photo has one
  const xmpBox = h('input', { type: 'checkbox', 'data-testid': 'inject-remove-xmp' }) as HTMLInputElement
  const xmpText = h('span', { class: 'radio-desc' })
  const xmpRow = h(
    'label',
    { class: 'checkbox-option', hidden: true },
    xmpBox,
    h('div', { class: 'checkbox-text' }, h('strong', null, 'Remove the XMP block too'), xmpText)
  )

  // 4. Inject
  const statusEl = h('p', { class: 'status-msg', 'data-testid': 'inject-status', hidden: true })
  let statusTimer: ReturnType<typeof setTimeout> | undefined
  function status(t: string, isError = false): void {
    clearTimeout(statusTimer)
    statusEl.textContent = t
    statusEl.classList.toggle('is-error', isError)
    show(statusEl, true)
    // Errors stay until they're dealt with.
    if (!isError) statusTimer = setTimeout(() => show(statusEl, false), 8000)
  }

  // Device presets: fill the camera, lens and exposure as that device
  // writes them. The pick is remembered until the form is filled some other
  // way, so injecting can also write the tags the form doesn't show.
  let preset: DevicePreset | null = null
  const groups = [...new Set(DEVICE_PRESETS.map((p) => p.group))]
  const presetSelect = h(
    'select',
    { class: 'injector-select', id: 'inject-preset', 'data-testid': 'inject-preset' },
    h('option', { value: '' }, 'Pick a device…'),
    groups.map((g) =>
      h('optgroup', { label: g }, DEVICE_PRESETS.filter((p) => p.group === g).map((p) => h('option', { value: p.id }, p.label)))
    )
  ) as HTMLSelectElement
  function forgetPreset(): void {
    preset = null
    presetSelect.value = ''
  }
  presetSelect.addEventListener('change', () => {
    const p = presetById(presetSelect.value)
    if (!p) return
    for (const k of PRESET_FIELD_KEYS) {
      inputs[k].value = p.fields[k]
      inputs[k].removeAttribute('aria-invalid')
    }
    preset = p
    status(`Filled in as ${p.label.replace(/ \(.*\)$/, '')}: camera, lens and exposure. Inject to save it.`)
  })

  const injectBtn = h(
    'button',
    {
      type: 'button',
      class: 'download scrub-inject-btn primary',
      'data-testid': 'inject-download-btn',
      onclick: () => {
        for (const k of keys) {
          const input = inputs[k]
          if (input instanceof HTMLInputElement && input.validity.badInput) {
            input.setAttribute('aria-invalid', 'true')
            input.focus()
            status(`${LABELS[k]}: that isn't a number.`, true)
            return
          }
        }
        const { edits, error } = editsFromFields(read(), loaded)
        if (error) {
          inputs[error.field].setAttribute('aria-invalid', 'true')
          inputs[error.field].focus()
          status(error.message, true)
          return
        }
        if (preset && formShowsPreset(preset, read())) Object.assign(edits, presetExtras(preset))
        const removeXmp = !xmpRow.hidden && xmpBox.checked
        if (Object.keys(edits).length === 0 && !removeXmp) {
          status('Nothing has changed yet: every field still shows what the photo has.')
          return
        }
        ctx.injectAndDownload(edits, { removeXmp })
      }
    },
    'Inject EXIF & Download'
  )

  const row = (key: keyof InjectorFields, extra?: Node) =>
    h(
      'div',
      { class: 'injector-row' },
      h('label', null, LABELS[key]),
      extra ? h('div', { class: 'injector-input-row' }, inputs[key], extra) : inputs[key]
    )

  const cameraSec = section(
    'Camera & Creator',
    false,
    h('p', { class: 'hint' }, 'The fields start with what the photo has. Change any of them, or empty one to remove it.'),
    h('div', { class: 'injector-row' }, h('label', { for: 'inject-preset' }, 'Device preset'), presetSelect),
    h(
      'p',
      { class: 'hint' },
      "A preset fills in the camera, lens and exposure the way that device writes them; injecting then also drops the old camera's serial numbers and maker data. The date, place and creator stay as they are."
    ),
    h('div', { class: 'injector-actions' }, resetBtn, defaultsBtn, clearBtn),
    h('div', { class: 'injector-grid-2' }, row('make'), row('model')),
    h('div', { class: 'injector-grid-2' }, row('artist'), row('copyright')),
    h('div', { class: 'injector-grid-2' }, row('software'), row('orientation'))
  )
  const opticsSec = section(
    'Lens & Exposure',
    false,
    row('lens'),
    h('div', { class: 'injector-grid-2' }, row('aperture'), row('shutter')),
    h('div', { class: 'injector-grid-2' }, row('iso'), row('focal'))
  )
  const nowBtn = h(
    'button',
    {
      type: 'button',
      class: 'pill-btn injector-prefill-btn',
      title: 'Fill in the time now',
      onclick: () => {
        inputs.dateTime.value = normalizeExifDate()
        inputs.dateTime.removeAttribute('aria-invalid')
      }
    },
    'Now'
  )
  const metaSec = section('Timestamp & Caption', false, row('dateTime', nowBtn), row('description'))
  const gpsSec = section(
    'GPS Location',
    false,
    h('div', { class: 'injector-grid-3' }, row('lat'), row('lon'), row('alt')),
    h(
      'div',
      { class: 'injector-actions' },
      gpsBtn('📍 Chicago HQ', 'Downtown Chicago, Illinois', '41.878113', '-87.629799', '182'),
      gpsBtn('📍 Akihabara', 'Akihabara Electric Town, Tokyo', '35.6983', '139.773', '10'),
      gpsBtn('📍 Null Island', '0°N 0°E (Null Island)', '0', '0', '0'),
      h('button', { type: 'button', class: 'linkish', onclick: () => setGps('', '', '') }, 'Clear GPS')
    ),
    h('p', { class: 'hint' }, "A new location replaces all of the photo's GPS tags.")
  )
  const actionSec = section(
    'Inject & Save',
    true,
    h(
      'p',
      { class: 'hint' },
      "Only the fields you change are written; the rest of the photo's EXIF stays as it was. The pixels aren't touched."
    ),
    xmpRow,
    injectBtn,
    statusEl
  )

  const el = h(
    'div',
    { class: 'controls-inner inject-controls', 'data-testid': 'inject-controls' },
    imageSec,
    cameraSec,
    opticsSec,
    metaSec,
    gpsSec,
    actionSec
  )

  function sync(): void {
    const cur = ctx.current()
    if (!cur) {
      pictureInfo.textContent = 'No photo loaded.'
      show(formatNote, false)
      show(xmpRow, false)
      injectBtn.disabled = true
      resetBtn.disabled = true
      return
    }
    pictureInfo.textContent = `${cur.name} · ${(cur.bytes.length / 1024).toFixed(1)} KB`
    const writable = canInject(cur.meta.format)
    injectBtn.disabled = !writable
    resetBtn.disabled = !writable
    show(formatNote, !writable)
    formatNote.textContent =
      cur.meta.format === 'unknown'
        ? "The injector writes into JPEG and PNG files, and this kind of file can't be read here."
        : cur.meta.format === 'gif'
          ? "GIFs can't hold EXIF, so there's nothing to edit here."
          : `The injector writes into JPEG and PNG files. This one is ${cur.meta.format.toUpperCase()}, so its EXIF can be read in the Scrubber but not changed here.`

    // A new photo: start from what it has. (Switching tabs keeps your edits.)
    if (cur.bytes !== loadedBytes) {
      loadedBytes = cur.bytes
      loaded = writable ? readInjectorFields(cur.bytes) : { ...EMPTY_FIELDS }
      fill(loaded)
      const xmp = writable ? cur.meta.xmpText : undefined
      show(xmpRow, !!xmp)
      if (xmp) {
        const copies = xmpCopies(xmp)
        xmpBox.checked = copies.length > 0
        xmpText.textContent =
          copies.length > 0
            ? `The photo's XMP block keeps its own copy of the ${copies.join(', ')}, which would contradict what you inject.`
            : 'The photo has an XMP block too (more metadata kept beside the EXIF).'
      }
    }
  }

  return { el, sync, status }
}
