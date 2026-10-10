import { generateAnimatedExport, generateFramesExport } from '../core/animate'
import { exportPng, exportWallpaper, wallpaperPresetById } from '../core/export'
import { exportFilename } from '../core/filename'
import { renderFxRgba } from '../core/fx'
import { openAnimatedGif, type AnimatedGif } from '../core/gif-frames'
import { colourTotal, Deres, previewFxSize, type DeresSettings, type Rendered } from '../core/pipeline'
import { profileById, type Profile } from '../core/profiles'
import {
  artifactPalette,
  engineStep,
  resolveConnection,
  runSignal,
  signalMachine,
  signalRenderer,
  type SignalImage
} from '../core/signal'
import { loadSignalEngine } from '../signal/load'
import type { FromWorker, RenderedView, ToWorker } from './protocol'

// The image worker. It keeps the working copy, so the page's slider moves
// cost a settings message, and all pixel work happens off the page's thread.
// With an animated GIF it keeps every frame, and the pipeline works on one at
// a time: whichever frame a message names.

const deres = new Deres()
let gen = 0
let last: { key: string; rendered: Rendered } | null = null
let sourceCopy: { width: number; height: number; rgba: Uint8Array } | null = null
/** An animated GIF's frames, while one is open. */
let animation: AnimatedGif | null = null
/** The frame the pipeline holds (always 0 for a still). */
let current = 0

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(msg, { transfer })
}

/** Points the pipeline at frame k of the animated GIF (a still has only frame 0). */
function useFrame(k: number): void {
  if (!animation || k === current) return
  const frame = Math.max(0, Math.min(animation.frames.length - 1, Math.floor(k)))
  if (frame === current) return
  const rgba = new Uint8Array(animation.frames[frame].buffer)
  deres.setSource(rgba, animation.width, animation.height, animation.origW, animation.origH)
  sourceCopy = { width: animation.width, height: animation.height, rgba }
  current = frame
}

/** Frame k through the machine. Picking the frame and rendering happen together, so a message handled in between can't swap the frame. */
function renderFor(settings: DeresSettings, frame: number): Rendered {
  useFrame(frame)
  // Screen effects and the signal don't change the picture, only how it's shown.
  const key = JSON.stringify({ ...settings, fx: null, pixelShape: null, signal: null, frame: current })
  if (last?.key === key) return last.rendered
  const rendered = deres.render(settings)
  last = { key, rendered }
  return rendered
}

/** Engine frames per GIF frame: the signal's noise moves at the GIF's own speed. */
function signalStep(): number {
  if (!animation) return 1
  const ms = animation.delaysMs.reduce((a, b) => a + b, 0) / animation.delaysMs.length
  return engineStep(1000 / ms)
}

/** Where a frame sits in its loop (0–1), for the screen effect's moving parts. */
function phaseOf(frame: number): number {
  return animation ? frame / animation.frames.length : 0
}

let lastSignal: { rendered: Rendered; key: string; image: SignalImage } | null = null

/** A frame through the analog signal, or null while it's off. Loads the engine the first time. */
async function signalFor(settings: DeresSettings, r: Rendered, frame: number): Promise<SignalImage | null> {
  const s = settings.signal
  if (!s || s.mode === 'off') return null
  const engine = await loadSignalEngine()
  const engineFrame = frame * signalStep()
  const key = JSON.stringify([settings.profileId, s, engineFrame])
  if (lastSignal?.rendered === r && lastSignal.key === key) return lastSignal.image
  const image = runSignal(engine, r, settings.profileId, s, engineFrame)
  lastSignal = image ? { rendered: r, key, image } : null
  return image
}

let lastArtifact: { key: string; colours: string[] | null } | null = null

/**
 * The settings to render with. With the signal on, CGA composite dithers to
 * the colours the signal really makes from its patterns (measured once per
 * signal setting), so the picture aims at what the TV shows.
 */
async function forRender(settings: DeresSettings): Promise<DeresSettings> {
  const s = settings.signal
  if (!s || s.mode === 'off' || signalMachine(settings.profileId, 0).artifact !== 'cga') return settings
  const engine = await loadSignalEngine()
  const key = JSON.stringify([settings.profileId, s.mode, s.colour, s.sharpen, s.decoder])
  if (lastArtifact?.key !== key) lastArtifact = { key, colours: artifactPalette(engine, settings.profileId, s) }
  return lastArtifact.colours ? { ...settings, fixedPalette: lastArtifact.colours } : settings
}

/** The connection the signal went over ("rf", "vhs-sp"…), for file names. */
function signalTag(settings: DeresSettings, r: Rendered): string | null {
  const s = settings.signal
  return s ? resolveConnection(s.mode, signalMachine(settings.profileId, r.width)) : null
}

/** The file name's start: frames after the first say which they are ("-frame12"). */
function frameBase(base: string, frame: number): string {
  return animation && frame > 0 ? `${base}-frame${frame + 1}` : base
}

/** Whether a machine's pixels are its palette's colours, and whether that palette is the same for every picture. */
function paletteKind(p: Profile | undefined, s: DeresSettings): { indexed: boolean; shared: boolean } {
  const k = p?.palette
  if (!k) return { indexed: false, shared: false }
  const indexed = k.kind === 'fixed' || k.kind === 'range' || k.kind === 'pool' || k.kind === 'custom' || k.kind === 'cell'
  const shared =
    k.kind === 'fixed' ||
    (k.kind === 'cell' && k.mode !== 'gbc-tile') ||
    (k.kind === 'custom' && !!s.customPalette && s.customPalette.length > 0)
  return { indexed, shared: indexed && shared }
}

/** A frame (or the picture) through the settings, as the preview shows it. */
async function renderView(settings: DeresSettings, fxScale: number, frame: number): Promise<{ view: RenderedView; transfer: Transferable[] }> {
  const t0 = performance.now()
  const s = await forRender(settings)
  const r = renderFor(s, frame)
  const shown = current
  let fx: { width: number; height: number; rgba: ArrayBuffer } | null = null
  const sig = await signalFor(s, r, shown)
  const phase = phaseOf(shown)
  if ((s.fx.screen !== 'off' || sig) && fxScale > 0) {
    const [fw, fh] = previewFxSize(r.width, r.height, r.geometry.par, fxScale, s.pixelShape === 'tv')
    let img: Uint8ClampedArray
    if (sig) {
      // The signal shown at the preview's size, through the screen effect if there is one.
      img = new Uint8ClampedArray(fw * fh * 4)
      const render = signalRenderer(sig, fw, fh, s.fx.screen !== 'off' ? s.fx : null, phase, r.paper)
      const row = new Uint8Array(fw * 3)
      for (let y = 0; y < fh; y++) {
        render(y, row)
        for (let x = 0, o = y * fw * 4; x < fw; x++, o += 4) {
          img[o] = row[x * 3]
          img[o + 1] = row[x * 3 + 1]
          img[o + 2] = row[x * 3 + 2]
          img[o + 3] = 255
        }
      }
    } else {
      img = renderFxRgba({ rgb: r.rgb, width: r.width, height: r.height, paper: r.paper }, fw, fh, s.fx, phase)
    }
    fx = { width: fw, height: fh, rgba: img.buffer as ArrayBuffer }
  }
  // The picture at its own size, only when it's what the preview shows.
  let rgba: Uint8ClampedArray | null = null
  if (!fx) {
    rgba = new Uint8ClampedArray(r.width * r.height * 4)
    for (let i = 0, n = r.width * r.height; i < n; i++) {
      rgba[i * 4] = r.rgb[i * 3]
      rgba[i * 4 + 1] = r.rgb[i * 3 + 1]
      rgba[i * 4 + 2] = r.rgb[i * 3 + 2]
      rgba[i * 4 + 3] = 255
    }
  }
  const transfer: Transferable[] = [fx ? fx.rgba : rgba!.buffer]
  const prof = profileById(settings.profileId)
  return {
    view: {
      frame: shown,
      width: r.width,
      height: r.height,
      rgba: rgba ? (rgba.buffer as ArrayBuffer) : null,
      fx,
      used: r.used,
      colours: prof ? colourTotal(prof, r.palette) : r.palette.length / 3,
      par: r.geometry.par,
      src: r.geometry.src,
      dst: r.geometry.dst,
      ms: Math.round(performance.now() - t0),
      tileFit: r.tileFit,
      emulatorFormats: prof?.limits?.emulatorFormats
    },
    transfer
  }
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data
  if (msg.type === 'load') {
    gen = msg.gen
    last = null
    animation = null
    current = 0
    const rawRgba = new Uint8Array(msg.rgba)
    sourceCopy = { width: msg.width, height: msg.height, rgba: rawRgba.slice() }
    const { hasAlpha } = deres.setSource(rawRgba, msg.width, msg.height, msg.origW, msg.origH)
    post({ type: 'loaded', gen, hasAlpha })
    return
  }
  if (msg.type === 'load-gif') {
    let gif: AnimatedGif | null = null
    try {
      gif = openAnimatedGif(new Uint8Array(msg.bytes), msg.maxEdge)
    } catch {
      gif = null
    }
    gen = msg.gen
    if (!gif) {
      post({ type: 'loaded-gif', gen, gif: null })
      return
    }
    last = null
    animation = gif
    current = 0
    const first = new Uint8Array(animation.frames[0].buffer)
    sourceCopy = { width: gif.width, height: gif.height, rgba: first }
    deres.setSource(first, gif.width, gif.height, gif.origW, gif.origH)
    const rgba = first.slice().buffer
    post(
      {
        type: 'loaded-gif',
        gen,
        gif: {
          width: gif.width,
          height: gif.height,
          origW: gif.origW,
          origH: gif.origH,
          rgba,
          hasAlpha: gif.hasAlpha,
          frames: gif.frames.length,
          total: gif.total,
          delaysMs: gif.delaysMs,
          loopCount: gif.loopCount
        }
      },
      [rgba]
    )
    return
  }
  if (msg.type === 'render') {
    if (msg.gen !== gen) return
    try {
      const { view, transfer } = await renderView(msg.settings, msg.fxScale, msg.frame)
      post({ type: 'rendered', job: msg.job, gen, ...view }, transfer)
    } catch (err) {
      post({ type: 'error', job: msg.job, gen, message: String((err as Error)?.message ?? err) })
    }
    return
  }
  if (msg.type === 'render-frame') {
    // Asked about an older picture: say so, so the page's request doesn't wait forever.
    if (msg.gen !== gen) return post({ type: 'error', id: msg.id, gen: msg.gen, message: 'That picture is gone' })
    try {
      const { view, transfer } = await renderView(msg.settings, msg.fxScale, msg.frame)
      post({ type: 'rendered-frame', id: msg.id, gen, view }, transfer)
    } catch (err) {
      post({ type: 'error', id: msg.id, gen, message: String((err as Error)?.message ?? err) })
    }
    return
  }
  if (msg.type === 'source-frame') {
    if (msg.gen !== gen) return post({ type: 'error', id: msg.id, gen: msg.gen, message: 'That picture is gone' })
    const a = animation
    const k = Math.max(0, Math.min((a?.frames.length ?? 1) - 1, msg.frame))
    const src = a ? { width: a.width, height: a.height, rgba: a.frames[k] } : sourceCopy
    if (!src) {
      post({ type: 'error', id: msg.id, gen, message: 'No picture loaded' })
      return
    }
    const rgba = src.rgba.slice().buffer as ArrayBuffer
    post({ type: 'source-frame', id: msg.id, gen, width: src.width, height: src.height, rgba }, [rgba])
    return
  }

  if (msg.type === 'export') {
    try {
      const s = await forRender(msg.settings)
      const r = renderFor(s, msg.frame)
      const frame = current
      const tv = s.pixelShape === 'tv'
      const signal = await signalFor(s, r, frame)
      const out = await exportPng(r, { multiplier: msg.multiplier, tv, fx: msg.withFx ? s.fx : null, signal, phase: phaseOf(frame) })
      const filename = exportFilename({
        base: frameBase(msg.base, frame),
        profileId: profileById(s.profileId)?.id ?? 'deres',
        width: r.width,
        height: r.height,
        multiplier: msg.multiplier,
        tv: tv && r.geometry.par[0] !== r.geometry.par[1],
        fx: out.fx,
        signal: signal ? signalTag(s, r) : null
      })
      post(
        { type: 'exported', id: msg.id, png: out.png.buffer, filename, width: out.width, height: out.height },
        [out.png.buffer]
      )
    } catch (err) {
      post({ type: 'error', id: msg.id, gen, message: String((err as Error)?.message ?? err) })
    }
  }

  if (msg.type === 'export-emulator') {
    try {
      const s = msg.settings
      const r = renderFor(s, msg.frame)
      const prof = profileById(s.profileId)
      let data: Uint8Array
      const format = msg.format
      // The pipeline makes each machine's own file (Game Boy or NES tiles, .scr, .koa).
      if (r.emulatorData && r.emulatorData.format === format) {
        // A copy: the original belongs to the cached render, and handing its
        // buffer over would leave it empty for the next download.
        data = r.emulatorData.data.slice()
      } else {
        throw new Error(`Profile ${s.profileId} does not support export format .${format}`)
      }
      const filename = `${frameBase(msg.base, current)}-${prof?.id ?? s.profileId}.${format}`
      post(
        {
          type: 'exported-emulator',
          id: msg.id,
          data: data.buffer as ArrayBuffer,
          filename,
          mimeType: 'application/octet-stream'
        },
        [data.buffer as ArrayBuffer]
      )
    } catch (err) {
      post({ type: 'error', id: msg.id, gen, message: String((err as Error)?.message ?? err) })
    }
  }

  if (msg.type === 'export-wallpaper') {
    try {
      const s = await forRender(msg.settings)
      const r = renderFor(s, msg.frame)
      const frame = current
      const tv = s.pixelShape === 'tv'
      const preset = wallpaperPresetById(msg.preset)
      if (!preset) throw new Error(`Unknown wallpaper preset: ${msg.preset}`)
      const signal = await signalFor(s, r, frame)
      const out = await exportWallpaper(r, preset, { tv, fx: msg.withFx ? s.fx : null, signal, phase: phaseOf(frame) })
      const prof = profileById(s.profileId)?.id ?? 'deres'
      const filename = `${frameBase(msg.base, frame)}-${prof}-${msg.preset}-wallpaper.png`
      post(
        {
          type: 'exported-wallpaper',
          id: msg.id,
          png: out.png.buffer,
          filename,
          width: out.width,
          height: out.height
        },
        [out.png.buffer]
      )
    } catch (err) {
      post({ type: 'error', id: msg.id, gen, message: String((err as Error)?.message ?? err) })
    }
  }

  if (msg.type === 'export-animated') {
    try {
      const s = await forRender(msg.settings)
      const tv = s.pixelShape === 'tv'
      const sig = s.signal && s.signal.mode !== 'off' ? s.signal : null
      const engine = sig ? await loadSignalEngine() : null
      const prof = profileById(s.profileId)
      const profId = prof?.id ?? 'deres'
      const onProgress = (done: number, total: number, note?: string) => post({ type: 'progress', id: msg.id, done, total, note })
      let res
      let filename: string
      if (msg.animationStyle === 'gif-frames') {
        // The GIF's own frames, each through the settings.
        const a = animation
        if (!a) throw new Error('This picture has no frames to animate.')
        const step = signalStep()
        const { indexed, shared } = paletteKind(prof, s)
        res = await generateFramesExport({
          format: msg.format,
          multiplier: msg.multiplier,
          tv,
          fx: msg.withFx ? s.fx : null,
          delaysMs: a.delaysMs,
          loopCount: a.loopCount,
          render: (k) => renderFor(s, k),
          signal: engine && sig ? (pic, k) => runSignal(engine, pic, s.profileId, sig, k * step)! : undefined,
          indexed,
          sharedPalette: shared,
          onProgress
        })
        const tag = sig ? `-${signalTag(s, renderFor(s, 0))}` : ''
        filename = msg.format === 'apng' ? `${msg.base}-${profId}${tag}-animated.png` : `${msg.base}-${profId}${tag}.gif`
      } else {
        const r = renderFor(s, msg.frame)
        const frame = current
        res = await generateAnimatedExport(
          r,
          {
            style: msg.animationStyle,
            format: msg.format,
            multiplier: msg.multiplier,
            tv,
            fx: msg.withFx ? s.fx : null,
            sourceRgba: sourceCopy?.rgba,
            sourceWidth: sourceCopy?.width,
            sourceHeight: sourceCopy?.height,
            onProgress,
            signal: engine && sig ? (pic, f) => runSignal(engine, pic, s.profileId, sig, f)! : undefined,
            loop: msg.loop
          },
          s,
          // The shimmer renders the picture again with each dither offset (the same frame).
          (subSettings) => {
            useFrame(frame)
            return deres.render(subSettings)
          }
        )
        const ext = msg.format === 'apng' ? 'png' : 'gif'
        const suffix = msg.format === 'apng' ? 'animated' : 'loop'
        const tag = sig ? `-${signalTag(s, r)}` : ''
        filename = `${frameBase(msg.base, frame)}-${profId}-${msg.animationStyle}${tag}-${suffix}.${ext}`
      }
      post(
        {
          type: 'exported-animated',
          id: msg.id,
          data: res.data.buffer as ArrayBuffer,
          filename,
          mimeType: res.mimeType,
          width: res.width,
          height: res.height,
          frameCount: res.frameCount
        },
        [res.data.buffer as ArrayBuffer]
      )
    } catch (err) {
      post({ type: 'error', id: msg.id, gen, message: String((err as Error)?.message ?? err) })
    }
  }
}
