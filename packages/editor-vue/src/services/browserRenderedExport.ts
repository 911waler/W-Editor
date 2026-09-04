import { toBlob as captureDomToBlob } from 'html-to-image'

import {
  EXPORT_STYLES,
  type ExportArtifact,
  type SafeRenderedExportDocument,
} from './browserFileExport'
import { isAppearanceTheme } from './appearanceTheme'

export type RenderedExportFailureCode =
  | 'ASSET_SETTLING_FAILED'
  | 'CAPTURE_FAILED'
  | 'CAPTURE_OVERSIZE'
  | 'CROSS_ORIGIN_TAINT'
  | 'PDF_FAILED'

export class BrowserRenderedExportError extends Error {
  constructor(readonly code: RenderedExportFailureCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BrowserRenderedExportError'
  }
}

export interface LongScreenshotLimits {
  readonly maxHeight: number
  readonly maxPixels: number
  readonly maxWidth: number
}

export const LONG_SCREENSHOT_LIMITS = Object.freeze({
  maxHeight: 32_767,
  maxPixels: 67_108_864,
  maxWidth: 32_767,
}) satisfies LongScreenshotLimits

export interface RenderedExportAdapter {
  readonly captureLongScreenshot: (rendered: SafeRenderedExportDocument) => Promise<RenderedExportArtifact>
  readonly capturePdf: (rendered: SafeRenderedExportDocument) => Promise<RenderedExportArtifact>
}

export interface RenderedExportArtifact extends ExportArtifact {
  readonly omittedRemoteImageCount: number
}

export type RenderedContentHydrator = (root: HTMLElement) => () => void

type CaptureToBlob = (node: HTMLElement, options: {
  readonly backgroundColor: string
  readonly cacheBust: boolean
  readonly canvasHeight: number
  readonly canvasWidth: number
  readonly height: number
  readonly pixelRatio: number
  readonly skipAutoScale: boolean
  readonly width: number
}) => Promise<Blob | null>

type CaptureMeasure = (node: HTMLElement) => Readonly<{ height: number; width: number }>

interface CapturedRenderedSurface {
  readonly breakCandidates: readonly number[]
  readonly blob: Blob
  readonly height: number
  readonly omittedRemoteImageCount: number
  readonly width: number
}

export interface PdfPageSlice {
  readonly height: number
  readonly start: number
}

function fail(code: RenderedExportFailureCode, message: string, cause?: unknown): BrowserRenderedExportError {
  return new BrowserRenderedExportError(code, message, cause === undefined ? undefined : { cause })
}

function isCrossOriginFailure(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'SecurityError') return true
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return /cors|cross[ -]?origin|failed to fetch|security|taint/iu.test(text)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(fail('ASSET_SETTLING_FAILED', message)), timeoutMs)
    void promise.then(
      (value) => {
        globalThis.clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        globalThis.clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function waitForImage(image: HTMLImageElement, timeoutMs: number): Promise<void> {
  const source = image.currentSrc || image.src
  if (source.length === 0) return
  if (image.complete) {
    if (image.naturalWidth === 0) throw fail('ASSET_SETTLING_FAILED', `Image could not be loaded: ${source}`)
    return
  }
  await withTimeout(new Promise<void>((resolve, reject) => {
    image.addEventListener('load', () => resolve(), { once: true })
    image.addEventListener('error', () => reject(fail('ASSET_SETTLING_FAILED', `Image could not be loaded: ${source}`)), { once: true })
  }), timeoutMs, `Timed out while loading image: ${source}`)
}

export async function settleRenderedAssets(root: ParentNode, timeoutMs = 10_000): Promise<void> {
  const ownerDocument = root instanceof Document ? root : root.ownerDocument
  const fonts = ownerDocument?.fonts
  const fontReady = fonts === undefined ? Promise.resolve() : Promise.resolve(fonts.ready).then(() => undefined)
  const images = [...root.querySelectorAll('img')]
  try {
    await withTimeout(Promise.all([fontReady, ...images.map((image) => waitForImage(image, timeoutMs))]).then(() => undefined), timeoutMs, 'Timed out while settling export assets.')
  } catch (error) {
    if (error instanceof BrowserRenderedExportError) throw error
    throw fail('ASSET_SETTLING_FAILED', error instanceof Error ? error.message : 'Export assets could not be settled.', error)
  }
}

export function assertLongScreenshotSize(
  width: number,
  height: number,
  limits: LongScreenshotLimits = LONG_SCREENSHOT_LIMITS,
): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw fail('CAPTURE_FAILED', 'The rendered document has no capturable dimensions.')
  }
  if (width > limits.maxWidth || height > limits.maxHeight || width * height > limits.maxPixels) {
    throw fail(
      'CAPTURE_OVERSIZE',
      `The rendered document is ${width}×${height}px and exceeds the browser-safe screenshot limit.`,
    )
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)), { once: true })
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Image data could not be read.')), { once: true })
    reader.readAsDataURL(blob)
  })
}

function replaceWithRemoteImagePlaceholder(image: HTMLImageElement, source: URL): void {
  const placeholder = image.ownerDocument.createElement('figure')
  placeholder.className = 'w-editor-export-omitted-image'
  placeholder.dataset['exportOmittedImage'] = 'remote'

  const icon = image.ownerDocument.createElement('span')
  icon.className = 'w-editor-export-omitted-image__icon'
  icon.setAttribute('aria-hidden', 'true')
  icon.textContent = '×'

  const caption = image.ownerDocument.createElement('figcaption')
  caption.className = 'w-editor-export-omitted-image__caption'
  const description = image.alt.trim()
  caption.textContent = description.length > 0 ? description : source.hostname

  const origin = image.ownerDocument.createElement('span')
  origin.className = 'w-editor-export-omitted-image__origin'
  origin.textContent = source.hostname

  placeholder.append(icon, caption)
  if (origin.textContent !== caption.textContent) placeholder.append(origin)
  image.replaceWith(placeholder)
}

async function embedCrossOriginImages(root: HTMLElement, fetcher: typeof fetch, baseUrl: string): Promise<number> {
  let omittedRemoteImageCount = 0
  for (const image of root.querySelectorAll<HTMLImageElement>('img[src]')) {
    const parsed = new URL(image.src, baseUrl)
    if (parsed.protocol === 'data:' || parsed.protocol === 'blob:' || parsed.origin === new URL(baseUrl).origin) continue
    try {
      const response = await fetcher(parsed.href, { credentials: 'omit', mode: 'cors' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = await response.blob()
      if (!blob.type.startsWith('image/')) throw new Error(`Unexpected media type ${blob.type || '(empty)'}`)
      image.src = await blobToDataUrl(blob)
    } catch {
      replaceWithRemoteImagePlaceholder(image, parsed)
      omittedRemoteImageCount += 1
    }
  }
  return omittedRemoteImageCount
}

function defaultMeasure(node: HTMLElement): Readonly<{ height: number; width: number }> {
  const bounds = node.getBoundingClientRect()
  return Object.freeze({
    height: Math.ceil(Math.max(node.scrollHeight, bounds.height)),
    width: Math.ceil(Math.max(node.scrollWidth, bounds.width)),
  })
}

function collectPageBreakCandidates(host: HTMLElement, height: number): readonly number[] {
  const hostTop = host.getBoundingClientRect().top
  const candidates = [...host.children].flatMap((child) => {
    if (!(child instanceof HTMLElement)) return []
    if (child.previousElementSibling?.matches('h1, h2, h3, h4, h5, h6') === true) return []
    const offset = Math.round(child.getBoundingClientRect().top - hostTop)
    return offset > 1 && offset < height - 1 ? [offset] : []
  })
  return Object.freeze([...new Set(candidates)].sort((left, right) => left - right))
}

export function planPdfPageSlices(
  totalHeight: number,
  maxSliceHeight: number,
  breakCandidates: readonly number[],
): readonly PdfPageSlice[] {
  if (!Number.isFinite(totalHeight) || !Number.isFinite(maxSliceHeight) || totalHeight <= 0 || maxSliceHeight <= 0) {
    throw new RangeError('PDF page slices require positive finite dimensions.')
  }
  const candidates = [...breakCandidates]
    .filter((candidate) => Number.isFinite(candidate) && candidate > 0 && candidate < totalHeight)
    .sort((left, right) => left - right)
  const slices: PdfPageSlice[] = []
  let start = 0
  while (totalHeight - start > maxSliceHeight + 0.5) {
    const target = start + maxSliceHeight
    const minimumUsefulBreak = start + maxSliceHeight * 0.65
    const safeBreak = candidates.findLast((candidate) => candidate >= minimumUsefulBreak && candidate <= target)
    const end = safeBreak ?? target
    slices.push(Object.freeze({ height: end - start, start }))
    start = end
  }
  slices.push(Object.freeze({ height: totalHeight - start, start }))
  return Object.freeze(slices)
}

export class BrowserRenderedExportAdapter implements RenderedExportAdapter {
  readonly #assetSettler: (root: ParentNode) => Promise<void>
  readonly #capture: CaptureToBlob
  readonly #document: Document
  readonly #fetch: typeof fetch
  readonly #hydrateRenderedContent: RenderedContentHydrator
  readonly #limits: LongScreenshotLimits
  readonly #measure: CaptureMeasure
  readonly #window: Window

  constructor(options: {
    readonly assetSettler?: (root: ParentNode) => Promise<void>
    readonly capture?: CaptureToBlob
    readonly document: Document
    readonly fetcher?: typeof fetch
    readonly hydrateRenderedContent?: RenderedContentHydrator
    readonly limits?: LongScreenshotLimits
    readonly measure?: CaptureMeasure
    readonly window: Window
  }) {
    this.#assetSettler = options.assetSettler ?? settleRenderedAssets
    this.#capture = options.capture ?? captureDomToBlob
    this.#document = options.document
    this.#fetch = options.fetcher ?? fetch
    this.#hydrateRenderedContent = options.hydrateRenderedContent ?? (() => () => undefined)
    this.#limits = options.limits ?? LONG_SCREENSHOT_LIMITS
    this.#measure = options.measure ?? defaultMeasure
    this.#window = options.window
  }

  async #captureRenderedSurface(rendered: SafeRenderedExportDocument): Promise<CapturedRenderedSurface> {
    const style = this.#document.createElement('style')
    style.textContent = EXPORT_STYLES
    const instanceRoot = this.#document.createElement('div')
    instanceRoot.className = 'w-editor-instance w-editor-export-instance'
    const themeId = isAppearanceTheme(rendered.theme) ? rendered.theme : 'default'
    const lineHeight = typeof rendered.lineHeight === 'number'
      && Number.isFinite(rendered.lineHeight)
      && rendered.lineHeight >= 1
      && rendered.lineHeight <= 3
      ? rendered.lineHeight
      : 1.75
    instanceRoot.dataset['theme'] = themeId
    instanceRoot.style.setProperty('--w-editor-line-height', String(lineHeight))
    const theme = this.#document.createElement('div')
    theme.className = `cherry theme__${themeId} rendered-document-theme w-editor-export-theme`
    theme.style.cssText = 'position:fixed;left:-100000px;top:0;width:960px;max-width:none;background:var(--app-surface,#fff);z-index:-1;'
    const host = this.#document.createElement('main')
    host.className = rendered.mountPresentation !== undefined
      ? 'tiptap-presentation-export-host'
      : rendered.presentationEngine === 'tiptap'
      ? 'tiptap ProseMirror cherry-markdown rendered-document-content w-editor-export'
      : 'cherry-markdown rendered-document-content w-editor-export'
    host.dataset['documentId'] = rendered.documentId
    host.dataset['presentationEngine'] = rendered.presentationEngine ?? 'cherry'
    host.dataset['revision'] = String(rendered.revision)
    host.style.cssText = 'box-sizing:border-box;width:960px;max-width:none;background:var(--app-surface,#fff);'
    if (rendered.mountPresentation === undefined) host.innerHTML = rendered.bodyHtml
    theme.append(host)
    instanceRoot.append(theme)
    this.#document.head.append(style)
    this.#document.body.append(instanceRoot)
    let disposeHydration = (): void => undefined
    let disposePresentation = (): void => undefined
    try {
      let captureTarget = host
      if (rendered.mountPresentation !== undefined) {
        try {
          const mounted = await rendered.mountPresentation(host)
          disposePresentation = mounted.dispose
          captureTarget = mounted.root
          const presentationSurface = captureTarget.closest<HTMLElement>('[data-tiptap-presentation]')
          if (presentationSurface !== null) {
            presentationSurface.style.width = '960px'
            presentationSurface.style.maxWidth = 'none'
            presentationSurface.style.padding = '0'
            presentationSurface.style.boxShadow = 'none'
          }
          captureTarget.classList.add('rendered-document-content', 'w-editor-export')
          captureTarget.dataset['documentId'] = rendered.documentId
          captureTarget.dataset['presentationEngine'] = 'tiptap'
          captureTarget.dataset['revision'] = String(rendered.revision)
        } catch (error) {
          throw fail('CAPTURE_FAILED', error instanceof Error ? error.message : 'The Tiptap presentation could not be mounted.', error)
        }
      }
      try {
        if (rendered.presentationEngine !== 'tiptap') disposeHydration = this.#hydrateRenderedContent(captureTarget)
      } catch (error) {
        throw fail('CAPTURE_FAILED', error instanceof Error ? error.message : 'Rendered content could not be prepared for capture.', error)
      }
      const omittedRemoteImageCount = await embedCrossOriginImages(captureTarget, this.#fetch, this.#window.location.href)
      await this.#assetSettler(captureTarget)
      const { height, width } = this.#measure(captureTarget)
      assertLongScreenshotSize(width, height, this.#limits)
      const breakCandidates = collectPageBreakCandidates(captureTarget, height)
      let blob: Blob | null
      try {
        blob = await this.#capture(captureTarget, {
          backgroundColor: this.#window.getComputedStyle(captureTarget).backgroundColor || '#ffffff',
          cacheBust: true,
          canvasHeight: height,
          canvasWidth: width,
          height,
          pixelRatio: 1,
          skipAutoScale: true,
          width,
        })
      } catch (error) {
        if (isCrossOriginFailure(error)) {
          throw fail('CROSS_ORIGIN_TAINT', 'A cross-origin asset prevented safe screenshot capture.', error)
        }
        throw fail('CAPTURE_FAILED', error instanceof Error ? error.message : 'The browser could not capture the rendered document.', error)
      }
      if (blob === null) throw fail('CAPTURE_FAILED', 'The browser returned no PNG data for the rendered document.')
      return Object.freeze({ blob, breakCandidates, height, omittedRemoteImageCount, width })
    } finally {
      disposeHydration()
      disposePresentation()
      instanceRoot.remove()
      style.remove()
    }
  }

  async captureLongScreenshot(rendered: SafeRenderedExportDocument): Promise<RenderedExportArtifact> {
    const capture = await this.#captureRenderedSurface(rendered)
    return Object.freeze({
      blob: capture.blob,
      filename: `${rendered.documentId}.png`,
      mediaType: 'image/png',
      omittedRemoteImageCount: capture.omittedRemoteImageCount,
      revision: rendered.revision,
    })
  }

  async capturePdf(rendered: SafeRenderedExportDocument): Promise<RenderedExportArtifact> {
    const capture = await this.#captureRenderedSurface(rendered)
    try {
      const { jsPDF } = await import('jspdf')
      const pdf = new jsPDF({ compress: true, format: 'a4', orientation: 'portrait', unit: 'mm' })
      pdf.setProperties({ creator: 'W-Editor', title: rendered.documentId })
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const margin = 5
      const printableWidth = pageWidth - margin * 2
      const printableHeight = pageHeight - margin * 2
      const millimetersPerPixel = printableWidth / capture.width
      const imageHeight = capture.height * millimetersPerPixel
      const slices = planPdfPageSlices(
        capture.height,
        printableHeight / millimetersPerPixel,
        capture.breakCandidates,
      )
      const png = new Uint8Array(await capture.blob.arrayBuffer())
      for (const [pageIndex, slice] of slices.entries()) {
        if (pageIndex > 0) pdf.addPage('a4', 'portrait')
        const sliceHeight = Math.min(printableHeight, slice.height * millimetersPerPixel)
        pdf.saveGraphicsState()
        pdf.rect(margin, margin, printableWidth, sliceHeight, null)
        pdf.clip()
        pdf.discardPath()
        pdf.addImage(
          png,
          'PNG',
          margin,
          margin - slice.start * millimetersPerPixel,
          printableWidth,
          imageHeight,
          'w-editor-rendered-document',
          'FAST',
        )
        pdf.restoreGraphicsState()
      }
      const buffer = pdf.output('arraybuffer')
      return Object.freeze({
        blob: new Blob([buffer], { type: 'application/pdf' }),
        filename: `${rendered.documentId}.pdf`,
        mediaType: 'application/pdf',
        omittedRemoteImageCount: capture.omittedRemoteImageCount,
        revision: rendered.revision,
      })
    } catch (error) {
      throw fail('PDF_FAILED', error instanceof Error ? error.message : 'The browser could not create the PDF document.', error)
    }
  }
}
