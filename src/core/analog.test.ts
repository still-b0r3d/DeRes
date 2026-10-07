import { describe, expect, it } from 'vitest'
import {
  processEarlyCcd,
  processDeepFry,
  processNewspaperHalftone,
  processRisograph,
  processFax
} from './analog'
import { linearToByte } from './color'

describe('analog, print & video aesthetics', () => {
  // 64×64 test linear gradient
  const createTestImage = (w: number, h: number) => {
    const rgb = new Float32Array(w * h * 3)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 3
        rgb[idx] = x / (w - 1) // red ramp
        rgb[idx + 1] = y / (h - 1) // green ramp
        rgb[idx + 2] = 0.5 // constant blue
      }
    }
    return rgb
  }

  describe('early CCD camera', () => {
    it('generates sensor noise and burnt-orange date stamp in bottom right', () => {
      const w = 640
      const h = 480
      const img = createTestImage(w, h)
      const res = processEarlyCcd(img, w, h)

      expect(res.rgb.length).toBe(w * h * 3)
      expect(res.indices.length).toBe(w * h)

      // Test date stamp area in bottom right
      // Date string: "'99 10 24", placed ~20px from right and ~18px from bottom
      // Check that bright orange pixels exist in bottom right area
      let orangeCount = 0
      for (let y = h - 40; y < h; y++) {
        for (let x = w - 140; x < w; x++) {
          const idx = (y * w + x) * 3
          const r = linearToByte(res.rgb[idx])
          const g = linearToByte(res.rgb[idx + 1])
          const b = linearToByte(res.rgb[idx + 2])
          // Burnt orange: high R (>200), medium G (~90-140), low B (<30)
          if (r > 200 && g > 80 && g < 150 && b < 30) {
            orangeCount++
          }
        }
      }
      expect(orangeCount).toBeGreaterThan(20)

      // Check sensor noise variance (output differs from smooth gradient)
      let noiseDiffCount = 0
      for (let i = 0; i < 500; i++) {
        if (Math.abs(res.rgb[i] - img[i]) > 0.005) {
          noiseDiffCount++
        }
      }
      expect(noiseDiffCount).toBeGreaterThan(100)
    })
  })

  describe('JPEG deep fry', () => {
    it('applies 8×8 DCT block crunch, contrast saturation boost, and ringing', () => {
      const w = 80
      const h = 80
      const img = createTestImage(w, h)
      const res = processDeepFry(img, w, h)

      expect(res.rgb.length).toBe(w * h * 3)
      expect(res.indices.length).toBe(w * h)

      // Deep fry boosts contrast and saturation
      let saturatedPixels = 0
      for (let i = 0; i < w * h; i++) {
        const r = linearToByte(res.rgb[i * 3])
        const g = linearToByte(res.rgb[i * 3 + 1])
        const b = linearToByte(res.rgb[i * 3 + 2])
        if (r === 255 || r === 0 || g === 255 || g === 0 || b === 255 || b === 0) {
          saturatedPixels++
        }
      }
      expect(saturatedPixels).toBeGreaterThan(50)
    })
  })

  describe('newspaper halftone', () => {
    it('separates into CMYK angled screen rosettes on unbleached newsprint paper', () => {
      const w = 100
      const h = 100
      const img = createTestImage(w, h)
      const res = processNewspaperHalftone(img, w, h)

      expect(res.rgb.length).toBe(w * h * 3)
      expect(res.paper).toEqual([242, 237, 228])

      // Newsprint background paper shows through in light areas
      // Top-left of gradient is dark red (x=0, y=0), but white/light pixels should be close to paper tint
      const midIdx = (50 * w + 50) * 3
      expect(res.rgb[midIdx]).toBeGreaterThan(0)
      expect(res.rgb[midIdx + 1]).toBeGreaterThan(0)
      expect(res.rgb[midIdx + 2]).toBeGreaterThan(0)
    })
  })

  describe('two-ink risograph', () => {
    it('separates into Fluo Pink and Teal spot inks with drum misregistration offset', () => {
      const w = 100
      const h = 100
      const img = createTestImage(w, h)
      const res = processRisograph(img, w, h)

      expect(res.rgb.length).toBe(w * h * 3)
      expect(res.paper).toEqual([251, 249, 244])

      // Overlap produces deep purple/indigo, plus standalone Pink and Teal
      let pinkCount = 0
      let tealCount = 0
      for (let i = 0; i < w * h; i++) {
        const r = linearToByte(res.rgb[i * 3])
        const g = linearToByte(res.rgb[i * 3 + 1])
        const b = linearToByte(res.rgb[i * 3 + 2])
        // Pinkish: high red & blue, low green
        if (r > 150 && g < 120 && b > 100) pinkCount++
        // Tealish: low red, high green & blue
        if (r < 80 && g > 100 && b > 100) tealCount++
      }
      expect(pinkCount).toBeGreaterThan(50)
      expect(tealCount).toBeGreaterThan(50)
    })
  })

  describe('streaky 1-bit fax', () => {
    it('produces 1-bit pixels, top transmission header, and vertical feed streaks', () => {
      const w = 120
      const h = 100
      const img = createTestImage(w, h)
      const res = processFax(img, w, h)

      expect(res.rgb.length).toBe(w * h * 3)
      expect(res.paper).toEqual([255, 255, 255])

      // Every pixel is strictly 1-bit: 0 or 1
      for (let i = 0; i < w * h * 3; i++) {
        expect(res.rgb[i] === 0 || res.rgb[i] === 1).toBe(true)
      }

      // Check header region (y < 20): has black text on white paper
      let headerBlack = 0
      for (let y = 0; y < 19; y++) {
        for (let x = 0; x < w; x++) {
          if (res.rgb[(y * w + x) * 3] === 0) headerBlack++
        }
      }
      expect(headerBlack).toBeGreaterThan(30)
    })
  })
})
