import { describe, expect, it } from 'vitest'
import { attachSauce, buildSauceRecord, parseSauce, SAUCE_EOF, SAUCE_RECORD_SIZE } from './sauce'

describe('SAUCE metadata record', () => {
  it('builds exactly 128 bytes record with correct headers', () => {
    const record = buildSauceRecord(1024, {
      title: 'B0r3d ANSI Art',
      author: 'still_b0r3d',
      group: 'b0r3d.org',
      date: '20261007',
      tInfo1: 80,
      tInfo2: 50,
      fontName: 'IBM VGA'
    })

    expect(record.length).toBe(SAUCE_RECORD_SIZE)

    const str = new TextDecoder('ascii').decode(record)
    expect(str.startsWith('SAUCE00')).toBe(true)

    const parsed = parseSauce(record)
    expect(parsed).not.toBeNull()
    expect(parsed?.title).toBe('B0r3d ANSI Art')
    expect(parsed?.author).toBe('still_b0r3d')
    expect(parsed?.group).toBe('b0r3d.org')
    expect(parsed?.date).toBe('20261007')
    expect(parsed?.fileSize).toBe(1024)
    expect(parsed?.tInfo1).toBe(80)
    expect(parsed?.tInfo2).toBe(50)
    expect(parsed?.fontName).toBe('IBM VGA')
  })

  it('attaches EOF marker and SAUCE record to arbitrary ANSI data', () => {
    const rawAnsi = new TextEncoder().encode('\x1b[32mHello ANSI\x1b[0m\r\n')
    const fileData = attachSauce(rawAnsi, {
      title: 'Test',
      tInfo1: 80,
      tInfo2: 1
    })

    expect(fileData.length).toBe(rawAnsi.length + 1 + SAUCE_RECORD_SIZE)
    expect(fileData[rawAnsi.length]).toBe(SAUCE_EOF)

    const parsed = parseSauce(fileData)
    expect(parsed).not.toBeNull()
    expect(parsed?.fileSize).toBe(rawAnsi.length)
    expect(parsed?.title).toBe('Test')
    expect(parsed?.tInfo1).toBe(80)
    expect(parsed?.tInfo2).toBe(1)
  })

  it('returns null when parsing data without SAUCE magic', () => {
    const randomBytes = new Uint8Array(150)
    expect(parseSauce(randomBytes)).toBeNull()
    expect(parseSauce(new Uint8Array(10))).toBeNull()
  })
})
