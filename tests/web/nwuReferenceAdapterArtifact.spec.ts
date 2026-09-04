import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WEditorMountOptions, WRendererMountOptions } from '../../packages/editor-web/src/index'

const adapterSource = readFileSync(resolve(import.meta.dirname, '../fixtures/nwu-reference/nwu-reference-adapter.js'), 'utf8')

interface ReferenceWEditorGlobal {
  readonly mountWEditor: (container: HTMLElement, options: WEditorMountOptions) => { destroy: (options?: unknown) => Promise<unknown> }
  readonly mountWRenderer: (container: HTMLElement, options: WRendererMountOptions) => { destroy: () => Promise<unknown> }
}

const browserWindow = window as Window & { WEditor?: ReferenceWEditorGlobal }

afterEach(() => {
  document.body.replaceChildren()
  delete browserWindow.WEditor
})

describe('repo-local lagging-copy NWU reference adapter artifact', () => {
  it('mounts the IIFE Editor and Reader from sanitized DOM inputs without fabricating persistence', () => {
    document.body.innerHTML = `
      <form id="blog-editor-form"><label class="editor-source-field"><textarea id="blog-content-input"># Initial</textarea></label></form>
      <section class="blog-preview-panel"></section>
      <div data-nwu-w-editor-reference data-document-id="article-reference"></div>
      <article data-nwu-w-renderer-fallback>Legacy fallback</article>
      <div data-nwu-w-renderer-reference></div>
      <script type="application/json" data-nwu-w-renderer-markdown>"# Reader"</script>`

    const captured: { editor?: WEditorMountOptions; renderer?: WRendererMountOptions } = {}
    const editorDestroy = vi.fn(async () => ({ status: 'destroyed' }))
    const rendererDestroy = vi.fn(async () => undefined)
    browserWindow.WEditor = {
      mountWEditor: vi.fn((_container, options) => {
        captured.editor = options
        return { destroy: editorDestroy }
      }),
      mountWRenderer: vi.fn((_container, options) => {
        captured.renderer = options
        return { destroy: rendererDestroy }
      }),
    }

    window.eval(adapterSource)

    expect(captured.editor).toMatchObject({
      assetBaseUrl: 'http://localhost:3000/static/vendor/w-editor/0.1.0/',
      document: { documentId: 'article-reference', markdown: '# Initial' },
      hostAdapterVersion: '1.0.0',
      initialMode: 'source',
    })
    expect(captured.editor).not.toHaveProperty('saveAdapter')
    expect(captured.renderer).toMatchObject({ markdown: '# Reader', profile: 'reader' })
    expect(document.querySelector('.editor-source-field')?.hasAttribute('hidden')).toBe(true)
    expect(document.querySelector('.blog-preview-panel')?.hasAttribute('hidden')).toBe(true)
    expect(document.querySelector('[data-nwu-w-renderer-fallback]')?.hasAttribute('hidden')).toBe(true)

    captured.editor?.onChange?.({
      apiVersion: '1.0.0',
      instanceId: 'reference-instance',
      origin: 'source-edit',
      snapshot: Object.freeze({
        documentId: 'article-reference',
        dirty: true,
        historyDepth: 1,
        markdown: '# Changed',
        mode: 'source',
        revision: 1,
        saveState: 'dirty',
        serverRevision: 'reference-only-1',
      }),
      type: 'change',
    })
    expect(document.querySelector<HTMLTextAreaElement>('#blog-content-input')?.value).toBe('# Changed')
  })
})
