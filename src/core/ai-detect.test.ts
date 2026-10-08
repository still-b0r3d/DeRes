import { describe, expect, it } from 'vitest'
import { checkC2pa, detectAiMarkers } from './ai-detect'
import { inspectMetadata } from './exif'
import { scrubPng, scrubJpeg } from './scrub'

describe('AI Marker & C2PA Detection', () => {
  it('detects C2PA caBX chunk in PNG buffers', () => {
    // 8-byte PNG signature + caBX chunk + IEND
    const pngHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const cabxPayload = [0x6a, 0x75, 0x6d, 0x62, 0x00, 0x01] // dummy C2PA JUMBF payload
    const cabxLen = cabxPayload.length
    const cabxChunk = [
      (cabxLen >> 24) & 0xff,
      (cabxLen >> 16) & 0xff,
      (cabxLen >> 8) & 0xff,
      cabxLen & 0xff,
      0x63, 0x61, 0x42, 0x58, // 'caBX'
      ...cabxPayload,
      0x00, 0x00, 0x00, 0x00 // dummy CRC
    ]
    const iendChunk = [
      0x00, 0x00, 0x00, 0x00,
      0x49, 0x45, 0x4e, 0x44,
      0xae, 0x42, 0x60, 0x82
    ]
    const png = new Uint8Array([...pngHeader, ...cabxChunk, ...iendChunk])

    const c2pa = checkC2pa(png)
    expect(c2pa.found).toBe(true)
    expect(c2pa.details).toContain('caBX')

    const report = detectAiMarkers(png)
    expect(report.detected).toBe(true)
    expect(report.tool).toContain('C2PA Content Credentials')
    expect(report.confidence).toBe('explicit')
    expect(report.synthIdNote).toContain('SynthID')
  })

  it('detects C2PA JUMBF manifest in JPEG APP11 segment', () => {
    // SOI + APP11 (0xFF 0xEB) + EOI
    const jumbPayload = Array.from(new TextEncoder().encode('jumb/c2pa manifest data goes here'))
    const segLen = 2 + jumbPayload.length
    const app11 = [
      0xff, 0xeb,
      (segLen >> 8) & 0xff,
      segLen & 0xff,
      ...jumbPayload
    ]
    const jpeg = new Uint8Array([0xff, 0xd8, ...app11, 0xff, 0xd9])

    const c2pa = checkC2pa(jpeg)
    expect(c2pa.found).toBe(true)
    expect(c2pa.details).toContain('APP11')

    const report = detectAiMarkers(jpeg)
    expect(report.detected).toBe(true)
    expect(report.tool).toContain('C2PA Content Credentials')
  })

  it('detects IPTC trainedAlgorithmicMedia in XMP / text blocks', () => {
    const xmp = '<x:xmpmeta><rdf:Description iptc4xmpExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"/></x:xmpmeta>'
    const dummyData = new Uint8Array([1, 2, 3])
    const report = detectAiMarkers(dummyData, [xmp])
    expect(report.detected).toBe(true)
    expect(report.evidence[0]).toContain('trainedAlgorithmicMedia')
  })

  it('detects Midjourney prompt & parameter syntax', () => {
    const promptBlock = 'cyberpunk retro hacker terminal --ar 16:9 --v 6.0 --stylize 250 Job ID: 12345678'
    const report = detectAiMarkers(new Uint8Array([]), [promptBlock])
    expect(report.detected).toBe(true)
    expect(report.tool).toBe('Midjourney')
    expect(report.promptOrParams).toContain('cyberpunk retro hacker terminal')
  })

  it('detects Stable Diffusion Automatic1111 parameter blocks', () => {
    const params = 'a futuristic vaporwave skyline\nSteps: 28, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 421094819'
    const report = detectAiMarkers(new Uint8Array([]), [params])
    expect(report.detected).toBe(true)
    expect(report.tool).toContain('Stable Diffusion')
    expect(report.promptOrParams).toContain('Steps: 28')
  })

  it('detects ComfyUI workflow JSON structures', () => {
    const comfyWorkflow = '{"nodes": [{"id": 3, "class_type": "KSampler", "inputs": {}}]}'
    const report = detectAiMarkers(new Uint8Array([]), [comfyWorkflow])
    expect(report.detected).toBe(true)
    expect(report.tool).toContain('ComfyUI')
  })

  it('detects DALL-E from EXIF software tag', () => {
    const report = detectAiMarkers(new Uint8Array([]), [], 'DALL·E 3')
    expect(report.detected).toBe(true)
    expect(report.tool).toBe('OpenAI DALL-E')
  })

  it('returns clean report for normal images without AI markers', () => {
    const report = detectAiMarkers(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), [], 'Nikon Corporation')
    expect(report.detected).toBe(false)
    expect(report.confidence).toBe('none')
    expect(report.summary).toContain('No standard AI provenance markers')
  })

  it('scrubPng strips caBX chunks alongside other metadata', () => {
    const pngHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    const ihdr = [
      0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00,
      0x90, 0x77, 0x53, 0xde
    ]
    const cabxChunk = [
      0x00, 0x00, 0x00, 0x04,
      0x63, 0x61, 0x42, 0x58, // 'caBX'
      0x01, 0x02, 0x03, 0x04,
      0x11, 0x22, 0x33, 0x44
    ]
    const idat = [
      0x00, 0x00, 0x00, 0x02,
      0x49, 0x44, 0x41, 0x54,
      0x78, 0x9c,
      0x05, 0xb9, 0x41, 0x02
    ]
    const iend = [
      0x00, 0x00, 0x00, 0x00,
      0x49, 0x45, 0x4e, 0x44,
      0xae, 0x42, 0x60, 0x82
    ]
    const png = new Uint8Array([...pngHeader, ...ihdr, ...cabxChunk, ...idat, ...iend])

    expect(checkC2pa(png).found).toBe(true)

    const meta = inspectMetadata(png)
    expect(meta.aiDetection?.detected).toBe(true)

    const scrubbed = scrubPng(png)
    expect(checkC2pa(scrubbed).found).toBe(false)
  })

  it('scrubJpeg strips C2PA APP11 markers', () => {
    const jumbPayload = Array.from(new TextEncoder().encode('jumb/c2pa manifest'))
    const segLen = 2 + jumbPayload.length
    const app11 = [
      0xff, 0xeb,
      (segLen >> 8) & 0xff,
      segLen & 0xff,
      ...jumbPayload
    ]
    const jpeg = new Uint8Array([0xff, 0xd8, ...app11, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0xd9])

    const meta = inspectMetadata(jpeg)
    expect(meta.aiDetection?.detected).toBe(true)

    const scrubbed = scrubJpeg(jpeg)
    expect(checkC2pa(scrubbed).found).toBe(false)
  })
})
