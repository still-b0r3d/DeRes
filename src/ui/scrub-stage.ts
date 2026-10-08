import { formatGpsDecimal, formatGpsDms, getMetadataNarrative, type ImageMetadata } from '../core/exif'
import type { ScrubBatchItem, SelfCheckReport } from '../core/scrub'
import { h, show } from './dom'

/** The self-check badge: it says clean only when the check found nothing left. */
export function selfCheckBadge(report: SelfCheckReport): string {
  return report.isClean ? '✓ Verified Clean' : '⚠ Not clean: metadata left'
}

/** A batch row's status, from that file's own self-check. */
export function batchStatus(item: ScrubBatchItem): { text: string; cls: 'clean' | 'err' | 'pend' } {
  if (item.status === 'error') return { text: 'Error', cls: 'err' }
  if (item.status !== 'scrubbed' || !item.report) return { text: 'Queued', cls: 'pend' }
  return item.report.isClean ? { text: '✓ Cleaned', cls: 'clean' } : { text: '⚠ Not clean', cls: 'err' }
}

export class ScrubStage {
  readonly el: HTMLElement
  private readonly statusMsg: HTMLElement
  private readonly contentContainer: HTMLElement
  private readonly batchPanelEl: HTMLElement
  private readonly batchSummaryEl: HTMLElement
  private readonly batchTableEl: HTMLTableElement
  private readonly previewImg: HTMLImageElement
  private readonly previewWrap: HTMLElement
  private readonly noPreviewEl: HTMLElement
  private readonly narrativeEl: HTMLElement
  private readonly gpsAlertEl: HTMLElement
  private readonly gpsCoordsEl: HTMLElement
  private readonly copyGpsBtn: HTMLButtonElement
  private readonly thumbAlertEl: HTMLElement
  private readonly thumbImg: HTMLImageElement
  private readonly trailerAlertEl: HTMLElement
  private readonly trailerDescEl: HTMLElement
  private readonly aiAlertEl: HTMLElement
  private readonly aiDescEl: HTMLElement
  private readonly aiEvidenceEl: HTMLElement
  private readonly checkBannerEl: HTMLElement
  private readonly checkBadgeEl: HTMLElement
  private readonly checkSummaryEl: HTMLElement
  private readonly checkStatsEl: HTMLElement
  private readonly summaryTabBtn: HTMLButtonElement
  private readonly treeTabBtn: HTMLButtonElement
  private readonly filterInput: HTMLInputElement
  private readonly tableEl: HTMLTableElement
  private currentMeta: ImageMetadata | null = null
  private currentViewMode: 'summary' | 'tree' = 'summary'
  private filterQuery = ''
  /** Shows a line in the scrubber's status (set by the app). */
  onStatus: (text: string) => void = () => {}

  constructor() {
    this.statusMsg = h('p', { class: 'stage-msg' }, 'Choose a photo to inspect and scrub its metadata.')

    // Batch Queue Panel
    this.batchSummaryEl = h('div', { class: 'scrub-batch-summary' })
    this.batchTableEl = h('table', { class: 'scrub-batch-table', 'data-testid': 'scrub-batch-table' })
    this.batchPanelEl = h(
      'div',
      { class: 'scrub-batch-panel', 'data-testid': 'scrub-batch-panel', hidden: true },
      h('div', { class: 'scrub-batch-header' }, h('h3', { class: 'scrub-sec-title' }, 'Batch Scrubber Queue'), this.batchSummaryEl),
      h('div', { class: 'scrub-batch-table-wrap' }, this.batchTableEl)
    )

    // Photo preview
    this.previewImg = h('img', {
      class: 'scrub-preview-img',
      alt: 'Loaded photo preview',
      'data-testid': 'scrub-preview-img'
    })
    this.previewWrap = h('div', { class: 'scrub-preview-wrap' }, this.previewImg)
    this.noPreviewEl = h(
      'p',
      { class: 'scrub-no-preview', 'data-testid': 'scrub-no-preview', hidden: true },
      "No preview: this browser can't show this photo. The details below are read straight from the file."
    )
    // A batch can hold photos this browser can't show (HEIC outside Safari).
    this.previewImg.addEventListener('error', () => {
      if (!this.previewImg.getAttribute('src')) return
      show(this.previewWrap, false)
      show(this.noPreviewEl, true)
    })

    // Narrative
    this.narrativeEl = h('div', {
      class: 'scrub-narrative',
      'data-testid': 'scrub-narrative'
    })

    // GPS Callout
    this.gpsCoordsEl = h('span', { class: 'scrub-gps-coords' })
    this.copyGpsBtn = h(
      'button',
      {
        type: 'button',
        class: 'pill-btn copy-gps-btn',
        'data-testid': 'copy-gps-btn',
        onclick: () => this.copyGps()
      },
      'Copy coordinates'
    )
    this.gpsAlertEl = h(
      'div',
      { class: 'scrub-alert scrub-gps-alert', 'data-testid': 'scrub-gps-alert', hidden: true },
      h('div', { class: 'scrub-alert-title' }, '📍 Embedded GPS Location Found'),
      h('p', { class: 'scrub-alert-body' }, this.gpsCoordsEl),
      h('div', { class: 'scrub-alert-actions' }, this.copyGpsBtn),
      h('p', { class: 'scrub-alert-note' }, 'No map tiles loaded. Coordinates never leave your browser.')
    )

    // Thumbnail warning
    this.thumbImg = h('img', {
      class: 'scrub-thumb-img',
      alt: 'Embedded thumbnail preview',
      'data-testid': 'scrub-thumb-img'
    })
    this.thumbAlertEl = h(
      'div',
      { class: 'scrub-alert scrub-thumb-alert', 'data-testid': 'scrub-thumb-alert', hidden: true },
      h('div', { class: 'scrub-alert-title' }, '⚠️ Embedded Thumbnail Found'),
      h(
        'p',
        { class: 'scrub-alert-body' },
        'This file contains an embedded preview thumbnail. If the photo was cropped or edited, the thumbnail may still show the original.'
      ),
      h('div', { class: 'scrub-thumb-container' }, this.thumbImg)
    )

    // Trailer warning
    this.trailerDescEl = h('p', { class: 'scrub-alert-body' })
    this.trailerAlertEl = h(
      'div',
      { class: 'scrub-alert scrub-trailer-alert', 'data-testid': 'scrub-trailer-alert', hidden: true },
      h('div', { class: 'scrub-alert-title' }, '⚠️ Hidden Trailing Data Detected'),
      this.trailerDescEl
    )

    // AI Generation Marker Alert
    this.aiDescEl = h('p', { class: 'scrub-alert-body' })
    this.aiEvidenceEl = h('div', { class: 'scrub-ai-evidence', 'data-testid': 'scrub-ai-evidence' })
    this.aiAlertEl = h(
      'div',
      { class: 'scrub-alert scrub-ai-alert', 'data-testid': 'scrub-ai-alert', hidden: true },
      h('div', { class: 'scrub-alert-title' }, '🤖 AI Generation Marker Found'),
      this.aiDescEl,
      this.aiEvidenceEl,
      h(
        'p',
        { class: 'scrub-alert-note' },
        "Note: Metadata markers can be removed or omitted, so absence of markers does not guarantee human creation. Google SynthID watermarks cannot be analyzed without Google's proprietary verification service."
      )
    )

    // Self-check verification badge
    this.checkSummaryEl = h('div', { class: 'scrub-check-summary' })
    this.checkStatsEl = h('div', { class: 'scrub-check-stats' })
    this.checkBadgeEl = h('div', { class: 'scrub-check-badge', 'data-testid': 'scrub-check-badge' })
    this.checkBannerEl = h(
      'div',
      { class: 'scrub-self-check', 'data-testid': 'scrub-self-check', hidden: true },
      this.checkBadgeEl,
      this.checkSummaryEl,
      this.checkStatsEl
    )

    // View Tabs & Filter for Metadata Inspector
    this.summaryTabBtn = h(
      'button',
      {
        type: 'button',
        class: 'pill-btn scrub-tab-btn active',
        'data-testid': 'scrub-summary-tab',
        onclick: () => this.switchView('summary')
      },
      'Summary'
    )
    this.treeTabBtn = h(
      'button',
      {
        type: 'button',
        class: 'pill-btn scrub-tab-btn',
        'data-testid': 'scrub-tree-tab',
        onclick: () => this.switchView('tree')
      },
      'All Tags Tree'
    )
    this.filterInput = h('input', {
      type: 'text',
      class: 'scrub-filter-input',
      'data-testid': 'scrub-filter-input',
      placeholder: 'Filter tags (e.g. Lens, Make)...',
      hidden: true,
      oninput: (e) => {
        this.filterQuery = (e.target as HTMLInputElement).value
        if (this.currentMeta) this.renderTable(this.currentMeta)
      }
    })

    // Metadata Inspector Table
    this.tableEl = h('table', { class: 'scrub-table', 'data-testid': 'scrub-table' })

    const tableContainer = h(
      'div',
      { class: 'scrub-table-container' },
      h(
        'div',
        { class: 'scrub-table-header' },
        h('h3', { class: 'scrub-sec-title' }, 'Metadata Inspector'),
        h('div', { class: 'scrub-view-tabs' }, this.summaryTabBtn, this.treeTabBtn),
        this.filterInput
      ),
      this.tableEl
    )

    this.contentContainer = h(
      'div',
      { class: 'scrub-content', hidden: true },
      this.batchPanelEl,
      this.previewWrap,
      this.noPreviewEl,
      this.checkBannerEl,
      this.narrativeEl,
      this.aiAlertEl,
      this.gpsAlertEl,
      this.thumbAlertEl,
      this.trailerAlertEl,
      tableContainer
    )

    this.el = h(
      'div',
      { class: 'scrub-stage-container' },
      this.statusMsg,
      this.contentContainer
    )
  }

  message(text: string): void {
    this.statusMsg.textContent = text
    show(this.statusMsg, true)
    show(this.contentContainer, false)
  }

  problem(text: string): void {
    this.statusMsg.textContent = text
    show(this.statusMsg, true)
  }

  showBatch(items: ScrubBatchItem[], activeIndex: number, onSelect: (index: number) => void): void {
    if (items.length <= 1) {
      show(this.batchPanelEl, false)
      return
    }

    show(this.batchPanelEl, true)
    const gpsCount = items.filter((it) => it.hasGps).length
    const trailerCount = items.filter((it) => it.trailerBytes > 0).length
    this.batchSummaryEl.textContent = `${items.length} files queued · ${gpsCount} with GPS · ${trailerCount} with trailers. Click any row to inspect.`

    const rows = items.map((it, idx) => {
      const isSelected = idx === activeIndex
      const st = batchStatus(it)
      const statusBadge = h(
        'span',
        { class: `badge ${st.cls}`, title: it.report && !it.report.isClean ? it.report.summary : null },
        st.text
      )

      const row = h(
        'tr',
        {
          class: `batch-row ${isSelected ? 'selected-row' : ''}`,
          onclick: () => onSelect(idx)
        },
        h('td', { class: 'col-name' }, it.name),
        h('td', { class: 'col-fmt' }, it.format.toUpperCase()),
        h('td', { class: 'col-size' }, `${(it.size / 1024).toFixed(1)} KB`),
        h('td', { class: it.hasGps ? 'col-alert' : 'col-muted' }, it.hasGps ? '📍 Yes' : 'No'),
        h('td', { class: it.trailerBytes > 0 ? 'col-alert' : 'col-muted' }, it.trailerBytes > 0 ? `${(it.trailerBytes / 1024).toFixed(0)} KB` : 'No'),
        h('td', { class: 'col-status' }, statusBadge)
      )
      return row
    })

    this.batchTableEl.replaceChildren(
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          h('th', null, 'File'),
          h('th', null, 'Format'),
          h('th', null, 'Size'),
          h('th', null, 'GPS'),
          h('th', null, 'Trailer'),
          h('th', null, 'Status')
        )
      ),
      h('tbody', null, ...rows)
    )
  }

  /** Shows a file's metadata; imageUrl is null when this browser can't show the picture. */
  showMetadata(meta: ImageMetadata, imageUrl: string | null): void {
    this.currentMeta = meta
    show(this.statusMsg, false)
    show(this.contentContainer, true)

    // Preview
    show(this.previewWrap, imageUrl !== null)
    show(this.noPreviewEl, imageUrl === null)
    if (imageUrl) this.previewImg.src = imageUrl
    else this.previewImg.removeAttribute('src')

    // Reset check banner
    show(this.checkBannerEl, false)

    // Narrative
    this.narrativeEl.textContent = getMetadataNarrative(meta)

    // GPS Callout
    if (meta.gps) {
      show(this.gpsAlertEl, true)
      const dms = formatGpsDms(meta.gps)
      const dec = formatGpsDecimal(meta.gps)
      this.gpsCoordsEl.textContent = `${dms} (${dec})`
    } else {
      show(this.gpsAlertEl, false)
    }

    // Thumbnail warning
    if (meta.hasThumbnail && meta.thumbnail) {
      show(this.thumbAlertEl, true)
      const blob = new Blob([meta.thumbnail.data.buffer as ArrayBuffer], { type: meta.thumbnail.mimeType })
      this.thumbImg.src = URL.createObjectURL(blob)
    } else {
      show(this.thumbAlertEl, false)
    }

    // Trailer warning
    if (meta.trailerBytes > 0) {
      show(this.trailerAlertEl, true)
      this.trailerDescEl.textContent = `${meta.trailerBytes.toLocaleString()} bytes of trailer data follow the image stream (e.g. motion photo MP4 video, Samsung trailer, or Ultra HDR gain map). These will be safely stripped.`
    } else {
      show(this.trailerAlertEl, false)
    }

    // AI Generation Marker Warning
    if (meta.aiDetection && meta.aiDetection.detected) {
      show(this.aiAlertEl, true)
      this.aiDescEl.textContent = `${meta.aiDetection.summary}${meta.aiDetection.promptOrParams ? ` Prompt: "${meta.aiDetection.promptOrParams}"` : ''}`
      this.aiEvidenceEl.textContent = meta.aiDetection.evidence.join(' · ')
    } else {
      show(this.aiAlertEl, false)
    }

    // Populate Table
    this.renderTable(meta)
  }

  showSelfCheck(report: SelfCheckReport): void {
    show(this.checkBannerEl, true)
    this.checkBannerEl.classList.toggle('fail', !report.isClean)
    this.checkBadgeEl.textContent = selfCheckBadge(report)
    this.checkSummaryEl.textContent = report.summary
    const savedStr = report.bytesSaved > 0 ? ` · Saved ${report.bytesSaved.toLocaleString()} bytes` : ''
    this.checkStatsEl.textContent = `Original: ${(report.originalSize / 1024).toFixed(1)} KB → Clean: ${(report.scrubbedSize / 1024).toFixed(1)} KB${savedStr} · Bit-identical pixels`
  }

  private switchView(mode: 'summary' | 'tree'): void {
    this.currentViewMode = mode
    this.summaryTabBtn.classList.toggle('active', mode === 'summary')
    this.treeTabBtn.classList.toggle('active', mode === 'tree')
    show(this.filterInput, mode === 'tree')
    if (mode === 'tree') this.filterInput.focus()
    if (this.currentMeta) this.renderTable(this.currentMeta)
  }

  private renderTable(meta: ImageMetadata): void {
    if (meta.format === 'unknown') {
      // Nothing was read, so no "None" that would read as "checked, none".
      this.tableEl.replaceChildren(
        h('thead', null, h('tr', null, h('th', null, 'Field'), h('th', null, 'Value'))),
        h('tbody', null, h('tr', null, h('td', { class: 'field-name' }, 'Format'), h('td', { class: 'val-muted' }, "Can't read this kind of file")))
      )
      return
    }

    if (this.currentViewMode === 'tree') {
      const q = this.filterQuery.trim().toLowerCase()
      const filtered = q
        ? meta.allTags.filter(
            (t) =>
              t.name.toLowerCase().includes(q) ||
              t.tagHex.toLowerCase().includes(q) ||
              t.category.toLowerCase().includes(q) ||
              t.displayValue.toLowerCase().includes(q)
          )
        : meta.allTags

      this.tableEl.replaceChildren(
        h(
          'thead',
          null,
          h('tr', null, h('th', null, 'Tag'), h('th', null, 'Name'), h('th', null, 'Category'), h('th', null, 'Value'))
        ),
        h(
          'tbody',
          null,
          ...(filtered.length > 0
            ? filtered.map((t) =>
                h(
                  'tr',
                  null,
                  h('td', { class: 'field-hex' }, t.tagHex),
                  h('td', { class: 'field-name' }, t.name),
                  h('td', { class: 'val-muted' }, t.category),
                  h('td', { class: 'val-highlight' }, t.displayValue)
                )
              )
            : [
                h(
                  'tr',
                  null,
                  h(
                    'td',
                    { colspan: 4, class: 'val-muted' },
                    q ? `No tags matching "${q}"` : 'No raw EXIF/TIFF tags recorded.'
                  )
                )
              ])
        )
      )
      return
    }

    const rows: [string, string][] = [
      ['Format', meta.format.toUpperCase()],
      ['Camera Make', meta.make || 'None'],
      ['Camera Model', meta.model || 'None'],
      ['Lens', meta.lensModel || 'None'],
      ['Date & Time', meta.dateTime || 'None'],
      ['Orientation', meta.orientation ? String(meta.orientation) : 'Standard (1)'],
      [
        'GPS Coordinates',
        meta.gps ? `${formatGpsDms(meta.gps)} (${formatGpsDecimal(meta.gps)})` : 'None'
      ],
      ['Shutter Speed', meta.exposureTime || 'None'],
      ['Aperture', meta.fNumber ? `f/${meta.fNumber}` : 'None'],
      ['ISO', meta.iso ? String(meta.iso) : 'None'],
      ['Focal Length', meta.focalLength ? `${meta.focalLength} mm` : 'None'],
      ['Software', meta.software || 'None'],
      ['Artist / Copyright', [meta.artist, meta.copyright].filter(Boolean).join(' / ') || 'None'],
      ['Colour Profile', meta.hasIccProfile ? 'Colour profile present' : 'None'],
      ['Embedded Thumbnail', meta.hasThumbnail ? 'Yes (may show the uncropped original)' : 'No'],
      ['Trailing Bytes', meta.trailerBytes > 0 ? `${meta.trailerBytes.toLocaleString()} bytes` : '0 bytes'],
      ['Total Raw Tags', `${meta.rawTagCount} metadata fields`]
    ]

    this.tableEl.replaceChildren(
      h('thead', null, h('tr', null, h('th', null, 'Field'), h('th', null, 'Value'))),
      h(
        'tbody',
        null,
        ...rows.map(([k, v]) =>
          h(
            'tr',
            null,
            h('td', { class: 'field-name' }, k),
            h('td', { class: v === 'None' || v === 'No' || v === '0 bytes' ? 'val-muted' : 'val-highlight' }, v)
          )
        )
      )
    )
  }

  private copyGps(): void {
    if (!this.currentMeta?.gps) return
    const text = formatGpsDecimal(this.currentMeta.gps)
    navigator.clipboard.writeText(text).then(
      () => {
        this.copyGpsBtn.textContent = 'Copied!'
        setTimeout(() => {
          this.copyGpsBtn.textContent = 'Copy coordinates'
        }, 2000)
      },
      () => this.onStatus(`Couldn't copy. The coordinates are ${text}`)
    )
  }
}
