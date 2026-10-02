import { describe, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'

import { CherrySourceAdapter, isCherrySourceHistoryShortcutEvent, sourceChangeMayAffectReferences } from '../../src/adapters/cherrySourceAdapter'
import { DocumentSession } from '../../src/core/documentSession'

function mount(markdown = '# Source\n\ntext'): {
  adapter: CherrySourceAdapter
  host: HTMLElement
  session: DocumentSession
} {
  const host = document.createElement('div')
  document.body.append(host)
  const session = new DocumentSession({ documentId: 'article', markdown })
  const adapter = new CherrySourceAdapter({ host, session })
  return { adapter, host, session }
}

describe('CherrySourceAdapter', () => {
  it('mounts edit-only with Cherry product toolbars hidden', () => {
    const { adapter, host } = mount()
    try {
      expect(adapter.value()).toBe('# Source\n\ntext')
      expect(host.querySelector('.cherry-editor')).not.toBeNull()
      const toolbar = host.querySelector<HTMLElement>('.cherry-toolbar')
      expect(toolbar?.hidden).toBe(true)
      expect(toolbar?.getAttribute('aria-hidden')).toBe('true')
      expect(toolbar?.querySelectorAll('button')).toHaveLength(0)
    } finally {
      adapter.destroy()
      host.remove()
      vi.clearAllTimers()
    }
  })

  it('applies the shared appearance theme without rebuilding the source editor', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'article', markdown: '# Theme' })
    const adapter = new CherrySourceAdapter({ host, session, theme: 'abyss' })
    const editor = host.querySelector('.cherry')
    try {
      expect(editor?.classList.contains('theme__abyss')).toBe(true)
      adapter.setTheme('red')
      expect(host.querySelector('.cherry')).toBe(editor)
      expect(editor?.classList.contains('theme__red')).toBe(true)
      expect(editor?.classList.contains('theme__abyss')).toBe(false)
    } finally {
      adapter.destroy()
      host.remove()
      vi.clearAllTimers()
    }
  })

  it('applies a revision-checked W-Editor source range command', () => {
    const { adapter, host, session } = mount('alpha beta')
    try {
      const acknowledgement = adapter.applySourceRangeCommand({
        baseRevision: 0,
        codecId: 'strong',
        expected: 'alpha',
        from: 0,
        replacement: '**alpha**',
        to: 5,
        transactionId: 'toolbar-bold-1',
      })

      expect(acknowledgement).toMatchObject({ origin: 'toolbar-command', revision: 1 })
      expect(session.snapshot().markdown).toBe('**alpha** beta')
      expect(adapter.value()).toBe('**alpha** beta')
      expect(adapter.selection()).toEqual({ anchor: 9, head: 9 })
    } finally {
      adapter.destroy()
      host.remove()
      vi.clearAllTimers()
    }
  })

  it('tracks composition through the public source DOM', () => {
    const onCompositionChange = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'article', markdown: 'text' })
    const adapter = new CherrySourceAdapter({ host, onCompositionChange, session })
    const content = host.querySelector('.cm-content')

    try {
      content?.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      expect(adapter.isComposing()).toBe(true)
      content?.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
      expect(adapter.isComposing()).toBe(false)
      expect(onCompositionChange.mock.calls).toEqual([[true], [false]])
    } finally {
      adapter.destroy()
      host.remove()
      vi.clearAllTimers()
    }
  })

  it('searches, replaces the active selection, and hydrates external snapshots without feedback', () => {
    const { adapter, host, session } = mount('Alpha beta alpha')
    const changes = vi.fn()
    session.subscribe(changes)
    try {
      expect(adapter.search('alpha')).toEqual([{ from: 0, to: 5 }, { from: 11, to: 16 }])
      adapter.setSelection({ anchor: 5, head: 0 })
      adapter.replaceSelection({
        codecId: 'search-replace',
        replacement: 'Omega',
        selectReplacement: true,
        transactionId: 'replace-selection-1',
      })
      expect(session.snapshot()).toEqual({ documentId: 'article', markdown: 'Omega beta alpha', revision: 1 })
      expect(adapter.selection()).toEqual({ anchor: 0, head: 5 })

      session.commitSource({ markdown: 'external\r\nsource', origin: 'import', transactionId: 'import-1' })
      expect(adapter.value()).toBe('external\r\nsource')
      expect(session.snapshot().revision).toBe(2)
      expect(changes).toHaveBeenCalledTimes(2)
    } finally {
      adapter.destroy()
      host.remove()
      vi.clearAllTimers()
    }
  })

  it('uses Cherry native search decorations and selects the active result', async () => {
    const { adapter, host } = mount('Alpha beta alpha')
    try {
      const matches = adapter.search('alpha')
      adapter.setSearchHighlights(matches, 1)
      await Promise.resolve()

      const highlighted = [...host.querySelectorAll<HTMLElement>('.cm-searching')]
      expect(highlighted).toHaveLength(2)
      expect(highlighted.map((match) => match.textContent)).toEqual(['Alpha', 'alpha'])
      expect(host.querySelectorAll('.w-editor-search-match--active')).toHaveLength(1)
      expect(host.querySelector('.w-editor-search-match--active')?.textContent).toBe('alpha')
      expect(adapter.selection()).toEqual({ anchor: 11, head: 16 })

      adapter.clearSearchHighlights()
      await Promise.resolve()
      expect(host.querySelectorAll('.cm-searching')).toHaveLength(0)
    } finally {
      adapter.destroy()
      host.remove()
      vi.clearAllTimers()
    }
  })

  it('applies all checked search replacements in one native edit and rejects a stale group before changing the view', () => {
    const { adapter, host, session } = mount('Alpha beta Alpha')
    try {
      adapter.applySourcePatchPlan({
        baseRevision: 0,
        patches: [
          { codecId: 'search-replace', expected: 'Alpha', from: 0, replacement: 'Omega', to: 5 },
          { codecId: 'search-replace', expected: 'Alpha', from: 11, replacement: 'Omega', to: 16 },
        ],
        transactionId: 'replace-all-1',
      })
      expect(adapter.value()).toBe('Omega beta Omega')
      expect(session.snapshot()).toEqual({ documentId: 'article', markdown: 'Omega beta Omega', revision: 1 })

      expect(() => adapter.applySourcePatchPlan({
        baseRevision: 1,
        patches: [
          { codecId: 'search-replace', expected: 'stale', from: 0, replacement: 'Nope', to: 5 },
          { codecId: 'search-replace', expected: 'Omega', from: 11, replacement: 'Nope', to: 16 },
        ],
        transactionId: 'replace-all-stale',
      })).toThrow()
      expect(adapter.value()).toBe('Omega beta Omega')
      expect(session.snapshot().revision).toBe(1)
    } finally {
      adapter.destroy()
      host.remove()
      vi.clearAllTimers()
    }
  })

  it('unsubscribes before teardown so later authority changes cannot feed back', () => {
    const { adapter, host, session } = mount('before')
    adapter.destroy()

    session.commitSource({ markdown: 'after', origin: 'import', transactionId: 'import-after-destroy' })

    expect(session.snapshot()).toEqual({ documentId: 'article', markdown: 'after', revision: 1 })
    expect(host.querySelector('.cm-editor')).toBeNull()
    host.remove()
    vi.clearAllTimers()
  })

  it('keeps user source commands in native history', () => {
    const { adapter, host, session } = mount('alpha')
    const keydown = vi.fn((event: KeyboardEvent) => isCherrySourceHistoryShortcutEvent(event))
    window.addEventListener('keydown', keydown, true)
    try {
      adapter.applySourceRangeCommand({
        baseRevision: 0,
        codecId: 'paragraph',
        expected: 'alpha',
        from: 0,
        replacement: 'ALPHA',
        to: 5,
        transactionId: 'source-command',
      })
      expect(adapter.undo()).toBe(true)
      expect(session.snapshot().markdown).toBe('alpha')
      expect(keydown).toHaveReturnedWith(true)
    } finally {
      window.removeEventListener('keydown', keydown, true)
      adapter.destroy()
      host.remove()
      vi.clearAllTimers()
    }
  })

  it('preserves exact CRLF authority through a native edit and undo', () => {
    const original = 'alpha\r\n\r\nbeta\r\n'
    const { adapter, host, session } = mount(original)
    try {
      adapter.setSelection({ anchor: 0, head: 5 })
      const acknowledgement = adapter.replaceSelection({
        codecId: 'paragraph',
        replacement: 'ALPHA',
        transactionId: 'source-crlf-replacement',
      })

      expect(acknowledgement).toMatchObject({ changed: true, origin: 'toolbar-command', revision: 1 })
      expect(session.snapshot().markdown).toBe('ALPHA\r\n\r\nbeta\r\n')
      expect(adapter.value()).toBe('ALPHA\r\n\r\nbeta\r\n')

      expect(adapter.undo()).toBe(true)
      expect(session.snapshot()).toEqual({ documentId: 'article', markdown: original, revision: 2 })
      expect(adapter.value()).toBe(original)
    } finally {
      adapter.destroy()
      host.remove()
      vi.clearAllTimers()
    }
  })

  it('mounts an empty Source document without inventing content or a revision', () => {
    const { adapter, host, session } = mount('')
    try {
      expect(adapter.value()).toBe('')
      expect(session.snapshot()).toEqual({ documentId: 'article', markdown: '', revision: 0 })
    } finally {
      adapter.destroy()
      host.remove()
      vi.clearAllTimers()
    }
  })

  it('does not add external hydration to an empty native history segment', () => {
    const { adapter, host, session } = mount('alpha')
    try {
      session.commitSource({ markdown: 'external', origin: 'import', transactionId: 'external-history' })
      expect(adapter.value()).toBe('external')
      const undone = adapter.undo()
      expect({ markdown: session.snapshot().markdown, undone, value: adapter.value() }).toEqual({
        markdown: 'external',
        undone: false,
        value: 'external',
      })
    } finally {
      adapter.destroy()
      host.remove()
      vi.clearAllTimers()
    }
  })

  it('records an explicit checkpoint restore as one new native user transaction', () => {
    const { adapter, host, session } = mount('current source')
    try {
      const acknowledgement = adapter.restoreCheckpoint('checkpoint source', 'restore-checkpoint-1')
      expect(acknowledgement).toEqual({
        changed: true,
        documentId: 'article',
        origin: 'checkpoint-restore',
        previousRevision: 0,
        revision: 1,
        transactionId: 'restore-checkpoint-1',
      })
      expect(adapter.value()).toBe('checkpoint source')

      expect(adapter.undo()).toBe(true)
      expect(session.snapshot()).toEqual({ documentId: 'article', markdown: 'current source', revision: 2 })
      expect(adapter.undo()).toBe(false)
      expect(adapter.redo()).toBe(true)
      expect(session.snapshot()).toEqual({ documentId: 'article', markdown: 'checkpoint source', revision: 3 })
    } finally {
      adapter.destroy()
      host.remove()
      vi.clearAllTimers()
    }
  })
})


describe('source reference capture', () => {
  it('filters ordinary changes but detects reference lines and scope delimiters', () => {
    expect(sourceChangeMayAffectReferences('hello\n[1](#wref-r~Paper)', 'hello!\n[1](#wref-r~Paper)', 5, 5, 6)).toBe(false)
    expect(sourceChangeMayAffectReferences('[1](#wref-r~Paper)', '[1](#wref-r~New)', 13, 18, 16)).toBe(true)
    expect(sourceChangeMayAffectReferences('text', '`text', 0, 0, 1)).toBe(true)
    expect(sourceChangeMayAffectReferences('text', '$text', 0, 0, 1)).toBe(true)
    expect(sourceChangeMayAffectReferences('text', '<!--text', 0, 0, 4)).toBe(true)
  })

  it('captures native deletion and undo while the sidebar is absent', () => {
    const citation = '[1](#wref-ref~Paper)'
    const { adapter, host, session } = mount(`intro\r\n${citation}\r\n`)
    const events: CustomEvent[] = []
    const listener = (event: Event): void => { events.push(event as CustomEvent) }
    document.body.addEventListener('w-reference-source-change', listener)
    try {
      const view = EditorView.findFromDOM(host.querySelector('.cm-editor')!)!
      view.dispatch({ changes: { from: 6, to: 6 + citation.length, insert: '' } })
      adapter.flush()
      expect(session.snapshot().markdown).toBe('intro\r\n\r\n')
      expect(events).toHaveLength(1)
      expect(events[0]?.detail).toEqual({ documentId: 'article', previous: [{ id: 'ref', number: 1, text: 'Paper' }], references: [] })
      expect(adapter.undo()).toBe(true)
      expect(events.at(-1)?.detail.references).toEqual([{ id: 'ref', number: 1, text: 'Paper' }])
    } finally {
      document.body.removeEventListener('w-reference-source-change', listener)
      adapter.destroy()
      host.remove()
      vi.clearAllTimers()
    }
  })

  it('captures the normal Cherry afterChange callback before an explicit flush', async () => {
    const citation = '[1](#wref-ref~Paper)'
    const { adapter, host, session } = mount(citation)
    const listener = vi.fn()
    host.addEventListener('w-reference-source-change', listener)
    try {
      const view = EditorView.findFromDOM(host.querySelector('.cm-editor')!)!
      view.dispatch({ changes: { from: 0, to: citation.length, insert: '' } })
      await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
      expect(session.snapshot().markdown).toBe('')
      expect(adapter.flush()).toBeNull()
    } finally {
      adapter.destroy()
      host.remove()
      vi.clearAllTimers()
    }
  })

  it('flushes composition capture once and stays quiet for ordinary typing', () => {
    const citation = '[1](#wref-ref~Paper)'
    const { adapter, host, session } = mount(`intro\n${citation}`)
    const listener = vi.fn()
    host.addEventListener('w-reference-source-change', listener)
    try {
      const view = EditorView.findFromDOM(host.querySelector('.cm-editor')!)!
      view.dispatch({ changes: { from: 1, insert: 'x' } })
      adapter.flush()
      expect(listener).not.toHaveBeenCalled()
      view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      view.dispatch({ changes: { from: 7, to: 7 + citation.length, insert: '' } })
      expect(session.snapshot().markdown).toContain('#wref')
      view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
      expect(listener).toHaveBeenCalledTimes(1)
      expect(session.snapshot().markdown).not.toContain('#wref')
      expect(adapter.flush()).toBeNull()
    } finally {
      adapter.destroy()
      host.remove()
      vi.clearAllTimers()
    }
  })
})
