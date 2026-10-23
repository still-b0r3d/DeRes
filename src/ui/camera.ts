import type { DeresSettings } from '../core/pipeline'
import type { LoadedGif, RenderedView } from '../worker/protocol'
import {
  cameraName,
  cameraProblem,
  CLIP_DELAY_MS,
  CLIP_FRAMES,
  clipSize,
  FpsMeter,
  forgetCameraPrefs,
  liveInputSize,
  loadCameraPrefs,
  saveCameraPrefs,
  type CameraPrefs,
  type Facing,
  type LiveGeometryChoice
} from './camera-plan'
import { h, show } from './dom'
import type { Engine } from './engine'
import { WORKING_MAX } from './loader'

// The live camera. "Use camera" turns the preview into a live view through
// whatever machine is picked: each camera frame is grabbed small (about 3
// camera pixels per machine pixel), sent to the worker's second pipeline,
// and shown as it comes back. Only one frame is in the worker at a time;
// frames that arrive meanwhile are skipped, so a slow look never builds up a
// queue. Snap turns the frame into a picture (a fresh PNG, so no metadata at
// all) and Record 3 s into a clip held like an animated GIF; both turn the
// camera off. Nothing leaves the device: frames go to the same worker photos
// go to. The camera also goes off when the page is hidden.

/** The camera: getUserMedia into a hidden <video>, and frames grabbed off it. */
class CameraFeed {
  private video: HTMLVideoElement | null = null
  private stream: MediaStream | null = null
  private readonly live = document.createElement('canvas')
  private readonly clip = document.createElement('canvas')
  /** Which way the camera faces, when the browser says (a computer's webcam often doesn't). */
  facing: Facing | null = null
  deviceId = ''
  /** The camera stopped by itself (permission taken back, another app took it). */
  onEnded: () => void = () => {}

  static get supported(): boolean {
    return typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia
  }

  get width(): number {
    return this.video?.videoWidth ?? 0
  }

  get height(): number {
    return this.video?.videoHeight ?? 0
  }

  /** Starts the camera facing that way (or that exact device). Throws the browser's own error when it can't. */
  async start(facing: Facing, deviceId?: string): Promise<void> {
    const size = { width: { ideal: 1920 }, height: { ideal: 1440 } }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId }, ...size } : { facingMode: { ideal: facing }, ...size },
      audio: false
    })
    this.stream = stream
    // iOS needs it muted and inline to play at all, and in the page to keep
    // its frames coming; it's 1 px and see-through (style.css).
    const video = (this.video ??= h('video', { class: 'camera-video', muted: true, playsinline: true, autoplay: true, 'aria-hidden': 'true' }))
    video.muted = true
    if (!video.isConnected) document.body.append(video)
    video.srcObject = stream
    try {
      await video.play()
      if (!video.videoWidth) await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }))
    } catch (err) {
      this.stop()
      throw err
    }
    const track = stream.getVideoTracks()[0]
    track?.addEventListener('ended', () => {
      if (this.stream === stream) this.onEnded()
    })
    const s = track?.getSettings() ?? {}
    this.facing = s.facingMode === 'user' || s.facingMode === 'environment' ? s.facingMode : null
    this.deviceId = s.deviceId ?? ''
  }

  stop(): void {
    for (const t of this.stream?.getTracks() ?? []) t.stop()
    this.stream = null
    if (this.video) this.video.srcObject = null
  }

  /** How many cameras the device has (only told after the camera was allowed). */
  async cameras(): Promise<string[]> {
    try {
      return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput').map((d) => d.deviceId)
    } catch {
      return []
    }
  }

  /** Calls `next` with the next camera frame (or the next screen frame, where the browser can't tell). */
  onFrame(next: () => void): void {
    const v = this.video
    if (v && 'requestVideoFrameCallback' in v) v.requestVideoFrameCallback(() => next())
    else requestAnimationFrame(() => next())
  }

  /** The camera's frame at width × height, r, g, b, a per pixel; mirrored left to right if asked. */
  grab(width: number, height: number, mirror: boolean, kind: 'live' | 'clip'): ArrayBuffer {
    const canvas = kind === 'live' ? this.live : this.clip
    return this.draw(canvas, width, height, mirror).getImageData(0, 0, width, height).data.buffer as ArrayBuffer
  }

  /** The whole frame, at most maxEdge on its long side, for a snap. */
  snap(maxEdge: number, mirror: boolean): HTMLCanvasElement {
    const s = Math.min(1, maxEdge / Math.max(this.width, this.height))
    const canvas = document.createElement('canvas')
    this.draw(canvas, Math.max(1, Math.round(this.width * s)), Math.max(1, Math.round(this.height * s)), mirror)
    return canvas
  }

  private draw(canvas: HTMLCanvasElement, width: number, height: number, mirror: boolean): CanvasRenderingContext2D {
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? width : 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    if (this.video) ctx.drawImage(this.video, 0, 0, width, height)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    return ctx
  }
}

/** What the page lends the live camera. */
export interface LiveHost {
  engine: Engine
  /** The settings to render live frames with. */
  settings(): DeresSettings
  /** The machine and framing, which decide how big a frame to grab. */
  geometryChoice(): LiveGeometryChoice
  /** The screen effect's enlargement for a live frame (0 for none); source() is already the frame's. */
  fxScale(): number
  /** A live frame back from the worker, and the frames shown in the last second. */
  show(view: RenderedView, fps: number): void
  /** The camera came on: playing, comparing and the controls follow. */
  started(): void
  /** The camera went off; `restore`: show the picture again (not when a snap or clip is about to replace it). */
  stopped(restore: boolean): void
  /** The frames grabbed changed size (the controls' resolution line follows). */
  resized(): void
  problem(text: string): void
  status(text: string): void
  /** A snap, opened like a chosen photo. */
  open(blob: Blob, name: string): void
  /** A clip, opened like an animated GIF. */
  openClip(gif: LoadedGif, name: string): void
}

export class LiveCamera {
  /** Next to Choose photo; only there when the browser can reach a camera (a secure page). */
  readonly useButton: HTMLButtonElement
  /** Under it: the live buttons, and a line about the camera. */
  readonly panel: HTMLElement
  private readonly row: HTMLElement
  private readonly info: HTMLElement
  private readonly snapBtn: HTMLButtonElement
  private readonly recordBtn: HTMLButtonElement
  private readonly flipBtn: HTMLButtonElement
  private readonly mirrorBtn: HTMLButtonElement
  private readonly feed = new CameraFeed()
  private readonly meter = new FpsMeter()
  private prefs: CameraPrefs = loadCameraPrefs()
  private isLive = false
  private starting = false
  private loopToken = 0
  private tick = 0
  private lastSize = ''
  /** A camera frame came while the worker was busy: the next one goes as soon as it's free. */
  private missed = false
  private devices: string[] = []
  private recording: { width: number; height: number; shots: number; next: number; name: string } | null = null

  constructor(private readonly host: LiveHost) {
    const supported = CameraFeed.supported
    this.useButton = h(
      'button',
      { type: 'button', class: 'choose camera-use', 'data-testid': 'camera-use', hidden: !supported, onclick: () => this.start() },
      'Use camera'
    )
    this.snapBtn = h('button', { type: 'button', class: 'choose camera-snap', 'data-testid': 'camera-snap', onclick: () => this.snap() }, 'Snap')
    this.recordBtn = h('button', { type: 'button', class: 'small', 'data-testid': 'camera-record', onclick: () => this.record() }, 'Record 3 s')
    this.flipBtn = h('button', { type: 'button', class: 'small', 'data-testid': 'camera-flip', hidden: true, onclick: () => this.flip() }, 'Flip')
    this.mirrorBtn = h(
      'button',
      { type: 'button', class: 'small', 'data-testid': 'camera-mirror', 'aria-pressed': 'false', onclick: () => this.toggleMirror() },
      'Mirror'
    )
    const stopBtn = h('button', { type: 'button', class: 'small', 'data-testid': 'camera-stop', onclick: () => this.stop() }, 'Stop')
    this.row = h('div', { class: 'camera-row', hidden: true }, this.snapBtn, this.recordBtn, this.flipBtn, this.mirrorBtn, stopBtn)
    this.info = h('p', { class: 'hint', 'data-testid': 'camera-info' })
    this.panel = h('div', { class: 'camera-panel', 'data-testid': 'camera-panel', hidden: !supported }, this.row, this.info)
    this.feed.onEnded = () => {
      this.stop()
      this.host.problem('The camera stopped.')
    }
    this.say(null)
    // Never on in a page nobody's looking at.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop()
    })
    window.addEventListener('pagehide', () => this.stop())
  }

  get live(): boolean {
    return this.isLive
  }

  /** "Back camera", "Front camera", or just "Camera" when the browser doesn't say which way it faces. */
  get label(): string {
    return this.feed.facing === 'environment' ? 'Back camera' : this.feed.facing === 'user' ? 'Front camera' : 'Camera'
  }

  /** The frame being grabbed (width × height) and the camera's own size, while live. */
  source(): { width: number; height: number; origW: number; origH: number } | null {
    const vw = this.feed.width
    const vh = this.feed.height
    if (!this.isLive || !vw || !vh) return null
    return { ...liveInputSize(vw, vh, this.host.geometryChoice()), origW: vw, origH: vh }
  }

  /** Reset settings: the camera choices go back to the first visit's. */
  forgetPrefs(): void {
    forgetCameraPrefs()
    this.prefs = loadCameraPrefs()
    this.syncButtons()
  }

  async start(): Promise<void> {
    if (this.isLive || this.starting) return
    this.starting = true
    this.useButton.disabled = true
    this.say('Starting the camera…')
    try {
      await this.feed.start(this.prefs.facing)
    } catch (err) {
      const p = cameraProblem(err, window.top !== window)
      this.host.problem(p.text)
      this.say(p.text, p.ownTab)
      return
    } finally {
      this.starting = false
      this.useButton.disabled = false
    }
    if (document.hidden) {
      // The page went into the background while the camera was starting.
      this.feed.stop()
      this.say(null)
      return
    }
    this.isLive = true
    this.tick = 0
    this.lastSize = ''
    this.meter.reset(performance.now())
    this.say(null)
    this.syncButtons()
    this.host.started()
    this.loop()
    this.devices = await this.feed.cameras()
    this.syncButtons()
  }

  /** Turns the camera off; `restore`: the picture comes back (a snap or clip replaces it instead). */
  stop(restore = true): void {
    if (!this.isLive) return
    this.isLive = false
    this.loopToken++
    if (this.recording) {
      this.recording = null
      this.host.engine.clipCancel()
    }
    this.feed.stop()
    this.host.engine.stopLive()
    this.say(null)
    this.syncButtons()
    this.host.stopped(restore)
  }

  /** A live frame came back from the worker. */
  shown(view: RenderedView): void {
    if (!this.isLive) return
    const now = performance.now()
    this.meter.frame(now)
    const fps = this.meter.fps(now)
    this.host.show(view, fps)
    // The camera moved on while this one was made: the frame it shows now goes
    // straight away, rather than at the camera's next frame (which would halve
    // the rate of any look a little slower than the camera).
    if (this.missed) this.frame(now)
    if (!this.recording) {
      this.say(this.meter.slow(now) ? `This look is slow live (about ${Math.max(1, fps)} frame${fps === 1 ? '' : 's'} a second). Snap to see it in full.` : null)
    }
  }

  private get mirror(): boolean {
    return this.prefs.mirror[this.feed.facing ?? 'user']
  }

  private loop(): void {
    const token = ++this.loopToken
    const step = () => {
      if (token !== this.loopToken || !this.isLive) return
      this.frame(performance.now())
      this.feed.onFrame(step)
    }
    this.feed.onFrame(step)
  }

  /** One camera frame: the clip's shot first, then the live view if the worker is free. */
  private frame(now: number): void {
    const vw = this.feed.width
    const vh = this.feed.height
    if (!vw || !vh) return
    if (this.recording) this.shoot(now)
    if (!this.host.engine.liveFree) {
      this.missed = true
      return
    }
    this.missed = false
    const src = this.source()
    if (!src) return
    const key = `${src.width}x${src.height}/${vw}x${vh}`
    if (key !== this.lastSize) {
      this.lastSize = key
      this.host.resized()
    }
    const rgba = this.feed.grab(src.width, src.height, this.mirror, 'live')
    this.host.engine.renderLive({ ...src, rgba }, this.host.settings(), this.host.fxScale(), this.tick++)
  }

  private async snap(): Promise<void> {
    if (!this.isLive || this.recording) return
    const canvas = this.feed.snap(WORKING_MAX, this.mirror)
    const name = `${cameraName('camera', new Date())}.png`
    this.stop(false)
    this.host.status('Snapping…')
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) {
      this.host.problem('The snap didn’t work. Try again.')
      this.host.stopped(true)
      return
    }
    this.host.status('')
    this.host.open(blob, name)
  }

  private record(): void {
    if (!this.isLive || this.recording) return
    const { width, height } = clipSize(this.feed.width, this.feed.height)
    this.host.engine.clipStart({
      width,
      height,
      origW: this.feed.width,
      origH: this.feed.height,
      delaysMs: new Array<number>(CLIP_FRAMES).fill(CLIP_DELAY_MS)
    })
    this.recording = { width, height, shots: 0, next: performance.now(), name: cameraName('camera-clip', new Date()) }
    this.say('Recording: the clip opens like an animated GIF, and the camera turns off.')
    this.syncButtons()
  }

  /** The clip's next frame, ten a second, at the size an animated GIF would be held at. */
  private shoot(now: number): void {
    const r = this.recording!
    if (now < r.next) return
    this.host.engine.clipFrame(this.feed.grab(r.width, r.height, this.mirror, 'clip'))
    r.shots++
    // Ten a second; if the phone fell behind, ten a second from here.
    r.next = now - r.next > CLIP_DELAY_MS ? now + CLIP_DELAY_MS : r.next + CLIP_DELAY_MS
    this.syncButtons()
    if (r.shots >= CLIP_FRAMES) this.endClip()
  }

  private async endClip(): Promise<void> {
    const r = this.recording!
    this.recording = null
    this.stop(false)
    this.host.status('Opening the clip…')
    const gif = await this.host.engine.clipEnd()
    if (!gif) {
      this.host.problem('The clip didn’t record. Try again.')
      this.host.stopped(true)
      return
    }
    this.host.status('')
    this.host.openClip(gif, r.name)
  }

  /** The other camera: front ↔ back on a phone; on a computer with several, the next one. */
  private async flip(): Promise<void> {
    if (!this.isLive || this.recording) return
    const want: Facing = (this.feed.facing ?? 'user') === 'user' ? 'environment' : 'user'
    const before = this.feed.deviceId
    this.loopToken++
    this.feed.stop()
    try {
      await this.feed.start(want)
      if (this.feed.deviceId === before && this.devices.length > 1) {
        // Facing didn't move it (a computer's cameras don't say which way they face).
        const next = this.devices[(this.devices.indexOf(before) + 1) % this.devices.length]
        this.feed.stop()
        await this.feed.start(want, next)
      }
    } catch (err) {
      this.host.problem(cameraProblem(err, window.top !== window).text)
      this.stop()
      return
    }
    if (!this.isLive) {
      // Stopped while the other camera was starting.
      this.feed.stop()
      return
    }
    this.prefs = { ...this.prefs, facing: this.feed.facing ?? want }
    saveCameraPrefs(this.prefs)
    this.lastSize = ''
    this.meter.reset(performance.now())
    this.syncButtons()
    this.loop()
  }

  private toggleMirror(): void {
    const key = this.feed.facing ?? 'user'
    this.prefs = { ...this.prefs, mirror: { ...this.prefs.mirror, [key]: !this.prefs.mirror[key] } }
    saveCameraPrefs(this.prefs)
    this.syncButtons()
  }

  private syncButtons(): void {
    show(this.useButton, CameraFeed.supported && !this.isLive)
    show(this.row, this.isLive)
    show(this.flipBtn, this.devices.length > 1)
    this.mirrorBtn.setAttribute('aria-pressed', String(this.mirror))
    const r = this.recording
    this.recordBtn.textContent = r ? `Recording ${Math.max(1, Math.ceil(((CLIP_FRAMES - r.shots) * CLIP_DELAY_MS) / 1000))}…` : 'Record 3 s'
    this.recordBtn.disabled = !!r
    this.snapBtn.disabled = !!r
    this.flipBtn.disabled = !!r
    this.mirrorBtn.disabled = !!r
  }

  /** The line under the buttons: `text`, or the usual one; `ownTab` adds a link to DeRes in its own tab. */
  private say(text: string | null, ownTab = false): void {
    const line = text ?? 'The camera picture stays on this device.'
    if (this.info.textContent === line && !ownTab) return
    this.info.replaceChildren(line)
    if (ownTab) {
      this.info.append(' ', h('a', { href: window.location.href, target: '_blank', rel: 'noopener', 'data-testid': 'camera-own-tab' }, 'Open DeRes in its own tab'))
    }
  }
}
