import { describe, expect, it } from 'vitest'
import { BYTE_TO_LINEAR, hexToRgb, linearToSrgb } from './color'
import { PaletteMatcher } from './matcher'
import { PLAN, planColour, YliluomaPlanner } from './yliluoma'

const bytes = (hexes: string[]) => Uint8Array.from(hexes.flatMap(hexToRgb))
const C64 = bytes([
  '#000000', '#ffffff', '#813338', '#75cec8', '#8e3c97', '#56ac4d', '#2e2c9b', '#edf171',
  '#8e5029', '#553800', '#c46c71', '#4a4a4a', '#7b7b7b', '#a9ff9f', '#706deb', '#b2b2b2'
])

describe('Yliluoma mixing plans', () => {
  const m = new PaletteMatcher(C64)
  const planner = new YliluomaPlanner(m)

  it('a palette colour is shown as only itself', () => {
    const lin = [0x75, 0xce, 0xc8].map((v) => BYTE_TO_LINEAR[v])
    for (let t = 0; t < PLAN; t++) expect(planner.pick(lin[0], lin[1], lin[2], t)).toBe(3)
    // Black and white sit exactly on cache steps, so their plans are pure too.
    expect(new Set(planner.planFor(0, 0, 0))).toEqual(new Set([0]))
    expect(new Set(planner.planFor(255, 255, 255))).toEqual(new Set([1]))
  })

  it('holds PLAN entries sorted dark to light', () => {
    const plan = planner.planFor(120, 90, 160)
    expect(plan.length).toBe(PLAN)
    for (let i = 1; i < plan.length; i++) expect(m.luma[plan[i]]).toBeGreaterThanOrEqual(m.luma[plan[i - 1]])
  })

  it("averages (in linear light) close to the colour it's for", () => {
    for (const [r, g, b] of [
      [128, 128, 128],
      [200, 120, 80],
      [60, 140, 200]
    ]) {
      const plan = planner.planFor(r, g, b)
      const avg = [0, 0, 0]
      for (const k of plan) for (let c = 0; c < 3; c++) avg[c] += m.linear[k * 3 + c] / PLAN
      const want = planColour(r, g, b)
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(linearToSrgb(avg[c]) - want[c] / 255)).toBeLessThan(0.12)
      }
    }
  })

  it('pick() uses the plan at the given threshold', () => {
    const lin = [BYTE_TO_LINEAR[128], BYTE_TO_LINEAR[128], BYTE_TO_LINEAR[128]] as const
    const plan = planner.planFor(128, 128, 128)
    for (let t = 0; t < PLAN; t++) expect(planner.pick(lin[0], lin[1], lin[2], t)).toBe(plan[t])
  })

  it('works on palettes bigger than its 16 candidates', () => {
    const cube: string[] = []
    for (const r of ['00', '33', '66', '99', 'cc', 'ff'])
      for (const g of ['00', '33', '66', '99', 'cc', 'ff']) for (const b of ['00', '33', '66', '99', 'cc', 'ff']) cube.push(`#${r}${g}${b}`)
    const big = new YliluomaPlanner(new PaletteMatcher(bytes(cube)))
    const plan = big.planFor(0x80, 0x80, 0x80)
    expect(plan.length).toBe(PLAN)
    expect(Math.max(...plan)).toBeLessThan(216)
  })
})
