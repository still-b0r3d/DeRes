import type { DitherId } from './dither'

// Hardware profiles. A profile is a machine's whole look, not just its
// colours: its native resolution, the shape of its pixels on a TV, its
// palette, and the dither and screen it suits.
//
// v0.1 has the fixed-palette machines. Later stages add palettes picked from
// a range (a quantizer snapping to the machine's bits per channel) and
// per-cell colour limits (ZX Spectrum, C64 multicolour, NES attributes).
// No palette below is official: these machines put out analogue video, so
// every emulator's numbers differ. Sources are listed in the README.

export interface FixedPalette {
  kind: 'fixed'
  colours: readonly string[]
}

export type PaletteSpec = FixedPalette

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
  screen: 'crt' | 'lcd'
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
    dither: 'floyd',
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
    dither: 'floyd',
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
  }
]

export const DEFAULT_PROFILE = 'gameboy'

export function profileById(id: string): Profile | undefined {
  return PROFILES.find((p) => p.id === id)
}
