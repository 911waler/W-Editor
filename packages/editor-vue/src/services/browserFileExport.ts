import { ensureReferenceStyles, areReferenceStylesReady } from './citationFormatting'
import { buildReferenceList } from '../adapters/referenceNode'
import { scanReferences } from '@w-editor/editor-core'
import type { DocumentSnapshot } from '@w-editor/editor-core'
import { sanitizeCherryHtmlWithSafeFormulas } from './rehydrateCherryFormulas'
import type { PreviewRenderer } from './workspaceModeAdapters'
import { isAppearanceTheme, type AppearanceTheme } from './appearanceTheme'
import type { TiptapPresentationOptions } from '../rendering/tiptapPresentation'

export interface ExportArtifact {
  readonly blob: Blob
  readonly filename: string
  readonly mediaType: string
  readonly revision: number
}

export interface ObjectUrlPort {
  readonly createObjectURL: (blob: Blob) => string
  readonly revokeObjectURL: (url: string) => void
}

export interface SafeRenderedExportDocument {
  readonly bodyHtml: string
  readonly documentId: string
  readonly lineHeight?: number
  readonly mountPresentation?: TiptapExportPresentationMount
  readonly presentationEngine?: 'cherry' | 'tiptap'
  readonly revision: number
  readonly theme?: AppearanceTheme
}

export interface TiptapExportPresentationMountResult {
  readonly dispose: () => void
  readonly root: HTMLElement
}

export type TiptapExportPresentationMount = (
  container: HTMLElement,
) => Promise<TiptapExportPresentationMountResult>

export interface ExportPresentation {
  readonly lineHeight: number
  readonly theme: AppearanceTheme
}

export interface HtmlDerivedExportArtifacts {
  readonly html: ExportArtifact
  readonly rendered: SafeRenderedExportDocument
}

export const EXPORT_STYLES = `
.w-reference { font-size: .8em; vertical-align: super; }
.w-reference-list { border-top: 1px solid #aaa; margin-top: 24px; overflow-wrap: anywhere; }
html { --w-editor-content-font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --w-editor-heading-font-family: Georgia, serif; color: #17211d; background: #fff; font-family: var(--w-editor-content-font-family); font-synthesis: weight style; line-height: 1.75; }
body { margin: 0; }
.rendered-document-theme { position: static; display: block; width: 100%; min-height: 0; height: auto; background: transparent; box-shadow: none; }
.rendered-document-content { width: 100%; color: #41544c; font-family: var(--w-editor-content-font-family); font-size: 16px; line-height: var(--w-editor-line-height, 1.75); }
.rendered-document-content > h1 { margin: 30px 0 16px; color: #41544c; font-family: var(--w-editor-heading-font-family); font-size: 32px; font-weight: 700; line-height: 35.2px; }
.rendered-document-content > h2 { margin: 30px 0 16px; color: #41544c; font-family: var(--w-editor-heading-font-family); font-size: 24px; font-weight: 700; line-height: 26.4px; }
.rendered-document-content > h3 { margin: 30px 0 16px; color: #41544c; font-family: var(--w-editor-heading-font-family); font-size: 20px; font-weight: 700; line-height: 22px; }
.rendered-document-content > h4 { margin: 12px 0; color: #41544c; font-family: var(--w-editor-heading-font-family); font-size: 16px; font-weight: 700; line-height: 17.6px; }
.rendered-document-content > h5 { margin: 12px 0; color: #41544c; font-family: var(--w-editor-heading-font-family); font-size: 14px; font-weight: 700; line-height: 15.4px; }
.rendered-document-content > p { max-width: 100%; margin: 16px 0; color: #41544c; font-family: var(--w-editor-content-font-family); font-size: 16px; font-weight: 400; line-height: var(--w-editor-line-height, 1.75); }
.rendered-document-content :is(ol, ul) { margin: 16px 0; padding-left: 24px; padding-inline-start: 24px; font-family: var(--w-editor-content-font-family); font-size: 16px; line-height: var(--w-editor-line-height, 1.75); }
.rendered-document-content :is(ol, ul) :is(ol, ul) { margin-block: 0; }
.rendered-document-content > blockquote { margin: 0 0 16px; padding: 0 0 0 16px; padding-inline-start: 16px; border: 0; border-left: 3px solid #52655d; border-inline-start: 3px solid #52655d; border-radius: 0; background: transparent; color: #41544c; }
.rendered-document-content > blockquote > p { margin: 0; }
.rendered-document-content .cherry-text-align__justify { text-align: justify; text-align-last: justify; }
.w-editor-export { box-sizing: border-box; width: 960px; max-width: 100%; margin: 0 auto; padding: 48px; }
.w-editor-export a.anchor { display: none !important; }
img, video { max-width: 100%; height: auto; }
.w-editor-export-omitted-image { box-sizing: border-box; display: flex; min-height: 112px; margin: 16px 0; padding: 18px 20px; align-items: center; gap: 12px; border: 1px dashed #aeb7c4; border-radius: 8px; background: #f7f8fa; color: #566171; }
.w-editor-export-omitted-image__icon { display: inline-flex; width: 28px; height: 28px; flex: 0 0 28px; align-items: center; justify-content: center; border: 1px solid currentColor; border-radius: 4px; font-size: 22px; line-height: 1; }
.w-editor-export-omitted-image__caption { min-width: 0; overflow-wrap: anywhere; font-weight: 600; }
.w-editor-export-omitted-image__origin { min-width: 0; overflow-wrap: anywhere; color: #737d8c; font-size: 12px; }
pre { overflow-wrap: anywhere; white-space: pre-wrap; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #cfd5df; padding: 6px 10px; text-align: start; }
blockquote { border-inline-start: 4px solid #cfd5df; margin-inline: 0; padding-inline-start: 16px; }
@media print { .w-editor-export { max-width: none; padding: 0; } }
`.trim()

function escapeHtmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function createStandaloneExportHtml(rendered: SafeRenderedExportDocument): string {
  const title = escapeHtmlText(rendered.documentId)
  const theme = isAppearanceTheme(rendered.theme) ? rendered.theme : 'default'
  const lineHeight = typeof rendered.lineHeight === 'number'
    && Number.isFinite(rendered.lineHeight)
    && rendered.lineHeight >= 1
    && rendered.lineHeight <= 3
    ? rendered.lineHeight
    : 1.75
  const engineClass = rendered.presentationEngine === 'tiptap' ? 'tiptap ProseMirror' : 'cherry-markdown'
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="generator" content="W-Editor">\n<title>${title}</title>\n<style>${EXPORT_STYLES}</style>\n</head>\n<body>\n<div class="cherry theme__${theme} rendered-document-theme w-editor-export-theme" style="--w-editor-line-height:${lineHeight}"><main class="w-editor-export ${engineClass} rendered-document-content" data-document-id="${title}" data-revision="${rendered.revision}">${rendered.bodyHtml}</main></div>\n</body>\n</html>\n`
}

export function renderSafeExportDocument(
  snapshot: DocumentSnapshot,
  renderer: PreviewRenderer,
  presentation?: ExportPresentation,
): SafeRenderedExportDocument {
  assertReferenceStylesReady(snapshot)
  const result = renderer.render(snapshot)
  if (result.snapshot.documentId !== snapshot.documentId
    || result.snapshot.revision !== snapshot.revision
    || result.snapshot.markdown !== snapshot.markdown) {
    throw new BrowserFileExportError('The Cherry renderer returned a different document revision.')
  }
  return Object.freeze({
    bodyHtml: sanitizeCherryHtmlWithSafeFormulas(result.html),
    documentId: snapshot.documentId,
    ...(presentation === undefined ? {} : { lineHeight: presentation.lineHeight, theme: presentation.theme }),
    presentationEngine: 'cherry',
    revision: snapshot.revision,
  })
}

const TIPTAP_EXPORT_CHROME_SELECTOR = [
  '.complex-node__controls',
  '.table-cell-selection-overlay',
  '.table-node-view__handle',
  '.table-node-view__menu',
  '.visual-block-context',
  '.visual-code-block__expand',
  '.visual-code-block__language',
  '.visual-code-block__toolbar',
  '[data-raw-edit]',
  '[data-semantic-edit]',
].join(', ')

export function renderSafeTiptapExportDocument(
  snapshot: DocumentSnapshot,
  presentationRoot: HTMLElement,
  presentation?: ExportPresentation,
): SafeRenderedExportDocument {
  assertReferenceStylesReady(snapshot)
  if (!presentationRoot.classList.contains('ProseMirror')) {
    throw new BrowserFileExportError('The Tiptap export root is not a ProseMirror presentation.')
  }
  const clone = presentationRoot.cloneNode(true)
  if (!(clone instanceof HTMLElement)) throw new BrowserFileExportError('The Tiptap presentation could not be cloned.')
  const references = scanReferences(snapshot.markdown)
  // Fallback blocks can contain local bibliographies. Export one document-wide list.
  if (references.length) clone.querySelectorAll('.w-reference-list').forEach(element => element.remove())
  clone.querySelectorAll(TIPTAP_EXPORT_CHROME_SELECTOR).forEach((element) => element.remove())
  clone.querySelectorAll('script, iframe, object, embed, form').forEach((element) => element.remove())
  const elements = [clone, ...clone.querySelectorAll<HTMLElement>('*')]
  for (const element of elements) {
    element.classList.remove('ProseMirror-selectednode')
    if (element.dataset['selected'] === 'true') element.dataset['selected'] = 'false'
    for (const attribute of [...element.attributes]) {
      if (/^on/iu.test(attribute.name)) element.removeAttribute(attribute.name)
    }
    element.removeAttribute('contenteditable')
    element.removeAttribute('tabindex')
    element.removeAttribute('aria-readonly')
  }
  return Object.freeze({
    bodyHtml: clone.innerHTML + (references.length ? buildReferenceList(references, clone.ownerDocument).outerHTML : ''),
    documentId: snapshot.documentId,
    ...(presentation === undefined ? {} : { lineHeight: presentation.lineHeight, theme: presentation.theme }),
    presentationEngine: 'tiptap',
    revision: snapshot.revision,
  })
}

export function createTiptapRenderedExportDocument(
  snapshot: DocumentSnapshot,
  options: Omit<TiptapPresentationOptions, 'profile' | 'snapshot'> & ExportPresentation,
): SafeRenderedExportDocument {
  return Object.freeze({
    bodyHtml: '',
    documentId: snapshot.documentId,
    lineHeight: options.lineHeight,
    mountPresentation: async (container: HTMLElement) => {
      await ensureReferenceStyles(scanReferences(snapshot.markdown).map(reference => reference.style ?? 'plain'))
      const { createTiptapPresentation } = await import('../rendering/tiptapPresentation')
      const instance = createTiptapPresentation(container, {
        ...(options.extensions === undefined ? {} : { extensions: options.extensions }),
        ...(options.locale === undefined ? {} : { locale: options.locale }),
        ...(options.localization === undefined ? {} : { localization: options.localization }),
        ...(options.onError === undefined ? {} : { onError: options.onError }),
        ...(options.resourceOptions === undefined ? {} : { resourceOptions: options.resourceOptions }),
        profile: 'reader',
        snapshot,
      })
      try {
        await instance.settle()
        const root = instance.root.querySelector<HTMLElement>('.ProseMirror')
        if (root === null) throw new BrowserFileExportError('The Tiptap presentation root is unavailable.')
        // Export captures the ProseMirror subtree; its ordinary reference footer is a sibling.
        const references = scanReferences(snapshot.markdown)
        root.querySelectorAll('.w-reference-list').forEach(element => element.remove())
        if (references.length) root.append(buildReferenceList(references, root.ownerDocument))
        return Object.freeze({ dispose: () => instance.destroy(), root })
      } catch (failure) {
        instance.destroy()
        throw failure
      }
    },
    presentationEngine: 'tiptap',
    revision: snapshot.revision,
    theme: options.theme,
  })
}

export async function materializeRenderedExportDocument(
  rendered: SafeRenderedExportDocument,
  ownerDocument: Document,
): Promise<SafeRenderedExportDocument> {
  if (rendered.mountPresentation === undefined) return rendered
  const container = ownerDocument.createElement('div')
  container.hidden = true
  ownerDocument.body.append(container)
  let dispose = (): void => undefined
  try {
    const mounted = await rendered.mountPresentation(container)
    dispose = mounted.dispose
    const bodyHtml = renderSafeTiptapExportDocument({
      documentId: rendered.documentId,
      markdown: '',
      revision: rendered.revision,
    }, mounted.root, {
      lineHeight: rendered.lineHeight ?? 1.75,
      theme: rendered.theme ?? 'default',
    }).bodyHtml
    return Object.freeze({
      bodyHtml,
      documentId: rendered.documentId,
      ...(rendered.lineHeight === undefined ? {} : { lineHeight: rendered.lineHeight }),
      presentationEngine: 'tiptap',
      revision: rendered.revision,
      ...(rendered.theme === undefined ? {} : { theme: rendered.theme }),
    })
  } finally {
    dispose()
    container.remove()
  }
}

export function createHtmlDerivedExportArtifacts(
  rendered: SafeRenderedExportDocument,
): HtmlDerivedExportArtifacts {
  if (rendered.mountPresentation !== undefined) {
    throw new BrowserFileExportError('Mounted presentations must be materialized before creating HTML-derived exports.')
  }
  const htmlMediaType = 'text/html;charset=utf-8'
  return Object.freeze({
    html: Object.freeze({
      blob: new Blob([createStandaloneExportHtml(rendered)], { type: htmlMediaType }),
      filename: `${rendered.documentId}.html`,
      mediaType: htmlMediaType,
      revision: rendered.revision,
    }),
    rendered,
  })
}

export function createHtmlDerivedExports(
  snapshot: DocumentSnapshot,
  renderer: PreviewRenderer,
  presentation?: ExportPresentation,
): HtmlDerivedExportArtifacts {
  const rendered = renderSafeExportDocument(snapshot, renderer, presentation)
  return createHtmlDerivedExportArtifacts(rendered)
}

export class BrowserFileExportError extends Error {
  readonly code = 'BROWSER_FILE_EXPORT_FAILED'

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BrowserFileExportError'
  }
}

export function createMarkdownExport(snapshot: DocumentSnapshot, filename = `${snapshot.documentId}.md`): ExportArtifact {
  const mediaType = 'text/markdown;charset=utf-8'
  return Object.freeze({
    blob: new Blob([snapshot.markdown], { type: mediaType }),
    filename,
    mediaType,
    revision: snapshot.revision,
  })
}

export class BrowserFileExporter {
  readonly #document: Pick<Document, 'createElement'>
  readonly #objectUrls: ObjectUrlPort

  constructor(options: { readonly document: Pick<Document, 'createElement'>; readonly objectUrls: ObjectUrlPort }) {
    this.#document = options.document
    this.#objectUrls = options.objectUrls
  }

  download(artifact: ExportArtifact): void {
    let url: string | null = null
    try {
      url = this.#objectUrls.createObjectURL(artifact.blob)
      const anchor = this.#document.createElement('a')
      anchor.href = url
      anchor.download = artifact.filename
      anchor.rel = 'noopener'
      anchor.click()
    } catch (cause) {
      throw new BrowserFileExportError(
        cause instanceof Error ? cause.message : 'The browser could not create the download.',
        { cause },
      )
    } finally {
      if (url !== null) this.#objectUrls.revokeObjectURL(url)
    }
  }
}

function assertReferenceStylesReady(snapshot: DocumentSnapshot): void {
  if (!areReferenceStylesReady(scanReferences(snapshot.markdown).map(reference => reference.style ?? 'plain'))) {
    throw new BrowserFileExportError('Journal styles must finish loading before exporting. Await ensureReferenceStyles first.')
  }
}
