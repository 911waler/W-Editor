import { afterEach, describe, expect, it, vi } from 'vitest'

import { TiptapVisualAdapter } from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession } from '../../src/core'

const SOURCE = '```typescript\nconst answer = 42\n```'
const adapters: TiptapVisualAdapter[] = []

afterEach(() => {
  while (adapters.length > 0) adapters.pop()?.destroy()
  document.body.replaceChildren()
})

describe('direct Tiptap code-block editing', () => {
  it('rehighlights editable code when its declared language changes', () => {
    const source = "```javascript\ndef greet(name):\n    print('Hello', name)\n```"
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'language-highlight', markdown: source })
    const adapter = new TiptapVisualAdapter({ host, project: projectOrdinaryMarkdown, session })
    adapters.push(adapter)

    const node = host.querySelector<HTMLElement>('[data-w-editor-node="code-block"]')!
    const code = node.querySelector<HTMLElement>('pre code')!
    const language = node.querySelector<HTMLSelectElement>('[data-code-action="language"]')!
    const javascriptHighlight = code.innerHTML
    expect(code.querySelector('.hljs-keyword')?.textContent).not.toBe('def')

    language.value = 'python'
    language.dispatchEvent(new Event('change', { bubbles: true }))

    expect(code.classList).toContain('language-python')
    expect(code.querySelector('.hljs-keyword')?.textContent).toBe('def')
    expect(code.innerHTML).not.toBe(javascriptHighlight)
  })

  it('owns editable highlighted code with icon-only Copy and Edit controls', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const onSemanticCopy = vi.fn()
    const onSemanticEdit = vi.fn()
    const session = new DocumentSession({ documentId: 'code-preview', markdown: SOURCE })
    const adapter = new TiptapVisualAdapter({
      host,
      onSemanticCopy,
      onSemanticEdit,
      project: projectOrdinaryMarkdown,
      session,
    })
    adapters.push(adapter)

    const node = host.querySelector<HTMLElement>('[data-w-editor-node="code-block"]')
    const code = node?.querySelector('pre code')
    expect(adapter.documentJSON().content?.[0]).toMatchObject({
      attrs: { language: 'typescript' },
      content: [{ text: 'const answer = 42', type: 'text' }],
      type: 'codeBlock',
    })
    expect(adapter.projection().map.entries[0]?.safePatchUnit).toMatchObject({
      expectedSource: SOURCE,
      strategy: { kind: 'direct', scope: 'block' },
      structural: false,
    })
    expect(code?.classList).toContain('language-typescript')
    expect(code?.getAttribute('data-highlighted')).toBe('true')
    expect(code?.textContent).toBe('const answer = 42')
    expect(code?.closest('.ProseMirror')?.getAttribute('contenteditable')).toBe('true')
    expect(node?.querySelector('.cm-editor')).toBeNull()
    expect(node?.querySelector('[data-semantic-copy="code-block"]')?.textContent).toBe('')
    expect(node?.querySelector('[data-semantic-copy="code-block"]')?.getAttribute('aria-label')).toBe('Copy code')
    expect(node?.querySelector('[data-semantic-copy="code-block"] .ch-icon-copy')).not.toBeNull()
    expect(node?.querySelector('[data-semantic-edit="code-block-editor"]')?.textContent).toBe('')
    expect(node?.querySelector('[data-semantic-edit="code-block-editor"]')?.getAttribute('aria-label')).toBe('Advanced code editor')
    expect(node?.querySelector('[data-semantic-edit="code-block-editor"] .ch-icon-edit')).not.toBeNull()
    expect(node?.querySelector<HTMLButtonElement>('[data-code-action="fold"]')?.hidden).toBe(true)

    node?.querySelector<HTMLButtonElement>('[data-semantic-copy="code-block"]')?.click()
    expect(onSemanticCopy).toHaveBeenCalledWith({ code: 'const answer = 42', language: 'typescript', source: SOURCE })
    expect(session.snapshot().revision).toBe(0)

    node?.querySelector<HTMLButtonElement>('[data-semantic-edit="code-block-editor"]')?.click()
    expect(adapter.selection().kind).toBe('text')
    expect(adapter.selectedCodeBlock()).toEqual({
      code: 'const answer = 42',
      kind: 'code-block',
      language: 'typescript',
      layoutKind: null,
      source: SOURCE,
    })
    expect(onSemanticEdit).toHaveBeenCalledWith({
      code: 'const answer = 42',
      editorId: 'code-block-editor',
      kind: 'code-block',
      language: 'typescript',
      layoutKind: null,
      source: SOURCE,
    })
    expect(session.snapshot().revision).toBe(0)

    expect(session.snapshot()).toMatchObject({ markdown: SOURCE, revision: 0 })
    expect(adapter.undo()).toBe(false)
  })

  it('folds long code to a visible 12-line preview and expands without changing content history', () => {
    const markdown = `\`\`\`ts\n${Array.from({ length: 16 }, (_, index) => `const line${index + 1} = ${index + 1}`).join('\n')}\n\`\`\``
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'long-code-preview', markdown })
    const adapter = new TiptapVisualAdapter({ host, project: projectOrdinaryMarkdown, session })
    adapters.push(adapter)

    const node = host.querySelector<HTMLElement>('[data-w-editor-node="code-block"]')!
    const fold = node.querySelector<HTMLButtonElement>('[data-code-action="fold"]')!
    const expand = node.querySelector<HTMLButtonElement>('[data-code-action="expand"]')!
    expect(node.dataset['codeLines']).toBe('16')
    expect(node.dataset['folded']).toBe('true')
    expect(node.querySelector<HTMLPreElement>('pre')?.hidden).toBe(false)
    expect(node.querySelector<HTMLElement>('[data-code-fade]')?.hidden).toBe(false)
    expect(fold.hidden).toBe(true)
    expect(expand.hidden).toBe(false)

    expand.click()
    expect(node.dataset['folded']).toBe('false')
    expect(fold.hidden).toBe(false)
    expect(expand.hidden).toBe(true)
    fold.click()
    expect(node.dataset['folded']).toBe('true')
    expect(session.snapshot()).toMatchObject({ markdown, revision: 0 })
    expect(adapter.undo()).toBe(false)
  })
})
