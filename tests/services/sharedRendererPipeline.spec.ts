import { describe, expect, it, vi } from 'vitest'
import { sanitizeCherryHtmlWithSafeFormulas } from '../../src/services/rehydrateCherryFormulas'

import {
  CherryRenderAdapter,
  RENDERER_PROFILE_CAPABILITIES,
  SharedRendererPipeline,
  createSharedRendererPipeline,
  hydrateRendererContent,
  type RendererExtension,
} from '../../packages/editor-vue/src/adapters'

describe('shared Renderer pipeline', () => {
  it('keeps invalid block formulas in the document sequence across safe reconstruction', () => {
    const pipeline = createSharedRendererPipeline()
    const snapshot = { documentId: 'numbered-errors', revision: 0, markdown: '$$\na\n$$\n\n$$\n\\frac{\n$$\n\n$$\nb\n$$' }
    try {
      const rendered = pipeline.render(snapshot)
      const host = document.createElement('div')
      host.innerHTML = rendered.html
      expect([...host.querySelectorAll('.Cherry-Math')].map(node => node.getAttribute('data-formula-number'))).toEqual(['1', '2', '3'])
      expect(host.querySelectorAll('.katex-error, .cherry-formula-error')).toHaveLength(1)
      host.innerHTML = sanitizeCherryHtmlWithSafeFormulas(rendered.html)
      expect([...host.querySelectorAll('.Cherry-Math > .formula-node__number')].map(node => node.textContent)).toEqual(['(1)', '(2)', '(3)'])
      const error = host.querySelectorAll('.Cherry-Math')[1]?.querySelector('.cherry-formula-error, .katex-error')
      expect(error).not.toBeNull()
      expect(error?.textContent).not.toMatch(/\([123]\)/u)
      const reconstructed = host.innerHTML
      expect(sanitizeCherryHtmlWithSafeFormulas(reconstructed)).toBe(reconstructed)
      expect(rendered.snapshot.markdown).toBe(snapshot.markdown)
    } finally { pipeline.destroy() }
  })

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

  it.each([
    { backslashes: 0, breaks: 1, text: 'leftright' },
    { backslashes: 1, breaks: 0, text: 'left<br>right' },
    { backslashes: 2, breaks: 1, text: String.raw`left\right` },
    { backslashes: 3, breaks: 0, text: String.raw`left\<br>right` },
    { backslashes: 4, breaks: 1, text: String.raw`left\\right` },
    { backslashes: 5, breaks: 0, text: String.raw`left\\<br>right` },
    { backslashes: 6, breaks: 1, text: String.raw`left\\\right` },
    { backslashes: 7, breaks: 0, text: String.raw`left\\\<br>right` },
  ])('renders $backslashes backslashes before a break tag with the authority escape semantics', ({ backslashes, breaks, text }) => {
    const pipeline = createSharedRendererPipeline()
    const markdown = `left${'\\'.repeat(backslashes)}<br>right`
    const snapshot = Object.freeze({ documentId: 'escaped-break', markdown, revision: 1 })
    const host = document.createElement('div')

    host.innerHTML = pipeline.render(snapshot).html

    expect(host.textContent).toBe(text)
    expect(host.querySelectorAll('br')).toHaveLength(breaks)
    expect(snapshot.markdown).toBe(markdown)
  })

  it('keeps break escapes inside bold text and link labels', () => {
    const pipeline = createSharedRendererPipeline()
    const host = document.createElement('div')
    host.innerHTML = pipeline.render(Object.freeze({
      documentId: 'marked-breaks',
      markdown: String.raw`**left\\<br>right** [left\\\<br>right](https://example.com)`,
      revision: 1,
    })).html

    expect(host.querySelector('strong')?.textContent).toBe(String.raw`left\right`)
    expect(host.querySelector('strong')?.querySelectorAll('br')).toHaveLength(1)
    expect(host.querySelector('a')?.textContent).toBe(String.raw`left\<br>right`)
    expect(host.querySelector('a')?.querySelectorAll('br')).toHaveLength(0)
  })

  it('keeps break tags and their backslashes literal inside inline and fenced code', () => {
    const pipeline = createSharedRendererPipeline()
    const host = document.createElement('div')
    const literal = String.raw`left\<br>middle\\<br>right`
    host.innerHTML = pipeline.render(Object.freeze({
      documentId: 'code-breaks',
      markdown: [`\`${literal}\``, '', '```text', literal, '```'].join('\n'),
      revision: 1,
    })).html

    const code = [...host.querySelectorAll('code')]
    expect(code).toHaveLength(2)
    expect(code[0]?.textContent).toBe(literal)
    expect(code[1]?.textContent?.trimEnd()).toBe(literal)
    expect(host.querySelectorAll('br')).toHaveLength(0)
  })

  it('preserves escaped break variants inside list items and table cells', () => {
    const pipeline = createSharedRendererPipeline()
    const host = document.createElement('div')
    host.innerHTML = pipeline.render(Object.freeze({
      documentId: 'contained-breaks',
      markdown: [
        String.raw`- left\\<BR />right`,
        '',
        '| Content |',
        '| --- |',
        String.raw`| left\\\<br/>right |`,
      ].join('\n'),
      revision: 1,
    })).html

    expect(host.querySelector('li')?.textContent).toBe(String.raw`left\right`)
    expect(host.querySelector('li')?.querySelectorAll('br')).toHaveLength(1)
    expect(host.querySelector('td')?.textContent).toBe(String.raw`left\<br/>right`)
    expect(host.querySelector('td')?.querySelectorAll('br')).toHaveLength(0)
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
