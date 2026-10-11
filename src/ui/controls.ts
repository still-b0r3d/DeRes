import { NEUTRAL } from '../core/adjust'
import { DITHERS } from '../core/dither'
import { FX_MIN_MULTIPLIER } from '../core/export'
import type { Geometry } from '../core/geometry'
import { framesText } from '../core/gif-info'
import { animationLimit, animationMultiplier, heldFrames } from '../core/animate'
import { colourCount, ditherApplies, ditherNote, exportSize, MAX_EXPORT_PIXELS, maxColourCount, paletteBytes } from '../core/pipeline'
import { PROFILES, profileById, representativePalette } from '../core/profiles'
import {
  CONNECTION_NAMES,
  LOOP_FPS,
  LOOP_FRAMES,
  resolveConnection,
  signalMachine,
  type LoopFps,
  type LoopFrames
} from '../core/signal'
import type { HardwareFitReport } from '../core/tiles'
import { h, segmented, show, slider, twoStepButton } from './dom'
import { sampleLinks } from './samples'
import { MULTIPLIERS, type Settings } from './settings'

// The control column, in pipeline order: Image -> Hardware -> Adjust ->
// Dither -> Screen -> Export. Every control writes through ctx.set() and is
// redrawn from the settings by sync(), so there's one source of truth.

export interface ControlsContext {
  get(): Settings
  set(patch: Partial<Settings>): void
  pickProfile(id: string): void
  openFile(): void
  loadSample(id?: string): void
  download(): void
  downloadAnimated?: (format: 'apng' | 'gif') => void
  downloadEmulator?: (format: 'scr' | 'koa' | 'chr') => void
  downloadWallpaper?: (preset: 'phone' | 'win95' | 'desktop-1080p') => void
  surpriseMe?: () => void
  loadPaletteFile(): void
  grabPalette(): void
  shareLink(): void
  /** With an animated GIF open: whether the animation export uses its own frames (the default). */
  gifFrames(): boolean
  setGifFrames(on: boolean): void
  /** Every setting back to its default (the picture stays). */
  resetSettings(): void
  /** What's loaded, or null. */
  picture(): {
    name: string
    origW: number
    origH: number
    hasAlpha: boolean
    /** Images in the file (a GIF can hold many). */
    frames: number
    /** An animated GIF; null for a still (or a GIF opened as one). */
    animation: { frames: number; total: number; durationMs: number } | null
  } | null
  geometry(): Geometry | null
}

export { MULTIPLIERS }

/** The size a GIF or APNG comes out at with these settings. */
export interface AnimationFit {
  /** The Size it's made at: the chosen one, or the biggest smaller one that fits. Null when none fits. */
  multiplier: number | null
  /** Frames held at once while it's made. */
  held: number
  /** The next Size up that doesn't fit (the smallest, when none fits); null when the chosen one fits. */
  next: number | null
  /** Why `next` doesn't fit: one frame is too big, or all of them together. */
  limit: 'frame' | 'frames' | null
}

/**
 * Animations hold their frames at once, so they can stop short of the PNG's
 * size: they drop to the biggest Size that fits instead. `gifFrames`: the
 * export is an animated GIF's own frames.
 */
export function animationFit(s: Settings, g: Geometry, gifFrames: boolean): AnimationFit {
  const tv = s.pixelShape === 'tv' && g.par[0] !== g.par[1]
  const size = (m: number) => exportSize(g.width, g.height, g.par, m, tv)
  const held = heldFrames(gifFrames ? 'gif-frames' : s.animationStyle, s.signal.mode !== 'off' ? s.loopFrames : null)
  const multiplier = animationMultiplier(size, s.multiplier, held, MULTIPLIERS)
  const next = MULTIPLIERS.find((m) => m <= s.multiplier && (multiplier === null || m > multiplier)) ?? null
  return { multiplier, held, next, limit: next === null ? null : animationLimit(...size(next), held) }
}

function section(title: string, open: boolean, ...body: (Node | null)[]): HTMLDetailsElement {
  return h(
    'details',
    { class: 'sec', open },
    h('summary', null, title),
    h('div', { class: 'sec-body' }, ...body)
  )
}

const pct = (v: number) => `${Math.round(v * 100)}%`
const signedPct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`

export function buildControls(ctx: ControlsContext): {
  el: HTMLElement
  sync: () => void
  status: (t: string) => void
  setTileFit: (report?: HardwareFitReport) => void
} {
  const set = ctx.set

  // Image
  const pictureInfo = h('p', { class: 'picture-info', 'data-testid': 'picture-info' })
  const fit = segmented(
    'Framing',
    [
      { value: 'fill', text: 'Crop to fill' },
      { value: 'fit', text: 'Fit, with bars' },
      { value: 'stretch', text: 'Stretch' }
    ] as const,
    (v) => set({ fit: v })
  )
  fit.el.classList.add('cols-3')
  const resolution = segmented(
    'Resolution',
    [
      { value: 'native', text: 'Native' },
      { value: 'custom', text: 'Custom block size' }
    ] as const,
    (v) => set({ resolution: v })
  )
  const block = slider({
    id: 'block',
    label: 'Block size',
    min: 2,
    max: 32,
    step: 1,
    format: (v) => `${v} px`,
    onInput: (v) => set({ block: v })
  })
  const background = segmented(
    'Transparent areas',
    [
      { value: 'white', text: 'White' },
      { value: 'black', text: 'Black' }
    ] as const,
    (v) => set({ background: v })
  )
  const backgroundRow = h('div', { class: 'row' }, h('span', { class: 'row-label' }, 'Transparent areas'), background.el)
  const fitRow = h('div', { class: 'row' }, h('span', { class: 'row-label' }, 'Framing'), fit.el)
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
    pictureInfo,
    h('div', { class: 'row' }, h('span', { class: 'row-label' }, 'Resolution'), resolution.el),
    block.el,
    fitRow,
    backgroundRow
  )

  // Hardware
  const cards = new Map<string, HTMLButtonElement>()
  const grid = h('div', { class: 'cards', role: 'group', 'aria-label': 'Hardware' })
  for (const p of PROFILES) {
    const strip = h('canvas', { class: 'swatch', 'aria-hidden': 'true' })
    const bytes = paletteBytes(p)
    const n = bytes.length / 3
    strip.width = n
    strip.height = 1
    const sctx = strip.getContext('2d')
    if (sctx) {
      const img = sctx.createImageData(n, 1)
      for (let i = 0; i < n; i++) img.data.set([bytes[i * 3], bytes[i * 3 + 1], bytes[i * 3 + 2], 255], i * 4)
      sctx.putImageData(img, 0, 0)
    }
    const size = `${p.width}×${p.height === 'auto' ? '…' : p.height}`
    const card = h(
      'button',
      {
        type: 'button',
        class: 'card',
        'data-profile': p.id,
        'data-kind': p.palette.kind,
        'data-palette': representativePalette(p.palette).join(','),
        onclick: () => ctx.pickProfile(p.id)
      },
      h('span', { class: 'card-name' }, p.name),
      h('span', { class: 'card-meta' }, `${p.origin.split(' · ').pop()} · ${size}`),
      strip
    )
    card.title = `${p.origin}. ${p.about}`
    cards.set(p.id, card)
    grid.append(card)
  }
  const about = h('p', { class: 'about', 'data-testid': 'profile-about' })
  const tileFitEl = h('div', { class: 'tile-fit-badge', 'data-testid': 'tile-fit', hidden: true })

  const customCount = slider({
    id: 'custom-count',
    label: 'Colours',
    min: 2,
    max: 256,
    step: 1,
    format: (v) => `${v} colours`,
    onInput: (v) => set({ customCount: v })
  })
  const loadPaletteBtn = h('button', { type: 'button', class: 'small', onclick: () => ctx.loadPaletteFile() }, 'Load palette (.hex, .pal, .gpl, .png)')
  const grabPaletteBtn = h('button', { type: 'button', class: 'small', onclick: () => ctx.grabPalette() }, 'Grab palette')
  const paletteTools = h('div', { class: 'palette-tools' }, customCount.el, h('div', { class: 'btn-row' }, loadPaletteBtn, grabPaletteBtn))
  const surpriseBtn = h(
    'button',
    {
      type: 'button',
      class: 'surprise-btn',
      'data-testid': 'surprise-btn',
      title: 'Shuffle a random retro machine, dither, and pre-filter aesthetic',
      onclick: () => ctx.surpriseMe?.()
    },
    '🎲 Surprise me'
  )

  const hardwareSec = section('Hardware', false, surpriseBtn, grid, about, tileFitEl, paletteTools)

  // Adjust
  const adj = {
    brightness: slider({
      id: 'brightness',
      label: 'Brightness',
      min: -0.5,
      max: 0.5,
      step: 0.01,
      format: signedPct,
      onInput: (v) => set({ adjust: { ...ctx.get().adjust, brightness: v } })
    }),
    contrast: slider({
      id: 'contrast',
      label: 'Contrast',
      min: 0,
      max: 2,
      step: 0.01,
      format: pct,
      onInput: (v) => set({ adjust: { ...ctx.get().adjust, contrast: v } })
    }),
    saturation: slider({
      id: 'saturation',
      label: 'Saturation',
      min: 0,
      max: 2,
      step: 0.01,
      format: pct,
      onInput: (v) => set({ adjust: { ...ctx.get().adjust, saturation: v } })
    }),
    gamma: slider({
      id: 'gamma',
      label: 'Gamma',
      min: 0.4,
      max: 2.5,
      step: 0.01,
      format: (v) => v.toFixed(2),
      onInput: (v) => set({ adjust: { ...ctx.get().adjust, gamma: v } })
    })
  }
  const adjustSec = section(
    'Adjust',
    false,
    adj.brightness.el,
    adj.contrast.el,
    adj.saturation.el,
    adj.gamma.el,
    h('button', { type: 'button', class: 'small', onclick: () => set({ adjust: { ...NEUTRAL } }) }, 'Reset')
  )

  // Dither
  const ditherButtons = new Map<string, HTMLButtonElement>()
  const ditherList = h('div', { class: 'dithers', role: 'group', 'aria-label': 'Dither' })
  for (const d of DITHERS) {
    const b = h(
      'button',
      { type: 'button', class: 'dither', 'data-dither': d.id, onclick: () => set({ dither: d.id }) },
      h('span', { class: 'dither-name' }, d.name),
      h('span', { class: 'dither-hint' }, d.hint)
    )
    ditherButtons.set(d.id, b)
    ditherList.append(b)
  }
  const ditherNoteEl = h('p', { class: 'hint', 'data-testid': 'dither-note', hidden: true })
  const ditherSec = section('Dither', false, ditherNoteEl, ditherList)

  // Signal
  const sigPatch = (patch: Partial<Settings['signal']>) => set({ signal: { ...ctx.get().signal, ...patch } })
  const signalMode = segmented(
    'Signal',
    [
      { value: 'off', text: 'Off' },
      { value: 'auto', text: "Machine's own" },
      { value: 'rf', text: 'RF' },
      { value: 'composite', text: 'Composite' },
      { value: 'vhs-sp', text: 'VHS SP' },
      { value: 'vhs-lp', text: 'VHS LP' },
      { value: 'vhs-ep', text: 'VHS EP' }
    ] as const,
    (v) => sigPatch({ mode: v })
  )
  const signalNote = h('p', { class: 'hint', 'data-testid': 'signal-note' })
  const wear = slider({
    id: 'signal-wear',
    label: 'Wear',
    min: 0,
    max: 1,
    step: 0.05,
    format: pct,
    onInput: (v) => sigPatch({ wear: v })
  })
  const signalColour = slider({
    id: 'signal-colour',
    label: 'Colour',
    min: 0,
    max: 1.5,
    step: 0.05,
    format: pct,
    onInput: (v) => sigPatch({ colour: v })
  })
  const sharpen = slider({
    id: 'signal-sharpen',
    label: 'Sharpen',
    min: 0,
    max: 1,
    step: 0.05,
    format: pct,
    onInput: (v) => sigPatch({ sharpen: v })
  })
  const decoder = segmented(
    'TV decoder',
    [
      { value: 'notch', text: 'Simple' },
      { value: 'comb', text: 'Comb filter' }
    ] as const,
    (v) => sigPatch({ decoder: v })
  )
  const advanced = h(
    'details',
    { class: 'sub' },
    h('summary', null, 'Advanced'),
    h(
      'div',
      { class: 'group' },
      signalColour.el,
      sharpen.el,
      h('div', { class: 'row' }, h('span', { class: 'row-label' }, 'TV decoder'), decoder.el),
      h('p', { class: 'hint' }, 'A comb filter cleans up the colour fringes, and with them the colours that only exist in the signal (CGA, Apple II).')
    )
  )
  const signalGroup = h('div', { class: 'group' }, wear.el, advanced)
  const signalSec = section(
    'Signal',
    false,
    signalMode.el,
    signalNote,
    signalGroup,
    h('p', { class: 'hint' }, 'The noise moves when a GIF plays, and in the animations under Export.'),
    h(
      'p',
      { class: 'hint credit' },
      'Signal engine: ',
      h('a', { href: 'https://github.com/valadaptive/ntsc-rs', target: '_blank', rel: 'noopener' }, 'ntsc-rs'),
      ' by valadaptive (MIT) · ',
      h('a', { href: '/THIRD-PARTY-NOTICES.txt', target: '_blank', 'data-testid': 'signal-notices' }, 'notices')
    )
  )

  // Screen
  const fxPatch = (patch: Partial<Settings['fx']>) => set({ fx: { ...ctx.get().fx, ...patch } })
  const screen = segmented(
    'Screen effect',
    [
      { value: 'off', text: 'Off' },
      { value: 'crt', text: 'CRT' },
      { value: 'lcd', text: 'LCD' },
      { value: 'vhs', text: 'VHS' },
      { value: 'composite', text: 'Composite' },
      { value: 'p1-green', text: 'P1 Green' },
      { value: 'p3-amber', text: 'P3 Amber' },
      { value: 'p4-white', text: 'P4 White' }
    ] as const,
    (v) => fxPatch({ screen: v })
  )
  const mask = segmented(
    'Mask',
    [
      { value: 'none', text: 'None' },
      { value: 'shadow', text: 'Shadow mask' },
      { value: 'grille', text: 'Aperture grille' }
    ] as const,
    (v) => fxPatch({ mask: v })
  )
  mask.el.classList.add('cols-3')
  const fxSlider = (id: 'scanlines' | 'curve' | 'bloom' | 'grid' | 'ghost', label: string) =>
    slider({ id: `fx-${id}`, label, min: 0, max: 1, step: 0.01, format: pct, onInput: (v) => fxPatch({ [id]: v }) })
  const fxs = {
    scanlines: fxSlider('scanlines', 'Scanlines'),
    curve: fxSlider('curve', 'Curve'),
    bloom: fxSlider('bloom', 'Bloom'),
    grid: fxSlider('grid', 'Pixel grid'),
    ghost: fxSlider('ghost', 'Ghosting')
  }
  const vhsTracking = slider({
    id: 'fx-vhs-tracking',
    label: 'Tracking jitter & noise',
    min: 0,
    max: 1,
    step: 0.05,
    format: pct,
    onInput: (v) => fxPatch({ vhsTracking: v })
  })
  const vhsOsdBox = h('input', { type: 'checkbox', id: 'fx-vhs-osd' })
  vhsOsdBox.addEventListener('change', () => fxPatch({ vhsOsd: vhsOsdBox.checked }))
  const vhsOsdLabel = h('label', { class: 'check', for: 'fx-vhs-osd' }, vhsOsdBox, ' On-screen display (PLAY ▶)')
  const vhsGroup = h('div', { class: 'group' }, vhsTracking.el, vhsOsdLabel)

  const maskRow = h('div', { class: 'row' }, h('span', { class: 'row-label' }, 'Mask'), mask.el)
  const crtGroup = h(
    'div',
    { class: 'group' },
    maskRow,
    fxs.scanlines.el,
    fxs.curve.el,
    fxs.bloom.el
  )
  const lcdGroup = h('div', { class: 'group' }, fxs.grid.el, fxs.ghost.el)
  const screenSec = section(
    'Screen',
    false,
    screen.el,
    crtGroup,
    vhsGroup,
    lcdGroup,
    h('p', { class: 'hint' }, `For the preview. To keep it in the PNG, tick "With the screen effect" under Export (${FX_MIN_MULTIPLIER}× and up).`)
  )

  // Export
  const shape = segmented(
    'Pixel shape',
    [
      { value: 'raw', text: 'Raw pixels' },
      { value: 'tv', text: 'As on a TV' }
    ] as const,
    (v) => set({ pixelShape: v })
  )
  const shapeNote = h('p', { class: 'hint' })
  const shapeRow = h(
    'div',
    null,
    h('div', { class: 'row' }, h('span', { class: 'row-label' }, 'Pixel shape'), shape.el),
    shapeNote
  )
  const mult = segmented(
    'Size',
    MULTIPLIERS.map((m) => ({ value: String(m), text: `${m}×` })),
    (v) => set({ multiplier: Number(v) })
  )
  mult.el.classList.add('cols-4')
  const sizeLine = h('p', { class: 'size-line', 'data-testid': 'export-size' })
  const fxBox = h('input', { type: 'checkbox', id: 'export-fx' })
  fxBox.addEventListener('change', () => set({ exportFx: fxBox.checked }))
  const fxLabel = h('label', { class: 'check', for: 'export-fx' }, fxBox, ' With the screen effect')
  const downloadBtn = h('button', { type: 'button', class: 'download', onclick: () => ctx.download() }, 'Download PNG')

  // "GIF frames" (an animated GIF's own frames) is offered only while one is open.
  const animStyle = segmented(
    'Animation loop',
    [
      { value: 'gif-frames', text: 'GIF frames' },
      { value: 'screen-fx', text: 'Screen FX' },
      { value: 'compare-wipe', text: 'A/B Wipe' },
      { value: 'dither-shimmer', text: 'Shimmer' }
    ] as const,
    (v) => {
      ctx.setGifFrames(v === 'gif-frames')
      if (v !== 'gif-frames') set({ animationStyle: v })
    }
  )
  animStyle.el.classList.add('anim-styles')
  const gifFramesBtn = animStyle.buttons.get('gif-frames')!
  const animRow = h('div', { class: 'row anim-row' }, h('span', { class: 'row-label' }, 'Animation loop'), animStyle.el)
  // Length and speed of the Screen FX loop with the signal on.
  const loopFrames = segmented(
    'Loop length',
    LOOP_FRAMES.map((n) => ({ value: String(n), text: `${n} frames` })),
    (v) => set({ loopFrames: Number(v) as LoopFrames })
  )
  loopFrames.el.classList.add('cols-3')
  const loopFps = segmented(
    'Loop speed',
    LOOP_FPS.map((n) => ({ value: String(n), text: `${n} fps` })),
    (v) => set({ loopFps: Number(v) as LoopFps })
  )
  const loopRows = h(
    'div',
    { class: 'group', 'data-testid': 'loop-rows' },
    h('div', { class: 'row' }, h('span', { class: 'row-label' }, 'Loop length'), loopFrames.el),
    h('div', { class: 'row' }, h('span', { class: 'row-label' }, 'Loop speed'), loopFps.el)
  )

  const downloadApngBtn = h(
    'button',
    {
      type: 'button',
      class: 'anim-btn',
      'data-testid': 'download-apng',
      onclick: () => ctx.downloadAnimated?.('apng')
    },
    '🎬 Download APNG'
  )
  const downloadGifBtn = h(
    'button',
    {
      type: 'button',
      class: 'anim-btn',
      'data-testid': 'download-gif',
      onclick: () => ctx.downloadAnimated?.('gif')
    },
    '🎞️ Download GIF'
  )
  const animActions = h('div', { class: 'anim-actions' }, downloadApngBtn, downloadGifBtn)
  // When GIF and APNG can't be made at the chosen Size: what they come out at, and why.
  const animHint = h('p', { class: 'hint anim-hint', 'data-testid': 'anim-hint', hidden: true })

  const emuScrBtn = h(
    'button',
    {
      type: 'button',
      class: 'emu-btn',
      'data-testid': 'download-scr',
      onclick: () => ctx.downloadEmulator?.('scr')
    },
    'Download .scr (ZX Spectrum)'
  )
  const emuKoaBtn = h(
    'button',
    {
      type: 'button',
      class: 'emu-btn',
      'data-testid': 'download-koa',
      onclick: () => ctx.downloadEmulator?.('koa')
    },
    'Download .koa (C64 Koala)'
  )
  const emuChrBtn = h(
    'button',
    {
      type: 'button',
      class: 'emu-btn',
      'data-testid': 'download-chr',
      onclick: () => ctx.downloadEmulator?.('chr')
    },
    'Download .chr (Game Boy tiles)'
  )
  const emuActions = h('div', { class: 'emu-actions', hidden: true }, emuScrBtn, emuKoaBtn, emuChrBtn)
  const exportNote = h('p', { class: 'hint export-note', 'data-testid': 'export-note', hidden: true })
  const shareBtn = h('button', { type: 'button', class: 'share-link', onclick: () => ctx.shareLink() }, 'Copy share link')

  const wallPhoneBtn = h(
    'button',
    {
      type: 'button',
      class: 'wall-btn',
      'data-testid': 'export-wall-phone',
      onclick: () => ctx.downloadWallpaper?.('phone')
    },
    '📱 Phone'
  )
  const wallWin95Btn = h(
    'button',
    {
      type: 'button',
      class: 'wall-btn',
      'data-testid': 'export-wall-win95',
      onclick: () => ctx.downloadWallpaper?.('win95')
    },
    '🖥️ Win95 (1024×768)'
  )
  const wall1080pBtn = h(
    'button',
    {
      type: 'button',
      class: 'wall-btn',
      'data-testid': 'export-wall-1080p',
      onclick: () => ctx.downloadWallpaper?.('desktop-1080p')
    },
    '🖥️ 1080p'
  )
  const wallRow = h(
    'div',
    { class: 'row wallpaper-row' },
    h('span', { class: 'row-label' }, 'Wallpaper presets'),
    h('div', { class: 'wall-btns' }, wallPhoneBtn, wallWin95Btn, wall1080pBtn)
  )

  const statusLine = h('p', { class: 'status', role: 'status' })
  const exportSec = section(
    'Export',
    false,
    shapeRow,
    h('div', { class: 'row' }, h('span', { class: 'row-label' }, 'Size'), mult.el),
    sizeLine,
    fxLabel,
    animRow,
    loopRows,
    h('div', { class: 'export-actions' }, downloadBtn, animActions, animHint, emuActions, shareBtn),
    exportNote,
    wallRow,
    statusLine
  )

  const resetBtn = twoStepButton({
    label: 'Reset settings',
    confirmLabel: 'Reset everything?',
    testid: 'reset-settings',
    onConfirm: () => ctx.resetSettings()
  })
  const el = h(
    'div',
    { class: 'controls-inner', 'data-testid': 'deres-controls' },
    imageSec,
    hardwareSec,
    adjustSec,
    ditherSec,
    signalSec,
    screenSec,
    exportSec,
    h('div', { class: 'reset-row' }, resetBtn)
  )

  function sync(): void {
    const s = ctx.get()
    const p = profileById(s.profileId)!
    const pic = ctx.picture()
    const g = ctx.geometry()

    pictureInfo.textContent = pic
      ? [`${pic.name} · ${pic.origW}×${pic.origH}`, framesText(pic.frames, pic.animation)].filter(Boolean).join(' · ')
      : 'No picture yet'
    resolution.set(s.resolution)
    const native = resolution.buttons.get('native')!
    native.textContent = `Native ${p.width}×${p.height === 'auto' ? 'auto' : p.height}`
    show(block.el, s.resolution === 'custom')
    block.set(s.block)
    if (s.resolution === 'custom' && g) block.el.querySelector('output')!.textContent = `${s.block} px → ${g.width}×${g.height}`
    fit.set(s.fit)
    show(fitRow, s.resolution === 'native' && p.height !== 'auto')
    background.set(s.background)
    show(backgroundRow, !!pic?.hasAlpha)

    for (const [id, card] of cards) card.setAttribute('aria-pressed', String(id === s.profileId))
    about.textContent = `${p.origin}. ${p.about}`

    // Range, pool and Custom machines pick their colours from the photo; the
    // slider can ask for fewer, never more than the machine had.
    const maxCount = maxColourCount(p)
    show(paletteTools, maxCount !== null)
    if (maxCount !== null) {
      customCount.input.max = String(maxCount)
      customCount.set(colourCount(p, s.customCount)!)
      show(customCount.el, !(p.palette.kind === 'custom' && s.customPalette))
    }

    if (cards.has('custom')) {
      const customCard = cards.get('custom')!
      const strip = customCard.querySelector('canvas.swatch') as HTMLCanvasElement
      if (strip && s.customPalette && s.customPalette.length > 0) {
        const bytes = paletteBytes(profileById('custom')!, s.customPalette)
        const n = bytes.length / 3
        strip.width = n
        const sctx = strip.getContext('2d')
        if (sctx) {
          const img = sctx.createImageData(n, 1)
          for (let i = 0; i < n; i++) img.data.set([bytes[i * 3], bytes[i * 3 + 1], bytes[i * 3 + 2], 255], i * 4)
          sctx.putImageData(img, 0, 0)
        }
      }
    }

    adj.brightness.set(s.adjust.brightness)
    adj.contrast.set(s.adjust.contrast)
    adj.saturation.set(s.adjust.saturation)
    adj.gamma.set(s.adjust.gamma)

    for (const d of DITHERS) {
      const b = ditherButtons.get(d.id)!
      show(b, !d.native || p.nativeDither === d.id)
      // Greyed out where it would change nothing on this machine.
      b.disabled = !ditherApplies(p, d.id)
      b.setAttribute('aria-pressed', String(s.dither === d.id && !b.disabled))
    }
    const dNote = ditherNote(p)
    ditherNoteEl.textContent = dNote ?? ''
    show(ditherNoteEl, dNote !== null)

    signalMode.set(s.signal.mode)
    wear.set(s.signal.wear)
    signalColour.set(s.signal.colour)
    sharpen.set(s.signal.sharpen)
    decoder.set(s.signal.decoder)
    const signalOn = s.signal.mode !== 'off'
    show(signalGroup, signalOn)
    const machine = signalMachine(p.id, g?.width ?? p.width)
    const connection = resolveConnection(s.signal.mode, machine)
    signalNote.textContent = connection
      ? `The ${p.name} over ${CONNECTION_NAMES[connection]}.` +
        (machine.artifact === 'cga'
          ? ' Its colours are made by the signal itself: each one is a pattern of black and white dots.'
          : machine.lineLocked
            ? ' Its colour fringes stand still, as they did on the real thing.'
            : '')
      : 'Off. The real thing: the picture goes out as an analog TV signal and comes back with the colour bleed, fringes and noise a TV showed.'

    screen.set(s.fx.screen)
    const hasCrt =
      s.fx.screen === 'crt' ||
      s.fx.screen === 'vhs' ||
      s.fx.screen === 'composite' ||
      s.fx.screen === 'p1-green' ||
      s.fx.screen === 'p3-amber' ||
      s.fx.screen === 'p4-white'
    show(crtGroup, hasCrt)
    show(maskRow, s.fx.screen === 'crt')
    show(fxs.bloom.el, s.fx.screen === 'crt' || s.fx.screen === 'p1-green' || s.fx.screen === 'p3-amber' || s.fx.screen === 'p4-white')
    show(vhsGroup, s.fx.screen === 'vhs')
    vhsTracking.set(s.fx.vhsTracking ?? 0.8)
    vhsOsdBox.checked = s.fx.vhsOsd !== false
    show(lcdGroup, s.fx.screen === 'lcd')
    mask.set(s.fx.mask)
    for (const k of ['scanlines', 'curve', 'bloom', 'grid', 'ghost'] as const) fxs[k].set(s.fx[k])

    const par = g?.par ?? p.par
    const square = par[0] === par[1]
    show(shapeRow, !square)
    shape.set(s.pixelShape)
    shapeNote.textContent = square
      ? ''
      : `This machine's pixels are ${par[0]}:${par[1]} (width:height). "As on a TV" stretches the PNG to match.`
    const tv = s.pixelShape === 'tv' && !square
    for (const m of MULTIPLIERS) {
      const b = mult.buttons.get(String(m))!
      const [w, hh] = g ? exportSize(g.width, g.height, par, m, tv) : [0, 0]
      const tooBig = w * hh > MAX_EXPORT_PIXELS
      b.disabled = tooBig
      b.title = g ? `${w}×${hh}${tooBig ? ' (too big)' : ''}` : ''
    }
    mult.set(String(s.multiplier))
    const animatedFrames = pic?.animation?.frames ?? 0
    const gifFrames = animatedFrames > 1 && ctx.gifFrames()
    show(gifFramesBtn, animatedFrames > 1)
    animStyle.el.classList.toggle('cols-4', animatedFrames > 1)
    animStyle.el.classList.toggle('cols-3', animatedFrames <= 1)
    animStyle.set(gifFrames ? 'gif-frames' : s.animationStyle)
    const signalLoop = signalOn && !gifFrames && s.animationStyle === 'screen-fx'
    show(loopRows, signalLoop)
    loopFrames.set(String(s.loopFrames))
    loopFps.set(String(s.loopFps))
    const fxOn = s.fx.screen !== 'off'
    fxBox.checked = s.exportFx
    fxBox.disabled = !fxOn || s.multiplier < FX_MIN_MULTIPLIER
    fxLabel.classList.toggle('disabled', fxBox.disabled)
    if (g) {
      const [w, hh] = exportSize(g.width, g.height, par, s.multiplier, tv)
      const withFx = s.exportFx && !fxBox.disabled
      let coloursLabel: string
      if (p.palette.kind === 'direct') {
        coloursLabel = '15-bit direct'
      } else if (p.palette.kind === 'ham') {
        coloursLabel = '12-bit HAM6'
      } else if (p.palette.kind === 'n64') {
        coloursLabel = '16-bit RGBA5551'
      } else if (p.palette.kind === 'pool') {
        coloursLabel = `${colourCount(p, s.customCount)} from ${p.palette.pool.length} colours`
      } else if (p.palette.kind === 'cell') {
        if (p.palette.mode === 'gbc-tile') coloursLabel = '8 palettes of 4 colours (32 max)'
        else if (p.palette.mode === 'msx-screen2') coloursLabel = '2 colours per 8×1 line (15 colours)'
        else coloursLabel = `cell clash (${p.palette.colours.length} colours)`
      } else if (p.palette.kind === 'analog') {
        if (p.palette.mode === 'fax') coloursLabel = '1-bit fax'
        else if (p.palette.mode === 'risograph') coloursLabel = '2-ink risograph'
        else if (p.palette.mode === 'newspaper') coloursLabel = 'CMYK halftone rosette'
        else if (p.palette.mode === 'deepfry') coloursLabel = '8×8 DCT crunch'
        else coloursLabel = '640×480 CCD sensor'
      } else if (p.palette.kind === 'fixed') {
        coloursLabel = `${p.palette.colours.length}-colour palette`
      } else if (p.palette.kind === 'range') {
        coloursLabel = `${colourCount(p, s.customCount)}-colour palette`
      } else {
        const count = s.customPalette?.length ?? colourCount(p, s.customCount) ?? 16
        coloursLabel = `${count}-colour palette`
      }
      const tooBig = w * hh > MAX_EXPORT_PIXELS
      const look = signalOn ? `full colour, ${connection ? `through ${CONNECTION_NAMES[connection]}` : 'with the signal'}` : withFx ? 'full colour' : coloursLabel
      // The size line is the PNG's; GIF and APNG have their own line by their buttons.
      sizeLine.textContent = tooBig ? `${w}×${hh} is too big. Pick a smaller size.` : `${w}×${hh} px · ${look}`
      downloadBtn.disabled = !pic || tooBig

      const anim = animationFit(s, g, gifFrames)
      const whyNot = anim.limit === 'frame' ? 'too big for an animation' : `too big for ${anim.held} frames`
      let animText = ''
      if (anim.multiplier === null && anim.next !== null) {
        // Not even the smallest Size fits: say why, by the buttons.
        const [aw, ah] = exportSize(g.width, g.height, par, anim.next, tv)
        animText =
          `GIF and APNG can't be made: even ${anim.next}× (${aw}×${ah} px) is ${whyNot}.` +
          (anim.limit === 'frames' && signalLoop
            ? ' Pick a shorter loop.'
            : anim.limit === 'frame' && s.resolution === 'custom'
              ? ' Pick a bigger block size.'
              : '')
      } else if (anim.multiplier !== null && anim.next !== null) {
        const [aw, ah] = exportSize(g.width, g.height, par, anim.multiplier, tv)
        // The Screen FX loop (without the signal) is the effect itself; the
        // rest keep the screen effect from 3× up, as the PNG does.
        const fxLost = withFx && anim.multiplier < FX_MIN_MULTIPLIER && !(s.animationStyle === 'screen-fx' && !signalOn && !gifFrames)
        // Why the next Size up won't do (a 32-frame signal loop on the NES at
        // 4×: 4× would fit one frame, but it's the frames that stop 3×).
        animText =
          `GIF and APNG come out at ${anim.multiplier}× (${aw}×${ah} px)${fxLost ? ', without the screen effect' : ''}: ` +
          `${anim.next === s.multiplier ? `${anim.next}× is` : `${anim.next}× and up are`} ${whyNot}.`
      }
      animHint.textContent = animText
      show(animHint, !!pic && animText !== '')
      downloadApngBtn.disabled = !pic || anim.multiplier === null
      downloadGifBtn.disabled = !pic || anim.multiplier === null

      wallPhoneBtn.disabled = !pic
      wallWin95Btn.disabled = !pic
      wall1080pBtn.disabled = !pic

      const fmts = p.limits?.emulatorFormats ?? []
      show(emuScrBtn, fmts.includes('scr'))
      show(emuKoaBtn, fmts.includes('koa'))
      show(emuChrBtn, fmts.includes('chr'))
      show(emuActions, fmts.length > 0)
      emuChrBtn.textContent =
        p.palette.kind === 'cell' && p.palette.mode === 'nes-attr' ? 'Download .chr (NES tiles)' : 'Download .chr (Game Boy tiles)'
      exportNote.textContent = p.exportNote ?? ''
      show(exportNote, !!p.exportNote)
      emuScrBtn.disabled = !pic
      emuKoaBtn.disabled = !pic
      emuChrBtn.disabled = !pic
    } else {
      sizeLine.textContent = ''
      show(animHint, false)
      downloadBtn.disabled = true
      downloadApngBtn.disabled = true
      downloadGifBtn.disabled = true
      wallPhoneBtn.disabled = true
      wallWin95Btn.disabled = true
      wall1080pBtn.disabled = true
      show(emuActions, false)
    }
  }

  return {
    el,
    sync,
    status: (t) => (statusLine.textContent = t),
    setTileFit: (report?: HardwareFitReport) => {
      if (!report) {
        show(tileFitEl, false)
        return
      }
      show(tileFitEl, true)
      tileFitEl.textContent = report.summary
      tileFitEl.classList.toggle('fit-ok', report.tilesFit)
      tileFitEl.classList.toggle('fit-warn', !report.tilesFit)
    }
  }
}
