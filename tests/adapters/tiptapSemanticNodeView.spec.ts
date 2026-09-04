import { afterEach, describe, expect, it, vi } from 'vitest'

import { TiptapVisualAdapter } from '../../src/adapters'
import { panelStarterSource, projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession } from '../../src/core'

const adapters: TiptapVisualAdapter[] = []

afterEach(() => {
  while (adapters.length > 0) adapters.pop()?.destroy()
  document.body.replaceChildren()
})

function mountSemanticNode() {
  const source = panelStarterSource('panel.info')
  const markdown = `Before\n\n${source}\n\nAfter`
  const session = new DocumentSession({ documentId: 'semantic-node-view', markdown })
  const host = document.createElement('div')
  document.body.append(host)
  const onSemanticEdit = vi.fn()
  const adapter = new TiptapVisualAdapter({
    host,
    onSemanticEdit,
    project: projectOrdinaryMarkdown,
    session,
  })
  adapters.push(adapter)
  return { adapter, host, markdown, onSemanticEdit, session, source }
}

describe('common typed semantic NodeView', () => {
  it('shows identity and preview with contextual edit controls that select the node and emit current source', () => {
    const { adapter, host, onSemanticEdit, session, source } = mountSemanticNode()
    const node = host.querySelector<HTMLElement>('[data-w-editor-node="semantic-block"]')
    const edit = node?.querySelector<HTMLButtonElement>('[data-semantic-edit="panel-editor"]')
    expect(node).not.toBeNull()
    expect(node?.classList).toContain('complex-node')
    expect(node?.dataset['previewState']).toBe('ready')
    expect(node?.dataset['selected']).toBe('false')
    expect(node?.querySelector('.semantic-node-view__identity')?.textContent).toBe('Info panel')
    expect(node?.querySelector('.semantic-preview__body')?.textContent).toContain('supporting information')
    expect(edit?.getAttribute('aria-label')).toBe('Edit source: Info panel')

    edit?.click()
    expect(adapter.selection().kind).toBe('node')
    expect(node?.dataset['selected']).toBe('true')
    expect(onSemanticEdit).toHaveBeenCalledOnce()
    expect(onSemanticEdit).toHaveBeenCalledWith({
      editorId: 'panel-editor',
      kind: 'panel',
      layoutKind: null,
      source,
      variant: 'info',
    })
    expect(session.snapshot()).toMatchObject({ revision: 0 })
  })

  it('contains preview failure locally and clears it without a content revision or undo entry', () => {
    const { adapter, host, markdown, session } = mountSemanticNode()
    host.querySelector<HTMLButtonElement>('[data-semantic-edit="panel-editor"]')?.click()
    expect(adapter.setSelectedSemanticLocalError('Preview service unavailable.')).toBe(true)
    const node = host.querySelector<HTMLElement>('[data-w-editor-node="semantic-block"]')
    expect(node?.dataset['previewState']).toBe('error')
    expect(node?.querySelector('[role="alert"]')?.textContent).toBe('Preview service unavailable.')
    expect(node?.querySelector<HTMLElement>('.semantic-node-view__preview')?.hidden).toBe(true)
    expect(session.snapshot()).toEqual({ documentId: 'semantic-node-view', markdown, revision: 0 })
    expect(adapter.undo()).toBe(false)

    expect(adapter.setSelectedSemanticLocalError(null)).toBe(true)
    expect(node?.dataset['previewState']).toBe('ready')
    expect(node?.querySelector('[role="alert"]')).toBeNull()
    expect(session.snapshot().revision).toBe(0)
  })

  it('supports keyboard selection and navigation past the NodeView without trapping focus', () => {
    const { adapter, session } = mountSemanticNode()
    adapter.setSelection({ anchor: 7, head: 7 })
    expect(adapter.dispatchKey('ArrowRight')).toBe(true)
    expect(adapter.selection().kind).toBe('node')
    expect(adapter.dispatchKey('ArrowRight')).toBe(true)
    expect(adapter.selection()).toEqual({ anchor: 10, head: 10, kind: 'text' })
    expect(session.snapshot().revision).toBe(0)
  })
})
