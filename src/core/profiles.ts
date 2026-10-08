import {
  SPECTRUM_PALETTE,
  C64_PALETTE,
  NES_PALETTE,
  APPLE2_HIRES_PALETTE,
  TMS9918_PALETTE,
  GBC_REPRESENTATIVE_PALETTE
} from './cell'
import { rgbToHex } from './color'
import type { DitherId } from './dither'
import { snapToBits } from './quantize'

// Hardware profiles. A profile is a machine's whole look, not just its
// colours: its native resolution, the shape of its pixels on a TV, its
// palette, and the dither and screen it suits.
//
// v0.1 has the fixed-palette machines.
// v0.2 adds palettes picked from a range, PS1 dither, and custom palettes.
// v0.3 adds per-cell modes (Spectrum, C64 MC, NES attributes, Apple II hi-res),
// Amiga HAM6, N64 3-point blur, and emulator export formats.
// v0.6 adds analog, print & video aesthetics.
// v0.7 adds extended hardware & handhelds (Nokia 3310, GBC, Virtual Boy, Atari ST, Amstrad CPC, MSX, CGA composite).
// Sources are listed in the README.

export interface FixedPalette {
  kind: 'fixed'
  colours: readonly string[]
}

export interface RangePalette {
  kind: 'range'
  bitsPerChannel: number
  count: number
}

export interface DirectPalette {
  kind: 'direct'
  bitsPerChannel: number
}

export interface CustomPalette {
  kind: 'custom'
  count: number
}

export interface PoolPalette {
  kind: 'pool'
  pool: readonly string[]
  count: number
}

export interface CellPalette {
  kind: 'cell'
  mode: 'spectrum' | 'c64-mc' | 'nes-attr' | 'apple2-hires' | 'msx-screen2' | 'gbc-tile'
  colours: readonly string[]
}

export interface HamPalette {
  kind: 'ham'
  mode: 'ham6'
  bitsPerChannel: number
}

export interface N64Palette {
  kind: 'n64'
  blur: boolean
}

export interface AnalogPalette {
  kind: 'analog'
  mode: 'ccd' | 'deepfry' | 'newspaper' | 'risograph' | 'fax'
}

export type PaletteSpec =
  | FixedPalette
  | RangePalette
  | DirectPalette
  | CustomPalette
  | PoolPalette
  | CellPalette
  | HamPalette
  | N64Palette
  | AnalogPalette

export interface HardwareLimits {
  /** Maximum unique 8×8 tiles (e.g. 256 for NES / Game Boy) */
  maxTiles?: number
  /** Maximum total colours on screen */
  maxColours?: number
  /** Allowed emulator file formats for export */
  emulatorFormats?: readonly ('scr' | 'koa' | 'chr')[]
}

export interface Profile {
  id: string
  name: string
  /** Who made it and when, shown on the card. */
  origin: string
  /** One plain sentence about the look. */
  about: string
  width: number
  /** 'auto' follows the picture (the receipt printer's paper is endless). */
  height: number | 'auto'
  /** Pixel width : height as shown on its screen. */
  par: readonly [number, number]
  palette: PaletteSpec
  limits?: HardwareLimits
  /** One line under the export buttons, e.g. why a file type is missing. */
  exportNote?: string
  /**
   * Grey levels: the picture is turned to grey and spread over the levels,
   * darkest to lightest, whatever their tint (the Game Boy's greens).
   */
  mono?: boolean
  dither: DitherId
  /** A dither only this machine has, offered in the list when it's picked. */
  nativeDither?: DitherId
  /** Edge sharpening before dithering (the Game Boy Camera does this). */
  edgeBoost?: number
  /** The screen effect that suits it. */
  screen: 'crt' | 'lcd' | 'vhs' | 'off'
}

const EGA = [
  '#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
  '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff'
]

const C64 = [
  '#000000', '#ffffff', '#813338', '#75cec8', '#8e3c97', '#56ac4d', '#2e2c9b', '#edf171',
  '#8e5029', '#553800', '#c46c71', '#4a4a4a', '#7b7b7b', '#a9ff9f', '#706deb', '#b2b2b2'
]

// The NES's 64 entries less the repeated blacks (55 colours).
const NES = [
  '#7c7c7c', '#0000fc', '#0000bc', '#4428bc', '#940084', '#a80020', '#a81000', '#881400',
  '#503000', '#007800', '#006800', '#005800', '#004058', '#000000',
  '#bcbcbc', '#0078f8', '#0058f8', '#6844fc', '#d800cc', '#e40058', '#f83800', '#e45c10',
  '#ac7c00', '#00b800', '#00a800', '#00a844', '#008888',
  '#f8f8f8', '#3cbcfc', '#6888fc', '#9878f8', '#f878f8', '#f85898', '#f87858', '#fca044',
  '#f8b800', '#b8f818', '#58d854', '#58f898', '#00e8d8', '#787878',
  '#fcfcfc', '#a4e4fc', '#b8b8f8', '#d8b8f8', '#f8b8f8', '#f8a4c0', '#f0d0b0', '#fce0a8',
  '#f8d878', '#d8f878', '#b8f8b8', '#b8f8d8', '#00fcfc', '#f8d8f8'
]

const PICO8 = [
  '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
  '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'
]

// 16 hues × 8 brightness steps, NTSC.
const ATARI_2600 = [
  '#000000', '#4a4a4a', '#6f6f6f', '#8e8e8e', '#aaaaaa', '#c0c0c0', '#d6d6d6', '#ececec',
  '#484800', '#69690f', '#86861d', '#a2a22a', '#bbbb35', '#d2d240', '#e8e84a', '#fcfc54',
  '#7c2c00', '#904811', '#a26221', '#b47a30', '#c3903d', '#d2a44a', '#dfb755', '#ecc860',
  '#901c00', '#a33915', '#b55328', '#c66c3a', '#d5824a', '#e39759', '#f0aa67', '#fcbc74',
  '#940000', '#a71a1a', '#b83232', '#c84848', '#d65c5c', '#e46f6f', '#f08080', '#fc9090',
  '#840064', '#97197a', '#a8308f', '#b846a2', '#c659b3', '#d46cc3', '#e07cd2', '#ec8ce0',
  '#500084', '#68199a', '#7d30ad', '#9246c0', '#a459d0', '#b56ce0', '#c57cee', '#d48cfc',
  '#140090', '#331aa3', '#4e32b5', '#6848c6', '#7f5cd5', '#956fe3', '#a980f0', '#bc90fc',
  '#000094', '#181aa7', '#2d32b8', '#4248c8', '#545cd6', '#656fe4', '#7580f0', '#8490fc',
  '#001c88', '#183b9d', '#2d57b0', '#4272c2', '#548ad2', '#65a0e1', '#75b5ef', '#84c8fc',
  '#003064', '#185080', '#2d6d98', '#4288b0', '#54a0c5', '#65b7d9', '#75cceb', '#84e0fc',
  '#004030', '#18624e', '#2d8169', '#429e82', '#54b899', '#65d1ae', '#75e7c2', '#84fcd4',
  '#004400', '#1a661a', '#32842e', '#48a048', '#5cba5c', '#6fd26f', '#80e880', '#90fc90',
  '#143c00', '#355f18', '#527e2d', '#6e9c42', '#87b754', '#9ed065', '#b4e775', '#c8fc84',
  '#303800', '#505916', '#6d762b', '#88923e', '#a0ab4f', '#b7c25f', '#ccd86e', '#e0ec7c',
  '#482c00', '#694d14', '#866a26', '#a28638', '#bb9f47', '#d2b656', '#e8cc63', '#fce070'
]

// Lo-res colours 5 and 10 are the same grey, so 15 entries.
const APPLE_II = [
  '#000000', '#e31e60', '#604ebd', '#ff44fd', '#00a360', '#9c9c9c', '#14cffd', '#d0c3ff',
  '#607203', '#ff6a3c', '#ffa0d0', '#14f53c', '#d0dd8d', '#72ffd0', '#ffffff'
]

function webSafe(): string[] {
  const steps = ['00', '33', '66', '99', 'cc', 'ff']
  const out: string[] = []
  for (const r of steps) for (const g of steps) for (const b of steps) out.push(`#${r}${g}${b}`)
  return out
}

const fixed = (colours: readonly string[]): FixedPalette => ({ kind: 'fixed', colours })

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (0 <= h && h < 60) [r, g, b] = [c, x, 0]
  else if (60 <= h && h < 120) [r, g, b] = [x, c, 0]
  else if (120 <= h && h < 180) [r, g, b] = [0, c, x]
  else if (180 <= h && h < 240) [r, g, b] = [0, x, c]
  else if (240 <= h && h < 300) [r, g, b] = [x, 0, c]
  else if (300 <= h && h < 360) [r, g, b] = [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

export function representativePalette(spec: PaletteSpec): string[] {
  if (spec.kind === 'fixed') return [...spec.colours]
  if (spec.kind === 'cell') return [...spec.colours]
  if (spec.kind === 'ham') {
    const out: string[] = []
    for (let i = 0; i < 16; i++) {
      const [r8, g8, b8] = hslToRgb(i * (360 / 16), 0.8, 0.5)
      out.push(rgbToHex(snapToBits(r8, 4), snapToBits(g8, 4), snapToBits(b8, 4)))
    }
    return out
  }
  if (spec.kind === 'n64') {
    const out: string[] = []
    for (let i = 0; i < 32; i++) {
      const [r8, g8, b8] = hslToRgb(i * (360 / 32), 0.75, 0.5)
      out.push(rgbToHex(snapToBits(r8, 5), snapToBits(g8, 5), snapToBits(b8, 5)))
    }
    return out
  }
  if (spec.kind === 'range') {
    const bits = spec.bitsPerChannel
    const count = Math.min(256, Math.max(1, spec.count))
    const out: string[] = []
    const step = 360 / count
    for (let i = 0; i < count; i++) {
      const hue = i * step
      const sat = 0.85
      const light = 0.2 + (0.6 * ((i % 8) + 1)) / 8
      const [r8, g8, b8] = hslToRgb(hue, sat, light)
      out.push(rgbToHex(snapToBits(r8, bits), snapToBits(g8, bits), snapToBits(b8, bits)))
    }
    return out
  }
  if (spec.kind === 'direct') {
    const out: string[] = []
    for (let i = 0; i < 32; i++) {
      const [r8, g8, b8] = hslToRgb(i * (360 / 32), 0.8, 0.5)
      out.push(rgbToHex(snapToBits(r8, spec.bitsPerChannel), snapToBits(g8, spec.bitsPerChannel), snapToBits(b8, spec.bitsPerChannel)))
    }
    return out
  }
  if (spec.kind === 'analog') {
    if (spec.mode === 'fax') return ['#ffffff', '#000000']
    if (spec.mode === 'risograph') return ['#fbf9f4', '#ff48b0', '#00838a', '#20124d']
    if (spec.mode === 'newspaper') return ['#f2ede4', '#009ee0', '#e5007d', '#ffe600', '#1a171b']
    if (spec.mode === 'deepfry') {
      return ['#000000', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ffffff']
    }
    const out: string[] = []
    for (let i = 0; i < 32; i++) {
      const [r8, g8, b8] = hslToRgb(i * (360 / 32), 0.8, 0.5)
      out.push(rgbToHex(r8, g8, b8))
    }
    return out
  }
  if (spec.kind === 'pool') {
    const step = spec.pool.length / spec.count
    const out: string[] = []
    for (let i = 0; i < spec.count; i++) {
      out.push(spec.pool[Math.floor(i * step)])
    }
    return out
  }
  // Custom
  return [
    '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
    '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffffff'
  ]
}

export const AMSTRAD_CPC_PALETTE: readonly string[] = [
  '#000000', '#000080', '#0000ff', '#008000', '#008080', '#0080ff', '#00ff00', '#00ff80', '#00ffff',
  '#800000', '#800080', '#8000ff', '#808000', '#808080', '#8080ff', '#80ff00', '#80ff80', '#80ffff',
  '#ff0000', '#ff0080', '#ff00ff', '#ff8000', '#ff8080', '#ff80ff', '#ffff00', '#ffff80', '#ffffff'
]

export const CGA_COMPOSITE_PALETTE: readonly string[] = [
  '#000000', '#1e3b60', '#2e581e', '#3e766e',
  '#70281e', '#5e585e', '#7e761e', '#9e987e',
  '#5e287e', '#4e58be', '#7e764e', '#6e98be',
  '#be383e', '#be589e', '#ce983e', '#ffffff'
]

export const PROFILES: readonly Profile[] = [
  {
    id: 'gameboy',
    name: 'Game Boy',
    origin: 'Nintendo · 1989',
    about: 'Four shades of green on a 160×144 screen.',
    width: 160,
    height: 144,
    par: [1, 1],
    palette: fixed(['#081820', '#346856', '#88c070', '#e0f8d0']),
    limits: { maxTiles: 256, maxColours: 4, emulatorFormats: ['chr'] },
    mono: true,
    dither: 'bayer4',
    screen: 'lcd'
  },
  {
    id: 'gameboy-pocket',
    name: 'Game Boy Pocket',
    origin: 'Nintendo · 1996',
    about: 'The sharper grey screen, still four shades.',
    width: 160,
    height: 144,
    par: [1, 1],
    palette: fixed(['#1f1f1f', '#4d533c', '#8b956d', '#c4cfa1']),
    limits: { maxTiles: 256, maxColours: 4, emulatorFormats: ['chr'] },
    mono: true,
    dither: 'floyd',
    screen: 'lcd'
  },
  {
    id: 'gameboy-camera',
    name: 'Game Boy Camera',
    origin: 'Nintendo · 1998',
    about: '128×112, four greys, sharpened edges and its own dither pattern.',
    width: 128,
    height: 112,
    par: [1, 1],
    palette: fixed(['#000000', '#555555', '#aaaaaa', '#ffffff']),
    limits: { maxTiles: 224, maxColours: 4, emulatorFormats: ['chr'] },
    mono: true,
    dither: 'gbcam',
    nativeDither: 'gbcam',
    edgeBoost: 0.6,
    screen: 'lcd'
  },
  {
    id: 'cga-1',
    name: 'CGA palette 1',
    origin: 'IBM PC · 1981',
    about: 'The 320×200 mode: black, cyan, magenta and white, in tall pixels.',
    width: 320,
    height: 200,
    par: [5, 6],
    palette: fixed(['#000000', '#55ffff', '#ff55ff', '#ffffff']),
    dither: 'bayer4',
    screen: 'crt'
  },
  {
    id: 'cga-0',
    name: 'CGA palette 0',
    origin: 'IBM PC · 1981',
    about: 'The other 320×200 palette: green, red and yellow.',
    width: 320,
    height: 200,
    par: [5, 6],
    palette: fixed(['#000000', '#55ff55', '#ff5555', '#ffff55']),
    dither: 'bayer4',
    screen: 'crt'
  },
  {
    id: 'ega',
    name: 'EGA',
    origin: 'IBM PC · 1984',
    about: 'Sixteen colours at 320×200: early DOS games.',
    width: 320,
    height: 200,
    par: [5, 6],
    palette: fixed(EGA),
    dither: 'floyd',
    screen: 'crt'
  },
  {
    id: 'c64-hires',
    name: 'C64 hi-res',
    origin: 'Commodore · 1982',
    about: 'The C64’s sixteen muted colours at 320×200.',
    width: 320,
    height: 200,
    par: [15, 16],
    palette: fixed(C64),
    limits: { maxTiles: 256, maxColours: 16 },
    dither: 'floyd',
    screen: 'crt'
  },
  {
    id: 'c64-mc',
    name: 'C64 multicolour',
    origin: 'Commodore · 1982',
    about: '160×200 wide pixels with 4×8 double cells: 1 shared backdrop and 3 cell colours.',
    width: 160,
    height: 200,
    par: [15, 8],
    palette: { kind: 'cell', mode: 'c64-mc', colours: C64_PALETTE },
    limits: { maxTiles: 256, maxColours: 16, emulatorFormats: ['koa'] },
    dither: 'none',
    screen: 'crt'
  },
  {
    id: 'zx-spectrum',
    name: 'ZX Spectrum',
    origin: 'Sinclair · 1982',
    about: '256×192 with 8×8 cell attribute clash: 1 ink and 1 paper colour per cell.',
    width: 256,
    height: 192,
    par: [1, 1],
    palette: { kind: 'cell', mode: 'spectrum', colours: SPECTRUM_PALETTE },
    limits: { maxTiles: 768, maxColours: 15, emulatorFormats: ['scr'] },
    dither: 'none',
    screen: 'crt'
  },
  {
    id: 'nes',
    name: 'NES',
    origin: 'Nintendo · 1983',
    about: 'The full NES colour set at 256×240, pixels a little wide.',
    width: 256,
    height: 240,
    par: [8, 7],
    palette: fixed(NES),
    // No .chr: this look puts any NES colour on any pixel, which NES tiles
    // (4 colours per 16×16 area) can't hold.
    limits: { maxTiles: 256, maxColours: 25 },
    exportNote: "No .chr here: this look uses any colour anywhere, which a real NES can't show. NES (attributes) makes one.",
    dither: 'floyd',
    screen: 'crt'
  },
  {
    id: 'nes-attr',
    name: 'NES attributes',
    origin: 'Nintendo · 1983',
    about: '256×240 with 16×16 attribute blocks: 4 hardware sub-palettes + 1 backdrop.',
    width: 256,
    height: 240,
    par: [8, 7],
    palette: { kind: 'cell', mode: 'nes-attr', colours: NES_PALETTE },
    limits: { maxTiles: 256, maxColours: 25, emulatorFormats: ['chr'] },
    dither: 'none',
    screen: 'crt'
  },
  {
    id: 'pico8',
    name: 'PICO-8',
    origin: 'Lexaloffle · 2015',
    about: 'The fantasy console: 128×128, sixteen colours.',
    width: 128,
    height: 128,
    par: [1, 1],
    palette: fixed(PICO8),
    limits: { maxTiles: 256, maxColours: 16 },
    dither: 'floyd',
    screen: 'crt'
  },
  {
    id: 'atari-2600',
    name: 'Atari 2600',
    origin: 'Atari · 1977',
    about: '128 NTSC colours at 160×192, pixels almost twice as wide as tall.',
    width: 160,
    height: 192,
    par: [12, 7],
    palette: fixed(ATARI_2600),
    dither: 'none',
    screen: 'crt'
  },
  {
    id: 'apple2-lores',
    name: 'Apple II lo-res',
    origin: 'Apple · 1977',
    about: '40×48 blocks of sixteen colours.',
    width: 40,
    height: 48,
    par: [8, 5],
    palette: fixed(APPLE_II),
    limits: { maxColours: 16 },
    dither: 'none',
    screen: 'crt'
  },
  {
    id: 'apple2-hires',
    name: 'Apple II hi-res',
    origin: 'Apple · 1977',
    about: '280×192 with 7-pixel byte rule: high bit selects Green/Violet or Orange/Blue.',
    width: 280,
    height: 192,
    par: [6, 7],
    palette: { kind: 'cell', mode: 'apple2-hires', colours: APPLE2_HIRES_PALETTE },
    limits: { maxColours: 6 },
    dither: 'none',
    screen: 'crt'
  },
  {
    id: 'mac',
    name: 'Mac 1-bit',
    origin: 'Apple · 1984',
    about: 'Black and white at 512×342: the MacPaint look.',
    width: 512,
    height: 342,
    par: [1, 1],
    palette: fixed(['#000000', '#ffffff']),
    mono: true,
    dither: 'atkinson',
    screen: 'crt'
  },
  {
    id: 'web-safe',
    name: 'Web-safe 216',
    origin: 'Windows 95 era · 1996',
    about: 'The 216 colours every 90s browser agreed on, at 640×480.',
    width: 640,
    height: 480,
    par: [1, 1],
    palette: fixed(webSafe()),
    limits: { maxColours: 216 },
    dither: 'bayer4',
    screen: 'crt'
  },
  {
    id: 'receipt',
    name: 'Receipt printer',
    origin: 'Thermal · 58 mm',
    about: 'Black dots on a 384-dot strip of paper.',
    width: 384,
    height: 'auto',
    par: [1, 1],
    palette: fixed(['#232323', '#f3f0e8']),
    mono: true,
    dither: 'floyd',
    screen: 'lcd'
  },
  {
    id: 'b0r3d',
    name: 'b0r3d',
    origin: 'b0r3d.org',
    about: 'Cyan, magenta and mint on near-black.',
    width: 320,
    height: 240,
    par: [1, 1],
    palette: fixed(['#131313', '#00ffff', '#ff00ff', '#00ff9d']),
    dither: 'bayer4',
    screen: 'crt'
  },
  {
    id: 'amiga-ham6',
    name: 'Amiga HAM6',
    origin: 'Commodore · 1985',
    about: '320×200 Hold-And-Modify: 16 base palette colours with horizontal channel hold-and-modify fringing.',
    width: 320,
    height: 200,
    par: [5, 6],
    palette: { kind: 'ham', mode: 'ham6', bitsPerChannel: 4 },
    limits: { maxColours: 4096 },
    dither: 'none',
    screen: 'crt'
  },
  {
    id: 'snes',
    name: 'Super Nintendo',
    origin: 'Nintendo · 1990',
    about: '32,768-colour range (5 bits per channel), 256 on screen at 256×224.',
    width: 256,
    height: 224,
    par: [8, 7],
    palette: { kind: 'range', bitsPerChannel: 5, count: 256 },
    limits: { maxTiles: 1024, maxColours: 256 },
    dither: 'floyd',
    screen: 'crt'
  },
  {
    id: 'genesis',
    name: 'Sega Genesis',
    origin: 'Sega · 1988',
    about: '512-colour range (3 bits per channel), 61 on screen at 320×224.',
    width: 320,
    height: 224,
    par: [10, 11],
    palette: { kind: 'range', bitsPerChannel: 3, count: 61 },
    limits: { maxTiles: 2048, maxColours: 64 },
    dither: 'floyd',
    screen: 'crt'
  },
  {
    id: 'mastersystem',
    name: 'Master System',
    origin: 'Sega · 1985',
    about: '64-colour range (2 bits per channel), 32 on screen at 256×192.',
    width: 256,
    height: 192,
    par: [8, 7],
    palette: { kind: 'range', bitsPerChannel: 2, count: 32 },
    limits: { maxTiles: 512, maxColours: 32 },
    dither: 'floyd',
    screen: 'crt'
  },
  {
    id: 'pc98',
    name: 'PC-9801',
    origin: 'NEC · 1982',
    about: '16 colours picked from 4,096 (4 bits per channel) at 640×400.',
    width: 640,
    height: 400,
    par: [1, 1],
    palette: { kind: 'range', bitsPerChannel: 4, count: 16 },
    limits: { maxColours: 16 },
    dither: 'bayer4',
    screen: 'crt'
  },
  {
    id: 'vga',
    name: 'VGA 256',
    origin: 'IBM · 1987',
    about: '256 colours from 262,144 (6 bits per channel) at 320×200.',
    width: 320,
    height: 200,
    par: [5, 6],
    palette: { kind: 'range', bitsPerChannel: 6, count: 256 },
    limits: { maxColours: 256 },
    dither: 'none',
    screen: 'crt'
  },
  {
    id: 'ps1',
    name: 'PlayStation',
    origin: 'Sony · 1994',
    about: '15-bit colour with the GPU’s hardware dither table at 320×240.',
    width: 320,
    height: 240,
    par: [1, 1],
    palette: { kind: 'direct', bitsPerChannel: 5 },
    dither: 'ps1',
    nativeDither: 'ps1',
    screen: 'crt'
  },
  {
    id: 'n64',
    name: 'Nintendo 64',
    origin: 'Nintendo · 1996',
    about: '320×240 at 16-bit colour with RDP 3-point sample filter and VI anti-aliasing blur.',
    width: 320,
    height: 240,
    par: [1, 1],
    palette: { kind: 'n64', blur: true },
    limits: { maxColours: 32768 },
    dither: 'none',
    screen: 'crt'
  },
  {
    id: 'vhs',
    name: 'VHS Tape',
    origin: 'JVC · 1976',
    about: 'Analog magnetic tape, 240 lines, horizontal chroma smear and tracking noise.',
    width: 320,
    height: 240,
    par: [10, 11],
    palette: { kind: 'range', bitsPerChannel: 6, count: 256 },
    limits: { maxColours: 256 },
    dither: 'none',
    screen: 'vhs'
  },
  {
    id: 'ccd-early',
    name: 'Early CCD Camera',
    origin: 'VGA Digital · 1998',
    about: '640×480 sensor, CCD photon noise, and burnt-orange digital date stamp.',
    width: 640,
    height: 480,
    par: [1, 1],
    palette: { kind: 'analog', mode: 'ccd' },
    dither: 'none',
    screen: 'off'
  },
  {
    id: 'deepfry',
    name: 'JPEG Deep Fry',
    origin: 'IJG JPEG · 1992',
    about: '8×8 DCT block quantization crunch, high-frequency ringing, and hyper-saturated contrast.',
    width: 480,
    height: 360,
    par: [1, 1],
    palette: { kind: 'analog', mode: 'deepfry' },
    dither: 'none',
    screen: 'off'
  },
  {
    id: 'newspaper',
    name: 'Newspaper Halftone',
    origin: 'Rotary Press · 1890',
    about: 'CMYK angled screen rosettes (15°, 75°, 0°, 45°) on unbleached newsprint.',
    width: 400,
    height: 500,
    par: [1, 1],
    palette: { kind: 'analog', mode: 'newspaper' },
    dither: 'none',
    screen: 'off'
  },
  {
    id: 'risograph',
    name: 'Two-Ink Risograph',
    origin: 'Riso Kagaku · 1980',
    about: 'Dual spot-color ink layering (Fluo Pink & Teal) with mechanical drum misregistration.',
    width: 400,
    height: 500,
    par: [1, 1],
    palette: { kind: 'analog', mode: 'risograph' },
    dither: 'none',
    screen: 'off'
  },
  {
    id: 'fax',
    name: '1-Bit Fax Machine',
    origin: 'ITU-T Group 3 · 1980',
    about: 'High-contrast 1-bit thermal print with paper feed streaks and transmission header.',
    width: 408,
    height: 392,
    par: [1, 1],
    palette: { kind: 'analog', mode: 'fax' },
    dither: 'floyd',
    screen: 'off'
  },
  {
    id: 'nokia-3310',
    name: 'Nokia 3310',
    origin: 'Nokia · 2000',
    about: '84×48 monochrome graphics on a green reflective backlight LCD.',
    width: 84,
    height: 48,
    par: [1, 1],
    palette: fixed(['#1c281a', '#879b6f']),
    mono: true,
    dither: 'bayer4',
    screen: 'lcd'
  },
  {
    id: 'gbc',
    name: 'Game Boy Color',
    origin: 'Nintendo · 1998',
    about: '160×144 with 8 background palettes of 4 colours (32 max) from 32,768.',
    width: 160,
    height: 144,
    par: [1, 1],
    palette: { kind: 'cell', mode: 'gbc-tile', colours: GBC_REPRESENTATIVE_PALETTE },
    limits: { maxTiles: 360, maxColours: 32, emulatorFormats: ['chr'] },
    dither: 'bayer4',
    screen: 'lcd'
  },
  {
    id: 'virtualboy',
    name: 'Virtual Boy',
    origin: 'Nintendo · 1995',
    about: '384×224 red linear array LEDs reflected by oscillating scanning mirrors.',
    width: 384,
    height: 224,
    par: [1, 1],
    palette: fixed(['#000000', '#460000', '#8c0000', '#ff0000']),
    mono: true,
    dither: 'bayer4',
    screen: 'crt'
  },
  {
    id: 'atari-st',
    name: 'Atari ST',
    origin: 'Atari · 1985',
    about: '16 colours picked from 512 (3 bits per channel) at 320×200.',
    width: 320,
    height: 200,
    par: [5, 6],
    palette: { kind: 'range', bitsPerChannel: 3, count: 16 },
    limits: { maxColours: 16 },
    dither: 'floyd',
    screen: 'crt'
  },
  {
    id: 'amstrad-cpc-0',
    name: 'Amstrad CPC (Mode 0)',
    origin: 'Amstrad · 1984',
    about: '160×200 with 16 colours picked from 27, 2:1 wide pixels.',
    width: 160,
    height: 200,
    par: [2, 1],
    palette: { kind: 'pool', pool: AMSTRAD_CPC_PALETTE, count: 16 },
    limits: { maxColours: 16 },
    dither: 'floyd',
    screen: 'crt'
  },
  {
    id: 'amstrad-cpc-1',
    name: 'Amstrad CPC (Mode 1)',
    origin: 'Amstrad · 1984',
    about: '320×200 with 4 colours picked from 27.',
    width: 320,
    height: 200,
    par: [1, 1],
    palette: { kind: 'pool', pool: AMSTRAD_CPC_PALETTE, count: 4 },
    limits: { maxColours: 4 },
    dither: 'floyd',
    screen: 'crt'
  },
  {
    id: 'msx-screen2',
    name: 'MSX (Screen 2)',
    origin: 'ASCII / Microsoft · 1983',
    about: '256×192 with TMS9918: 2 colours per 8×1 horizontal pixel slice from 15.',
    width: 256,
    height: 192,
    par: [8, 7],
    palette: { kind: 'cell', mode: 'msx-screen2', colours: TMS9918_PALETTE },
    limits: { maxColours: 15 },
    dither: 'none',
    screen: 'crt'
  },
  {
    id: 'cga-composite',
    name: 'CGA Composite',
    origin: 'IBM · 1981',
    about: '16 colours produced by NTSC composite color burst subcarrier crosstalk.',
    width: 320,
    height: 200,
    par: [5, 6],
    palette: fixed(CGA_COMPOSITE_PALETTE),
    limits: { maxColours: 16 },
    dither: 'floyd',
    screen: 'crt'
  },
  {
    id: 'custom',
    name: 'Custom palette',
    origin: 'User custom',
    about: 'Quantized to N colours or loaded from a palette file.',
    width: 320,
    height: 240,
    par: [1, 1],
    palette: { kind: 'custom', count: 16 },
    dither: 'floyd',
    screen: 'crt'
  }
]

export const DEFAULT_PROFILE = 'gameboy'

export function profileById(id: string): Profile | undefined {
  return PROFILES.find((p) => p.id === id)
}
