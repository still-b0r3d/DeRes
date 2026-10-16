import { chunk, decodePng, PNG_SIGNATURE } from '../core/png'

// Reads an APNG back for tests, frame by frame: each frame's data (the IDAT,
// or an fdAT without its sequence number) goes into a PNG of its own with
// the file's header and palette, which decodePng reads. The writers here
// only make whole-picture frames that replace the last one, so that's all
// it has to know.

export interface ApngFrameData {
  delayMs: number
  /** r, g, b, a per pixel. */
  rgba: Uint8Array
}

export interface ReadApng {
  width: number
  height: number
  /** acTL: frames, and how many times it plays (0 = forever). */
  frameCount: number
  numPlays: number
  /** The colour type from IHDR (3 = indexed, 2 = RGB) and the palette's colour count. */
  colourType: number
  paletteColours: number
  frames: ApngFrameData[]
}

export async function readApng(bytes: Uint8Array): Promise<ReadApng> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let ihdr: Uint8Array | null = null
  let plte: Uint8Array | null = null
  let trns: Uint8Array | null = null
  let frameCount = 0
  let numPlays = 0
  const pending: { delayMs: number; data: Uint8Array[] }[] = []
  for (let o = 8; o < bytes.length; ) {
    const len = view.getUint32(o)
    const name = String.fromCharCode(...bytes.subarray(o + 4, o + 8))
    const data = bytes.subarray(o + 8, o + 8 + len)
    const d = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (name === 'IHDR') ihdr = data
    else if (name === 'PLTE') plte = data
    else if (name === 'tRNS') trns = data
    else if (name === 'acTL') {
      frameCount = d.getUint32(0)
      numPlays = d.getUint32(4)
    } else if (name === 'fcTL') {
      const num = d.getUint16(20)
      const den = d.getUint16(22) || 100
      pending.push({ delayMs: Math.round((num * 1000) / den), data: [] })
    } else if (name === 'IDAT' || name === 'fdAT') {
      pending[pending.length - 1].data.push(name === 'IDAT' ? data : data.subarray(4))
    }
    o += 12 + len
  }
  if (!ihdr) throw new Error('No IHDR')
  const width = new DataView(ihdr.buffer, ihdr.byteOffset).getUint32(0)
  const height = new DataView(ihdr.buffer, ihdr.byteOffset).getUint32(4)
  const frames: ApngFrameData[] = []
  for (const f of pending) {
    const parts = [
      PNG_SIGNATURE,
      chunk('IHDR', ihdr),
      ...(plte ? [chunk('PLTE', plte)] : []),
      ...(trns ? [chunk('tRNS', trns)] : []),
      ...f.data.map((c) => chunk('IDAT', c)),
      chunk('IEND', new Uint8Array(0))
    ]
    const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
    let p = 0
    for (const part of parts) {
      png.set(part, p)
      p += part.length
    }
    frames.push({ delayMs: f.delayMs, rgba: (await decodePng(png)).rgba })
  }
  return { width, height, frameCount, numPlays, colourType: ihdr[9], paletteColours: plte ? plte.length / 3 : 0, frames }
}
