import rukusUrl from '../../b0r3d-brand/rukus.png'
import rukusGifUrl from '../../b0r3d-brand/rukus-breaks-out.gif'
import { h } from './dom'

// The sample pictures. Rukus (a PNG with made-up EXIF, a thumbnail and a
// colour profile) suits every tool; the GIF is z0mbie crystal footage of him
// breaking out of his hamster ball, for trying a GIF (the EXIF tools can't
// read GIFs).

export interface Sample {
  id: string
  label: string
  url: string
  name: string
}

export const SAMPLES: readonly Sample[] = [
  { id: 'rukus', label: 'Rukus', url: rukusUrl, name: 'rukus.png' },
  { id: 'rukus-gif', label: 'Rukus breaks out (GIF)', url: rukusGifUrl, name: 'rukus-breaks-out.gif' }
]

export const DEFAULT_SAMPLE = SAMPLES[0]

export function sampleById(id: string): Sample {
  return SAMPLES.find((s) => s.id === id) ?? DEFAULT_SAMPLE
}

/** "Try a sample: Rukus · Rukus breaks out (GIF)", one link per sample. */
export function sampleLinks(load: (id: string) => void): HTMLElement[] {
  const links: HTMLElement[] = [h('span', null, 'Try a sample: ')]
  SAMPLES.forEach((s, i) => {
    if (i > 0) links.push(h('span', null, ' · '))
    links.push(h('button', { type: 'button', class: 'linkish', 'data-sample': s.id, onclick: () => load(s.id) }, s.label))
  })
  return links
}
