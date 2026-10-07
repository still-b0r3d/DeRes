// Resizing by area average: each output pixel is the mean of the source area
// it covers (in linear light, by the caller's choice of data). One-step
// shrinking with drawImage samples a few source pixels and aliases; this
// doesn't. When an axis is enlarged instead, the window is one source pixel
// wide, which is the same as linear interpolation.

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface AxisWeights {
  /** start[i] … start[i+1] index into src/weight for output i. */
  start: Int32Array
  src: Int32Array
  weight: Float32Array
  min: number
  max: number
}

function axisWeights(srcLen: number, from: number, span: number, outLen: number): AxisWeights {
  const ratio = span / outLen
  const width = Math.max(ratio, 1)
  const start = new Int32Array(outLen + 1)
  const src: number[] = []
  const weight: number[] = []
  let min = srcLen
  let max = 0
  for (let i = 0; i < outLen; i++) {
    start[i] = src.length
    const c = from + (i + 0.5) * ratio
    const lo = Math.max(0, c - width / 2)
    const hi = Math.min(srcLen, c + width / 2)
    let total = 0
    const first = src.length
    for (let k = Math.floor(lo); k < Math.ceil(hi); k++) {
      const w = Math.min(hi, k + 1) - Math.max(lo, k)
      if (w <= 1e-9) continue
      src.push(k)
      weight.push(w)
      total += w
      if (k < min) min = k
      if (k > max) max = k
    }
    if (src.length === first) {
      // Window fell outside the image (only possible with odd inputs).
      const k = Math.min(srcLen - 1, Math.max(0, Math.floor(c)))
      src.push(k)
      weight.push(1)
      total = 1
      min = Math.min(min, k)
      max = Math.max(max, k)
    }
    for (let j = first; j < src.length; j++) weight[j] /= total
  }
  start[outLen] = src.length
  return { start, src: Int32Array.from(src), weight: Float32Array.from(weight), min, max }
}

/**
 * Resizes the `rect` part of a `sw`×`sh` image with `ch` channels per pixel to
 * `dw`×`dh`. Returns a new buffer.
 */
export function resampleArea(
  data: Float32Array,
  sw: number,
  sh: number,
  rect: Rect,
  dw: number,
  dh: number,
  ch: number
): Float32Array {
  const xw = axisWeights(sw, rect.x, rect.w, dw)
  const yw = axisWeights(sh, rect.y, rect.h, dh)
  const rows = yw.max - yw.min + 1
  const { start, src, weight } = xw
  // Horizontal pass over only the rows the vertical pass will read.
  const tmp = new Float32Array(rows * dw * ch)
  for (let r = 0; r < rows; r++) {
    const rowBase = (yw.min + r) * sw
    let o = r * dw * ch
    if (ch === 4) {
      // The common case (RGBA), unrolled: this loop touches every pixel of
      // the working copy, so it's most of the cost of changing machines.
      for (let i = 0; i < dw; i++) {
        let a0 = 0
        let a1 = 0
        let a2 = 0
        let a3 = 0
        for (let j = start[i], end = start[i + 1]; j < end; j++) {
          const s = (rowBase + src[j]) << 2
          const w = weight[j]
          a0 += data[s] * w
          a1 += data[s + 1] * w
          a2 += data[s + 2] * w
          a3 += data[s + 3] * w
        }
        tmp[o] = a0
        tmp[o + 1] = a1
        tmp[o + 2] = a2
        tmp[o + 3] = a3
        o += 4
      }
    } else {
      for (let i = 0; i < dw; i++) {
        for (let c = 0; c < ch; c++) {
          let a = 0
          for (let j = start[i]; j < start[i + 1]; j++) a += data[(rowBase + src[j]) * ch + c] * weight[j]
          tmp[o + c] = a
        }
        o += ch
      }
    }
  }
  const out = new Float32Array(dw * dh * ch)
  const span = dw * ch
  for (let y = 0; y < dh; y++) {
    const o = y * span
    for (let j = yw.start[y]; j < yw.start[y + 1]; j++) {
      const s = (yw.src[j] - yw.min) * span
      const w = yw.weight[j]
      for (let k = 0; k < span; k++) out[o + k] += tmp[s + k] * w
    }
  }
  return out
}
