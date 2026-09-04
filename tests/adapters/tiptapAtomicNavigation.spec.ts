import { describe, expect, it } from 'vitest'

import { TiptapVisualAdapter, type TiptapVisualProjection } from '../../src/adapters'
import { DocumentSession, type DocumentSnapshot } from '../../src/core'

function blockProjection(nodeType: 'rawBlock' | 'semanticBlock') {
  return (snapshot: DocumentSnapshot): TiptapVisualProjection => ({
    content: {
      content: [
        { content: [{ text: 'A', type: 'text' }], type: 'paragraph' },
        {
          attrs: {
            kind: nodeType === 'semanticBlock' ? 'diagram' : undefined,
            projectionId: 'protected-block',
            source: nodeType === 'semanticBlock' ? 'graph LR; A-->B' : '::: exact :::',
          },
          type: nodeType,
        },
        { content: [{ text: 'B', type: 'text' }], type: 'paragraph' },
      ],
      type: 'doc',
    },
    map: { documentLength: snapshot.markdown.length, entries: [], revision: snapshot.revision },
    revision: snapshot.revision,
    source: snapshot.markdown,
  })
}

function inlineProjection(snapshot: DocumentSnapshot): TiptapVisualProjection {
  return {
    content: {
      content: [{
        content: [
          { text: 'A', type: 'text' },
          { attrs: { projectionId: 'raw-inline', source: '{{ exact }}' }, type: 'rawInline' },
          { text: 'B', type: 'text' },
        ],
        type: 'paragraph',
      }],
      type: 'doc',
    },
    map: { documentLength: snapshot.markdown.length, entries: [], revision: snapshot.revision },
    revision: snapshot.revision,
    source: snapshot.markdown,
  }
}

function mount(project: (snapshot: DocumentSnapshot) => TiptapVisualProjection) {
  const host = document.createElement('div')
  document.body.append(host)
  const session = new DocumentSession({ documentId: 'atomic-navigation', markdown: 'preserved source' })
  const adapter = new TiptapVisualAdapter({ host, project, session })
  return { adapter, host, session }
}

describe('keyboard-safe atomic and isolating navigation', () => {
  it.each(['rawBlock', 'semanticBlock'] as const)('selects and moves past a %s in both directions', (nodeType) => {
    const { adapter, host, session } = mount(blockProjection(nodeType))
    try {
      adapter.setSelection({ anchor: 2, head: 2 })
      expect(adapter.dispatchKey('ArrowRight')).toBe(true)
      expect(adapter.selection().kind).toBe('node')
      expect(adapter.dispatchKey('ArrowRight')).toBe(true)
      expect(adapter.selection()).toEqual({ anchor: 5, head: 5, kind: 'text' })

      expect(adapter.dispatchKey('ArrowLeft')).toBe(true)
      expect(adapter.selection().kind).toBe('node')
      expect(adapter.dispatchKey('ArrowLeft')).toBe(true)
      expect(adapter.selection()).toEqual({ anchor: 2, head: 2, kind: 'text' })
      expect(session.snapshot()).toEqual({ documentId: 'atomic-navigation', markdown: 'preserved source', revision: 0 })
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it.each([
    { key: 'Delete' as const, position: 2 },
    { key: 'Backspace' as const, position: 5 },
  ])('$key selects a protected block without mutating it', ({ key, position }) => {
    const { adapter, host, session } = mount(blockProjection('rawBlock'))
    try {
      adapter.setSelection({ anchor: position, head: position })
      expect(adapter.dispatchKey(key)).toBe(true)
      expect(adapter.selection().kind).toBe('node')
      expect(adapter.documentJSON().content).toHaveLength(3)
      expect(session.snapshot().revision).toBe(0)
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('selects and escapes a raw inline atom without trapping the caret or changing source', () => {
    const { adapter, host, session } = mount(inlineProjection)
    try {
      adapter.setSelection({ anchor: 2, head: 2 })
      expect(adapter.dispatchKey('ArrowRight')).toBe(true)
      expect(adapter.selection().kind).toBe('node')
      expect(adapter.dispatchKey('ArrowRight')).toBe(true)
      expect(adapter.selection()).toEqual({ anchor: 3, head: 3, kind: 'text' })
      expect(adapter.dispatchKey('ArrowLeft')).toBe(true)
      expect(adapter.selection().kind).toBe('node')
      expect(adapter.dispatchKey('ArrowLeft')).toBe(true)
      expect(adapter.selection()).toEqual({ anchor: 2, head: 2, kind: 'text' })

      adapter.setSelection({ anchor: 2, head: 2 })
      expect(adapter.dispatchKey('Delete')).toBe(true)
      expect(adapter.selection().kind).toBe('node')
      adapter.setSelection({ anchor: 3, head: 3 })
      expect(adapter.dispatchKey('Backspace')).toBe(true)
      expect(adapter.selection().kind).toBe('node')
      expect(adapter.text()).toBe('AB')
      expect(session.snapshot().revision).toBe(0)
    } finally {
      adapter.destroy()
      host.remove()
    }
  })
})
