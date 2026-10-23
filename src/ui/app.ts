import {
  generateAscii,
  toAnsiBytes,
  toAnsiText,
  toHtml,
  toMarkdown,
  toPlainText,
  exportPetsciiPrg,
  exportPetsciiSeq,
  exportTeletextPage,
  AnsimationWriter,
  DEFAULT_ASCII_SETTINGS,
  type AsciiResult,
  type AsciiSettings
} from '../core/ascii'
import { packAscii, unpackAscii, type PackedAscii } from '../core/ascii-pack'
import { loadAsciiSettings, saveAsciiSettings } from './ascii-settings'
import { asciiImageSize, asciiPixels, drawnWithFont, renderAsciiToCanvas, renderHalfBlockPng } from '../core/ascii-render'
import { MAX_ANIMATION_BUDGET } from '../core/animate'
import { encodeRgbAnimation } from '../core/encode-animation'
import { BYTE_TO_LINEAR, rgbToHex } from '../core/color'
import { baseName } from '../core/filename'
import { planGeometry, type Geometry } from '../core/geometry'
import { gifFrameCount } from '../core/gif-info'
import { exportPaletteHex, parsePalettePng, parsePaletteText } from '../core/palette-file'
import { colourCount, previewFxSize, type DeresSettings } from '../core/pipeline'
import { PROFILES, profileById } from '../core/profiles'
import type { DitherId } from '../core/dither'
import { quantizeRgb } from '../core/quantize'
import { encodeSettings } from '../core/share'
import { inspectMetadata, type ImageMetadata } from '../core/exif'
import {
  createScrubBatchItem,
  scrubBatch,
  scrubImage,
  type ScrubBatchItem,
  type ScrubOptions
} from '../core/scrub'
import { createZip } from '../core/zip'
import { injectExif } from '../core/inject'
import type { RenderedView } from '../worker/protocol'
import { asciiAnimationFit, buildAsciiControls, type AsciiScale } from './ascii-controls'
import { AsciiStage } from './ascii-stage'
import { animationFit, buildControls } from './controls'
import { buildScrubControls } from './scrub-controls'
import { buildInjectControls } from './inject-controls'
import { ScrubStage } from './scrub-stage'
import { h, show } from './dom'
import { Engine } from './engine'
import {
  decodeToWorkingCopy,
  DecodeError,
  DECODE_MESSAGES,
  imageFromTransfer,
  workingCopyFromRgba,
  WORKING_MAX,
  type WorkingCopy
} from './loader'
import { DEFAULT_SAMPLE, sampleById } from './samples'
import { Player, playScale } from './player'
import { defaultSettings, loadSettings, saveSettings, settingsFromHash, type Settings } from './settings'
import { Stage } from './stage'

// Wires the page together: one loaded picture, the image worker, the preview
// and the controls across DeRes, ASCII / ANSI Studio, and EXIF Scrubber.

interface Picture {
  copy: WorkingCopy
  name: string
  base: string
  hasAlpha: boolean
  /** Images in the file: a GIF can hold many. */
  frames: number
  /** An animated GIF the worker holds (copy is its first frame); null for a still. */
  animation: PictureAnimation | null
}

interface PictureAnimation {
  /** Frames held, and in the file (more when some were cut to fit). */
  frames: number
  total: number
  delaysMs: number[]
  durationMs: number
  /** 0 = forever, null = the file plays once. */
  loopCount: number | null
}

/** The file the scrubber works on outside batch mode, as opened (the raw bytes). */
interface ScrubFile {
  bytes: Uint8Array
  meta: ImageMetadata
  /** For the preview; null when this browser can't show the picture. */
  url: string | null
  name: string
}

/**
 * How many cells of the ASCII studio's frames are kept while a GIF plays: as
 * much memory as DeRes keeps (a packed cell takes 14 bytes, a pixel 4).
 */
const ASCII_PLAY_BUDGET = Math.floor((MAX_ANIMATION_BUDGET * 4) / 14)

/** The ASCII art on screen: which frame, made with which settings (JSON). */
interface AsciiShown {
  key: string
  frame: number
  art: PackedAscii
  /** The art as cells, made the first time an export needs it. */
  result?: AsciiResult
}

/**
 * Waited for between an export's frames: once the page has been busy for a
 * while, it gets a moment for other things. A message to itself, not a
 * timer (a timer crawls in a background tab); only now and then, as each
 * one costs about a frame's time in Safari.
 */
function breather(): () => Promise<void> {
  let since = performance.now()
  return async () => {
    if (performance.now() - since < 25) return
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => resolve()
      channel.port2.postMessage(null)
    })
    since = performance.now()
  }
}

/** Starts a download of blob as filename. */
function save(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = h('a', { href: url, download: filename, class: 'visually-hidden' })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** A canvas's pixels as r, g, b. */
function canvasRgb(canvas: HTMLCanvasElement): Uint8Array {
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
  const rgb = new Uint8Array((data.length / 4) * 3)
  for (let i = 0, o = 0; i < data.length; i += 4, o += 3) {
    rgb[o] = data[i]
    rgb[o + 1] = data[i + 1]
    rgb[o + 2] = data[i + 2]
  }
  return rgb
}

const MIME: Record<ImageMetadata['format'], string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  avif: 'image/avif',
  gif: 'image/gif',
  unknown: 'application/octet-stream'
}

export function startApp(): void {
  let activeTool: 'deres' | 'ascii' | 'scrub' | 'inject' = 'deres'
  let settings: Settings = loadSettings()
  let asciiSettings: AsciiSettings = loadAsciiSettings()
  let scrubOptions: ScrubOptions = { mode: 'all', preserveOrientation: true }
  let picture: Picture | null = null
  let asciiShown: AsciiShown | null = null
  // The size the ASCII studio's PNG, GIF and APNG are made at.
  let asciiScale: AsciiScale = 1
  // The frame of an animated GIF that a preview was last on: the other one opens there.
  let sharedFrame = 0
  // The scrubber: one file (the last one opened), or a batch when several
  // photos were picked or dropped together. The sample never joins a batch,
  // and any new pick, drop or paste replaces the batch.
  let scrubFile: ScrubFile | null = null
  let batchItems: ScrubBatchItem[] = []
  let activeBatchIndex = 0
  let batchPreviewUrl: string | null = null
  let opening = 0
  // With an animated GIF open, the animation export uses its own frames
  // unless another style is picked (back to this for every new GIF).
  let gifFramesChosen = true

  function selectBatchIndex(idx: number): void {
    if (idx < 0 || idx >= batchItems.length) return
    activeBatchIndex = idx
    showScrub()
  }

  /** Puts the scrubber's current file or batch on screen. */
  function showScrub(): void {
    if (batchPreviewUrl) URL.revokeObjectURL(batchPreviewUrl)
    batchPreviewUrl = null
    scrubStage.showBatch(batchItems, activeBatchIndex, selectBatchIndex)
    if (batchItems.length > 1) {
      const item = batchItems[activeBatchIndex]
      batchPreviewUrl = URL.createObjectURL(new Blob([item.rawBytes.buffer as ArrayBuffer], { type: MIME[item.meta.format] }))
      scrubStage.showMetadata(item.meta, batchPreviewUrl)
    } else if (scrubFile) {
      scrubStage.showMetadata(scrubFile.meta, scrubFile.url)
    }
    scrubControls.sync()
    injectControls.sync()
  }

  async function handleFiles(files: FileList | File[]): Promise<void> {
    const list = Array.from(files)
    if (list.length === 0) return

    if (list.length > 1) {
      const items: ScrubBatchItem[] = []
      for (const file of list) {
        try {
          items.push(createScrubBatchItem(new Uint8Array(await file.arrayBuffer()), file.name))
        } catch {
          // ignore unreadable
        }
      }
      batchItems = items
      activeBatchIndex = 0
      await open(list[0], list[0].name, true)
    } else {
      await open(list[0], list[0].name)
    }
  }

  const engine = new Engine()
  const stage = new Stage()
  const asciiStage = new AsciiStage()
  const scrubStage = new ScrubStage()
  const player = new Player<RenderedView>(
    {
      make: (k) => engine.renderFrame(deres(settings), previewScale(true), k),
      // With a screen effect or the signal, the enlarged picture is all a frame holds.
      size: (v) => (v.fx ? v.fx.width * v.fx.height : v.width * v.height),
      show: showResult,
      started: () => stage.setPlaying(true),
      paused(frame) {
        stage.setPlaying(false)
        showOriginal(frame)
        render()
      },
      problem: (message) => stage.problem(message)
    },
    { budget: MAX_ANIMATION_BUDGET, picture: () => engine.picture }
  )
  // The ASCII studio's own: its frames are made as text art in the worker.
  // Playing stops the modem typing, and the modem dialling pauses it.
  const asciiPlayer = new Player<PackedAscii>(
    {
      make: (k) => engine.asciiFrame(asciiSettings, k),
      size: (art) => art.width * art.height,
      show: (art, k) => showAscii(art, k, true),
      started: () => asciiStage.setPlaying(true),
      paused(frame) {
        asciiStage.setPlaying(false)
        if (!asciiShows(frame)) renderAsciiFrame(frame, true)
      },
      problem: (message) => asciiStage.problem(message)
    },
    { budget: ASCII_PLAY_BUDGET, picture: () => engine.picture, testPrefix: 'ascii-' }
  )
  asciiStage.addPlaybar(asciiPlayer.el)
  asciiStage.onDial = () => asciiPlayer.pause()

  const readout = h('p', { class: 'readout', 'data-testid': 'readout' })
  const busy = h('span', { class: 'busy', hidden: true }, 'working…')
  const holdHint = h(
    'p',
    { class: 'hold-hint' },
    'Hold the picture to see the original',
    h('span', { class: 'desktop-only' }, ' (or hold Space)')
  )

  const deresStageSlot = h(
    'div',
    { class: 'deres-stage-slot' },
    stage.el,
    player.el,
    h('div', { class: 'readout-row' }, readout, busy),
    holdHint
  )
  const asciiStageSlot = h('div', { class: 'ascii-stage-slot', hidden: true }, asciiStage.el)
  const scrubStageSlot = h('div', { class: 'scrub-stage-slot', hidden: true }, scrubStage.el)
  document.getElementById('stage-slot')!.append(deresStageSlot, asciiStageSlot, scrubStageSlot)

  const fileInput = h('input', {
    id: 'file-input',
    type: 'file',
    accept: 'image/*',
    multiple: true,
    class: 'visually-hidden',
    tabindex: -1
  }) as HTMLInputElement
  document.body.append(fileInput)
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      handleFiles(fileInput.files)
    }
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
      const count = colourCount(profileById(settings.profileId)!, settings.customCount) ?? 16
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

  /** Takes a "#s=…" share link off the address, so a reload doesn't bring its settings back. */
  function dropShareLink(): void {
    if (window.location.hash.startsWith('#s=')) history.replaceState(history.state, '', window.location.pathname + window.location.search)
  }

  // A share link's settings become the visitor's own (saved, as any change
  // is), and the link leaves the address bar: left there, every reload
  // would put its settings back over the changes made since.
  if (window.location.hash.startsWith('#s=')) {
    saveSettings(settings, true)
    dropShareLink()
  }

  /** Copies a link to these settings. It goes on the clipboard only, never into the address bar. */
  function shareLink(): void {
    const { origin, pathname, search } = window.location
    const url = `${origin}${pathname}${search}${encodeSettings(settings)}`
    const copied = navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject(new Error('No clipboard'))
    copied.then(
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
      customWidth: settings.customWidth,
      fit: settings.fit
    })
  }

  const deres = (s: Settings): DeresSettings => ({
    profileId: s.profileId,
    fit: s.fit,
    resolution: s.resolution,
    customWidth: s.customWidth,
    detail: s.detail,
    background: s.background,
    adjust: s.adjust,
    dither: s.dither,
    fx: s.fx,
    pixelShape: s.pixelShape,
    customCount: s.customCount,
    customPalette: s.customPalette,
    signal: s.signal
  })

  /** The preview needs an enlarged copy: a screen effect or the signal is on. */
  const shownLarger = () => settings.fx.screen !== 'off' || settings.signal.mode !== 'off'

  /**
   * The preview's enlargement for the screen effect or the signal (0 when
   * neither is on). While a GIF plays, every frame is kept, so it's smaller
   * if need be to keep them all within the animation budget.
   */
  const previewScale = (playing: boolean): number => {
    const g = geometry()
    if (!g || !shownLarger()) return 0
    const tv = settings.pixelShape === 'tv'
    const s = stage.fxScaleFor(g.width, g.height, g.par, tv)
    const frames = picture?.animation?.frames ?? 1
    return playing && frames > 1 ? playScale(s, frames, (k) => previewFxSize(g.width, g.height, g.par, k, tv)) : s
  }

  // What the played frames were made with: when it changes, they're dropped.
  let playKey = ''
  const render = () => {
    if (!geometry()) return
    const key = JSON.stringify([deres(settings), previewScale(true)])
    if (key !== playKey) {
      playKey = key
      player.invalidate()
    }
    if (player.playing) return
    engine.render({ settings: deres(settings), fxScale: previewScale(false), frame: player.frame })
  }

  // The original shown by Compare: the paused frame of an animation.
  let originalTicket = 0
  async function showOriginal(frame: number): Promise<void> {
    const ticket = ++originalTicket
    if (!picture) return
    if (frame === 0 || !picture.animation) {
      stage.setSource(picture.copy.canvas)
      return
    }
    try {
      const src = await engine.sourceFrame(frame)
      if (ticket !== originalTicket) return
      const canvas = h('canvas', { width: src.width, height: src.height })
      canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(src.rgba), src.width, src.height), 0, 0)
      stage.setSource(canvas)
    } catch {
      // A new picture came along.
    }
  }

  // What the ASCII studio's played frames were made with: when it changes, they're dropped.
  const asciiKey = () => JSON.stringify(asciiSettings)
  let asciiPlayKey = ''
  const renderAscii = () => {
    if (!picture) {
      asciiStage.message('Choose a photo to start.')
      return
    }
    const key = asciiKey()
    if (key !== asciiPlayKey) {
      asciiPlayKey = key
      asciiPlayer.invalidate()
    }
    if (asciiPlayer.playing) return
    renderAsciiFrame(asciiPlayer.frame, false)
  }

  /** Whether the art on screen is frame k with the current settings. */
  const asciiShows = (k: number) => asciiShown?.frame === k && asciiShown.key === asciiKey()

  /**
   * Frame k (or the picture) through the ASCII settings, onto the stage. The
   * picture, an animated GIF's first frame included, is right here, so it's
   * made at once; later frames come from the worker, which holds them.
   * `instant`: shown whole even with a baud rate picked (a frame picked on
   * the play bar isn't typed out).
   */
  let asciiTicket = 0
  function renderAsciiFrame(k: number, instant: boolean): void {
    const pic = picture
    if (!pic) return
    const ticket = ++asciiTicket
    const kept = asciiPlayer.kept(k)
    if (kept) return showAscii(kept, k, instant)
    if (!pic.animation || k === 0) {
      try {
        showAscii(packAscii(generateAscii(pic.copy.rgba, pic.copy.width, pic.copy.height, asciiSettings)), 0, instant)
      } catch (err) {
        asciiStage.problem(`Error rendering ASCII: ${(err as Error).message}`)
      }
      return
    }
    const key = asciiKey()
    // Old news once the settings, the frame or the picture moved on.
    const current = () => ticket === asciiTicket && key === asciiKey() && picture === pic
    engine.asciiFrame(asciiSettings, k).then(
      (art) => {
        if (current() && !asciiPlayer.playing && asciiPlayer.frame === k) showAscii(art, k, instant)
      },
      (err: Error) => {
        if (current()) asciiStage.problem(`Error rendering ASCII: ${err.message}`)
      }
    )
  }

  function showAscii(art: PackedAscii, frame: number, instant: boolean): void {
    const resized = asciiShown?.art.width !== art.width || asciiShown?.art.height !== art.height
    asciiShown = { key: asciiKey(), frame, art }
    if (instant) asciiStage.showFrame(art)
    else asciiStage.show(art)
    // Which frame is on screen (the tests wait for it).
    asciiStage.el.dataset.frame = String(frame)
    // The export sizes follow the art's.
    if (resized) asciiControls.syncExport()
  }

  /**
   * The ASCII art on screen as cells, for copying and saving, with the file
   * name's start: a frame of an animated GIF past the first says which ("-frame12").
   */
  function asciiOnScreen(): { result: AsciiResult; base: string; of: string } | null {
    if (!asciiShown || !picture) return null
    asciiShown.result ??= unpackAscii(asciiShown.art)
    const later = !!picture.animation && asciiShown.frame > 0
    return {
      result: asciiShown.result,
      base: later ? `${picture.base}-frame${asciiShown.frame + 1}` : picture.base,
      of: later ? ` of frame ${asciiShown.frame + 1}` : ''
    }
  }

  /**
   * The frames of the animated GIF as art with settings s, for an export:
   * the play bar's own when it keeps them with these settings, else made in
   * the worker, a few frames ahead of the one wanted (each answer takes a
   * while to come back).
   */
  function asciiFrameSource(s: AsciiSettings, count: number): (k: number) => Promise<PackedAscii> {
    const key = JSON.stringify(s)
    const asked = new Map<number, Promise<PackedAscii>>()
    const ask = (k: number): Promise<PackedAscii> => {
      let art = asked.get(k)
      if (!art) {
        const kept = key === asciiKey() ? asciiPlayer.kept(k) : null
        art = kept ? Promise.resolve(kept) : engine.asciiFrame(s, k)
        // One that's never waited for (the export stopped) isn't an error.
        art.catch(() => {})
        asked.set(k, art)
      }
      return art
    }
    return (k) => {
      for (let j = 1; j <= 3 && k + j < count; j++) ask(k + j)
      const art = ask(k)
      asked.delete(k)
      return art
    }
  }

  /** Copies text made from the art on screen; `what` names it in the status line. */
  function copyAscii(what: string, make: (result: AsciiResult) => string): void {
    const on = asciiOnScreen()
    if (!on) return
    navigator.clipboard.writeText(make(on.result)).then(
      () => asciiControls.status(`Copied ${what}${on.of} to clipboard.`),
      () => asciiControls.status('Failed to copy to clipboard.')
    )
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
      const screen = p.id === 'vhs' ? 'vhs' : (settings.fx.screen === 'off' ? settings.fx.screen : p.screen)
      const fx = { ...settings.fx, screen }
      // The colours slider starts at the new machine's own count.
      this.set({ profileId: id, dither: p.dither, fx, customCount: undefined })
    },
    openFile: () => fileInput.click(),
    loadSample,
    download,
    downloadAnimated,
    downloadEmulator,
    downloadWallpaper,
    surpriseMe,
    loadPaletteFile: () => paletteFileInput.click(),
    grabPalette,
    shareLink,
    gifFrames: () => gifFramesChosen,
    setGifFrames(on) {
      gifFramesChosen = on
      controls.sync()
    },
    resetSettings() {
      // Every setting back to how a first visit starts (palettes grabbed or
      // loaded go too); the picture stays.
      settings = defaultSettings()
      gifFramesChosen = true
      saveSettings(settings, true)
      dropShareLink()
      controls.sync()
      render()
      controls.status('Settings reset.')
    },
    picture: () =>
      picture && {
        name: picture.name,
        origW: picture.copy.origW,
        origH: picture.copy.origH,
        copyW: picture.copy.width,
        copyH: picture.copy.height,
        hasAlpha: picture.hasAlpha,
        frames: picture.frames,
        animation: picture.animation
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
    resetSettings() {
      asciiSettings = { ...DEFAULT_ASCII_SETTINGS }
      asciiScale = 1
      saveAsciiSettings(asciiSettings)
      asciiControls.sync()
      renderAscii()
      asciiControls.status('Settings reset.')
    },
    openFile: () => fileInput.click(),
    loadSample,
    // Copies and downloads are of the art on screen: the paused frame of an animated GIF.
    copyText: () => copyAscii('plain text', toPlainText),
    copyMarkdown: () => copyAscii('Markdown code block', toMarkdown),
    copyAnsi: () => copyAscii('ANSI escape sequence text', toAnsiText),
    copyHtml: () => copyAscii('HTML <pre> block', toHtml),
    downloadAns: () => {
      const on = asciiOnScreen()
      if (!on || !picture) return
      try {
        // The visitor made the art, so no author; the group names where it was made.
        const bytes = toAnsiBytes(on.result, {
          title: picture.base,
          author: '',
          group: 'b0r3d.org'
        })
        save(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' }), `${on.base}.ans`)
        asciiControls.status(`Saved ${on.base}.ans (${bytes.length.toLocaleString()} bytes with SAUCE record).`)
      } catch (err) {
        asciiControls.status(`Couldn't export .ans: ${(err as Error).message}`)
      }
    },
    downloadAnsimation,
    downloadPetsciiSeq: () => {
      const on = asciiOnScreen()
      if (!on) return
      try {
        const bytes = exportPetsciiSeq(on.result)
        save(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' }), `${on.base}.seq`)
        asciiControls.status(`Saved ${on.base}.seq (${bytes.length.toLocaleString()} bytes PETSCII stream).`)
      } catch (err) {
        asciiControls.status(`Couldn't export .seq: ${(err as Error).message}`)
      }
    },
    downloadPetsciiPrg: () => {
      const on = asciiOnScreen()
      if (!on) return
      try {
        const bytes = exportPetsciiPrg(on.result)
        save(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' }), `${on.base}.prg`)
        asciiControls.status(`Saved ${on.base}.prg (${bytes.length.toLocaleString()} bytes: on a C64, LOAD it and type RUN).`)
      } catch (err) {
        asciiControls.status(`Couldn't export .prg: ${(err as Error).message}`)
      }
    },
    downloadTeletext: () => {
      const on = asciiOnScreen()
      if (!on) return
      try {
        const text = exportTeletextPage(on.result)
        save(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${on.base}.txt`)
        asciiControls.status(`Saved ${on.base}.txt (the Teletext art as plain text).`)
      } catch (err) {
        asciiControls.status(`Couldn't save the .txt: ${(err as Error).message}`)
      }
    },
    downloadPng: async () => {
      const on = asciiOnScreen()
      if (!on) return
      const multiplier = asciiScale
      asciiControls.status(`Making ASCII PNG (${multiplier}×)…`)
      try {
        if (!drawnWithFont(on.result)) {
          const res = await renderHalfBlockPng(on.result, multiplier)
          const filename = `${on.base}-ansi-${res.width}x${res.height}-${multiplier}x.png`
          save(new Blob([res.png.buffer as ArrayBuffer], { type: 'image/png' }), filename)
          asciiControls.status(`Saved ${filename} (${res.width}×${res.height}).`)
        } else {
          const canvas = renderAsciiToCanvas(on.result, multiplier)
          canvas.toBlob((blob) => {
            if (!blob) {
              asciiControls.status("Couldn't encode PNG")
              return
            }
            const filename = `${on.base}-ascii-${canvas.width}x${canvas.height}-${multiplier}x.png`
            save(blob, filename)
            asciiControls.status(`Saved ${filename} (${canvas.width}×${canvas.height}).`)
          }, 'image/png')
        }
      } catch (err) {
        asciiControls.status(`Couldn't make PNG: ${(err as Error).message}`)
      }
    },
    downloadAnimated: downloadAsciiAnimated,
    scale: () => asciiScale,
    setScale(scale) {
      asciiScale = scale
      asciiControls.syncExport()
    },
    art: () => asciiShown && { width: asciiShown.art.width, height: asciiShown.art.height },
    picture: () =>
      picture && {
        name: picture.name,
        origW: picture.copy.origW,
        origH: picture.copy.origH,
        frames: picture.frames,
        animation: picture.animation
      }
  })

  /**
   * Every frame of the animated GIF through the ASCII settings, as a GIF or
   * APNG of the rendered art: each frame the same pixels as its PNG, at the
   * chosen size or the biggest that fits an animation (the hint by the
   * buttons says which). The frames are made in the worker, drawn here (the
   * font is the page's), and the page gets a breather between frames.
   */
  async function downloadAsciiAnimated(format: 'apng' | 'gif'): Promise<void> {
    const pic = picture
    const anim = pic?.animation
    if (!pic || !anim || !asciiShown) return
    const { width: columns, height: rows } = asciiShown.art
    const multiplier = asciiAnimationFit(columns, rows, asciiScale).multiplier
    if (multiplier === null) return
    // Every frame with the settings of the moment, whatever changes meanwhile.
    const s = asciiSettings
    const frameArt = asciiFrameSource(s, anim.frames)
    const font = drawnWithFont(asciiShown.result ?? unpackAscii(asciiShown.art))
    const canvas = font ? document.createElement('canvas') : null
    const [width, height] = asciiImageSize(columns, rows, multiplier)
    const making = `Making the ${format.toUpperCase()}…`
    asciiControls.status(making)
    try {
      const res = await encodeRgbAnimation({
        format,
        width,
        height,
        delaysMs: anim.delaysMs,
        loopCount: anim.loopCount,
        frame: async (k) => {
          const result = unpackAscii(await frameArt(k))
          return canvas ? canvasRgb(renderAsciiToCanvas(result, multiplier, canvas)) : asciiPixels(result, multiplier)
        },
        breathe: breather(),
        onProgress: (done, total, note) =>
          asciiControls.status(`${making} ${note ? `${note}, ` : ''}frame ${done} of ${total}${done === total && !note ? ', putting them together' : ''}`)
      })
      const kind = font ? 'ascii' : 'ansi'
      const filename =
        format === 'apng' ? `${pic.base}-${kind}-${width}x${height}-${multiplier}x-animated.png` : `${pic.base}-${kind}-${width}x${height}-${multiplier}x.gif`
      save(new Blob([res.data], { type: res.mimeType }), filename)
      asciiControls.status(`Saved ${filename} (${res.width}×${res.height}, ${res.frameCount} frames).`)
    } catch (err) {
      asciiControls.status(`Couldn't make ${format.toUpperCase()}: ${(err as Error).message}`)
    }
  }

  /**
   * Every frame of the animated GIF through the ASCII settings as one .ans,
   * each drawn over the last (see AnsimationWriter), with one SAUCE record.
   */
  async function downloadAnsimation(): Promise<void> {
    const pic = picture
    const anim = pic?.animation
    if (!pic || !anim) return
    const frameArt = asciiFrameSource(asciiSettings, anim.frames)
    const making = 'Making the ANSImation…'
    asciiControls.status(making)
    try {
      const writer = new AnsimationWriter()
      const breathe = breather()
      for (let k = 0; k < anim.frames; k++) {
        await breathe()
        writer.add(unpackAscii(await frameArt(k)))
        asciiControls.status(`${making} frame ${k + 1} of ${anim.frames}`)
      }
      // The visitor made the art, so no author; the group names where it was made.
      const bytes = writer.finish({ title: pic.base, author: '', group: 'b0r3d.org' })
      const filename = `${pic.base}-animated.ans`
      save(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' }), filename)
      asciiControls.status(`Saved ${filename} (${writer.frames} frames, ${bytes.length.toLocaleString()} bytes with SAUCE record).`)
    } catch (err) {
      asciiControls.status(`Couldn't make the ANSImation: ${(err as Error).message}`)
    }
  }

  const scrubControls = buildScrubControls({
    openFile: () => fileInput.click(),
    loadSample: () => loadSample(),
    getOptions: () => scrubOptions,
    setOptions: (patch) => {
      scrubOptions = { ...scrubOptions, ...patch }
      scrubControls.sync()
    },
    batchItems: () => batchItems,
    clearBatch: () => {
      batchItems = []
      activeBatchIndex = 0
      showScrub()
    },
    scrubAndDownload: () => {
      if (!scrubFile) return
      try {
        scrubControls.status('Scrubbing metadata…')
        const result = scrubImage(scrubFile.bytes, scrubOptions)
        scrubStage.showSelfCheck(result.report)
        const ext = result.format === 'jpeg' ? 'jpg' : result.format
        const filename = `${baseName(scrubFile.name)}-clean.${ext}`
        const blob = new Blob([result.data.buffer as ArrayBuffer], { type: MIME[result.format] })
        const url = URL.createObjectURL(blob)
        const a = h('a', { href: url, download: filename, class: 'visually-hidden' })
        document.body.append(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
        scrubControls.status(
          result.report.isClean
            ? `Cleaned and saved ${filename}.`
            : `Saved ${filename}, but it is not fully clean: ${result.report.leftovers.join(', ')}.`
        )
      } catch (err) {
        scrubControls.status(`Failed to scrub: ${(err as Error).message}`)
      }
    },
    downloadBatchZip: () => {
      if (batchItems.length === 0) return
      scrubControls.status('Scrubbing batch & packaging ZIP…')
      try {
        const { zipEntries } = scrubBatch(batchItems, scrubOptions)
        if (zipEntries.length === 0) {
          scrubControls.status('No files could be scrubbed.')
          return
        }
        const zipData = createZip(zipEntries)
        const blob = new Blob([zipData.buffer as ArrayBuffer], { type: 'application/zip' })
        const url = URL.createObjectURL(blob)
        const filename = 'b0r3d-clean-photos.zip'
        const a = h('a', { href: url, download: filename, class: 'visually-hidden' })
        document.body.append(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
        scrubStage.showBatch(batchItems, activeBatchIndex, selectBatchIndex)
        const notClean = batchItems.filter((it) => it.report && !it.report.isClean).length
        scrubControls.status(
          notClean === 0
            ? `Bundled & saved ${filename} (${zipEntries.length} clean photos, ${(zipData.length / 1024).toFixed(1)} KB).`
            : `Saved ${filename} (${zipEntries.length} photos, ${(zipData.length / 1024).toFixed(1)} KB), but ${notClean} not fully clean: see the table.`
        )
      } catch (err) {
        scrubControls.status(`ZIP failed: ${(err as Error).message}`)
      }
    },
    picture: () => (scrubFile ? { name: scrubFile.name, size: scrubFile.bytes.length } : null)
  })

  scrubStage.onStatus = scrubControls.status

  const injectControls = buildInjectControls({
    openFile: () => fileInput.click(),
    loadSample: () => loadSample(),
    current: () => {
      if (batchItems.length > 1) {
        const item = batchItems[activeBatchIndex]
        return item ? { name: item.name, bytes: item.rawBytes, meta: item.meta } : null
      }
      return scrubFile ? { name: scrubFile.name, bytes: scrubFile.bytes, meta: scrubFile.meta } : null
    },
    injectAndDownload: (edits, options) => {
      const inBatch = batchItems.length > 1
      const item = inBatch ? batchItems[activeBatchIndex] : null
      const bytes = item ? item.rawBytes : scrubFile?.bytes
      const name = item ? item.name : scrubFile?.name
      if (!bytes || !name) return
      try {
        const newBytes = injectExif(bytes, edits, options)
        const meta = inspectMetadata(newBytes)
        const ext = meta.format === 'jpeg' ? 'jpg' : meta.format
        const filename = `${baseName(name)}-injected.${ext}`
        const blob = new Blob([newBytes.slice().buffer], { type: MIME[meta.format] })
        const url = URL.createObjectURL(blob)
        const a = h('a', { href: url, download: filename, class: 'visually-hidden' })
        document.body.append(a)
        a.click()
        a.remove()
        // The edited photo is now the one shown, inspected and scrubbed
        // (in a batch, that photo's place in the batch).
        if (item) {
          batchItems[activeBatchIndex] = { ...createScrubBatchItem(newBytes, item.name), id: item.id }
          setTimeout(() => URL.revokeObjectURL(url), 60_000)
        } else {
          setScrubFile({ bytes: newBytes, meta, url, name })
        }
        showScrub()
        const n = Object.keys(edits).length
        const parts = [
          n > 0 ? `${n} field${n === 1 ? '' : 's'} changed` : '',
          options.removeXmp ? 'XMP block removed' : ''
        ].filter(Boolean)
        injectControls.status(`Saved ${filename}: ${parts.join(', ')}.`)
      } catch (err) {
        injectControls.status(`Couldn't inject: ${(err as Error).message}`, true)
      }
    }
  })

  const deresControlsSlot = controls.el
  const asciiControlsSlot = asciiControls.el
  const scrubControlsSlot = scrubControls.el
  const injectControlsSlot = injectControls.el
  asciiControlsSlot.hidden = true
  scrubControlsSlot.hidden = true
  injectControlsSlot.hidden = true
  document
    .getElementById('controls')!
    .append(deresControlsSlot, asciiControlsSlot, scrubControlsSlot, injectControlsSlot)

  // Tabs
  const tabDeres = document.getElementById('tab-deres') as HTMLButtonElement | null
  const tabAscii = document.getElementById('tab-ascii') as HTMLButtonElement | null
  const tabScrub = document.getElementById('tab-scrub') as HTMLButtonElement | null
  const tabInject = document.getElementById('tab-inject') as HTMLButtonElement | null
  const layoutEl = document.querySelector('.layout') as HTMLElement | null

  function switchTool(tool: 'deres' | 'ascii' | 'scrub' | 'inject'): void {
    // Leaving a preview pauses its playback; the other preview opens on the frame it was on.
    if (tool !== 'deres') player.pause()
    if (tool !== 'ascii') asciiPlayer.pause()
    if (activeTool === 'deres') sharedFrame = player.frame
    if (activeTool === 'ascii') sharedFrame = asciiPlayer.frame
    if (tool === 'deres' && player.frame !== sharedFrame) {
      player.setFrame(sharedFrame)
      showOriginal(player.frame)
    }
    if (tool === 'ascii') asciiPlayer.setFrame(sharedFrame)
    activeTool = tool
    if (layoutEl) layoutEl.dataset.tool = tool
    if (tabDeres) {
      tabDeres.classList.toggle('active', tool === 'deres')
      tabDeres.setAttribute('aria-selected', String(tool === 'deres'))
    }
    if (tabAscii) {
      tabAscii.classList.toggle('active', tool === 'ascii')
      tabAscii.setAttribute('aria-selected', String(tool === 'ascii'))
    }
    if (tabScrub) {
      tabScrub.classList.toggle('active', tool === 'scrub')
      tabScrub.setAttribute('aria-selected', String(tool === 'scrub'))
    }
    if (tabInject) {
      tabInject.classList.toggle('active', tool === 'inject')
      tabInject.setAttribute('aria-selected', String(tool === 'inject'))
    }

    show(deresStageSlot, tool === 'deres')
    show(deresControlsSlot, tool === 'deres')
    show(asciiStageSlot, tool === 'ascii')
    show(asciiControlsSlot, tool === 'ascii')
    show(scrubStageSlot, tool === 'scrub' || tool === 'inject')
    show(scrubControlsSlot, tool === 'scrub')
    show(injectControlsSlot, tool === 'inject')

    if (tool === 'ascii') {
      asciiControls.sync()
      renderAscii()
    } else if (tool === 'scrub') {
      showScrub()
    } else if (tool === 'inject') {
      showScrub()
      injectControls.sync()
    } else {
      controls.sync()
      render()
    }
  }

  tabDeres?.addEventListener('click', () => switchTool('deres'))
  tabAscii?.addEventListener('click', () => switchTool('ascii'))
  tabScrub?.addEventListener('click', () => switchTool('scrub'))
  tabInject?.addEventListener('click', () => switchTool('inject'))
  if (layoutEl) layoutEl.dataset.tool = 'deres'

  controls.sync()
  asciiControls.sync()
  scrubControls.sync()
  injectControls.sync()

  // A render asked for before playback started is old news once it has, and
  // so is one of a frame the slider has since moved off. While the slider is
  // held, it shows only frames at the playing size (the full-size one is
  // made when it's let go).
  engine.onRendered = (m) => {
    if (!player.playing && !player.holding && m.frame === player.frame) showResult(m)
  }

  function showResult(m: RenderedView): void {
    const tv = settings.pixelShape === 'tv'
    const keep = settings.background === 'transparent' && !!picture?.hasAlpha
    stage.show(m, tv, keep ? null : settings.background === 'white' ? '#ffffff' : '#000000')
    const shape = m.par[0] === m.par[1] ? 'square pixels' : `${m.par[0]}:${m.par[1]} pixels`
    controls.setTileFit(m.tileFit)
    let tileText = ''
    if (m.tileFit) {
      tileText = ` · ${m.tileFit.summary}`
    }
    const coloursText = m.colours === null ? `${m.used} colours used` : `${m.used} of ${m.colours} colours used`
    readout.textContent = `${coloursText} · ${m.width}×${m.height} · ${shape}${tileText}`
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
    if (shownLarger()) render()
  }

  function setScrubFile(file: ScrubFile): void {
    if (scrubFile?.url) URL.revokeObjectURL(scrubFile.url)
    scrubFile = file
  }

  /** Opens one picture. A batch (several files picked together) passes inBatch for its first file. */
  async function open(blob: Blob, name: string, inBatch = false): Promise<void> {
    const ticket = ++opening
    player.halt()
    asciiPlayer.halt()
    stage.setPlaying(false)
    asciiStage.setPlaying(false)
    if (!inBatch) {
      batchItems = []
      activeBatchIndex = 0
    }
    if (!picture) {
      stage.message('Opening…')
      asciiStage.message('Opening…')
      scrubStage.message('Opening…')
    } else {
      readout.textContent = 'Opening…'
    }

    let bytes: Uint8Array | null = null
    try {
      bytes = new Uint8Array(await blob.arrayBuffer())
    } catch {
      // The decode below reports it.
    }

    const frames = bytes ? gifFrameCount(bytes) : 0
    let copy: WorkingCopy | null = null
    let hasAlpha = false
    let animation: PictureAnimation | null = null
    if (bytes && frames > 1) {
      // An animated GIF: the worker decodes every frame, and the first is the
      // picture. If it won't open that way, it opens as a still below.
      const gif = await engine.loadGif(bytes, WORKING_MAX)
      if (ticket !== opening) return
      if (gif) {
        try {
          copy = workingCopyFromRgba(new Uint8ClampedArray(gif.rgba), gif.width, gif.height, gif.origW, gif.origH)
          hasAlpha = gif.hasAlpha
          animation = {
            frames: gif.frames,
            total: gif.total,
            delaysMs: gif.delaysMs,
            durationMs: gif.delaysMs.reduce((a, b) => a + b, 0),
            loopCount: gif.loopCount
          }
        } catch {
          copy = null
        }
      }
    }
    if (!copy) {
      try {
        copy = await decodeToWorkingCopy(blob)
      } catch (err) {
        if (ticket !== opening) return
        openFailed(err, bytes, name)
        return
      }
      if (ticket !== opening) return
      hasAlpha = await engine.load(copy)
      if (ticket !== opening) return
    }
    picture = { copy, name, base: baseName(name), hasAlpha, frames, animation }
    if (animation) gifFramesChosen = true
    player.setAnimation(animation?.delaysMs ?? null)
    asciiPlayer.setAnimation(animation?.delaysMs ?? null)
    sharedFrame = 0
    // The ASCII art of the last picture is no good for exports any more.
    asciiShown = null
    asciiTicket++
    if (bytes) setScrubFile({ bytes, meta: inspectMetadata(bytes), url: URL.createObjectURL(blob), name })
    stage.setSource(copy.canvas)
    controls.sync()
    asciiControls.sync()
    showScrub()
    if (activeTool === 'ascii') {
      renderAscii()
    } else if (activeTool === 'scrub' || activeTool === 'inject') {
      // Scrubber and Injector view already updated
    } else {
      render()
    }
  }

  /** The picture didn't open: say why, and let the scrubber still read the file if it can. */
  function openFailed(err: unknown, bytes: Uint8Array | null, name: string): void {
    const text = err instanceof DecodeError ? DECODE_MESSAGES[err.problem] : DECODE_MESSAGES.unreadable
    if (!picture) {
      stage.message('Choose a photo to start.')
      asciiStage.message('Choose a photo to start.')
      scrubStage.message('Choose a photo to start.')
    }
    // The scrubber reads the file itself, so it can still inspect a photo
    // this browser can't show (HEIC outside Safari), just with no preview.
    const meta = bytes ? inspectMetadata(bytes) : null
    if (bytes && meta && meta.format !== 'unknown') {
      setScrubFile({ bytes, meta, url: null, name })
      showScrub()
    } else {
      showScrub()
      scrubStage.problem(text)
    }
    stage.problem(text)
    asciiStage.problem(text)
    controls.sync()
    asciiControls.sync()
  }

  async function loadSample(id = DEFAULT_SAMPLE.id): Promise<void> {
    const sample = sampleById(id)
    try {
      const res = await fetch(sample.url)
      await open(await res.blob(), sample.name)
    } catch {
      stage.problem("The sample picture didn't load. Choose a photo of your own instead.")
      asciiStage.problem("The sample picture didn't load. Choose a photo of your own instead.")
      scrubStage.problem("The sample picture didn't load. Choose a photo of your own instead.")
    }
  }

  async function download(): Promise<void> {
    if (!picture) return
    controls.status('Making the PNG…')
    try {
      const fxOk = settings.exportFx && settings.fx.screen !== 'off'
      const res = await engine.export(deres(settings), settings.multiplier, fxOk, picture.base, player.frame)
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

  async function downloadAnimated(format: 'apng' | 'gif'): Promise<void> {
    if (!picture) return
    const signalOn = settings.signal.mode !== 'off'
    const style = picture.animation && gifFramesChosen ? 'gif-frames' : settings.animationStyle
    const styleName =
      style === 'gif-frames'
        ? 'the'
        : style === 'screen-fx'
          ? signalOn
            ? 'signal loop'
            : 'Screen FX loop'
          : style === 'compare-wipe'
            ? 'Before & After wipe'
            : 'Dither shimmer'
    const making = `Making ${styleName} ${format.toUpperCase()}…`
    controls.status(making)
    try {
      const fxOk = settings.exportFx && settings.fx.screen !== 'off'
      // The biggest Size that fits, as the hint by the buttons says.
      const g = geometry()
      const fitted = g ? animationFit(settings, g, style === 'gif-frames').multiplier : null
      const res = await engine.exportAnimated(
        deres(settings),
        format,
        style,
        fitted ?? settings.multiplier,
        fxOk,
        picture.base,
        (done, total, note) =>
          controls.status(`${making} ${note ? `${note}, ` : ''}frame ${done} of ${total}${done === total && !note ? ', putting them together' : ''}`),
        signalOn ? { frames: settings.loopFrames, fps: settings.loopFps } : undefined,
        player.frame
      )
      const blob = new Blob([res.data], { type: res.mimeType })
      const url = URL.createObjectURL(blob)
      const a = h('a', { href: url, download: res.filename, class: 'visually-hidden' })
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      controls.status(`Saved ${res.filename} (${res.width}×${res.height}, ${res.frameCount} frames).`)
    } catch (err) {
      controls.status(`Couldn't make ${format.toUpperCase()}: ${(err as Error).message}`)
    }
  }

  async function downloadEmulator(format: 'scr' | 'koa' | 'chr'): Promise<void> {
    if (!picture) return
    controls.status(`Making the .${format}…`)
    try {
      const res = await engine.exportEmulator(deres(settings), format, picture.base, player.frame)
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

  async function downloadWallpaper(preset: 'phone' | 'win95' | 'desktop-1080p'): Promise<void> {
    if (!picture) return
    controls.status(`Generating ${preset} wallpaper…`)
    try {
      const fxOk = settings.exportFx && settings.fx.screen !== 'off'
      const res = await engine.exportWallpaper(deres(settings), preset, fxOk, picture.base, player.frame)
      const blob = new Blob([res.png], { type: 'image/png' })
      const url = URL.createObjectURL(blob)
      const a = h('a', { href: url, download: res.filename, class: 'visually-hidden' })
      document.body.append(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      controls.status(`Saved ${res.filename} (${res.width}×${res.height}).`)
    } catch (err) {
      controls.status(`Couldn't make wallpaper: ${(err as Error).message}`)
    }
  }

  function surpriseMe(): void {
    const eligible = PROFILES.filter((p) => p.id !== 'custom')
    const randProfile = eligible[Math.floor(Math.random() * eligible.length)]
    const dithers: DitherId[] = ['none', 'bayer2', 'bayer4', 'bayer8', 'floyd', 'atkinson', 'yliluoma']
    if (randProfile.nativeDither) dithers.push(randProfile.nativeDither)
    const randDither = dithers[Math.floor(Math.random() * dithers.length)]
    const randBrightness = Math.round((Math.random() * 0.2 - 0.1) * 100) / 100
    const randContrast = Math.round((0.9 + Math.random() * 0.3) * 100) / 100
    const randSaturation = Math.round((0.85 + Math.random() * 0.4) * 100) / 100
    const randScreen = Math.random() > 0.5 ? randProfile.screen : 'off'

    settings = {
      ...settings,
      profileId: randProfile.id,
      customCount: undefined,
      dither: randDither,
      adjust: {
        ...settings.adjust,
        brightness: randBrightness,
        contrast: randContrast,
        saturation: randSaturation
      },
      fx: {
        ...settings.fx,
        screen: randScreen
      }
    }
    saveSettings(settings)
    controls.sync()
    render()
    controls.status(`🎲 Rolled: ${randProfile.name} · ${randDither} dither · ${randScreen} screen`)
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
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files)
    } else {
      const file = imageFromTransfer(e.dataTransfer)
      if (file) open(file, file.name)
      else stage.problem("That doesn't look like a picture.")
    }
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

  // A share link opened on top of the page: applied and kept, as on a fresh load.
  window.addEventListener('hashchange', () => {
    const fromHash = settingsFromHash(window.location.hash, settings)
    if (fromHash) {
      settings = fromHash
      saveSettings(settings, true)
      controls.sync()
      render()
    }
    dropShareLink()
  })

  footer()
  stage.message('Loading the sample…')
  asciiStage.message('Loading the sample…')
  scrubStage.message('Loading the sample…')
  loadSample()
}

/** Where the code lives (MIT, so anyone can read it and host a copy). */
const SOURCE_URL = 'https://github.com/still-b0r3d/DeRes'

function footer(): void {
  const version = import.meta.env.VITE_APP_VERSION || 'dev'
  const commit = (import.meta.env.VITE_BUILD_COMMIT || '').slice(0, 7)
  const line = document.getElementById('app-version')!
  const dot = () => h('span', { 'aria-hidden': 'true' }, ' · ')
  line.replaceChildren(
    `b0r3d DeRes v${version}`,
    ...(commit ? [dot(), `build ${commit}`] : []),
    dot(),
    h('a', { href: SOURCE_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Source'),
    dot(),
    h('a', { href: './LICENSE.txt' }, 'MIT')
  )
}
