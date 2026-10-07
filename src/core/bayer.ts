// Bayer ordered-dither threshold matrices. Each holds 0 … n²-1 once, laid out
// so that every threshold sits as far as possible from the ones just below it.

const cache = new Map<number, Uint8Array>()

/** The n×n Bayer matrix (n = 1, 2, 4, 8 or 16), row by row. */
export function bayerMatrix(n: number): Uint8Array {
  const hit = cache.get(n)
  if (hit) return hit
  let m: Uint8Array
  if (n === 1) {
    m = Uint8Array.of(0)
  } else {
    if (n < 1 || n > 16 || (n & (n - 1)) !== 0) throw new Error(`No Bayer matrix of size ${n}`)
    const half = n / 2
    const base = bayerMatrix(half)
    m = new Uint8Array(n * n)
    // Quadrant offsets of the 2×2 matrix [0 2; 3 1].
    const offset = [0, 2, 3, 1]
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const q = (y >= half ? 2 : 0) + (x >= half ? 1 : 0)
        m[y * n + x] = 4 * base[(y % half) * half + (x % half)] + offset[q]
      }
    }
  }
  cache.set(n, m)
  return m
}
