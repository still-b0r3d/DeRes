import type { Rect } from '../core/resample'
import type { DeresSettings } from '../core/pipeline'
import type { HardwareFitReport } from '../core/tiles'

// Messages between the page and the image worker. The picture goes over once
// (load, or load-gif with the file's bytes for an animated GIF, which the
// worker decodes); after that the page only sends settings. With an animated
// GIF, every render and export names the frame it's about (0 otherwise).

export type AnimationStyle = 'screen-fx' | 'compare-wipe' | 'dither-shimmer' | 'gif-frames'

export type ToWorker =
  | {
      type: 'load'
      /** Bumped for every new picture, so answers about an old one are dropped. */
      gen: number
      width: number
      height: number
      origW: number
      origH: number
      rgba: ArrayBuffer
    }
  | {
      /** An animated GIF: the worker decodes it and keeps every frame. */
      type: 'load-gif'
      gen: number
      bytes: ArrayBuffer
      /** Longest edge to hold the frames at. */
      maxEdge: number
    }
  | {
      type: 'render'
      job: number
      gen: number
      settings: DeresSettings
      /** Enlargement for the screen-effect preview (0 = no effect). */
      fxScale: number
      frame: number
    }
  | {
      /** One frame of an animated GIF for playback (answered in order, never dropped). */
      type: 'render-frame'
      id: number
      gen: number
      settings: DeresSettings
      fxScale: number
      frame: number
    }
  | {
      /** A frame of an animated GIF as it was opened (for comparing). */
      type: 'source-frame'
      id: number
      gen: number
      frame: number
    }
  | {
      type: 'export'
      id: number
      gen: number
      settings: DeresSettings
      multiplier: number
      withFx: boolean
      base: string
      frame: number
    }
  | {
      type: 'export-emulator'
      id: number
      gen: number
      settings: DeresSettings
      format: 'scr' | 'koa' | 'chr'
      base: string
      frame: number
    }
  | {
      type: 'export-wallpaper'
      id: number
      gen: number
      settings: DeresSettings
      preset: 'phone' | 'win95' | 'desktop-1080p'
      withFx: boolean
      base: string
      frame: number
    }
  | {
      type: 'export-animated'
      id: number
      gen: number
      settings: DeresSettings
      format: 'apng' | 'gif'
      animationStyle: AnimationStyle
      multiplier: number
      withFx: boolean
      base: string
      /** Length and speed of a Screen FX loop with the signal on. */
      loop?: { frames: number; fps: number }
      /** The frame the other styles start from. */
      frame: number
    }

/** A frame (or the picture) through the settings, ready to show. */
export interface RenderedView {
  frame: number
  width: number
  height: number
  /** The picture at its real size, r, g, b, a per pixel; null when fx is there (the preview shows only that). */
  rgba: ArrayBuffer | null
  fx: { width: number; height: number; rgba: ArrayBuffer } | null
  used: number
  /** How many colours the machine's list holds; null when it has no list. */
  colours: number | null
  par: readonly [number, number]
  src: Rect
  dst: Rect
  ms: number
  tileFit?: HardwareFitReport
  emulatorFormats?: readonly ('scr' | 'koa' | 'chr')[]
}

export interface RenderedMessage extends RenderedView {
  type: 'rendered'
  job: number
  gen: number
}

/** An animated GIF the worker now holds; frame 0 is the picture. */
export interface LoadedGif {
  width: number
  height: number
  origW: number
  origH: number
  /** Frame 0, r, g, b, a per pixel. */
  rgba: ArrayBuffer
  hasAlpha: boolean
  /** Frames held, and in the file (more when some were cut to fit). */
  frames: number
  total: number
  delaysMs: number[]
  /** 0 = forever, null = the file plays once. */
  loopCount: number | null
}

export type FromWorker =
  | { type: 'loaded'; gen: number; hasAlpha: boolean }
  /** gif is null when the file didn't open as an animation (it's then opened as a still). */
  | { type: 'loaded-gif'; gen: number; gif: LoadedGif | null }
  | RenderedMessage
  | { type: 'rendered-frame'; id: number; gen: number; view: RenderedView }
  | { type: 'source-frame'; id: number; gen: number; width: number; height: number; rgba: ArrayBuffer }
  | { type: 'exported'; id: number; png: ArrayBuffer; filename: string; width: number; height: number }
  | { type: 'exported-emulator'; id: number; data: ArrayBuffer; filename: string; mimeType: string }
  | { type: 'exported-wallpaper'; id: number; png: ArrayBuffer; filename: string; width: number; height: number }
  | {
      type: 'exported-animated'
      id: number
      data: ArrayBuffer
      filename: string
      mimeType: 'image/png' | 'image/gif'
      width: number
      height: number
      frameCount: number
    }
  /** An animation on its way: frames made so far, and how many in all. */
  | { type: 'progress'; id: number; done: number; total: number; note?: string }
  | { type: 'error'; job?: number; id?: number; gen: number; message: string }
