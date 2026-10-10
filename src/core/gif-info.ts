// How many frames a GIF holds, from its block structure alone (nothing is
// decoded). The app opens a GIF as one still picture, its first frame, and
// says so when there are more.

/** The number of images in a GIF file; 0 when it isn't one. A damaged file counts what it has. */
export function gifFrameCount(bytes: Uint8Array): number {
  if (bytes.length < 13) return 0
  const sig = String.fromCharCode(...bytes.subarray(0, 6))
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return 0

  const n = bytes.length
  let p = 13
  // Global colour table.
  if (bytes[10] & 0x80) p += 3 << ((bytes[10] & 7) + 1)

  // Skips a run of sub-blocks (a length byte, then that many bytes) up to the 0 that ends it.
  const skipSubBlocks = (): boolean => {
    while (p < n) {
      const len = bytes[p++]
      if (len === 0) return true
      p += len
    }
    return false
  }

  let frames = 0
  while (p < n) {
    const block = bytes[p++]
    if (block === 0x2c) {
      // Image descriptor: position and size (8 bytes), then flags.
      if (p + 9 > n) break
      const flags = bytes[p + 8]
      p += 9
      if (flags & 0x80) p += 3 << ((flags & 7) + 1)
      // LZW minimum code size, then the image data.
      p++
      if (!skipSubBlocks()) break
      frames++
    } else if (block === 0x21) {
      // Extension: its label, then sub-blocks.
      p++
      if (!skipSubBlocks()) break
    } else {
      // 0x3b ends the file; anything else means the file is damaged here.
      break
    }
  }
  return frames
}
