import { describe, expect, it, vi } from 'vitest'

import {
  CherryRenderAdapter,
  RENDERER_PROFILE_CAPABILITIES,
  SharedRendererPipeline,
  createSharedRendererPipeline,
  hydrateRendererContent,
  type RendererExtension,
} from '../../packages/editor-vue/src/adapters'

describe('shared Renderer pipeline', () => {
  function semanticHtml(html: string): string {
    const template = document.createElement('template')
    template.innerHTML = html
    template.content.querySelectorAll('[data-sign]').forEach((element) => element.removeAttribute('data-sign'))
    return template.innerHTML
  }

  it('publishes the reader and author-preview capability profiles', () => {
    expect(RENDERER_PROFILE_CAPABILITIES.reader).toMatchObject({
      allowsAuthorEvents: false,
      allowsCodeCopy: true,
      allowsCodeEdit: false,
      allowsCodeFold: true,
      allowsDocumentMutation: false,
      allowsTaskToggle: false,
    })
    expect(RENDERER_PROFILE_CAPABILITIES['author-preview']).toMatchObject({
      allowsAuthorEvents: true,
      allowsCodeCopy: true,
      allowsCodeEdit: true,
      allowsCodeFold: true,
      allowsDocumentMutation: false,
      allowsTaskToggle: true,
    })
  })

  it('uses one pipeline for Cherry render and all post-render stages', () => {
    const pipeline = createSharedRendererPipeline()
    const adapter = new CherryRenderAdapter({ pipeline })
    const snapshot = Object.freeze({
      documentId: 'shared-renderer',
      markdown: [
        '# Shared renderer',
        '',
        'Inline $x^2$ and a fenced block:',
        '',
        '```javascript',
        'const answer = 42',
        '```',
      ].join('\n'),
      revision: 3,
    })

    const rendered = adapter.render(snapshot)

    expect(adapter.pipeline).toBe(pipeline)
    expect(pipeline.pipelineId).toBe('w-editor-shared-renderer-v1')
    expect(rendered.snapshot).toBe(snapshot)
    expect(rendered.html).toContain('Shared renderer')
    expect(rendered.html).toContain('katex')
    expect(pipeline.stages).toEqual([
      'markdown-compatibility',
      'cherry-render',
      'sanitizer',
      'formula-rehydrate',
      'chart-hydration',
      'mermaid-hydration',
      'code-enhancement',
    ])
  })

  it('exposes a reader profile that keeps copy/fold but removes author mutation actions', () => {
    const root = document.createElement('div')
    root.innerHTML = '<pre><code class="language-javascript">line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10\nline 11\nline 12\nline 13</code></pre>'
    document.body.append(root)
    const onCodeEdit = vi.fn()
    const dispose = hydrateRendererContent(root, { locale: 'en', onCodeEdit, profile: 'reader' })

    expect(root.getAttribute('contenteditable')).toBe('false')
    expect(root.querySelector('[data-w-editor-action="copy-code"]')).not.toBeNull()
    expect(root.querySelector('[data-w-editor-action="collapse-code"]')).not.toBeNull()
    expect(root.querySelector('[data-w-editor-action="edit-code"]')).toBeNull()
    const mutation = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: 'x' })
    root.dispatchEvent(mutation)
    expect(mutation.defaultPrevented).toBe(true)
    expect(onCodeEdit).not.toHaveBeenCalled()

    dispose()
    root.remove()
  })

  it('keeps the author-preview code entry point and emits the existing index contract', () => {
    const root = document.createElement('div')
    root.innerHTML = '<pre><code class="language-javascript">const answer = 42</code></pre>'
    document.body.append(root)
    const onCodeEdit = vi.fn()
    const dispose = hydrateRendererContent(root, { locale: 'en', onCodeEdit, profile: 'author-preview' })

    root.querySelector<HTMLButtonElement>('[data-w-editor-action="edit-code"]')?.click()
    expect(onCodeEdit).toHaveBeenCalledWith(0)
    expect(root.querySelector('[data-w-editor-action="copy-code"]')).not.toBeNull()
    expect(root.getAttribute('contenteditable')).toBe('false')

    dispose()
    root.remove()
  })

  it('binds only renderer-confirmed task items to their Markdown order', () => {
    const pipeline = createSharedRendererPipeline()
    const rendered = pipeline.render(Object.freeze({
      documentId: 'bound-tasks',
      markdown: '- [ ] Parent\n  - [x] Child',
      revision: 2,
    }))
    const template = document.createElement('template')
    template.innerHTML = rendered.html
    expect([...template.content.querySelectorAll('li.check-list-item')].map((item) => item.getAttribute('data-w-editor-task-index')))
      .toEqual(['0', '1'])
  })

  it('keeps Reader and Final on the same rendered HTML under the same fixture', () => {
    const pipeline = new SharedRendererPipeline()
    const snapshot = Object.freeze({
      documentId: 'reader-final-parity',
      markdown: '# Heading\n\nInline $x^2$ and **content**.',
      revision: 9,
    })

    const finalPreview = pipeline.render(snapshot, 'author-preview')
    const reader = pipeline.render(snapshot, 'reader')

    expect(semanticHtml(reader.html)).toBe(semanticHtml(finalPreview.html))
    expect(reader.snapshot).toBe(snapshot)
    expect(reader.pipelineId).toBe(finalPreview.pipelineId)
    expect(reader.capabilities.allowsCodeEdit).toBe(false)
    expect(finalPreview.capabilities.allowsCodeEdit).toBe(true)
  })

  it('rejects an extension that requests authority-changing permissions', () => {
    const malicious = {
      id: 'host-card',
      permissions: ['write-authority'],
      render: () => '<script>globalThis.pwned = true</script>',
    } as unknown as RendererExtension
    const pipeline = createSharedRendererPipeline({ extensions: [malicious] })
    const snapshot = Object.freeze({ documentId: 'extension-boundary', markdown: 'safe', revision: 1 })

    expect(() => pipeline.render(snapshot)).toThrow(/permission/iu)
    expect(snapshot.markdown).toBe('safe')
  })

  it('sanitizes safe-fragment extension output without changing Markdown authority', () => {
    const snapshot = Object.freeze({ documentId: 'extension-safe', markdown: 'safe', revision: 2 })
    const pipeline = createSharedRendererPipeline({ extensions: [{
      id: 'safe-card',
      permissions: ['safe-fragment'],
      render: () => '<section data-ok="true" onclick="globalThis.pwned = true"><script>bad()</script><a href="javascript:bad()">link</a></section>',
    }] })

    const rendered = pipeline.render(snapshot)
    const template = document.createElement('template')
    template.innerHTML = rendered.html
    const extension = template.content.querySelector('[data-w-editor-extension="safe-card"]')
    expect(extension?.querySelector('script')).toBeNull()
    expect(extension?.querySelector('[onclick]')).toBeNull()
    expect(extension?.querySelector('a')?.hasAttribute('href')).toBe(false)
    expect(snapshot.markdown).toBe('safe')
  })
})
