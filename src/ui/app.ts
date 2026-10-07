import { BYTE_TO_LINEAR, rgbToHex } from '../core/color'
import { baseName } from '../core/filename'
import { planGeometry, type Geometry } from '../core/geometry'
import { exportPaletteHex, parsePalettePng, parsePaletteText } from '../core/palette-file'
import type { DeresSettings } from '../core/pipeline'
import { profileById } from '../core/profiles'
import { quantizeRgb } from '../core/quantize'
import { decodeSettings, encodeSettings } from '../core/share'
import rukusUrl from '../../b0r3d-brand/rukus.png'
import type { RenderedMessage } from '../worker/protocol'
import { buildControls } from './controls'
import { h, show } from './dom'
import { Engine } from './engine'
import { decodeToWorkingCopy, DecodeError, DECODE_MESSAGES, imageFromTransfer, type WorkingCopy } from './loader'
import { loadSettings, saveSettings, type Settings } from './settings'
import { Stage } from './stage'

// Wires the page together: one loaded picture, the image worker, the preview
// and the controls.

interface Picture {
  copy: WorkingCopy
  name: string
  base: string
  hasAlpha: boolean
}

export function startApp(): void {
  let settings: Settings = loadSettings()
  let picture: Picture | null = null
  let opening = 0
  const engine = new Engine()
  const stage = new Stage()

  const readout = h('p', { class: 'readout', 'data-testid': 'readout' })
  const busy = h('span', { class: 'busy', hidden: true }, 'working…')
  const holdHint = h(
    'p',
    { class: 'hold-hint' },
    'Hold the picture to see the original',
    h('span', { class: 'desktop-only' }, ' (or hold Space)')
  )
  document.getElementById('stage-slot')!.append(stage.el, h('div', { class: 'readout-row' }, readout, busy), holdHint)

  const fileInput = h('input', { id: 'file-input', type: 'file', accept: 'image/*', class: 'visually-hidden', tabindex: -1 })
  document.body.append(fileInput)
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (file) open(file, file.name)
    fileInput.value = ''
  })

  const paletteFileInput = h('input', {
    id: 'palette-file-input',
    type: 'file',
    accept: '.hex,.pal,.gpl,image/png',
    class: 'visually-hidden',
    tabindex: -1
  })
  document.body.append(paletteFileInput)
  paletteFileInput.addEventListener('change', async () => {
    const file = paletteFileInput.files?.[0]
    if (!file) return
    paletteFileInput.value = ''
    try {
      let colours: string[] = []
      if (file.name.toLowerCase().endsWith('.png')) {
        const buf = await file.arrayBuffer()
        colours = await parsePalettePng(new Uint8Array(buf))
      } else {
        const text = await file.text()
        colours = parsePaletteText(text)
      }
      if (colours.length === 0) {
        controls.status(`No valid colours found in ${file.name}.`)
        return
      }
      settings = {
        ...settings,
        profileId: 'custom',
        customPalette: colours,
        customCount: colours.length
      }
      saveSettings(settings)
      controls.sync()
      render()
      controls.status(`Loaded palette "${file.name}" (${colours.length} colours).`)
    } catch (err) {
      controls.status(`Couldn't load palette: ${(err as Error).message}`)
    }
  })

  async function grabPalette(): Promise<void> {
    if (!picture) {
      controls.status('Open a picture first to grab its palette.')
      return
    }
    try {
      const imgData = picture.copy.rgba
      const imgW = picture.copy.width
      const imgH = picture.copy.height
      const count = settings.customCount ?? 16
      const rgb = new Float32Array(imgW * imgH * 3)
      for (let i = 0; i < imgW * imgH; i++) {
        rgb[i * 3] = BYTE_TO_LINEAR[imgData[i * 4]]
        rgb[i * 3 + 1] = BYTE_TO_LINEAR[imgData[i * 4 + 1]]
        rgb[i * 3 + 2] = BYTE_TO_LINEAR[imgData[i * 4 + 2]]
      }
      const raw = quantizeRgb(rgb, count, 8)
      const colours: string[] = []
      for (let i = 0; i < raw.length / 3; i++) {
        colours.push(rgbToHex(raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]))
      }
      if (colours.length === 0) return

      settings = { ...settings, profileId: 'custom', customPalette: colours, customCount: colours.length }
      saveSettings(settings)
      controls.sync()
      render()

      const hexText = exportPaletteHex(colours)
      const blob = new Blob([hexText], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const link = h('a', { href: url, download: `${picture.base}-palette.hex`, class: 'visually-hidden' })
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)

      controls.status(`Grabbed ${colours.length} colours and downloaded ${picture.base}-palette.hex.`)
    } catch (err) {
      controls.status(`Couldn't grab palette: ${(err as Error).message}`)
    }
  }

  function shareLink(): void {
    const hash = encodeSettings(settings)
    window.location.hash = hash
    const url = window.location.href
    navigator.clipboard.writeText(url).then(
      () => controls.status('Share link copied to clipboard.'),
      () => controls.status(`Share URL: ${url}`)
    )
  }

  const geometry = (): Geometry | null => {
    if (!picture) return null
    return planGeometry({
      srcW: picture.copy.width,
      srcH: picture.copy.height,
      origW: picture.copy.origW,
      origH: picture.copy.origH,
      profile: profileById(settings.profileId)!,
      resolution: settings.resolution,
      block: settings.block,
      fit: settings.fit
    })
  }

  const deres = (s: Settings): DeresSettings => ({
    profileId: s.profileId,
    fit: s.fit,
    resolution: s.resolution,
    block: s.block,
    background: s.background,
    adjust: s.adjust,
    dither: s.dither,
    fx: s.fx,
    pixelShape: s.pixelShape,
    customCount: s.customCount,
    customPalette: s.customPalette
  })

  const render = () => {
    const g = geometry()
    if (!g) return
    const tv = settings.pixelShape === 'tv'
    const fxScale = settings.fx.screen === 'off' ? 0 : stage.fxScaleFor(g.width, g.height, g.par, tv)
    engine.render({ settings: deres(settings), fxScale })
  }

  const controls = buildControls({
    get: () => settings,
    set(patch) {
      settings = { ...settings, ...patch }
      saveSettings(settings)
      controls.sync()
      render()
    },
    pickProfile(id) {
      const p = profileById(id)
      if (!p) return
      // Each machine starts with the dither and screen that suit it.
      const fx = settings.fx.screen === 'off' ? settings.fx : { ...settings.fx, screen: p.screen }
      this.set({ profileId: id, dither: p.dither, fx })
    },
    openFile: () => fileInput.click(),
    loadSample,
    download,
    loadPaletteFile: () => paletteFileInput.click(),
    grabPalette,
    shareLink,
    picture: () =>
      picture && {
        name: picture.name,
        origW: picture.copy.origW,
        origH: picture.copy.origH,
        hasAlpha: picture.hasAlpha
      },
    geometry
  })
  document.getElementById('controls')!.append(controls.el)
  controls.sync()

  engine.onRendered = (m: RenderedMessage) => {
    const tv = settings.pixelShape === 'tv'
    stage.show(m, tv, settings.background === 'white' ? '#ffffff' : '#000000')
    const shape = m.par[0] === m.par[1] ? 'square pixels' : `${m.par[0]}:${m.par[1]} pixels`
    readout.textContent = `${m.used} of ${m.colours} colours used · ${m.width}×${m.height} · ${shape}`
    readout.dataset.ms = String(m.ms)
  }
  engine.onError = (message) => stage.problem(`Something went wrong: ${message}`)
  let busyTimer: ReturnType<typeof setTimeout> | undefined
  engine.onBusy = (on) => {
    clearTimeout(busyTimer)
    if (on) busyTimer = setTimeout(() => show(busy, true), 200)
    else show(busy, false)
  }
  stage.onResize = () => {
    if (settings.fx.screen !== 'off') render()
  }

  async function open(blob: Blob, name: string): Promise<void> {
    const ticket = ++opening
    if (!picture) stage.message('Opening…')
    else readout.textContent = 'Opening…'
    let copy: WorkingCopy
    try {
      copy = await decodeToWorkingCopy(blob)
    } catch (err) {
      if (ticket !== opening) return
      const text = err instanceof DecodeError ? DECODE_MESSAGES[err.problem] : DECODE_MESSAGES.unreadable
      if (!picture) stage.message('Choose a photo to start.')
      stage.problem(text)
      controls.sync()
      return
    }
    if (ticket !== opening) return
    const hasAlpha = await engine.load(copy)
    if (ticket !== opening) return
    picture = { copy, name, base: baseName(name), hasAlpha }
    stage.setSource(copy.canvas)
    controls.sync()
    render()
  }

  async function loadSample(): Promise<void> {
    try {
      const res = await fetch(rukusUrl)
      await open(await res.blob(), 'rukus.png')
    } catch {
      stage.problem("The sample picture didn't load. Choose a photo of your own instead.")
    }
  }

  async function download(): Promise<void> {
    if (!picture) return
    controls.status('Making the PNG…')
    try {
      const fxOk = settings.exportFx && settings.fx.screen !== 'off'
      const res = await engine.export(deres(settings), settings.multiplier, fxOk, picture.base)
      const url = URL.createObjectURL(new Blob([res.png], { type: 'image/png' }))
      const a = h('a', { href: url, download: res.filename, class: 'visually-hidden' })
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      controls.status(`Saved ${res.filename} (${res.width}×${res.height}).`)
    } catch (err) {
      controls.status(`Couldn't make the PNG: ${(err as Error).message}`)
    }
  }

  // Paste (Ctrl+V / Cmd+V) and drag and drop, anywhere on the page.
  document.addEventListener('paste', (e) => {
    const file = imageFromTransfer(e.clipboardData)
    if (!file) return
    e.preventDefault()
    open(file, file.name && file.name !== 'image.png' ? file.name : 'photo.png')
  })
  const dropOverlay = h('div', { class: 'drop-overlay', hidden: true }, h('p', null, 'Drop the picture to open it'))
  document.body.append(dropOverlay)
  let dragDepth = 0
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return
    dragDepth++
    show(dropOverlay, true)
  })
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) show(dropOverlay, false)
  })
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault()
  })
  window.addEventListener('drop', (e) => {
    dragDepth = 0
    show(dropOverlay, false)
    if (!hasFiles(e)) return
    e.preventDefault()
    const file = imageFromTransfer(e.dataTransfer)
    if (file) open(file, file.name)
    else stage.problem("That doesn't look like a picture.")
  })

  // Hold Space to see the original (unless typing or on a control).
  const typing = (t: EventTarget | null) =>
    t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT|BUTTON|SUMMARY)$/.test(t.tagName)
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || typing(e.target)) return
    e.preventDefault()
    stage.hold(true)
  })
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') stage.hold(false)
  })

  window.addEventListener('hashchange', () => {
    const fromHash = decodeSettings(window.location.hash)
    if (fromHash) {
      settings = { ...settings, ...fromHash }
      controls.sync()
      render()
    }
  })

  footer()
  stage.message('Loading the sample…')
  loadSample()
}

function footer(): void {
  const version = import.meta.env.VITE_APP_VERSION || 'dev'
  const commit = (import.meta.env.VITE_BUILD_COMMIT || '').slice(0, 7)
  const line = document.getElementById('app-version')!
  line.replaceChildren(
    `b0r3d DeRes v${version}`,
    ...(commit ? [h('span', { 'aria-hidden': 'true' }, ' · '), `build ${commit}`] : []),
    h('span', { 'aria-hidden': 'true' }, ' · '),
    h('a', { href: './LICENSE.txt' }, 'MIT')
  )
}
