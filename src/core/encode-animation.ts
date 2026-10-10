import { apngPlays, MAX_ANIMATION_BUDGET, MAX_ANIMATION_PIXELS, type AnimatedExportResult } from './animate'
import { ApngWriter } from './apng'
import { GifWriter, NearestColour, PaletteSamples } from './gif'

// A GIF or APNG from full-colour frames made one at a time (the ASCII
// studio's rendered art). Every frame is looked at twice: first for its
// colours, then to write it. When all the frames together use 256 colours or
// fewer (the 16 ANSI colours, the C64's, Teletext's, greys), the file is
// indexed with exactly those colours: small, and the very pixels of the PNG.
// Past that, a GIF gets one shared palette for every frame (so still parts
// don't shimmer) and an APNG stays full colour. Frames are held between the
// two passes while they fit the budget; past it, each is made again.

/** The exact colours in a set of frames, while there are no more than 256. */
export class ColourCensus {
  private readonly seen = new Set<number>()
  private over = false

  add(rgb: Uint8Array): void {
    if (this.over) return
    const seen = this.seen
    let last = -1
    for (let i = 0; i < rgb.length; i += 3) {
      const c = (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2]
      // Rendered art comes in runs of one colour.
      if (c === last) continue
      last = c
      if (seen.has(c)) continue
      seen.add(c)
      if (seen.size > 256) {
        this.over = true
        seen.clear()
        return
      }
    }
  }

  /** r, g, b per colour, in the order first seen; null when there are more than 256 (or none). */
  palette(): Uint8Array | null {
    if (this.over || this.seen.size === 0) return null
    const out = new Uint8Array(this.seen.size * 3)
    let i = 0
    for (const c of this.seen) {
      out[i++] = c >> 16
      out[i++] = (c >> 8) & 0xff
      out[i++] = c & 0xff
    }
    return out
  }
}

export interface RgbAnimationOptions {
  format: 'apng' | 'gif'
  width: number
  height: number
  /** How long each frame shows, in milliseconds: one entry per frame. */
  delaysMs: readonly number[]
  /** 0 = forever, null = it plays once (as the GIF it came from). */
  loopCount: number | null
  /** Frame k at width × height, r, g, b per pixel. Asked for again in the second pass unless it's held. */
  frame: (k: number) => Promise<Uint8Array> | Uint8Array
  /** Frames done so far, of how many; `note` names the pass that only reads the colours. */
  onProgress?: (done: number, total: number, note?: string) => void
  /** Pixels held between the passes (MAX_ANIMATION_BUDGET). A test can set it low. */
  budget?: number
  /** Waited for between frames, so the page can get on with other things. */
  breathe?: () => Promise<void>
}

export async function encodeRgbAnimation(o: RgbAnimationOptions): Promise<AnimatedExportResult> {
  const total = o.delaysMs.length
  if (total === 0) throw new Error('There are no frames to export.')
  const { width, height } = o
  const pixels = width * height
  if (pixels > MAX_ANIMATION_PIXELS) throw new Error('That size is too big for an animation. Pick a smaller size.')

  // First pass: every frame's colours (and, for a GIF, samples for a shared palette).
  const held: (Uint8Array | null)[] | null = pixels * total <= (o.budget ?? MAX_ANIMATION_BUDGET) ? [] : null
  const census = new ColourCensus()
  const samples = o.format === 'gif' ? new PaletteSamples(total * pixels) : null
  for (let k = 0; k < total; k++) {
    if (k > 0) await o.breathe?.()
    const rgb = await o.frame(k)
    census.add(rgb)
    samples?.add(rgb, pixels)
    held?.push(rgb)
    o.onProgress?.(k + 1, total, 'reading the colours')
  }
  const exact = census.palette()

  /** Frame k for the second pass, let go once it's written. */
  const again = async (k: number): Promise<Uint8Array> => {
    await o.breathe?.()
    const rgb = held?.[k] ?? (await o.frame(k))
    if (held) held[k] = null
    return rgb
  }

  if (o.format === 'apng') {
    const writer = new ApngWriter(width, height, { numPlays: apngPlays(o.loopCount), palette: exact ?? undefined })
    const colours = exact ? new NearestColour(exact) : null
    for (let k = 0; k < total; k++) {
      const rgb = await again(k)
      const delayMs = o.delaysMs[k]
      await writer.add(colours ? { width, height, delayMs, indices: colours.map(rgb) } : { width, height, delayMs, rgb })
      o.onProgress?.(k + 1, total)
    }
    return { data: writer.finish(), format: 'apng', mimeType: 'image/png', width, height, frameCount: total }
  }

  const palette = exact ?? samples!.palette()
  const colours = new NearestColour(palette)
  const writer = new GifWriter(width, height, { loop: o.loopCount, palette })
  for (let k = 0; k < total; k++) {
    const rgb = await again(k)
    writer.add({ width, height, delayMs: o.delaysMs[k], indices: colours.map(rgb) })
    o.onProgress?.(k + 1, total)
  }
  return { data: writer.finish(), format: 'gif', mimeType: 'image/gif', width, height, frameCount: total }
}
