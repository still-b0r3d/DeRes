import { describe, expect, it } from 'vitest'
import { detectAiMarkers, digitalSourceType, findContentCredentials } from './ai-detect'
import { inspectMetadata } from './exif'
import { chunk, PNG_SIGNATURE } from './png'
import { scrubJpeg, scrubPng, scrubWebp } from './scrub'
import { tinyJpegBody } from '../test/fake-exif'
import {
  bytesFor,
  exifApp1,
  fakeC2paBox,
  fakeWebp,
  jumbfApp11,
  rawTiff,
  xmpApp1,
  xmpSourceType
} from '../test/fake-tiff'

const enc = (s: string) => new TextEncoder().encode(s)
const IHDR = chunk('IHDR', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]))
const IDAT = chunk('IDAT', new Uint8Array([0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0, 0, 0, 4, 0, 1]))
const IEND = chunk('IEND', new Uint8Array(0))
const png = (...chunks: Uint8Array[]) => new Uint8Array([...PNG_SIGNATURE, ...IHDR, ...chunks.flatMap((c) => [...c]), ...IDAT, ...IEND])
const jpeg = (...segments: number[][]) => new Uint8Array([0xff, 0xd8, ...segments.flat(), ...tinyJpegBody()])
/** An uncompressed iTXt chunk. */
const itxt = (keyword: string, text: string) => chunk('iTXt', new Uint8Array([...enc(keyword), 0, 0, 0, 0, 0, ...enc(text)]))

describe('Content Credentials are not, by themselves, a sign of AI', () => {
  it('a camera-signed JPEG has credentials but no AI marker', () => {
    const photo = jpeg(jumbfApp11(fakeC2paBox({ generatorInfo: 'Leica Camera AG M11-P' })))
    const meta = inspectMetadata(photo)
    expect(meta.aiDetection?.detected).toBe(false)
    expect(meta.aiDetection?.credentials).toMatchObject({
      where: 'JPEG APP11 segments',
      generator: 'Leica Camera AG M11-P'
    })
    expect(meta.aiDetection?.credentials?.aiClaim).toBeUndefined()
    // The All Tags list names them and who wrote them.
    expect(meta.allTags.find((t) => t.category === 'C2PA' && t.name === 'Content Credentials')?.displayValue).toContain(
      'signed by Leica Camera AG M11-P'
    )
  })

  it('credentials that say "made by AI" are a marker, with the app that wrote them', () => {
    const photo = png(chunk('caBX', fakeC2paBox({ generator: 'Adobe_Firefly/1.0 c2pa-rs/0.30', sourceType: 'trainedAlgorithmicMedia' })))
    const report = inspectMetadata(photo).aiDetection!
    expect(report.detected).toBe(true)
    expect(report.kind).toBe('made')
    expect(report.tool).toBe('Adobe_Firefly/1.0 c2pa-rs/0.30')
    expect(report.evidence[0]).toContain('Content Credentials (PNG caBX chunk')
    expect(report.summary).toContain('made with AI')
  })

  it('credentials that say "edited with AI" are an editing marker', () => {
    const photo = jpeg(jumbfApp11(fakeC2paBox({ generator: 'Photoshop', sourceType: 'compositeWithTrainedAlgorithmicMedia' })))
    const report = inspectMetadata(photo).aiDetection!
    expect(report.detected).toBe(true)
    expect(report.kind).toBe('edited')
  })

  it('reads credentials split over several APP11 packets', () => {
    const box = fakeC2paBox({ generatorInfo: 'Google Pixel Camera', sourceType: 'trainedAlgorithmicMedia' })
    const photo = jpeg(jumbfApp11(box, 40))
    expect(jumbfApp11(box, 40).filter((b, i, a) => b === 0xff && a[i + 1] === 0xeb).length).toBeGreaterThan(2)
    const cred = findContentCredentials(photo)!
    expect(cred.aiClaim).toBe('made')
    expect(cred.generator).toBe('Google Pixel Camera')
  })

  it('JUMBF data that is not C2PA (a JPEG XT extension) is not credentials', () => {
    const photo = jpeg(jumbfApp11(fakeC2paBox({ label: 'jpxt' })))
    expect(findContentCredentials(photo)).toBeNull()
    expect(inspectMetadata(photo).aiDetection?.credentials).toBeUndefined()
  })

  it('finds credentials in a WebP, and the scrubber removes them', () => {
    const webp = fakeWebp([
      { fourCC: 'VP8L', data: new Uint8Array([0x2f, 0, 0, 0, 0]) },
      { fourCC: 'C2PA', data: fakeC2paBox({ generator: 'Sony Camera' }) }
    ])
    expect(findContentCredentials(webp)?.where).toBe('WebP C2PA chunk')
    expect(findContentCredentials(scrubWebp(webp))).toBeNull()
  })

  it('the scrubber removes PNG caBX and JPEG APP11 credentials', () => {
    const p = png(chunk('caBX', fakeC2paBox({ generator: 'x' })))
    expect(findContentCredentials(p)).not.toBeNull()
    expect(findContentCredentials(scrubPng(p))).toBeNull()
    const j = jpeg(jumbfApp11(fakeC2paBox({ generator: 'x' })))
    expect(findContentCredentials(j)).not.toBeNull()
    expect(findContentCredentials(scrubJpeg(j))).toBeNull()
  })
})

describe('IPTC digital source type', () => {
  it('tells made, edited and ordinary apart', () => {
    expect(digitalSourceType(xmpSourceType('trainedAlgorithmicMedia'))?.kind).toBe('made')
    expect(digitalSourceType(xmpSourceType('compositeWithTrainedAlgorithmicMedia'))?.kind).toBe('edited')
    expect(digitalSourceType(xmpSourceType('compositeSynthetic'))?.kind).toBe('edited')
    expect(digitalSourceType(xmpSourceType('computationalCapture'))).toBeNull()
    expect(digitalSourceType(xmpSourceType('digitalCapture'))).toBeNull()
  })

  it('in a JPEG XMP block', () => {
    expect(inspectMetadata(jpeg(xmpApp1(xmpSourceType('trainedAlgorithmicMedia')))).aiDetection?.kind).toBe('made')
    expect(inspectMetadata(jpeg(xmpApp1(xmpSourceType('compositeWithTrainedAlgorithmicMedia')))).aiDetection?.kind).toBe(
      'edited'
    )
    expect(inspectMetadata(jpeg(xmpApp1(xmpSourceType('computationalCapture')))).aiDetection?.detected).toBe(false)
  })

  it('in a PNG XMP block (iTXt), where most AI PNGs keep it', () => {
    const meta = inspectMetadata(png(itxt('XML:com.adobe.xmp', xmpSourceType('trainedAlgorithmicMedia'))))
    expect(meta.xmpText).toContain('trainedAlgorithmicMedia')
    expect(meta.aiDetection?.kind).toBe('made')
    expect(meta.allTags.some((t) => t.name === 'XMP Metadata Packet')).toBe(true)
  })
})

describe('AI tools that leave their settings in the file', () => {
  it('Stable Diffusion settings in a PNG iTXt chunk (non-English prompts go there)', () => {
    const meta = inspectMetadata(png(itxt('parameters', '夜の東京、ネオン\nSteps: 20, Sampler: Euler a, CFG scale: 7, Seed: 1')))
    expect(meta.aiDetection?.detected).toBe(true)
    expect(meta.aiDetection?.promptOrParams).toContain('夜の東京')
  })

  it('Stable Diffusion settings in a JPEG UserComment (UTF-16)', () => {
    const w = bytesFor(true)
    const text = 'a cat\nSteps: 20, Sampler: Euler a, CFG scale: 7'
    const utf16be = [...text].flatMap((c) => [0, c.charCodeAt(0)])
    const { tiff } = rawTiff([w.ascii(0x010f, 'x')], [w.undefinedBytes(0x9286, [...enc('UNICODE\0'), ...utf16be])])
    const meta = inspectMetadata(jpeg(exifApp1(tiff)))
    expect(meta.aiDetection?.tool).toContain('Stable Diffusion')
    expect(meta.allTags.find((t) => t.name === 'UserComment')?.displayValue).toBe(text)
  })

  it('a ComfyUI prompt graph in a PNG tEXt chunk', () => {
    const graph = '{"3": {"class_type": "KSampler", "inputs": {}}, "6": {"class_type": "CLIPTextEncode"}}'
    const meta = inspectMetadata(png(chunk('tEXt', new Uint8Array([...enc('prompt'), 0, ...enc(graph)]))))
    expect(meta.aiDetection?.tool).toContain('ComfyUI')
  })

  it('compressed PNG text is listed but not read', () => {
    const meta = inspectMetadata(png(chunk('zTXt', new Uint8Array([...enc('Comment'), 0, 0, 0x78, 0x9c, 1, 2, 3]))))
    expect(meta.allTags.find((t) => t.name === 'PNG Text (Comment)')?.displayValue).toContain('compressed text (not read)')
  })

  it('Midjourney, DALL-E and a plain photo', () => {
    expect(detectAiMarkers(['retro hacker terminal --ar 16:9 --v 6.0 Job ID: 1234']).tool).toBe('Midjourney')
    expect(detectAiMarkers([], 'DALL·E 3').tool).toBe('OpenAI DALL-E')
    const plain = detectAiMarkers([], 'Nikon Corporation')
    expect(plain.detected).toBe(false)
    expect(plain.summary).toContain('No standard AI provenance markers')
    expect(plain.synthIdNote).toContain('SynthID')
  })
})
