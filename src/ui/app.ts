import {
  generateAscii,
  toAnsiBytes,
  toAnsiText,
  toHtml,
  toMarkdown,
  toPlainText,
  DEFAULT_ASCII_SETTINGS,
  type AsciiResult,
  type AsciiSettings
} from '../core/ascii'
import { renderAsciiToCanvas, renderHalfBlockPng } from '../core/ascii-render'
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
import { buildAsciiControls } from './ascii-controls'
import { AsciiStage } from './ascii-stage'
import { buildControls } from './controls'
import { h, show } from './dom'
import { Engine } from './engine'
import { decodeToWorkingCopy, DecodeError, DECODE_MESSAGES, imageFromTransfer, type WorkingCopy } from './loader'
import { loadSettings, saveSettings, type Settings } from './settings'
import { Stage } from './stage'

// Wires the page together: one loaded picture, the image worker, the preview
// and the controls across DeRes and ASCII / ANSI Studio.

interface Picture {
  copy: WorkingCopy
  name: string
  base: string
  hasAlpha: boolean
}

const ASCII_STORAGE_KEY = 'b0r3d_ascii_settings'

function loadAsciiSettings(): AsciiSettings {
  try {
    const raw = localStorage.getItem(ASCII_STORAGE_KEY)
    if (raw) return { ...DEFAULT_ASCII_SETTINGS, ...JSON.parse(raw) }
  } catch {
    // Storage disabled or quota
  }
  return { ...DEFAULT_ASCII_SETTINGS }
}

function saveAsciiSettings(settings: AsciiSettings): void {
  try {
    localStorage.setItem(ASCII_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage disabled or quota
  }
}

export function startApp(): void {
  let activeTool: 'deres' | 'ascii' = 'deres'
  let settings: Settings = loadSettings()
  let asciiSettings: AsciiSettings = loadAsciiSettings()
  let picture: Picture | null = null
  let currentAsciiResult: AsciiResult | null = null
  let opening = 0

  const engine = new Engine()
  const stage = new Stage()
  const asciiStage = new AsciiStage()

  const readout = h('p', { class: 'readout', 'data-testid': 'readout' })
  const busy = h('span', { class: 'busy', hidden: true }, 'working…')
  const holdHint = h(
    'p',
    { class: 'hold-hint' },
    'Hold the picture to see the original',
    h('span', { class: 'desktop-only' }, ' (or hold Space)')
  )

  const deresStageSlot = h('div', { class: 'deres-stage-slot' }, stage.el, h('div', { class: 'readout-row' }, readout, busy), holdHint)
  const asciiStageSlot = h('div', { class: 'ascii-stage-slot', hidden: true }, asciiStage.el)
  document.getElementById('stage-slot')!.append(deresStageSlot, asciiStageSlot)

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

  const renderAscii = () => {
    if (!picture) {
      asciiStage.message('Choose a photo to start.')
      return
    }
    try {
      const res = generateAscii(picture.copy.rgba, picture.copy.width, picture.copy.height, asciiSettings)
      currentAsciiResult = res
      asciiStage.show(res)
    } catch (err) {
      asciiStage.problem(`Error rendering ASCII: ${(err as Error).message}`)
    }
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
    downloadEmulator,
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

  const asciiControls = buildAsciiControls({
    get: () => asciiSettings,
    set(patch) {
      asciiSettings = { ...asciiSettings, ...patch }
      saveAsciiSettings(asciiSettings)
      asciiControls.sync()
      renderAscii()
    },
    openFile: () => fileInput.click(),
    loadSample,
    copyText: () => {
      if (!currentAsciiResult) return
      navigator.clipboard.writeText(toPlainText(currentAsciiResult)).then(
        () => asciiControls.status('Copied plain text to clipboard.'),
        () => asciiControls.status('Failed to copy to clipboard.')
      )
    },
    copyMarkdown: () => {
      if (!currentAsciiResult) return
      navigator.clipboard.writeText(toMarkdown(currentAsciiResult)).then(
        () => asciiControls.status('Copied Markdown code block to clipboard.'),
        () => asciiControls.status('Failed to copy to clipboard.')
      )
    },
    copyAnsi: () => {
      if (!currentAsciiResult) return
      navigator.clipboard.writeText(toAnsiText(currentAsciiResult)).then(
        () => asciiControls.status('Copied ANSI escape sequence text to clipboard.'),
        () => asciiControls.status('Failed to copy to clipboard.')
      )
    },
    copyHtml: () => {
      if (!currentAsciiResult) return
      navigator.clipboard.writeText(toHtml(currentAsciiResult)).then(
        () => asciiControls.status('Copied HTML <pre> block to clipboard.'),
        () => asciiControls.status('Failed to copy to clipboard.')
      )
    },
    downloadAns: () => {
      if (!currentAsciiResult || !picture) return
      try {
        const bytes = toAnsiBytes(currentAsciiResult, {
          title: picture.base,
          author: 'still_b0r3d',
          group: 'b0r3d.org'
        })
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' })
        const url = URL.createObjectURL(blob)
        const a = h('a', { href: url, download: `${picture.base}.ans`, class: 'visually-hidden' })
        document.body.append(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
        asciiControls.status(`Saved ${picture.base}.ans (${bytes.length.toLocaleString()} bytes with SAUCE record).`)
      } catch (err) {
        asciiControls.status(`Couldn't export .ans: ${(err as Error).message}`)
      }
    },
    downloadPng: async (multiplier: number) => {
      if (!currentAsciiResult || !picture) return
      asciiControls.status(`Making ASCII PNG (${multiplier}×)…`)
      try {
        if (currentAsciiResult.settings.mode === 'half-block') {
          const res = await renderHalfBlockPng(currentAsciiResult, multiplier)
          const blob = new Blob([res.png.buffer as ArrayBuffer], { type: 'image/png' })
          const url = URL.createObjectURL(blob)
          const filename = `${picture.base}-ansi-${res.width}x${res.height}-${multiplier}x.png`
          const a = h('a', { href: url, download: filename, class: 'visually-hidden' })
          document.body.append(a)
          a.click()
          a.remove()
          setTimeout(() => URL.revokeObjectURL(url), 60_000)
          asciiControls.status(`Saved ${filename} (${res.width}×${res.height}).`)
        } else {
          const canvas = renderAsciiToCanvas(currentAsciiResult, multiplier)
          canvas.toBlob((blob) => {
            if (!blob) {
              asciiControls.status("Couldn't encode PNG")
              return
            }
            const url = URL.createObjectURL(blob)
            const filename = `${picture!.base}-ascii-${canvas.width}x${canvas.height}-${multiplier}x.png`
            const a = h('a', { href: url, download: filename, class: 'visually-hidden' })
            document.body.append(a)
            a.click()
            a.remove()
            setTimeout(() => URL.revokeObjectURL(url), 60_000)
            asciiControls.status(`Saved ${filename} (${canvas.width}×${canvas.height}).`)
          }, 'image/png')
        }
      } catch (err) {
        asciiControls.status(`Couldn't make PNG: ${(err as Error).message}`)
      }
    },
    picture: () =>
      picture && {
        name: picture.name,
        origW: picture.copy.origW,
        origH: picture.copy.origH
      }
  })

  const deresControlsSlot = controls.el
  const asciiControlsSlot = asciiControls.el
  asciiControlsSlot.hidden = true
  document.getElementById('controls')!.append(deresControlsSlot, asciiControlsSlot)

  // Tabs
  const tabDeres = document.getElementById('tab-deres') as HTMLButtonElement | null
  const tabAscii = document.getElementById('tab-ascii') as HTMLButtonElement | null

  function switchTool(tool: 'deres' | 'ascii'): void {
    activeTool = tool
    if (tabDeres) {
      tabDeres.classList.toggle('active', tool === 'deres')
      tabDeres.setAttribute('aria-selected', String(tool === 'deres'))
    }
    if (tabAscii) {
      tabAscii.classList.toggle('active', tool === 'ascii')
      tabAscii.setAttribute('aria-selected', String(tool === 'ascii'))
    }

    show(deresStageSlot, tool === 'deres')
    show(deresControlsSlot, tool === 'deres')
    show(asciiStageSlot, tool === 'ascii')
    show(asciiControlsSlot, tool === 'ascii')

    if (tool === 'ascii') {
      asciiControls.sync()
      renderAscii()
    } else {
      controls.sync()
      render()
    }
  }

  tabDeres?.addEventListener('click', () => switchTool('deres'))
  tabAscii?.addEventListener('click', () => switchTool('ascii'))

  controls.sync()
  asciiControls.sync()

  engine.onRendered = (m: RenderedMessage) => {
    const tv = settings.pixelShape === 'tv'
    stage.show(m, tv, settings.background === 'white' ? '#ffffff' : '#000000')
    const shape = m.par[0] === m.par[1] ? 'square pixels' : `${m.par[0]}:${m.par[1]} pixels`
    controls.setTileFit(m.tileFit)
    let tileText = ''
    if (m.tileFit) {
      tileText = ` · ${m.tileFit.summary}`
    }
    readout.textContent = `${m.used} of ${m.colours} colours used · ${m.width}×${m.height} · ${shape}${tileText}`
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
    if (!picture) {
      stage.message('Opening…')
      asciiStage.message('Opening…')
    } else {
      readout.textContent = 'Opening…'
    }
    let copy: WorkingCopy
    try {
      copy = await decodeToWorkingCopy(blob)
    } catch (err) {
      if (ticket !== opening) return
      const text = err instanceof DecodeError ? DECODE_MESSAGES[err.problem] : DECODE_MESSAGES.unreadable
      if (!picture) {
        stage.message('Choose a photo to start.')
        asciiStage.message('Choose a photo to start.')
      }
      stage.problem(text)
      asciiStage.problem(text)
      controls.sync()
      asciiControls.sync()
      return
    }
    if (ticket !== opening) return
    const hasAlpha = await engine.load(copy)
    if (ticket !== opening) return
    picture = { copy, name, base: baseName(name), hasAlpha }
    stage.setSource(copy.canvas)
    controls.sync()
    asciiControls.sync()
    if (activeTool === 'ascii') {
      renderAscii()
    } else {
      render()
    }
  }

  async function loadSample(): Promise<void> {
    try {
      const res = await fetch(rukusUrl)
      await open(await res.blob(), 'rukus.png')
    } catch {
      stage.problem("The sample picture didn't load. Choose a photo of your own instead.")
      asciiStage.problem("The sample picture didn't load. Choose a photo of your own instead.")
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

  async function downloadEmulator(format: 'scr' | 'koa' | 'chr'): Promise<void> {
    if (!picture) return
    controls.status(`Making the .${format}…`)
    try {
      const res = await engine.exportEmulator(deres(settings), format, picture.base)
      const blob = new Blob([res.data.buffer as ArrayBuffer], { type: res.mimeType })
      const url = URL.createObjectURL(blob)
      const a = h('a', { href: url, download: res.filename, class: 'visually-hidden' })
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      controls.status(`Saved ${res.filename} (${res.data.length.toLocaleString()} bytes).`)
    } catch (err) {
      controls.status(`Couldn't export .${format}: ${(err as Error).message}`)
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
  asciiStage.message('Loading the sample…')
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
