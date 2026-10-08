import { describe, expect, it } from 'vitest'
import { inspectMetadata } from '../core/exif'
import { createScrubBatchItem, verifyScrubbed, type ScrubBatchItem } from '../core/scrub'
import { fakeExifApp1, tinyJpegBody } from '../test/fake-exif'
import { batchStatus, selfCheckBadge } from './scrub-stage'

// The badge and batch status follow the self-check, never a fixed text.

const dirty = new Uint8Array([0xff, 0xd8, ...fakeExifApp1({ make: 'FakeCam', gps: { lat: 0, lon: 0 } }), ...tinyJpegBody()])
const dirtyReport = verifyScrubbed(inspectMetadata(dirty), dirty.length, dirty)

describe('scrubber view', () => {
  it('only says Verified Clean when the check found nothing', () => {
    expect(selfCheckBadge(dirtyReport)).not.toContain('Verified Clean')
    expect(selfCheckBadge({ ...dirtyReport, isClean: true, leftovers: [] })).toBe('✓ Verified Clean')
  })

  it("a batch row says Cleaned only when that file's own check passed", () => {
    const item: ScrubBatchItem = { ...createScrubBatchItem(dirty, 'a.jpg'), status: 'scrubbed', report: dirtyReport }
    expect(batchStatus(item)).toEqual({ text: '⚠ Not clean', cls: 'err' })
    expect(batchStatus({ ...item, report: { ...dirtyReport, isClean: true, leftovers: [] } })).toEqual({ text: '✓ Cleaned', cls: 'clean' })
    expect(batchStatus({ ...item, status: 'pending', report: undefined }).text).toBe('Queued')
    expect(batchStatus({ ...item, status: 'error' }).text).toBe('Error')
  })
})
