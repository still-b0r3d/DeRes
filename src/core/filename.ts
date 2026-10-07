// Export file names that say what's inside: photo-nes-256x240-4x.png.

/** A file name's stem, safe for a download name ("IMG_2041.HEIC" -> "img-2041"). */
export function baseName(fileName: string): string {
  const stem = fileName.replace(/\.[^./\\]*$/, '')
  const clean = stem
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return clean || 'photo'
}

export interface ExportName {
  base: string
  profileId: string
  width: number
  height: number
  multiplier: number
  /** Stretched to the TV's pixel shape. */
  tv: boolean
  /** With the screen effect. */
  fx: boolean
}

export function exportFilename(n: ExportName): string {
  return (
    `${n.base}-${n.profileId}-${n.width}x${n.height}-${n.multiplier}x` +
    `${n.tv ? '-tv' : ''}${n.fx ? '-fx' : ''}.png`
  )
}
