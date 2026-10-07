import { hexToRgb, rgbToHex } from './color'
import { decodePng, encodeIndexedPng } from './png'

// Parsing and exporting palette files: .hex, JASC .pal, GIMP .gpl, and palette PNGs.
// Max 256 colours per palette.

/**
 * Parses a palette text file (.hex, JASC-PAL, or GIMP .gpl).
 * Returns an array of lowercase #rrggbb hex strings.
 */
export function parsePaletteText(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return []

  // 1. JASC-PAL format
  if (lines[0].toUpperCase() === 'JASC-PAL') {
    // Line 0: JASC-PAL
    // Line 1: 0100 (version)
    // Line 2: count
    // Lines 3+: R G B
    const out: string[] = []
    const count = parseInt(lines[2], 10) || lines.length - 3
    for (let i = 3; i < lines.length && out.length < Math.min(256, count); i++) {
      const parts = lines[i].split(/\s+/).map((n) => parseInt(n, 10))
      if (parts.length >= 3 && !parts.slice(0, 3).some(isNaN)) {
        out.push(rgbToHex(parts[0], parts[1], parts[2]))
      }
    }
    return out
  }

  // 2. GIMP .gpl format
  if (lines[0].toUpperCase().startsWith('GIMP PALETTE')) {
    const out: string[] = []
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      if (line.startsWith('#') || line.startsWith('Name:') || line.startsWith('Columns:')) {
        continue
      }
      const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)/)
      if (match) {
        const r = parseInt(match[1], 10)
        const g = parseInt(match[2], 10)
        const b = parseInt(match[3], 10)
        out.push(rgbToHex(r, g, b))
        if (out.length >= 256) break
      }
    }
    return out
  }

  // 3. .hex format (one hex code per line, e.g. "00ffff" or "#00ffff" or "0ff")
  const out: string[] = []
  for (const line of lines) {
    if (line.startsWith(';') || line.startsWith('//')) continue
    const cleaned = line.replace(/^#/, '').trim()
    if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
      out.push(`#${cleaned.toLowerCase()}`)
    } else if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
      const r = cleaned[0] + cleaned[0]
      const g = cleaned[1] + cleaned[1]
      const b = cleaned[2] + cleaned[2]
      out.push(`#${r}${g}${b}`.toLowerCase())
    }
    if (out.length >= 256) break
  }
  return out
}

/**
 * Extracts unique colours from a decoded PNG image as #rrggbb strings (max 256).
 */
export async function parsePalettePng(bytes: Uint8Array): Promise<string[]> {
  const decoded = await decodePng(bytes)
  const { width, height, rgba } = decoded
  const seen = new Set<string>()
  const out: string[] = []

  for (let i = 0, n = width * height; i < n; i++) {
    const hex = rgbToHex(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2])
    if (!seen.has(hex)) {
      seen.add(hex)
      out.push(hex)
      if (out.length >= 256) break
    }
  }
  return out
}

/** Exports as a standard .hex string (one #rrggbb per line). */
export function exportPaletteHex(colours: readonly string[]): string {
  return colours.map((c) => c.toLowerCase()).join('\n') + '\n'
}

/** Exports as a JASC-PAL format string. */
export function exportPaletteJasc(colours: readonly string[]): string {
  const header = ['JASC-PAL', '0100', String(colours.length)]
  const lines = colours.map((c) => {
    const [r, g, b] = hexToRgb(c)
    return `${r} ${g} ${b}`
  })
  return [...header, ...lines].join('\r\n') + '\r\n'
}

/** Exports as a GIMP .gpl palette format string. */
export function exportPaletteGpl(colours: readonly string[], name = 'b0r3d DeRes'): string {
  const header = ['GIMP Palette', `Name: ${name}`, 'Columns: 8', '#']
  const lines = colours.map((c) => {
    const [r, g, b] = hexToRgb(c)
    const rStr = String(r).padStart(3, ' ')
    const gStr = String(g).padStart(3, ' ')
    const bStr = String(b).padStart(3, ' ')
    return `${rStr} ${gStr} ${bStr}\t${c}`
  })
  return [...header, ...lines].join('\n') + '\n'
}

/** Exports a 1×N PNG containing the palette colours in order. */
export async function exportPalettePng(colours: readonly string[]): Promise<Uint8Array<ArrayBuffer>> {
  const n = Math.min(256, Math.max(1, colours.length))
  const palette = new Uint8Array(n * 3)
  for (let i = 0; i < n; i++) {
    const [r, g, b] = hexToRgb(colours[i])
    palette[i * 3] = r
    palette[i * 3 + 1] = g
    palette[i * 3 + 2] = b
  }
  return encodeIndexedPng(n, 1, palette, (_y, out) => {
    for (let x = 0; x < n; x++) out[x] = x
  })
}
