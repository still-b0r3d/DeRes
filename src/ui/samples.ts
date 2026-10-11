import rukusUrl from '../../b0r3d-brand/rukus.png'
import rukusGifUrl from '../../b0r3d-brand/rukus-breaks-out.gif'
import catNapUrl from '../../samples/cat-nap.jpg'
import crystalForestUrl from '../../samples/crystal-forest.jpg'
import crystalGifUrl from '../../samples/crystal-awakens.gif'
import deskCatGifUrl from '../../samples/desk-cat.gif'
import neonCubeGifUrl from '../../samples/neon-cube.gif'
import yetiGifUrl from '../../samples/yeti-roar.gif'
import { h } from './dom'

// The sample pictures, all from b0r3d.org's own games and clips. Rukus (a PNG
// with made-up EXIF, a thumbnail and a colour profile) suits every tool and is
// the one the EXIF tools load. The rest give the machines something different
// to chew on: Chainsaw Squirrel's crystal forest (bright flat art), a cat nap
// (a photo-like frame from the site's 90s music clip), and GIFs: Rukus
// breaking out of his hamster ball in z0mbie crystal, a Chainsaw Squirrel yeti
// fight, and three moments from the site's music clips. The GIFs are cut from
// the raw footage, never a finished ad with its titles on.

export interface Sample {
  id: string
  label: string
  url: string
  name: string
  kind: 'picture' | 'gif'
}

export const SAMPLES: readonly Sample[] = [
  { id: 'rukus', label: 'Rukus', url: rukusUrl, name: 'rukus.png', kind: 'picture' },
  { id: 'forest', label: 'Crystal forest', url: crystalForestUrl, name: 'crystal-forest.jpg', kind: 'picture' },
  { id: 'cat-nap', label: 'Cat nap', url: catNapUrl, name: 'cat-nap.jpg', kind: 'picture' },
  { id: 'rukus-gif', label: 'Rukus breaks out', url: rukusGifUrl, name: 'rukus-breaks-out.gif', kind: 'gif' },
  { id: 'yeti-gif', label: 'Yeti roar', url: yetiGifUrl, name: 'yeti-roar.gif', kind: 'gif' },
  { id: 'crystal-gif', label: 'Crystal awakens', url: crystalGifUrl, name: 'crystal-awakens.gif', kind: 'gif' },
  { id: 'neon-gif', label: 'Neon cube', url: neonCubeGifUrl, name: 'neon-cube.gif', kind: 'gif' },
  { id: 'desk-cat-gif', label: 'Desk cat', url: deskCatGifUrl, name: 'desk-cat.gif', kind: 'gif' }
]

export const DEFAULT_SAMPLE = SAMPLES[0]

export function sampleById(id: string): Sample {
  return SAMPLES.find((s) => s.id === id) ?? DEFAULT_SAMPLE
}

/** "Try a picture: Rukus · Crystal forest · …" and "Try a GIF: …", one link per sample. */
export function sampleLinks(load: (id: string) => void): HTMLElement[] {
  const line = (kind: Sample['kind'], lead: string) => {
    const parts: HTMLElement[] = [h('span', null, lead)]
    SAMPLES.filter((s) => s.kind === kind).forEach((s, i) => {
      if (i > 0) parts.push(h('span', null, ' · '))
      parts.push(h('button', { type: 'button', class: 'linkish', 'data-sample': s.id, onclick: () => load(s.id) }, s.label))
    })
    return h('span', { class: 'sample-line' }, ...parts)
  }
  return [line('picture', 'Try a picture: '), line('gif', 'Try a GIF: ')]
}
