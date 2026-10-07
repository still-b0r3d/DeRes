import { describe, expect, it } from 'vitest'
import { createZip } from './zip'

describe('createZip', () => {
  it('creates a valid empty zip archive', () => {
    const zip = createZip([])
    expect(zip.length).toBe(22)
    const view = new DataView(zip.buffer)
    // EOCD signature PK\x05\x06
    expect(view.getUint32(0, true)).toBe(0x06054b50)
  })

  it('creates an archive with files and validates signatures and headers', () => {
    const text1 = new TextEncoder().encode('Hello, world!')
    const text2 = new TextEncoder().encode('Still bored at b0r3d.org')

    const zip = createZip([
      { name: 'test1.txt', data: text1 },
      { name: 'folder/test2.txt', data: text2 }
    ])

    expect(zip.length).toBeGreaterThan(0)
    const view = new DataView(zip.buffer)

    // First local header PK\x03\x04
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(view.getUint16(26, true)).toBe('test1.txt'.length)
    expect(view.getUint32(22, true)).toBe(text1.length)

    // Locate EOCD signature at end
    const eocdOffset = zip.length - 22
    expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50)
    expect(view.getUint16(eocdOffset + 8, true)).toBe(2)
    expect(view.getUint16(eocdOffset + 10, true)).toBe(2)
  })
})
