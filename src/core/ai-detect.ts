// AI-image markers
// Looks for what a file says about being made or edited with AI:
// - the IPTC "digital source type" (in XMP, or inside Content Credentials),
// - Stable Diffusion / ComfyUI settings, Midjourney prompts, DALL-E's name.
//
// Content Credentials (C2PA) are a signed record of where a picture came
// from. Cameras (Leica, Sony, Nikon), phones and editing apps add them as
// well as AI tools, so finding them is not a sign of AI by itself; only what
// they say inside counts. The signature is not checked here.

export interface ContentCredentials {
  /** Where they are: "JPEG APP11 segments", "PNG caBX chunk", "WebP C2PA chunk". */
  where: string
  /** The app or device that wrote them, when it could be read. */
  generator?: string
  /** What the credentials themselves say about AI, if anything. */
  aiClaim?: 'made' | 'edited'
  bytes: number
}

export interface AiMarkerReport {
  /** The file says it was made or edited with AI. */
  detected: boolean
  kind?: 'made' | 'edited'
  tool?: string
  confidence: 'explicit' | 'none'
  summary: string
  evidence: string[]
  promptOrParams?: string
  /** Content Credentials, whatever they say. */
  credentials?: ContentCredentials
  synthIdNote: string
}

const SYNTHID_NOTE =
  "Google SynthID embeds imperceptible pixel-level watermarks that cannot be verified offline without Google's proprietary verification service."

/** Content Credentials larger than this are only partly searched. */
const MAX_SCAN_BYTES = 16 * 1024 * 1024

/**
 * What an IPTC digital source type in this text says: made by AI
 * (trainedAlgorithmicMedia), or a picture with AI-made parts
 * (compositeWithTrainedAlgorithmicMedia, compositeSynthetic). Ordinary
 * phone photos may say computationalCapture, which is not AI.
 */
export function digitalSourceType(text: string): { kind: 'made' | 'edited'; code: string } | null {
  // The "t" is lower case only when the code stands alone; inside
  // compositeWithTrainedAlgorithmicMedia it's upper case.
  if (/(^|[^A-Za-z])trainedAlgorithmicMedia/.test(text)) return { kind: 'made', code: 'trainedAlgorithmicMedia' }
  const composite = /compositeWithTrainedAlgorithmicMedia|compositeSynthetic/.exec(text)
  if (composite) return { kind: 'edited', code: composite[0] }
  return null
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

function has(bytes: Uint8Array, text: string, from = 0): number {
  const first = text.charCodeAt(0)
  outer: for (let i = bytes.indexOf(first, from); i >= 0 && i + text.length <= bytes.length; i = bytes.indexOf(first, i + 1)) {
    for (let j = 1; j < text.length; j++) if (bytes[i + j] !== text.charCodeAt(j)) continue outer
    return i
  }
  return -1
}

/** A CBOR text string starting at `at`, or null. */
function cborText(b: Uint8Array, at: number): string | null {
  const head = b[at]
  if (head === undefined || head >> 5 !== 3) return null
  const info = head & 0x1f
  let len: number
  let start: number
  if (info < 24) {
    len = info
    start = at + 1
  } else if (info === 24) {
    len = b[at + 1]
    start = at + 2
  } else if (info === 25) {
    len = (b[at + 1] << 8) | b[at + 2]
    start = at + 3
  } else {
    return null
  }
  if (start + len > b.length) return null
  return new TextDecoder('utf-8').decode(b.subarray(start, start + Math.min(len, 200)))
}

/** Position just after the CBOR text key `key` (its last match), or -1. */
function afterKey(b: Uint8Array, key: string): number {
  const pattern = String.fromCharCode(0x60 + key.length) + key
  let found = -1
  for (let i = has(b, pattern); i >= 0; i = has(b, pattern, i + 1)) found = i
  return found < 0 ? -1 : found + pattern.length
}

/**
 * The app that wrote the credentials. Several manifests can sit in one
 * file (the picture's sources come first); the last one is the picture's own.
 */
function claimGenerator(b: Uint8Array): string | undefined {
  const info = afterKey(b, 'claim_generator_info')
  if (info >= 0) {
    const nameAt = has(b.subarray(info, info + 300), '\x64name')
    if (nameAt >= 0) {
      const name = cborText(b, info + nameAt + 5)
      if (name) return name.trim()
    }
  }
  const plain = afterKey(b, 'claim_generator')
  if (plain >= 0) return cborText(b, plain)?.trim() || undefined
  return undefined
}

/** Content Credentials in a JPEG, PNG or WebP, or null when there are none. */
export function findContentCredentials(data: Uint8Array): ContentCredentials | null {
  const parts: Uint8Array[] = []
  let where = ''

  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    where = 'PNG caBX chunk'
    let pos = 8
    while (pos + 8 <= data.length) {
      const len = ((data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3]) >>> 0
      const type = String.fromCharCode(data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7])
      if (type === 'caBX') parts.push(data.subarray(pos + 8, Math.min(data.length, pos + 8 + len)))
      if (type === 'IEND') break
      pos += 12 + len
    }
  } else if (data[0] === 0xff && data[1] === 0xd8) {
    where = 'JPEG APP11 segments'
    let pos = 2
    while (pos + 4 <= data.length) {
      if (data[pos] !== 0xff) {
        pos++
        continue
      }
      const marker = data[pos + 1]
      if (marker === 0xd9 || marker === 0xda) break
      if (marker === 0xff || marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
        pos += marker === 0xff ? 1 : 2
        continue
      }
      const len = (data[pos + 2] << 8) | data[pos + 3]
      if (len < 2) break
      // APP11 JUMBF: "JP", a box instance (2 bytes), a packet number (4),
      // then the box. Later packets repeat the box's 8-byte header.
      if (marker === 0xeb && len >= 10 && data[pos + 4] === 0x4a && data[pos + 5] === 0x50) {
        const packet = ((data[pos + 8] << 24) | (data[pos + 9] << 16) | (data[pos + 10] << 8) | data[pos + 11]) >>> 0
        const skip = packet > 1 ? 16 : 8
        parts.push(data.subarray(Math.min(pos + 4 + skip, pos + 2 + len), Math.min(data.length, pos + 2 + len)))
      }
      pos += 2 + len
    }
  } else if (data[0] === 0x52 && data[1] === 0x49 && data[8] === 0x57 && data[9] === 0x45) {
    where = 'WebP C2PA chunk'
    let pos = 12
    while (pos + 8 <= data.length) {
      const size = (data[pos + 4] | (data[pos + 5] << 8) | (data[pos + 6] << 16) | (data[pos + 7] << 24)) >>> 0
      if (String.fromCharCode(data[pos], data[pos + 1], data[pos + 2], data[pos + 3]) === 'C2PA') {
        parts.push(data.subarray(pos + 8, Math.min(data.length, pos + 8 + size)))
      }
      pos += 8 + size + (size % 2)
    }
  }

  if (parts.length === 0) return null
  const all = concat(parts)
  // JUMBF also carries other things (JPEG XT extensions); C2PA labels its
  // boxes "c2pa".
  if (has(all, 'c2pa') < 0) return null
  const scan = all.subarray(0, MAX_SCAN_BYTES)
  const claim = digitalSourceType(new TextDecoder('latin1').decode(scan))
  return {
    where,
    generator: claimGenerator(scan),
    aiClaim: claim?.kind,
    bytes: all.length
  }
}

/**
 * What the file says about AI. `textBlocks` are its XMP, PNG text and EXIF
 * comments; `software` is the EXIF Software tag.
 */
export function detectAiMarkers(
  textBlocks: string[] = [],
  software?: string,
  credentials?: ContentCredentials | null
): AiMarkerReport {
  const evidence: string[] = []
  let kind: 'made' | 'edited' | undefined
  let tool: string | undefined
  let promptOrParams: string | undefined
  const found = (k: 'made' | 'edited', why: string, by?: string) => {
    if (kind !== 'made') kind = k
    if (by && !tool) tool = by
    evidence.push(why)
  }

  // 1. Content Credentials, by what they say inside.
  if (credentials?.aiClaim) {
    const signer = credentials.generator ? `, written by ${credentials.generator}` : ''
    found(
      credentials.aiClaim,
      `Content Credentials (${credentials.where}${signer}) say ${credentials.aiClaim === 'made' ? 'it was made by AI' : 'it has AI-made parts'}`,
      credentials.generator
    )
  }

  // 2. The EXIF Software tag.
  if (software) {
    const sw = software.toLowerCase()
    if (sw.includes('dall-e') || sw.includes('dall·e')) found('made', `EXIF Software tag says "${software}"`, 'OpenAI DALL-E')
    else if (sw.includes('midjourney')) found('made', `EXIF Software tag says "${software}"`, 'Midjourney')
    else if (sw.includes('stable diffusion') || sw.includes('automatic1111') || sw.includes('comfyui')) {
      found('made', `EXIF Software tag says "${software}"`, 'Stable Diffusion')
    }
  }

  // 3. XMP, PNG text and EXIF comments.
  let sourceTypeSeen = false
  for (const block of textBlocks) {
    const source = digitalSourceType(block)
    if (source && !sourceTypeSeen) {
      sourceTypeSeen = true
      found(
        source.kind,
        `IPTC digital source type: ${source.code} (${source.kind === 'made' ? 'made by AI' : 'has AI-made or synthetic parts'})`
      )
    }

    if (
      (block.includes('--v 5') || block.includes('--v 6') || block.includes('--ar ') || block.includes('--stylize')) &&
      (block.includes('Job ID:') || block.toLowerCase().includes('midjourney') || block.includes('--v '))
    ) {
      tool = 'Midjourney'
      found('made', 'Midjourney prompt and settings')
      promptOrParams ??= block.slice(0, 500)
    }

    if (block.includes('Steps: ') && block.includes('Sampler: ') && block.includes('CFG scale: ')) {
      tool = 'Stable Diffusion (Automatic1111 / WebUI)'
      found('made', 'Stable Diffusion generation settings')
      promptOrParams ??= block.slice(0, 500)
    }

    if (block.includes('"class_type"') && (block.includes('KSampler') || block.includes('CLIPTextEncode'))) {
      tool = 'ComfyUI / Stable Diffusion'
      found('made', 'ComfyUI workflow')
      promptOrParams ??= block.slice(0, 500)
    }
  }

  const detected = kind !== undefined
  const by = tool ? ` (${tool})` : ''
  const summary =
    kind === 'made'
      ? `The file says it was made with AI${by}.`
      : kind === 'edited'
        ? `The file says parts of it were made with AI or are synthetic${by}.`
        : 'No standard AI provenance markers found in metadata.'

  return {
    detected,
    kind,
    tool,
    confidence: detected ? 'explicit' : 'none',
    summary,
    evidence,
    promptOrParams,
    credentials: credentials ?? undefined,
    synthIdNote: SYNTHID_NOTE
  }
}
