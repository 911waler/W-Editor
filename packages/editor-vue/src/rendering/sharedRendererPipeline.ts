import { bindReferenceNavigation, hydrateReferenceStyles, renderReferencesHtml } from '../adapters/referenceNode'
import Cherry from 'cherry-markdown/dist/cherry-markdown.esm.js'
import * as echarts from 'echarts'
import katex from 'katex'
import mermaid from 'mermaid'

import type { DocumentSnapshot, PreviewRenderResult, ResourceOptions } from '@w-editor/editor-core'
import { normalizeMarkdownForCherry, taskItemMarkers } from '@w-editor/editor-core'

import { prepareCherryFormulas } from '../services/prepareCherryFormulas'
import { sanitizeCherryHtmlWithSafeFormulas } from '../services/rehydrateCherryFormulas'
import { W_EDITOR_CHERRY_ENGINE_OPTIONS } from '../adapters/wEditorCherrySyntax'
import { hydrateRendererContent, type RendererHydrationOptions } from './rendererHydration'
import { sanitizeRendererExtensions, type RendererExtension } from './rendererExtensions'
import { rendererProfileCapabilities, type RendererProfile, type RendererProfileCapabilities } from './rendererProfiles'

export const SHARED_RENDERER_PIPELINE_ID = 'w-editor-shared-renderer-v1' as const

export const SHARED_RENDERER_STAGES = Object.freeze([
  'markdown-compatibility',
  'cherry-render',
  'sanitizer',
  'formula-rehydrate',
  'chart-hydration',
  'mermaid-hydration',
  'code-enhancement',
] as const)

export interface SharedRendererResult extends PreviewRenderResult {
  readonly capabilities: RendererProfileCapabilities
  readonly pipelineId: typeof SHARED_RENDERER_PIPELINE_ID
  readonly profile: RendererProfile
}

export interface SharedRendererPipelineOptions {
  readonly extensions?: readonly RendererExtension[]
  readonly resourceOptions?: ResourceOptions
}

function bindRenderedTaskItems(html: string, snapshot: DocumentSnapshot, ownerDocument: Document): string {
  const markers = taskItemMarkers(snapshot.markdown)
  if (markers.length === 0) return html
  const template = ownerDocument.createElement('template')
  template.innerHTML = html
  const items = [...template.content.querySelectorAll<HTMLElement>('li.check-list-item')]
  if (items.length !== markers.length) return html
  const compatible = items.every((item, index) => {
    const indicator = item.querySelector<HTMLElement>('.ch-icon-check, .ch-icon-square')
    const marker = markers[index]
    return indicator !== null && marker !== undefined
      && indicator.classList.contains('ch-icon-check') === marker.checked
  })
  if (!compatible) return html
  for (const [index, item] of items.entries()) item.dataset['wEditorTaskIndex'] = String(index)
  return template.innerHTML
}

export class SharedRendererPipeline {
  readonly pipelineId = SHARED_RENDERER_PIPELINE_ID
  readonly stages = SHARED_RENDERER_STAGES
  readonly #extensions: readonly RendererExtension[]
  readonly #resourceOptions: ResourceOptions
  readonly #pendingReleases = new Set<() => void>()

  constructor(options: SharedRendererPipelineOptions = {}) {
    this.#extensions = Object.freeze([...(options.extensions ?? [])])
    this.#resourceOptions = Object.freeze({ ...(options.resourceOptions ?? {}) })
  }

  render(
    snapshot: DocumentSnapshot,
    profile: RendererProfile = 'author-preview',
    ownerDocument: Document = document,
  ): SharedRendererResult {
    const host = ownerDocument.createElement('div')
    host.hidden = true
    host.setAttribute('aria-hidden', 'true')
    ownerDocument.body?.append(host)
    const formulas = prepareCherryFormulas(snapshot.markdown, ownerDocument)
    const cherry = new Cherry({
      el: host,
      engine: W_EDITOR_CHERRY_ENGINE_OPTIONS,
      value: normalizeMarkdownForCherry(formulas.markdown),
      externals: { echarts, katex, mermaid },
      editor: { defaultModel: 'previewOnly' },
      toolbars: {
        toolbar: false,
        toolbarRight: false,
        bubble: false,
        float: false,
        sidebar: false,
      },
    })

    try {
      const safeHtml = bindRenderedTaskItems(
        sanitizeCherryHtmlWithSafeFormulas(cherry.getHtml(false), ownerDocument, formulas.sources),
        snapshot,
        ownerDocument,
      )
      const extensionHtml = sanitizeRendererExtensions(
        this.#extensions,
        snapshot,
        profile,
        this.#resourceOptions,
        ownerDocument,
      )
      return Object.freeze({
        capabilities: rendererProfileCapabilities(profile),
        html: `${renderReferencesHtml(safeHtml, ownerDocument)}${extensionHtml}`,
        pipelineId: SHARED_RENDERER_PIPELINE_ID,
        profile,
        snapshot,
      })
    } finally {
      // Cherry schedules one preview refresh of its own. Keep this hidden,
      // unmarked host alive until that callback runs, then release everything.
      const scheduler = ownerDocument.defaultView ?? globalThis
      const release = (): void => {
        scheduler.clearTimeout(timeoutId)
        cherry.destroy()
        host.remove()
        this.#pendingReleases.delete(release)
      }
      const timeoutId = scheduler.setTimeout(release, 0)
      this.#pendingReleases.add(release)
    }
  }

  hydrate(root: HTMLElement, options: RendererHydrationOptions): () => void {
    const stopHydration = hydrateRendererContent(root, options)
    const stopReferences = bindReferenceNavigation(root, () => false)
    const stopStyles = hydrateReferenceStyles(root)
    return () => { stopStyles(); stopReferences(); stopHydration() }
  }

  destroy(): void {
    for (const release of [...this.#pendingReleases]) release()
  }
}

export function createSharedRendererPipeline(options: SharedRendererPipelineOptions = {}): SharedRendererPipeline {
  return new SharedRendererPipeline(options)
}

export const defaultSharedRendererPipeline = createSharedRendererPipeline()
