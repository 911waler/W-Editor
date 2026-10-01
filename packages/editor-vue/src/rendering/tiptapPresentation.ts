import { buildReferenceList } from '../adapters/referenceNode'
import { ensureReferenceStyles } from '../services/citationFormatting'
import {
  DocumentSession,
  createTaskItemCheckedPlan,
  projectOrdinaryMarkdown,
  scanReferences,
  type DocumentSnapshot,
  type ResourceOptions,
} from '@w-editor/editor-core'

import {
  TiptapVisualAdapter,
  type TiptapVisualProjection,
} from '../adapters/tiptapVisualAdapter'
import type { RendererExtension } from './rendererExtensions'
import { sanitizeRendererExtensions } from './rendererExtensions'
import type { RendererProfile } from './rendererProfiles'
import { createSharedRendererPipeline } from './sharedRendererPipeline'
import {
  createUiLocalizationStore,
  type UiLocale,
  type UiLocalizationStore,
} from '../services/uiLocalization'

export interface TiptapPresentationTaskToggleEvent {
  readonly checked: boolean
  readonly index: number
  readonly snapshot: DocumentSnapshot
}

export interface TiptapPresentationOptions {
  readonly extensions?: readonly RendererExtension[]
  readonly locale?: UiLocale
  readonly localization?: UiLocalizationStore
  readonly onCodeEdit?: (index: number) => void
  readonly onError?: (failure: unknown) => void
  readonly onSnapshotChange?: (snapshot: DocumentSnapshot) => void
  readonly onTaskToggle?: (event: TiptapPresentationTaskToggleEvent) => void
  readonly profile: RendererProfile
  readonly resourceOptions?: ResourceOptions
  readonly snapshot: DocumentSnapshot
}

export interface TiptapPresentationInstance {
  readonly destroy: () => void
  readonly root: HTMLElement
  readonly setSnapshot: (snapshot: DocumentSnapshot) => void
  readonly settle: (timeoutMs?: number) => Promise<void>
  readonly snapshot: () => DocumentSnapshot
}

function fallbackText(html: string, ownerDocument: Document): string {
  const template = ownerDocument.createElement('template')
  template.innerHTML = html
  return (template.content.textContent ?? '').replace(/\s+/gu, ' ').trim()
}

function codeBlockIndex(projection: TiptapVisualProjection, source: string): number {
  const blocks = projection.content.content?.filter((node) => node.type === 'codeBlock') ?? []
  return blocks.findIndex((node) => node.attrs?.['originalSource'] === source)
}

function containsRawInline(node: Readonly<{ readonly content?: readonly unknown[] | undefined; readonly type?: string | undefined }>): boolean {
  if (node.type === 'rawInline') return true
  return (node.content ?? []).some((child) => (
    typeof child === 'object' && child !== null && containsRawInline(child as Readonly<{ readonly content?: readonly unknown[] | undefined; readonly type?: string | undefined }>))
  )
}

type PresentationNode = Readonly<{ readonly attrs?: Record<string, unknown> | undefined; readonly content?: readonly PresentationNode[] | undefined; readonly type?: string | undefined }>

function hasSupportedInlineImage(node: PresentationNode): boolean {
  if (node.type === 'inlineImage') return true
  return (node.content ?? []).some(hasSupportedInlineImage)
}

function hasExtendedInlineImage(node: PresentationNode): boolean {
  if (node.type === 'inlineImage') {
    const source = String(node.attrs?.['source'] ?? '')
    const extension = /\}\s*$/u.test(source) ? source.slice(source.lastIndexOf('{')) : ''
    return (extension.length > 0 && !/^\{(?:\s*(?:width|height)=[1-9]\d*)+\s*\}$/u.test(extension))
      || /^!\[[^\]]*#/u.test(source)
  }
  return (node.content ?? []).some(hasExtendedInlineImage)
}

function requiresCherryFallback(
  node: PresentationNode,
  source: string,
): boolean {
  if (node.type === 'rawBlock') return true
  if (node.type === 'codeBlock') return false
  if (/!\[[^\]\r\n]*\]\([^\r\n)]+\)(?:\{[^}\r\n]*\})?/u.test(source)
    && (!hasSupportedInlineImage(node) || hasExtendedInlineImage(node))) return true
  return (node.type === 'paragraph' || containsRawInline(node))
    && /<(?:a|audio|div|img|span|video)\b|<!--/iu.test(source)
}

function waitForImage(image: HTMLImageElement): Promise<void> {
  if (image.currentSrc.length === 0 && image.src.length === 0) return Promise.resolve()
  if (image.complete) return Promise.resolve()
  return new Promise((resolve) => {
    const settle = (): void => resolve()
    image.addEventListener('load', settle, { once: true })
    image.addEventListener('error', settle, { once: true })
  })
}

async function waitForPresentation(root: HTMLElement, timeoutMs: number): Promise<void> {
  const ownerDocument = root.ownerDocument
  const view = ownerDocument.defaultView
  const deadline = Date.now() + timeoutMs
  if (ownerDocument.fonts !== undefined) await Promise.race([
    Promise.resolve(ownerDocument.fonts.ready),
    new Promise<void>((_, reject) => view?.setTimeout(() => reject(new Error('Timed out while loading presentation fonts.')), timeoutMs)),
  ])
  await Promise.all([...root.querySelectorAll('img')].map(waitForImage))
  while (root.querySelector('[aria-busy="true"], [data-preview-state="loading"]') !== null) {
    if (Date.now() >= deadline) throw new Error('Timed out while settling the Tiptap presentation.')
    await new Promise<void>((resolve) => {
      if (view?.requestAnimationFrame !== undefined) view.requestAnimationFrame(() => resolve())
      else globalThis.setTimeout(resolve, 16)
    })
  }
}

class TiptapPresentationController implements TiptapPresentationInstance {
  readonly #extensions: readonly RendererExtension[]
  readonly #fallbackPipeline = createSharedRendererPipeline()
  readonly #host: HTMLElement
  readonly #localization: UiLocalizationStore
  readonly #onCodeEdit: TiptapPresentationOptions['onCodeEdit']
  readonly #onError: TiptapPresentationOptions['onError']
  readonly #onSnapshotChange: TiptapPresentationOptions['onSnapshotChange']
  readonly #onTaskToggle: TiptapPresentationOptions['onTaskToggle']
  readonly #profile: RendererProfile
  readonly #resourceOptions: ResourceOptions
  readonly root: HTMLElement
  #adapter: TiptapVisualAdapter | null = null
  #destroyed = false
  #session: DocumentSession

  constructor(container: HTMLElement, options: TiptapPresentationOptions) {
    this.#extensions = Object.freeze([...(options.extensions ?? [])])
    this.#localization = options.localization ?? createUiLocalizationStore(options.locale ?? 'zh')
    this.#onCodeEdit = options.onCodeEdit
    this.#onError = options.onError
    this.#onSnapshotChange = options.onSnapshotChange
    this.#onTaskToggle = options.onTaskToggle
    this.#profile = options.profile
    this.#resourceOptions = Object.freeze({ ...(options.resourceOptions ?? {}) })
    this.#session = new DocumentSession(options.snapshot)
    const ownerDocument = container.ownerDocument
    const surface = ownerDocument.createElement('article')
    surface.className = 'visual-surface tiptap-presentation-surface'
    surface.dataset['mode'] = 'preview'
    surface.dataset['rendererProfile'] = this.#profile
    surface.dataset['tiptapPresentation'] = ''
    const host = ownerDocument.createElement('div')
    host.className = 'visual-editor-host tiptap-presentation-host'
    surface.append(host)
    container.append(surface)
    this.root = surface
    this.#host = host
    this.#mountAdapter()
  }

  snapshot(): DocumentSnapshot {
    return this.#session.snapshot()
  }

  setSnapshot(snapshot: DocumentSnapshot): void {
    this.#assertActive()
    this.#adapter?.destroy()
    this.#adapter = null
    this.#host.replaceChildren()
    this.#session = new DocumentSession(snapshot)
    this.#mountAdapter()
  }

  async settle(timeoutMs = 10_000): Promise<void> {
    this.#assertActive()
    await ensureReferenceStyles(scanReferences(this.#session.snapshot().markdown).map(reference => reference.style ?? 'plain'))
    await waitForPresentation(this.root, timeoutMs)
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#adapter?.destroy()
    this.#adapter = null
    this.root.remove()
  }

  #project = (snapshot: DocumentSnapshot): TiptapVisualProjection => {
    const projection = projectOrdinaryMarkdown(snapshot)
    const content = (projection.content.content ?? []).map((node, index) => {
      const entry = projection.map.entries[index]
      const source = entry?.originalSource ?? String(node.attrs?.['source'] ?? '')
      if (!requiresCherryFallback(node, source)) return node
      const fallback = this.#fallbackPipeline.render(Object.freeze({
        documentId: `${snapshot.documentId}:fallback:${index}`,
        markdown: source,
        revision: snapshot.revision,
      }), 'reader', this.root.ownerDocument)
      return Object.freeze({
        attrs: Object.freeze({
          ...(node.attrs ?? {}),
          fallbackKind: 'cherry-raw',
          safeHtml: fallback.html,
          showSourceWhenEmpty: node.type === 'rawBlock',
          source,
        }),
        type: 'presentationFallback',
      })
    })
    const extensionHtml = sanitizeRendererExtensions(
      this.#extensions,
      snapshot,
      this.#profile,
      this.#resourceOptions,
      this.root.ownerDocument,
    )
    if (extensionHtml.length > 0) {
      content.push(Object.freeze({
        attrs: Object.freeze({
          fallbackKind: 'renderer-extension',
          safeHtml: extensionHtml,
          showSourceWhenEmpty: false,
          source: fallbackText(extensionHtml, this.root.ownerDocument),
        }),
        type: 'presentationFallback',
      }))
    }
    return Object.freeze({
      ...projection,
      content: { ...projection.content, content },
    })
  }

  #mountAdapter(): void {
    const adapter = new TiptapVisualAdapter({
      ...(this.#profile === 'author-preview' && this.#onCodeEdit !== undefined
        ? { allowReadOnlySemanticEdit: true }
        : {}),
      host: this.#host,
      localization: this.#localization,
      ...(this.#profile === 'author-preview'
        ? { onReadOnlyTaskToggle: ({ checked, index }) => this.#toggleTask(index, checked) }
        : {}),
      onSemanticCopy: (event) => {
        const clipboard = this.root.ownerDocument.defaultView?.navigator.clipboard
        if (clipboard === undefined) return
        try {
          void clipboard.writeText(event.code).catch((failure: unknown) => this.#onError?.(failure))
        } catch (failure) {
          this.#onError?.(failure)
        }
      },
      ...(this.#profile === 'author-preview' && this.#onCodeEdit !== undefined
        ? {
            onSemanticEdit: (event) => {
              if (event.kind !== 'code-block') return
              const index = codeBlockIndex(this.#project(this.#session.snapshot()), event.source)
              if (index >= 0) this.#onCodeEdit?.(index)
            },
          }
        : {}),
      project: this.#project,
      session: this.#session,
    })
    adapter.setPresentationMode(true, this.#profile)
    const presentation = this.#host.querySelector<HTMLElement>('.ProseMirror')
    presentation?.setAttribute('aria-label', this.#localization.t('mode.surface.preview'))
    if (this.#profile === 'reader') {
      presentation?.querySelectorAll(
        '[data-semantic-edit], [data-raw-edit], .visual-code-block__language, .table-node-view__handle, .table-node-view__menu, .table-cell-selection-overlay',
      ).forEach((control) => control.remove())
    }
    // Fallback fragments have their own serialized bibliography. Replace all fragments
    // with one live document list, which hydrates after local journal chunks load.
    this.#host.querySelectorAll('.w-reference-list').forEach(list => list.remove())
    const references = scanReferences(this.#session.snapshot().markdown)
    if (references.length) this.#host.append(buildReferenceList(references, this.#host.ownerDocument))
    const seen = new Set<string>()
    for (const anchor of this.#host.querySelectorAll<HTMLElement>('[data-reference-id]')) {
      const id = anchor.dataset['referenceId']!
      anchor.id = seen.has(id) ? '' : `citation-${id}`
      seen.add(id)
    }
    this.#adapter = adapter
  }

  #toggleTask(index: number, checked: boolean): boolean {
    try {
      const current = this.#session.snapshot()
      const plan = createTaskItemCheckedPlan(
        current,
        index,
        checked,
        `tiptap-presentation-task:${current.documentId}:${current.revision + 1}`,
      )
      if (plan !== null) this.#session.commitPatchPlan(plan, 'toolbar-command')
      const snapshot = this.#session.snapshot()
      this.#onSnapshotChange?.(snapshot)
      this.#onTaskToggle?.(Object.freeze({ checked, index, snapshot }))
      return true
    } catch (failure) {
      this.#onError?.(failure)
      return false
    }
  }

  #assertActive(): void {
    if (this.#destroyed) throw new Error('The Tiptap presentation has been destroyed.')
  }
}

export function createTiptapPresentation(
  container: HTMLElement,
  options: TiptapPresentationOptions,
): TiptapPresentationInstance {
  return new TiptapPresentationController(container, options)
}
