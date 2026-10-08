import { generateAnimatedExport } from '../core/animate'
import { exportPng, exportWallpaper, wallpaperPresetById } from '../core/export'
import { exportFilename } from '../core/filename'
import { renderFxRgba } from '../core/fx'
import { colourTotal, Deres, exportSize, type DeresSettings, type Rendered } from '../core/pipeline'
import { profileById } from '../core/profiles'
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
  // Screen effects don't change the picture, only how it's shown.
  const key = JSON.stringify({ ...settings, fx: null, pixelShape: null })
  if (last?.key === key) return last.rendered
  const rendered = deres.render(settings)
  last = { key, rendered }
  return rendered
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
      const r = renderFor(msg.settings)
      const rgba = new Uint8ClampedArray(r.width * r.height * 4)
      for (let i = 0, n = r.width * r.height; i < n; i++) {
        rgba[i * 4] = r.rgb[i * 3]
        rgba[i * 4 + 1] = r.rgb[i * 3 + 1]
        rgba[i * 4 + 2] = r.rgb[i * 3 + 2]
        rgba[i * 4 + 3] = 255
      }
      let fx: { width: number; height: number; rgba: ArrayBuffer } | null = null
      const s = msg.settings
      if (s.fx.screen !== 'off' && msg.fxScale > 0) {
        const [fw, fh] = exportSize(r.width, r.height, r.geometry.par, msg.fxScale, s.pixelShape === 'tv')
        const img = renderFxRgba({ rgb: r.rgb, width: r.width, height: r.height, paper: r.paper }, fw, fh, s.fx)
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
      const s = msg.settings
      const r = renderFor(s)
      const tv = s.pixelShape === 'tv'
      const out = await exportPng(r, { multiplier: msg.multiplier, tv, fx: msg.withFx ? s.fx : null })
      const filename = exportFilename({
        base: msg.base,
        profileId: profileById(s.profileId)?.id ?? 'deres',
        width: r.width,
        height: r.height,
        multiplier: msg.multiplier,
        tv: tv && r.geometry.par[0] !== r.geometry.par[1],
        fx: out.fx
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
      const s = msg.settings
      const r = renderFor(s)
      const tv = s.pixelShape === 'tv'
      const preset = wallpaperPresetById(msg.preset)
      if (!preset) throw new Error(`Unknown wallpaper preset: ${msg.preset}`)
      const out = await exportWallpaper(r, preset, { tv, fx: msg.withFx ? s.fx : null })
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
      const s = msg.settings
      const r = renderFor(s)
      const tv = s.pixelShape === 'tv'
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
          onProgress: (done, total) => post({ type: 'progress', id: msg.id, done, total })
        },
        s,
        (subSettings) => deres.render(subSettings)
      )
      const prof = profileById(s.profileId)?.id ?? 'deres'
      const ext = msg.format === 'apng' ? 'png' : 'gif'
      const suffix = msg.format === 'apng' ? 'animated' : 'loop'
      const filename = `${msg.base}-${prof}-${msg.animationStyle}-${suffix}.${ext}`
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

