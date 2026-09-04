import { describe, expect, it } from 'vitest'

import { TiptapVisualAdapter } from '../../src/adapters/tiptapVisualAdapter'
import { projectOrdinaryMarkdown } from '../../src/codecs/ordinaryBlocks'
import { DocumentSession } from '../../src/core/documentSession'

function mount(markdown: string): {
  readonly adapter: TiptapVisualAdapter
  readonly host: HTMLElement
} {
  const host = document.createElement('div')
  document.body.append(host)
  const session = new DocumentSession({ documentId: 'ordinary-editing', markdown })
  const adapter = new TiptapVisualAdapter({ host, project: projectOrdinaryMarkdown, session })
  return { adapter, host }
}

describe('continuous ordinary Tiptap editing', () => {
  it('moves the caret by ArrowRight and ArrowLeft across a heading/paragraph boundary', () => {
    const { adapter, host } = mount('# Alpha\n\nBravo')
    try {
      adapter.setSelection({ anchor: 6, head: 6 })
      expect(adapter.dispatchKey('ArrowRight')).toBe(true)
      expect(adapter.selection()).toEqual({ anchor: 8, head: 8, kind: 'text' })
      expect(adapter.dispatchKey('ArrowLeft')).toBe(true)
      expect(adapter.selection()).toEqual({ anchor: 6, head: 6, kind: 'text' })
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('places a caret, types, and exposes a continuous cross-block selection for copy', () => {
    const { adapter, host } = mount('# Alpha\n\nBravo')
    try {
      adapter.setSelection({ anchor: 8, head: 8 })
      adapter.insertText('New ')
      expect(adapter.text()).toBe('AlphaNew Bravo')

      adapter.setSelection({ anchor: 1, head: 17 })
      expect(adapter.selectedText()).toBe('AlphaNew Bravo')
      expect(adapter.copyText()).toBe('Alpha\nNew Bravo')
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('deletes one continuous range across adjacent ordinary blocks', () => {
    const { adapter, host } = mount('Alpha\n\nBravo')
    try {
      adapter.setSelection({ anchor: 4, head: 10 })
      adapter.insertText('')

      expect(adapter.text()).toBe('Alpavo')
      expect(adapter.documentJSON().content).toHaveLength(1)
      expect(adapter.selection()).toEqual({ anchor: 4, head: 4, kind: 'text' })
    } finally {
      adapter.destroy()
      host.remove()
    }
  })
})
