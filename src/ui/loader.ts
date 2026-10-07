// Opening a picture: decode it once, straight into a working copy no bigger
// than WORKING_MAX on its long edge, and let the full-size decode go. A
// full-size canvas is never made: iOS Safari caps a canvas at about 16.7
// million pixels, and a 24 or 48 MP photo would silently draw blank.

export const WORKING_MAX = 2048

export interface WorkingCopy {
  /** The working copy, also used to show the original next to the result. */
  canvas: HTMLCanvasElement
  width: number
  height: number
  /** The photo's real size. */
  origW: number
  origH: number
  rgba: Uint8ClampedArray
}

export type DecodeProblem = 'unreadable' | 'too-big'

export class DecodeError extends Error {
  constructor(readonly problem: DecodeProblem) {
    super(problem)
  }
}

export const DECODE_MESSAGES: Record<DecodeProblem, string> = {
  unreadable:
    "This browser can't open that file. JPEG, PNG, WebP and GIF work everywhere; HEIC photos only open in Safari.",
  'too-big': 'That photo is too big for this browser to open. A smaller copy (or a screenshot of it) will work.'
}

async function openWithImageElement(blob: Blob): Promise<{ img: HTMLImageElement; done: () => void }> {
  const url = URL.createObjectURL(blob)
  const img = new Image()
  img.src = url
  try {
    await img.decode()
  } catch {
    URL.revokeObjectURL(url)
    throw new DecodeError('unreadable')
  }
  return { img, done: () => URL.revokeObjectURL(url) }
}

export async function decodeToWorkingCopy(blob: Blob): Promise<WorkingCopy> {
  let full: ImageBitmap | null = null
  let fallback: { img: HTMLImageElement; done: () => void } | null = null
  // createImageBitmap applies the photo's rotation flag ('from-image'); a
  // browser that doesn't know that option gets an <img>, which does too.
  try {
    full = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch {
    fallback = await openWithImageElement(blob)
  }
  const origW = full ? full.width : fallback!.img.naturalWidth
  const origH = full ? full.height : fallback!.img.naturalHeight
  if (!origW || !origH) {
    full?.close()
    fallback?.done()
    throw new DecodeError('unreadable')
  }
  const s = Math.min(1, WORKING_MAX / Math.max(origW, origH))
  const width = Math.max(1, Math.round(origW * s))
  const height = Math.max(1, Math.round(origH * s))

  let source: CanvasImageSource = full ?? fallback!.img
  let resized: ImageBitmap | null = null
  if (full && s < 1) {
    // The browser's own high-quality shrink, where it has one.
    try {
      resized = await createImageBitmap(full, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' })
      source = resized
    } catch {
      // drawImage below scales it instead.
    }
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new DecodeError('too-big')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  try {
    ctx.drawImage(source, 0, 0, width, height)
  } catch {
    throw new DecodeError('too-big')
  } finally {
    resized?.close()
    full?.close()
    fallback?.done()
  }
  const rgba = ctx.getImageData(0, 0, width, height).data
  // A picture too big for the browser draws as nothing at all.
  let blank = true
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 0) {
      blank = false
      break
    }
  }
  if (blank) throw new DecodeError('too-big')
  return { canvas, width, height, origW, origH, rgba }
}

/** The picture in a paste or drop, if there is one. */
export function imageFromTransfer(data: DataTransfer | null): File | null {
  if (!data) return null
  for (const file of Array.from(data.files)) if (file.type.startsWith('image/') || isHeic(file)) return file
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) return file
    }
  }
  return null
}

function isHeic(file: File): boolean {
  return /\.(heic|heif)$/i.test(file.name)
}
