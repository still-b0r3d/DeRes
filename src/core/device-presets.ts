// Device presets for the EXIF Injector
// What a few phones and cameras write about themselves: make, model, lens,
// software and a typical daylight exposure. Picking one fills those fields;
// the date, place, creator and orientation stay the user's.
//
// The strings follow real files where we could find one (Apple's and Google's
// lens names, Nikon's "E990v1.0", Kodak's long model names, the 3DS camera's
// "00204"). A field a device doesn't write is left empty, so injecting removes
// the photo's own value. The Game Boy Camera never wrote EXIF at all; it's
// here for DeRes's Game Boy pictures.

import type { ExifEdits, InjectorFields } from './inject'

export type PresetFields = Pick<InjectorFields, 'make' | 'model' | 'lens' | 'software' | 'aperture' | 'shutter' | 'iso' | 'focal'>

export interface DevicePreset {
  id: string
  /** As the menu shows it, with the year it came out. */
  label: string
  group: 'Phones' | 'Cameras' | 'Handhelds'
  fields: PresetFields
  /** LensMake, when the device writes one. */
  lensMake?: string
  /** FocalLengthIn35mmFilm, when the device writes one. */
  focal35?: number
}

export const PRESET_FIELD_KEYS: readonly (keyof PresetFields)[] = [
  'make',
  'model',
  'lens',
  'software',
  'aperture',
  'shutter',
  'iso',
  'focal'
]

const none = { lens: '', software: '', aperture: '', shutter: '', iso: '', focal: '' }

export const DEVICE_PRESETS: readonly DevicePreset[] = [
  {
    id: 'iphone-15-pro',
    label: 'iPhone 15 Pro (2023)',
    group: 'Phones',
    fields: {
      make: 'Apple',
      model: 'iPhone 15 Pro',
      lens: 'iPhone 15 Pro back triple camera 6.765mm f/1.78',
      software: '17.4.1',
      aperture: '1.78',
      shutter: '1/120',
      iso: '64',
      focal: '6.765'
    },
    lensMake: 'Apple',
    focal35: 24
  },
  {
    id: 'pixel-8-pro',
    label: 'Pixel 8 Pro (2023)',
    group: 'Phones',
    fields: {
      make: 'Google',
      model: 'Pixel 8 Pro',
      lens: 'Pixel 8 Pro back camera 6.9mm f/1.68',
      software: '',
      aperture: '1.68',
      shutter: '1/125',
      iso: '50',
      focal: '6.9'
    },
    lensMake: 'Google',
    focal35: 24
  },
  {
    id: 'galaxy-s23-ultra',
    label: 'Galaxy S23 Ultra (2023)',
    group: 'Phones',
    fields: {
      make: 'samsung',
      model: 'Galaxy S23 Ultra',
      lens: '',
      software: '',
      aperture: '1.7',
      shutter: '1/100',
      iso: '50',
      focal: '6.3'
    },
    focal35: 24
  },
  {
    id: 'iphone-4',
    label: 'iPhone 4 (2010)',
    group: 'Phones',
    fields: {
      make: 'Apple',
      model: 'iPhone 4',
      lens: '',
      software: '4.3.5',
      aperture: '2.8',
      shutter: '1/120',
      iso: '80',
      focal: '3.85'
    }
  },
  {
    id: 'canon-5d-mark-ii',
    label: 'Canon EOS 5D Mark II (2008)',
    group: 'Cameras',
    fields: {
      make: 'Canon',
      model: 'Canon EOS 5D Mark II',
      lens: 'EF24-105mm f/4L IS USM',
      software: '',
      aperture: '8',
      shutter: '1/200',
      iso: '100',
      focal: '50'
    }
  },
  {
    id: 'canon-sd1000',
    label: 'Canon PowerShot SD1000 (2007)',
    group: 'Cameras',
    fields: {
      make: 'Canon',
      model: 'Canon PowerShot SD1000',
      lens: '',
      software: '',
      aperture: '2.8',
      shutter: '1/60',
      iso: '80',
      focal: '5.8'
    }
  },
  {
    id: 'kodak-c613',
    label: 'Kodak EasyShare C613 (2006)',
    group: 'Cameras',
    fields: {
      make: 'EASTMAN KODAK COMPANY',
      model: 'KODAK EASYSHARE C613 ZOOM DIGITAL CAMERA',
      lens: '',
      software: '',
      aperture: '2.7',
      shutter: '1/160',
      iso: '80',
      focal: '6'
    }
  },
  {
    id: 'coolpix-990',
    label: 'Nikon Coolpix 990 (1999)',
    group: 'Cameras',
    fields: {
      make: 'NIKON',
      model: 'E990',
      lens: '',
      software: 'E990v1.0',
      aperture: '2.5',
      shutter: '1/250',
      iso: '100',
      focal: '8.2'
    }
  },
  {
    id: 'nintendo-3ds',
    label: 'Nintendo 3DS (2011)',
    group: 'Handhelds',
    fields: { ...none, make: 'Nintendo', model: 'Nintendo 3DS', software: '00204' }
  },
  {
    id: 'game-boy-camera',
    label: 'Game Boy Camera (1998, just for fun)',
    group: 'Handhelds',
    fields: { ...none, make: 'Nintendo', model: 'Game Boy Camera' }
  }
]

export function presetById(id: string): DevicePreset | undefined {
  return DEVICE_PRESETS.find((p) => p.id === id)
}

/**
 * The tags a preset writes that the form doesn't show, added when injecting
 * while the form still names the preset's camera: its LensMake and 35 mm
 * figure (or none), and nothing left that names the old camera.
 */
export function presetExtras(p: DevicePreset): Pick<ExifEdits, 'lensMake' | 'focalLength35' | 'forgetCamera'> {
  return { lensMake: p.lensMake ?? null, focalLength35: p.focal35 ?? null, forgetCamera: true }
}

/** Whether the form still shows the preset's camera (make and model unchanged since it was picked). */
export function formShowsPreset(p: DevicePreset, fields: Pick<InjectorFields, 'make' | 'model'>): boolean {
  return fields.make.trim() === p.fields.make && fields.model.trim() === p.fields.model
}
