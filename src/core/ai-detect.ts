// AI-Generated Image Marker Detection
// Inspects file buffers and metadata for standard AI provenance markers:
// C2PA (Content Credentials), IPTC DigitalSourceType (trainedAlgorithmicMedia),
// Stable Diffusion / ComfyUI generation parameters, Midjourney prompts, and DALL-E signatures.

export interface AiMarkerReport {
  detected: boolean
  tool?: string
  confidence: 'explicit' | 'likely' | 'none'
  summary: string
  evidence: string[]
  promptOrParams?: string
  synthIdNote: string
}

const SYNTHID_NOTE =
  "Google SynthID embeds imperceptible pixel-level watermarks that cannot be verified offline without Google's proprietary verification service."

/**
 * Checks for C2PA Content Credentials in JPEG (APP11) or PNG (caBX chunk).
 */
export function checkC2pa(data: Uint8Array): { found: boolean; details?: string } {
  // Check PNG caBX chunk
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    let pos = 8
    while (pos + 8 <= data.length) {
      const len =
        ((data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3]) >>> 0
      const type = String.fromCharCode(data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7])
      if (type === 'caBX') {
        return { found: true, details: "Found C2PA Content Credentials in PNG 'caBX' chunk" }
      }
      if (type === 'IEND') break
      pos += 12 + len
    }
  }

  // Check JPEG APP11 (0xFF 0xEB) with JUMBF / C2PA box
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xd8) {
    let pos = 2
    while (pos + 4 <= data.length) {
      if (data[pos] !== 0xff) {
        pos++
        continue
      }
      const marker = data[pos + 1]
      if (marker === 0xd9 || marker === 0xda) break
      if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
        pos += 2
        continue
      }
      const len = (data[pos + 2] << 8) | data[pos + 3]
      if (marker === 0xeb) {
        // APP11 segment
        const segment = data.subarray(pos + 4, pos + 2 + len)
        // Check for JUMBF box identifier or c2pa signature
        const str = new TextDecoder('latin1').decode(segment.subarray(0, 32))
        if (str.includes('JP2') || str.includes('jumb') || str.includes('c2pa')) {
          return { found: true, details: 'Found C2PA Content Credentials manifest in JPEG APP11 segment' }
        }
      }
      pos += 2 + len
    }
  }

  return { found: false }
}

/**
 * Inspects parsed metadata, XMP packets, and text chunks for AI generation markers.
 */
export function detectAiMarkers(
  data: Uint8Array,
  textBlocks: string[] = [],
  software?: string
): AiMarkerReport {
  const evidence: string[] = []
  let detected = false
  let tool: string | undefined
  let confidence: 'explicit' | 'likely' | 'none' = 'none'
  let promptOrParams: string | undefined

  // 1. Check C2PA Content Credentials
  const c2pa = checkC2pa(data)
  if (c2pa.found && c2pa.details) {
    detected = true
    confidence = 'explicit'
    tool = 'C2PA Content Credentials (OpenAI / Adobe / Leica)'
    evidence.push(c2pa.details)
  }

  // 2. Check Software tag in EXIF
  if (software) {
    const swLower = software.toLowerCase()
    if (swLower.includes('dall-e') || swLower.includes('dall·e')) {
      detected = true
      confidence = 'explicit'
      tool = 'OpenAI DALL-E'
      evidence.push(`EXIF Software tag explicitly declares "${software}"`)
    } else if (swLower.includes('midjourney')) {
      detected = true
      confidence = 'explicit'
      tool = 'Midjourney'
      evidence.push(`EXIF Software tag declares "${software}"`)
    } else if (swLower.includes('stable diffusion') || swLower.includes('automatic1111') || swLower.includes('comfyui')) {
      detected = true
      confidence = 'explicit'
      tool = 'Stable Diffusion'
      evidence.push(`EXIF Software tag declares "${software}"`)
    }
  }

  // 3. Check XMP packets and text blocks
  for (const block of textBlocks) {
    // IPTC trainedAlgorithmicMedia
    if (block.includes('trainedAlgorithmicMedia') || block.includes('digitalsourcetype/trainedAlgorithmicMedia')) {
      detected = true
      if (!tool) tool = 'IPTC Synthetic Media (Google / Midjourney / Adobe)'
      confidence = 'explicit'
      evidence.push('IPTC DigitalSourceType declared as trainedAlgorithmicMedia')
    } else if (block.includes('compositeSynthetic')) {
      detected = true
      if (!tool) tool = 'IPTC Synthetic Media'
      confidence = 'explicit'
      evidence.push('IPTC DigitalSourceType declared as compositeSynthetic')
    }

    // Midjourney signature
    if (
      (block.includes('--v 5') || block.includes('--v 6') || block.includes('--ar ') || block.includes('--stylize')) &&
      (block.includes('Job ID:') || block.toLowerCase().includes('midjourney') || block.includes('--v '))
    ) {
      detected = true
      tool = 'Midjourney'
      confidence = 'explicit'
      evidence.push('Found Midjourney parameter syntax and prompt')
      if (!promptOrParams) promptOrParams = block.slice(0, 500)
    }

    // Stable Diffusion / Automatic1111 parameters
    if (block.includes('Steps: ') && block.includes('Sampler: ') && block.includes('CFG scale: ')) {
      detected = true
      tool = 'Stable Diffusion (Automatic1111 / WebUI)'
      confidence = 'explicit'
      evidence.push('Found Stable Diffusion generation parameter block')
      if (!promptOrParams) promptOrParams = block.slice(0, 500)
    }

    // ComfyUI workflow graph
    if (block.includes('"nodes"') && block.includes('"class_type"') && (block.includes('KSampler') || block.includes('CLIPTextEncode'))) {
      detected = true
      tool = 'ComfyUI / Stable Diffusion'
      confidence = 'explicit'
      evidence.push('Found ComfyUI nodal generation workflow metadata')
      if (!promptOrParams) promptOrParams = block.slice(0, 500)
    }
  }

  const summary = detected
    ? `Identified ${tool || 'AI image generation'} marker.`
    : 'No standard AI provenance markers found in metadata.'

  return {
    detected,
    tool,
    confidence,
    summary,
    evidence,
    promptOrParams,
    synthIdNote: SYNTHID_NOTE
  }
}
