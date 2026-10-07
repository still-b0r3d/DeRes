import type { Rect } from '../core/resample'
import type { DeresSettings } from '../core/pipeline'
import type { HardwareFitReport } from '../core/tiles'

// Messages between the page and the image worker. The picture goes over once
// (load); after that the page only sends settings.

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
      type: 'render'
      job: number
      gen: number
      settings: DeresSettings
      /** Enlargement for the screen-effect preview (0 = no effect). */
      fxScale: number
    }
  | {
      type: 'export'
      id: number
      gen: number
      settings: DeresSettings
      multiplier: number
      withFx: boolean
      base: string
    }
  | {
      type: 'export-emulator'
      id: number
      gen: number
      settings: DeresSettings
      format: 'scr' | 'koa' | 'chr'
      base: string
    }

export interface RenderedMessage {
  type: 'rendered'
  job: number
  gen: number
  width: number
  height: number
  /** The picture at its real size, r, g, b, a per pixel. */
  rgba: ArrayBuffer
  fx: { width: number; height: number; rgba: ArrayBuffer } | null
  used: number
  colours: number
  par: readonly [number, number]
  src: Rect
  dst: Rect
  ms: number
  tileFit?: HardwareFitReport
  emulatorFormats?: readonly ('scr' | 'koa' | 'chr')[]
}

export type FromWorker =
  | { type: 'loaded'; gen: number; hasAlpha: boolean }
  | RenderedMessage
  | { type: 'exported'; id: number; png: ArrayBuffer; filename: string; width: number; height: number }
  | { type: 'exported-emulator'; id: number; data: ArrayBuffer; filename: string; mimeType: string }
  | { type: 'error'; job?: number; id?: number; gen: number; message: string }
