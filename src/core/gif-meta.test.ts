import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildGif, gifApp, gifComment, gifPlainText, gifXmp, xmpPacket, type Block } from '../test/gif-builder'
import { getMetadataNarrative, inspectMetadata, xmpGps, xmpHasLocation } from './exif'
import { decodeGifFrames } from './gif-decode'
import { scrubBatch, createScrubBatchItem, scrubImage } from './scrub'

// GIFs in the EXIF tools: what the inspector reads, and what the scrubber
// keeps (every frame, byte for byte) and drops.

const RGBK = [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]
const frame = (k: number, extra: object = {}) => ({ width: 4, height: 3, indices: new Array(12).fill(k % 4), delay: 5 + k, ...extra })

const CHICAGO = xmpPacket({ 'exif:GPSLatitude': '41,52.8N', 'exif:GPSLongitude': '87,37.8W' })
const NO_PLACE = xmpPacket({ 'photoshop:Credit': 'b0r3d' })
const AI_MADE = xmpPacket({ 'Iptc4xmpExt:DigitalSourceType': 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia' })
const ICC = gifApp('ICCRGBG1012', new Array(600).fill(7))
const PHOTOSHOP = gifApp('MGK8BIM0000', [1, 2, 3, 4])

/** A 3-frame GIF with metadata between its frames, and bytes after its end. */
function busyGif(blocks: Block[] = [gifComment('made on a Tuesday'), gifXmp(CHICAGO), ICC, PHOTOSHOP, gifPlainText('hi')]): Uint8Array {
  const gif = buildGif({ width: 4, height: 3, globalTable: RGBK, loop: 0, blocks: [frame(0), ...blocks, frame(1), frame(2, { disposal: 2 })] })
  return Uint8Array.from([...gif, 1, 2, 3, 4, 5])
}

/** Every frame's pixels (as a hash) and timing, and the loop count. */
function frames(bytes: Uint8Array) {
  const { reader, frames } = decodeGifFrames(bytes)
  const hash = (rgba: Uint8ClampedArray) => createHash('sha256').update(rgba).digest('hex')
  return { loop: reader.loopCount, frames: frames.map((f) => ({ delay: f.delayMs, disposal: f.disposal, pixels: hash(f.rgba) })) }
}

describe('GIF metadata', () => {
  it('reads the version, size, frames and loop', () => {
    const meta = inspectMetadata(buildGif({ width: 4, height: 3, globalTable: RGBK, loop: 2, blocks: [frame(0), frame(1)] }))
    expect(meta.format).toBe('gif')
    expect(meta.gif).toEqual({ version: '89a', width: 4, height: 3, frames: 2, loopCount: 2, comments: 0 })
    expect(meta.rawTagCount).toBe(0)
    expect(meta.trailerBytes).toBe(0)
    const tags = Object.fromEntries(meta.allTags.map((t) => [t.name, t.displayValue]))
    expect(tags).toMatchObject({ 'GIF Version': '89a', Size: '4×3', Frames: '2', 'Loop Count': '2 more times' })
    expect(getMetadataNarrative(meta)).toBe("A GIF with 2 frames that plays 3 times. GIFs don't record a camera or date; no location found.")
  })

  it('reads comments, plain text, XMP and other application blocks, and the bytes after the end', () => {
    const meta = inspectMetadata(busyGif())
    expect(meta.gif).toMatchObject({ frames: 3, loopCount: 0, comments: 1 })
    expect(meta.rawTagCount).toBe(5)
    expect(meta.trailerBytes).toBe(5)
    expect(meta.hasIccProfile).toBe(true)
    expect(meta.xmpText).toBe(CHICAGO)
    expect(meta.gps?.latitude).toBeCloseTo(41.88, 6)
    expect(meta.gps?.longitude).toBeCloseTo(-87.63, 6)
    const rows = meta.allTags.map((t) => `${t.name}: ${t.displayValue}`)
    expect(rows).toContain('GIF Comment: made on a Tuesday')
    expect(rows).toContain('GIF Plain Text: hi')
    expect(rows).toContain('Application block (ICCRGBG1012): colour profile, 618 bytes')
    expect(rows).toContain('Application block (MGK8BIM0000): Photoshop data, 20 bytes')
    expect(rows.some((r) => r.startsWith('XMP Metadata Packet'))).toBe(true)
    expect(getMetadataNarrative(meta)).toBe(
      "A GIF with 3 frames that loops forever. GIFs don't record a camera or date; its XMP gives a location: 41.880000, -87.630000, and a comment."
    )
  })

  it('finds AI markers in a GIF’s XMP and comments', () => {
    expect(inspectMetadata(busyGif([gifXmp(AI_MADE)])).aiDetection?.kind).toBe('made')
    const prompt = gifComment('masterpiece, a cat in a hamster ball\nSteps: 30, Sampler: Euler a, CFG scale: 7, Seed: 1, Size: 512x512, Model: sd15')
    expect(inspectMetadata(busyGif([prompt])).aiDetection?.detected).toBe(true)
    expect(inspectMetadata(busyGif([gifComment('just a comment')])).aiDetection?.detected).toBe(false)
  })

  it('reads XMP GPS in its usual spellings', () => {
    const el = '<exif:GPSLatitude>51,30,26.4N</exif:GPSLatitude><exif:GPSLongitude>0,7,39W</exif:GPSLongitude>'
    expect(xmpGps(el)?.latitude).toBeCloseTo(51.5073, 4)
    expect(xmpGps(el)?.longitude).toBeCloseTo(-0.1275, 4)
    const dec = xmpGps(xmpPacket({ 'exif:GPSLatitude': '-33.8688', 'exif:GPSLongitude': '151.2093', 'exif:GPSAltitude': '58/1' }))
    expect([dec?.latitude, dec?.longitude, dec?.altitude, dec?.latRef]).toEqual([-33.8688, 151.2093, 58, 'S'])
    expect(xmpGps(NO_PLACE)).toBeUndefined()
    expect(xmpGps(xmpPacket({ 'exif:GPSLatitude': 'nowhere', 'exif:GPSLongitude': '1,2E' }))).toBeUndefined()
    expect(xmpHasLocation(CHICAGO)).toBe(true)
    expect(xmpHasLocation(xmpPacket({ 'photoshop:City': 'Chicago' }))).toBe(true)
    expect(xmpHasLocation(NO_PLACE)).toBe(false)
  })

  it('survives a GIF cut off in the middle of a block', () => {
    const gif = busyGif()
    const cut = gif.subarray(0, 200)
    const meta = inspectMetadata(cut)
    expect(meta.format).toBe('gif')
    expect(meta.trailerBytes).toBeGreaterThan(0)
  })
})

describe('scrubbing a GIF', () => {
  it('"Remove everything" drops every metadata block and keeps every frame exactly', () => {
    const gif = busyGif()
    const res = scrubImage(gif, { mode: 'all' })
    expect(res.format).toBe('gif')
    expect(frames(res.data)).toEqual(frames(gif))
    const after = inspectMetadata(res.data)
    expect(after.rawTagCount).toBe(0)
    expect(after.xmpText).toBeUndefined()
    expect(after.hasIccProfile).toBe(false)
    expect(after.gps).toBeUndefined()
    expect(after.trailerBytes).toBe(0)
    expect(after.gif).toMatchObject({ frames: 3, loopCount: 0, comments: 0 })
    expect(res.report.isClean).toBe(true)
    expect(res.report.leftovers).toEqual([])
    expect(res.report.summary).toContain('Kept: every frame, its timing and the loop.')
    // What's left is what was there, byte for byte: header, table, loop block, frames, end.
    const plain = buildGif({ width: 4, height: 3, globalTable: RGBK, loop: 0, blocks: [frame(0), frame(1), frame(2, { disposal: 2 })] })
    expect([...res.data]).toEqual([...plain])
  })

  it('drops the timing that belonged to a plain text block, so no frame takes it over', () => {
    const textTiming = [0x21, 0xf9, 4, 0, 200, 0, 0, 0] // 2 s, for the text
    const gif = buildGif({ width: 4, height: 3, globalTable: RGBK, blocks: [frame(0), { raw: textTiming }, gifPlainText('caption'), frame(1)] })
    const res = scrubImage(gif, { mode: 'all' })
    expect(frames(res.data).frames.map((f) => f.delay)).toEqual([50, 60])
    expect(frames(res.data)).toEqual(frames(gif))
  })

  it('"Location only" drops just the XMP that holds a location', () => {
    const gif = busyGif([gifComment('made on a Tuesday'), gifXmp(CHICAGO), gifXmp(NO_PLACE), ICC])
    const res = scrubImage(gif, { mode: 'location_only' })
    expect(frames(res.data)).toEqual(frames(gif))
    const after = inspectMetadata(res.data)
    expect(after.gps).toBeUndefined()
    expect(after.xmpText).toBe(NO_PLACE)
    expect(after.gif?.comments).toBe(1)
    expect(after.hasIccProfile).toBe(true)
    expect(after.trailerBytes).toBe(0)
    expect(res.report.isClean).toBe(true)
    expect(res.report.summary).toContain('comment')
  })

  it('keeps every frame of the sample identical', () => {
    const sample = new Uint8Array(readFileSync(new URL('../../b0r3d-brand/rukus-breaks-out.gif', import.meta.url)))
    for (const mode of ['all', 'location_only'] as const) {
      const res = scrubImage(sample, { mode })
      expect(frames(res.data)).toEqual(frames(sample))
      expect(res.report.isClean).toBe(true)
    }
  })

  it('goes into a batch and its ZIP as a .gif', () => {
    const items = [createScrubBatchItem(busyGif(), 'one.gif'), createScrubBatchItem(busyGif(), 'One.GIF')]
    expect(items[0].format).toBe('gif')
    expect(items[0].hasGps).toBe(true)
    const { zipEntries } = scrubBatch(items)
    expect(zipEntries.map((e) => e.name)).toEqual(['one-clean.gif', 'One-clean-2.gif'])
    expect(items.every((it) => it.status === 'scrubbed' && it.report?.isClean)).toBe(true)
  })
})
