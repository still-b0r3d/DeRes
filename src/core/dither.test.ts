import { describe, expect, it } from 'vitest'
import { bayerMatrix } from './bayer'
import { BYTE_TO_LINEAR, hexToRgb, srgbToLinear } from './color'
import { dither, DITHERS, type DitherId } from './dither'
import { PaletteMatcher } from './matcher'
import { YliluomaPlanner } from './yliluoma'

const bytes = (hexes: string[]) => Uint8Array.from(hexes.flatMap(hexToRgb))
const BW = bytes(['#000000', '#ffffff'])
const GREYS = bytes(['#000000', '#555555', '#aaaaaa', '#ffffff'])
const CGA1 = bytes(['#000000', '#55ffff', '#ff55ff', '#ffffff'])

/** A w×h linear-light image from a function returning sRGB bytes. */
function image(w: number, h: number, f: (x: number, y: number) => [number, number, number]): Float32Array {
  const rgb = new Float32Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = f(x, y)
      rgb.set([BYTE_TO_LINEAR[r], BYTE_TO_LINEAR[g], BYTE_TO_LINEAR[b]], (y * w + x) * 3)
    }
  }
  return rgb
}

/** Grey ramp, left to right, with a colour tint growing down the rows. */
const RAMP = image(16, 8, (x, y) => {
  const v = Math.round((x / 15) * 255)
  return [v, Math.max(0, v - y * 16), Math.min(255, v + y * 8)]
})

function run(id: DitherId, palette: Uint8Array, rgb: Float32Array, w: number, h: number, mono = false): Uint8Array {
  const matcher = new PaletteMatcher(palette)
  let planner: YliluomaPlanner | null = null
  const out = new Uint8Array(w * h)
  dither(id, { rgb, width: w, height: h, matcher, mono, planner: () => (planner ??= new YliluomaPlanner(matcher)) }, out)
  return out
}

const rows = (out: Uint8Array, w: number) =>
  Array.from({ length: out.length / w }, (_, y) =>
    Array.from(out.subarray(y * w, (y + 1) * w), (v) => v.toString(16)).join('')
  ).join('\n')

const greyImage = (w: number, h: number, linear: number) => {
  const rgb = new Float32Array(w * h * 3)
  rgb.fill(linear)
  return rgb
}

const share = (out: Uint8Array, index: number) => out.filter((v) => v === index).length / out.length

describe('Bayer matrices', () => {
  it('starts from the classic 2×2', () => {
    expect([...bayerMatrix(2)]).toEqual([0, 2, 3, 1])
  })

  it.each([2, 4, 8, 16])('%i×%i holds every threshold once', (n) => {
    expect([...bayerMatrix(n)].sort((a, b) => a - b)).toEqual([...Array(n * n).keys()])
  })

  it('refuses sizes that are not powers of two', () => {
    expect(() => bayerMatrix(3)).toThrow()
  })
})

describe('every dither', () => {
  const ids = DITHERS.map((d) => d.id)

  it.each(ids)('%s is deterministic and stays in the palette', (id) => {
    const a = run(id, CGA1, RAMP, 16, 8)
    const b = run(id, CGA1, RAMP, 16, 8)
    expect(a).toEqual(b)
    expect(Math.max(...a)).toBeLessThan(4)
  })

  it.each(ids)('%s leaves an exact palette colour alone', (id) => {
    const rgb = image(8, 8, () => [0x55, 0xff, 0xff])
    const out = run(id, CGA1, rgb, 8, 8)
    expect(new Set(out)).toEqual(new Set([1]))
  })

  it('does not modify its input', () => {
    const copy = Float32Array.from(RAMP)
    run('floyd', CGA1, RAMP, 16, 8)
    run('atkinson', CGA1, RAMP, 16, 8)
    expect(RAMP).toEqual(copy)
  })
})

describe('fixed outputs (16×8 ramp, CGA palette 1)', () => {
  it('none', () => {
    expect(rows(run('none', CGA1, RAMP, 16, 8), 16)).toMatchInlineSnapshot(`
      "0000022221113333
      0000022222213333
      0000002222222333
      0000002222222233
      0000002222222223
      0000002222222222
      0000022222222222
      0000022222222222"
    `)
  })
  it('Bayer 4×4', () => {
    expect(rows(run('bayer4', CGA1, RAMP, 16, 8), 16)).toMatchInlineSnapshot(`
      "0002020101232313
      0020201212323233
      0000020202222323
      2020202222323233
      0000020202222223
      0020202222222232
      0000020202222222
      2020202222223232"
    `)
  })
  it('Floyd–Steinberg', () => {
    expect(rows(run('floyd', CGA1, RAMP, 16, 8), 16)).toMatchInlineSnapshot(`
      "0000202102112333
      0000000001221233
      0000202020212123
      0000000020202123
      0000202010212223
      0000000020202122
      0002020202022223
      0000000020222222"
    `)
  })
  it('Atkinson', () => {
    expect(rows(run('atkinson', CGA1, RAMP, 16, 8), 16)).toMatchInlineSnapshot(`
      "0000021021121333
      0000000022121333
      0000000210222233
      0000020000212223
      0000000222022122
      0000200002222223
      0000002002222222
      0000000220022222"
    `)
  })
  it('Yliluoma', () => {
    expect(rows(run('yliluoma', CGA1, RAMP, 16, 8), 16)).toMatchInlineSnapshot(`
      "0000000000030313
      0000002020303233
      0000000002020123
      0000202010203232
      0000000000020223
      0000002020222212
      0000000002020222
      0000200020202222"
    `)
  })
})

describe('tone (brightness is kept, in linear light)', () => {
  // 25% linear light: a quarter of the dots should be white.
  const quarter = greyImage(64, 64, 0.25)

  it.each(['floyd', 'bayer8', 'yliluoma'] as const)('%s on black and white', (id) => {
    expect(share(run(id, BW, quarter, 64, 64, true), 1)).toBeCloseTo(0.25, 1)
  })

  it('Atkinson passes on only 3/4 of the error, so it drifts', () => {
    // The big errors left by white dots are the ones cut short, so a dark
    // grey comes out lighter. That's its look; check it stays nearby.
    const s = share(run('atkinson', BW, quarter, 64, 64, true), 1)
    expect(s).toBeGreaterThan(0.25)
    expect(s).toBeLessThan(0.45)
  })

  it('ordered dithering over grey levels mixes the two levels around the pixel', () => {
    // Halfway (in linear light) between grey levels 1 and 2.
    const mid = (srgbToLinear(0x55 / 255) + srgbToLinear(0xaa / 255)) / 2
    const out = run('bayer4', GREYS, greyImage(16, 16, mid), 16, 16, true)
    expect(share(out, 1)).toBeCloseTo(0.5, 2)
    expect(share(out, 2)).toBeCloseTo(0.5, 2)
  })

  it("the Game Boy Camera's dither works in sRGB steps, so mid-grey is half and half", () => {
    const out = run('gbcam', GREYS, greyImage(16, 16, srgbToLinear(0.5)), 16, 16, true)
    expect(share(out, 1)).toBeCloseTo(0.5, 2)
    expect(share(out, 2)).toBeCloseTo(0.5, 2)
  })
})

describe('Floyd–Steinberg', () => {
  it('runs rows in alternating directions (serpentine)', () => {
    // A one-row-at-a-time scan would put the first white dot of every row
    // in the same column; serpentine scanning breaks that up.
    const out = run('floyd', BW, greyImage(32, 8, 0.3), 32, 8, true)
    const firstWhite = Array.from({ length: 8 }, (_, y) => out.subarray(y * 32, y * 32 + 32).indexOf(1))
    expect(new Set(firstWhite).size).toBeGreaterThan(1)
  })
})
