import { generateAnimatedExport } from '../core/animate'
import { exportPng, exportWallpaper, wallpaperPresetById } from '../core/export'
import { exportFilename } from '../core/filename'
import { renderFxRgba } from '../core/fx'
import { colourTotal, Deres, exportSize, type DeresSettings, type Rendered } from '../core/pipeline'
import { profileById } from '../core/profiles'
import { artifactPalette, resolveConnection, runSignal, signalMachine, signalRenderer, type SignalImage } from '../core/signal'
import { loadSignalEngine } from '../signal/load'
import type { FromWorker, ToWorker } from './protocol'

// The image worker. It keeps the working copy, so the page's slider moves
// cost a settings message, and all pixel work happens off the page's thread.

const deres = new Deres()
let gen = 0
let last: { key: string; rendered: Rendered } | null = null
let sourceCopy: { width: number; height: number; rgba: Uint8Array } | null = null

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(msg, { transfer })
}

function renderFor(settings: DeresSettings): Rendered {
  // Screen effects and the signal don't change the picture, only how it's shown.
  const key = JSON.stringify({ ...settings, fx: null, pixelShape: null, signal: null })
  if (last?.key === key) return last.rendered
  const rendered = deres.render(settings)
  last = { key, rendered }
  return rendered
}

let lastSignal: { rendered: Rendered; key: string; image: SignalImage } | null = null

/** The picture through the analog signal (frame 0), or null while it's off. Loads the engine the first time. */
async function signalFor(settings: DeresSettings, r: Rendered): Promise<SignalImage | null> {
  const s = settings.signal
  if (!s || s.mode === 'off') return null
  const engine = await loadSignalEngine()
  const key = JSON.stringify([settings.profileId, s])
  if (lastSignal?.rendered === r && lastSignal.key === key) return lastSignal.image
  const image = runSignal(engine, r, settings.profileId, s, 0)
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

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data
  if (msg.type === 'load') {
    gen = msg.gen
    last = null
    const rawRgba = new Uint8Array(msg.rgba)
    sourceCopy = { width: msg.width, height: msg.height, rgba: rawRgba.slice() }
    const { hasAlpha } = deres.setSource(rawRgba, msg.width, msg.height, msg.origW, msg.origH)
    post({ type: 'loaded', gen, hasAlpha })
    return
  }
  if (msg.type === 'render') {
    if (msg.gen !== gen) return
    try {
      const t0 = performance.now()
      const s = await forRender(msg.settings)
      const r = renderFor(s)
      const rgba = new Uint8ClampedArray(r.width * r.height * 4)
      for (let i = 0, n = r.width * r.height; i < n; i++) {
        rgba[i * 4] = r.rgb[i * 3]
        rgba[i * 4 + 1] = r.rgb[i * 3 + 1]
        rgba[i * 4 + 2] = r.rgb[i * 3 + 2]
        rgba[i * 4 + 3] = 255
      }
      let fx: { width: number; height: number; rgba: ArrayBuffer } | null = null
      const sig = await signalFor(s, r)
      if ((s.fx.screen !== 'off' || sig) && msg.fxScale > 0) {
        const [fw, fh] = exportSize(r.width, r.height, r.geometry.par, msg.fxScale, s.pixelShape === 'tv')
        let img: Uint8ClampedArray
        if (sig) {
          // The signal shown at the preview's size, through the screen effect if there is one.
          img = new Uint8ClampedArray(fw * fh * 4)
          const render = signalRenderer(sig, fw, fh, s.fx.screen !== 'off' ? s.fx : null, 0, r.paper)
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
          img = renderFxRgba({ rgb: r.rgb, width: r.width, height: r.height, paper: r.paper }, fw, fh, s.fx)
        }
        fx = { width: fw, height: fh, rgba: img.buffer as ArrayBuffer }
      }
      const transfer: Transferable[] = [rgba.buffer]
      if (fx) transfer.push(fx.rgba)
      const prof = profileById(msg.settings.profileId)
      post(
        {
          type: 'rendered',
          job: msg.job,
          gen,
          width: r.width,
          height: r.height,
          rgba: rgba.buffer,
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
      )
    } catch (err) {
      post({ type: 'error', job: msg.job, gen, message: String((err as Error)?.message ?? err) })
    }
    return
  }

  if (msg.type === 'export') {
    try {
      const s = await forRender(msg.settings)
      const r = renderFor(s)
      const tv = s.pixelShape === 'tv'
      const signal = await signalFor(s, r)
      const out = await exportPng(r, { multiplier: msg.multiplier, tv, fx: msg.withFx ? s.fx : null, signal })
      const filename = exportFilename({
        base: msg.base,
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
      const r = renderFor(s)
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
      const filename = `${msg.base}-${prof?.id ?? s.profileId}.${format}`
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
      const r = renderFor(s)
      const tv = s.pixelShape === 'tv'
      const preset = wallpaperPresetById(msg.preset)
      if (!preset) throw new Error(`Unknown wallpaper preset: ${msg.preset}`)
      const out = await exportWallpaper(r, preset, { tv, fx: msg.withFx ? s.fx : null, signal: await signalFor(s, r) })
      const prof = profileById(s.profileId)?.id ?? 'deres'
      const filename = `${msg.base}-${prof}-${msg.preset}-wallpaper.png`
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
      const r = renderFor(s)
      const tv = s.pixelShape === 'tv'
      const sig = s.signal && s.signal.mode !== 'off' ? s.signal : null
      const engine = sig ? await loadSignalEngine() : null
      const res = await generateAnimatedExport(
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
          onProgress: (done, total) => post({ type: 'progress', id: msg.id, done, total }),
          signal: engine && sig ? (pic, frame) => runSignal(engine, pic, s.profileId, sig, frame)! : undefined,
          loop: msg.loop
        },
        s,
        (subSettings) => deres.render(subSettings)
      )
      const prof = profileById(s.profileId)?.id ?? 'deres'
      const ext = msg.format === 'apng' ? 'png' : 'gif'
      const suffix = msg.format === 'apng' ? 'animated' : 'loop'
      const tag = sig ? `-${signalTag(s, r)}` : ''
      const filename = `${msg.base}-${prof}-${msg.animationStyle}${tag}-${suffix}.${ext}`
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

