import { linearToByte } from './color'

// Fast, deterministic color quantization using weighted median cut.
// It samples image pixels into histogram buckets, splits the highest-variance
// boxes along their dominant RGB channel at the weighted median, and snaps
// the resulting average colors to the target hardware bit grid.

export function snapToBits(v8: number, bits: number): number {
  if (bits >= 8) return Math.min(255, Math.max(0, Math.round(v8)))
  if (bits <= 0) return 0
  const maxVal = (1 << bits) - 1
  const level = Math.round((Math.min(255, Math.max(0, v8)) * maxVal) / 255)
  return Math.round((level * 255) / maxVal)
}

interface Bucket {
  r: number
  g: number
  b: number
  weight: number
}

interface Box {
  buckets: Bucket[]
  totalWeight: number
  minR: number
  maxR: number
  minG: number
  maxG: number
  minB: number
  maxB: number
  spreadR: number
  spreadG: number
  spreadB: number
  maxSpread: number
}

function makeBox(buckets: Bucket[]): Box {
  let totalWeight = 0
  let minR = 255, maxR = 0
  let minG = 255, maxG = 0
  let minB = 255, maxB = 0

  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i]
    totalWeight += b.weight
    if (b.r < minR) minR = b.r
    if (b.r > maxR) maxR = b.r
    if (b.g < minG) minG = b.g
    if (b.g > maxG) maxG = b.g
    if (b.b < minB) minB = b.b
    if (b.b > maxB) maxB = b.b
  }

  const spreadR = maxR - minR
  const spreadG = maxG - minG
  const spreadB = maxB - minB
  const maxSpread = Math.max(spreadR, spreadG, spreadB)

  return {
    buckets,
    totalWeight,
    minR, maxR,
    minG, maxG,
    minB, maxB,
    spreadR, spreadG, spreadB,
    maxSpread
  }
}

/**
 * Quantizes an RGB float buffer (linear light, 3 floats per pixel) into
 * up to `maxColours` sRGB bytes (r, g, b per entry), snapped to `bitsPerChannel`.
 */
export function quantizeRgb(
  rgb: Float32Array,
  maxColours: number,
  bitsPerChannel = 8
): Uint8Array {
  const targetCount = Math.max(1, Math.min(256, maxColours))
  const pixelCount = Math.floor(rgb.length / 3)
  if (pixelCount === 0) return new Uint8Array(0)

  // 1. Build a 5-bit histogram to group nearby pixels into representative buckets.
  // 5 bits = 32 levels per channel = 32,768 possible buckets.
  const counts = new Uint32Array(32768)
  const sumR = new Float64Array(32768)
  const sumG = new Float64Array(32768)
  const sumB = new Float64Array(32768)

  for (let i = 0; i < pixelCount; i++) {
    const r8 = linearToByte(rgb[i * 3])
    const g8 = linearToByte(rgb[i * 3 + 1])
    const b8 = linearToByte(rgb[i * 3 + 2])

    const key = ((r8 >> 3) << 10) | ((g8 >> 3) << 5) | (b8 >> 3)
    counts[key]++
    sumR[key] += r8
    sumG[key] += g8
    sumB[key] += b8
  }

  const buckets: Bucket[] = []
  for (let key = 0; key < 32768; key++) {
    const w = counts[key]
    if (w > 0) {
      buckets.push({
        r: Math.round(sumR[key] / w),
        g: Math.round(sumG[key] / w),
        b: Math.round(sumB[key] / w),
        weight: w
      })
    }
  }

  // If unique buckets are already within target count
  if (buckets.length <= targetCount) {
    const snappedSet = new Set<number>()
    const out: number[] = []
    for (const b of buckets) {
      const r = snapToBits(b.r, bitsPerChannel)
      const g = snapToBits(b.g, bitsPerChannel)
      const b_ = snapToBits(b.b, bitsPerChannel)
      const key = (r << 16) | (g << 8) | b_
      if (!snappedSet.has(key)) {
        snappedSet.add(key)
        out.push(r, g, b_)
      }
    }
    return Uint8Array.from(out)
  }

  // 2. Median Cut: partition boxes until we reach targetCount
  const boxes: Box[] = [makeBox(buckets)]

  while (boxes.length < targetCount) {
    // Pick the box with the largest spread (with buckets > 1)
    let bestBoxIdx = -1
    let bestScore = -1
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]
      if (box.buckets.length > 1 && box.maxSpread > 0) {
        // Score combines spread and weight to prioritize significant clusters
        const score = box.maxSpread * Math.sqrt(box.totalWeight)
        if (score > bestScore) {
          bestScore = score
          bestBoxIdx = i
        }
      }
    }

    if (bestBoxIdx === -1) break // Cannot split further

    const box = boxes.splice(bestBoxIdx, 1)[0]
    const bList = box.buckets

    // Sort along the dominant spread axis
    const axis =
      box.spreadR >= box.spreadG && box.spreadR >= box.spreadB
        ? 'r'
        : box.spreadG >= box.spreadB
          ? 'g'
          : 'b'

    bList.sort((a, b) => a[axis] - b[axis] || a.r - b.r || a.g - b.g || a.b - b.b)

    // Find weighted median split point
    const halfWeight = box.totalWeight / 2
    let accum = 0
    let splitIdx = 1
    for (let i = 0; i < bList.length - 1; i++) {
      accum += bList[i].weight
      if (accum >= halfWeight) {
        splitIdx = i + 1
        break
      }
    }

    const left = bList.slice(0, splitIdx)
    const right = bList.slice(splitIdx)

    if (left.length > 0 && right.length > 0) {
      boxes.push(makeBox(left), makeBox(right))
    } else {
      boxes.push(box)
      break
    }
  }

  // 3. Compute weighted mean for each box and snap to the channel bit grid
  const palette: { r: number; g: number; b: number; weight: number }[] = []
  for (const box of boxes) {
    let rSum = 0, gSum = 0, bSum = 0
    for (const b of box.buckets) {
      rSum += b.r * b.weight
      gSum += b.g * b.weight
      bSum += b.b * b.weight
    }
    const r = snapToBits(Math.round(rSum / box.totalWeight), bitsPerChannel)
    const g = snapToBits(Math.round(gSum / box.totalWeight), bitsPerChannel)
    const b = snapToBits(Math.round(bSum / box.totalWeight), bitsPerChannel)
    palette.push({ r, g, b, weight: box.totalWeight })
  }

  // Deduplicate identical snapped colours, keeping highest weight
  const seen = new Set<number>()
  const finalColors: number[] = []

  // Sort by weight descending so dominant clusters are prioritized
  palette.sort((a, b) => b.weight - a.weight)

  for (const p of palette) {
    const key = (p.r << 16) | (p.g << 8) | p.b
    if (!seen.has(key)) {
      seen.add(key)
      finalColors.push(p.r, p.g, p.b)
    }
  }

  return Uint8Array.from(finalColors)
}
