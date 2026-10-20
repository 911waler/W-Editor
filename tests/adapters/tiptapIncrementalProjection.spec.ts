import { describe, expect, it, vi } from 'vitest'
import { TiptapVisualAdapter } from '../../src/adapters/tiptapVisualAdapter'
import { TiptapTransactionPatchPlanner, serializeOrdinaryTiptapPatch } from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs/ordinaryBlocks'
import { referenceMarkdown } from '../../packages/editor-core/src'
import { DocumentSession } from '../../src/core/documentSession'

function mount(markdown: string) {
  const host = document.createElement('div')
  document.body.append(host)
  const session = new DocumentSession({ documentId: 'incremental', markdown })
  const project = vi.fn(projectOrdinaryMarkdown)
  const adapter = new TiptapVisualAdapter({
    host, session, project,
    patchPlanner: new TiptapTransactionPatchPlanner({ createTransactionId: () => 'local', serialize: serializeOrdinaryTiptapPatch }),
  })
  project.mockClear()
  return { adapter, project, host, dispose: () => { adapter.destroy(); host.remove() } }
}

function expectMapMatchesFull(adapter: TiptapVisualAdapter) {
  const actual = adapter.projection()
  const full = projectOrdinaryMarkdown({ documentId: 'incremental', markdown: actual.source!, revision: actual.revision })
  expect(actual.map.entries.map(({ sourceSpan, originalSource, safePatchUnit }) => ({ sourceSpan, originalSource, expected: safePatchUnit.expectedSource, safeSpan: safePatchUnit.sourceSpan })))
    .toEqual(full.map.entries.map(({ sourceSpan, originalSource, safePatchUnit }) => ({ sourceSpan, originalSource, expected: safePatchUnit.expectedSource, safeSpan: safePatchUnit.sourceSpan })))
}

describe('incremental visual projection', () => {
  it.each(['Alpha\n\nBravo', '# Alpha\n\nBravo'])('parses only the changed block across pending edits and deletion: %s', (markdown) => {
    const { adapter, project, dispose } = mount(markdown)
    try {
      adapter.setSelection({ anchor: 3, head: 3 })
      for (const text of ['x', '中', 'y']) {
        adapter.insertText(text)
        expectMapMatchesFull(adapter)
      }
      adapter.setSelection({ anchor: 3, head: 6 })
      adapter.insertText('')
      expect(adapter.projection().source).toBe(markdown)
      expectMapMatchesFull(adapter)
      expect(project.mock.calls.every(([snapshot]) => snapshot.markdown.length < markdown.length)).toBe(true)
      adapter.setSelection({ anchor: 1, head: 1 })
      const count = project.mock.calls.length
      adapter.setSelection({ anchor: 2, head: 2 })
      expect(project).toHaveBeenCalledTimes(count)
    } finally { dispose() }
  })

  it('reuses an exact-source acknowledgement and updates its revision', () => {
    const { adapter, project, dispose } = mount('Alpha\n\nBravo')
    try {
      adapter.setSelection({ anchor: 3, head: 3 })
      adapter.insertText('x')
      project.mockClear()
      const snapshot = { documentId: 'incremental', markdown: adapter.projection().source!, revision: 1 }
      adapter.acknowledgeSynchronization({ snapshot })
      expect(project).not.toHaveBeenCalled()
      expect(adapter.projection().revision).toBe(1)
      expect(adapter.projection().map.revision).toBe(1)
      adapter.insertText('y')
      expectMapMatchesFull(adapter)
    } finally { dispose() }
  })

  it('falls back for a paragraph split', () => {
    const { adapter, project, host, dispose } = mount('Alpha\n\nBravo')
    try {
      adapter.setSelection({ anchor: 3, head: 3 })
      host.querySelector('.tiptap')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      expect(project.mock.calls.some(([snapshot]) => snapshot.markdown.includes('Bravo'))).toBe(true)
      expectMapMatchesFull(adapter)
    } finally { dispose() }
  })
  it('keeps later-block offsets correct through undo and redo before acknowledgement', () => {
    const { adapter, project, dispose } = mount('Alpha\n\nBravo\n\nCharlie')
    try {
      adapter.setSelection({ anchor: 3, head: 3 })
      adapter.insertText('x')
      adapter.setSelection({ anchor: 11, head: 11 })
      adapter.insertText('y')
      const edited = adapter.projection().source
      expectMapMatchesFull(adapter)
      expect(adapter.undo()).toBe(true)
      expectMapMatchesFull(adapter)
      expect(adapter.redo()).toBe(true)
      expect(adapter.projection().source).toBe(edited)
      expectMapMatchesFull(adapter)
      expect(project.mock.calls.every(([snapshot]) => !snapshot.markdown.includes('Charlie'))).toBe(true)
    } finally { dispose() }
  })

  it('does not reuse a map for different source with the same length', () => {
    const { adapter, project, dispose } = mount('Alpha\n\nBravo')
    try {
      adapter.acknowledgeSynchronization({ snapshot: { documentId: 'incremental', markdown: 'Omega\n\nBravo', revision: 1 } })
      expect(project).toHaveBeenCalledTimes(1)
      expect(project.mock.calls[0]?.[0].markdown).toBe('Omega\n\nBravo')
    } finally { dispose() }
  })

  it('keeps unchanged link syntax local in an affected paragraph', () => {
    const { adapter, project, dispose } = mount('Alpha [link](https://example.com)\n\nBravo')
    try {
      adapter.setSelection({ anchor: 3, head: 3 })
      adapter.insertText('x')
      expect(project.mock.calls.every(([snapshot]) => !snapshot.markdown.includes('Bravo'))).toBe(true)
      expectMapMatchesFull(adapter)
    } finally { dispose() }
  })

  it('locally edits cited prose with an unchanged formula and encoded reference metadata', () => {
    const reference = referenceMarkdown({ id: 'study', number: 7, text: 'Example study', metadata: { title: 'An example paper' }, style: 'apa' })
    const markdown = `Alpha ${reference} and $x^2$ with evidence.\n\nBravo`
    const { adapter, project, dispose } = mount(markdown)
    try {
      adapter.setSelection({ anchor: 3, head: 3 })
      adapter.insertText('中')
      expect(project.mock.calls.every(([snapshot]) => !snapshot.markdown.includes('Bravo'))).toBe(true)
      expect(adapter.projection().source).toContain(reference)
      expectMapMatchesFull(adapter)
      expect(adapter.undo()).toBe(true)
      expect(adapter.projection().source).toBe(markdown)
    } finally { dispose() }
  })

  it('keeps parser work bounded to the edited cited paragraph in a 20k-character document', () => {
    const reference = referenceMarkdown({ id: 'study', number: 1, text: 'Evidence', metadata: { title: 'Research results' } })
    const paragraph = `Ordinary scientific writing ${reference} and experimental evidence. ` + 'More evidence. '.repeat(8)
    const markdown = Array.from({ length: 80 }, () => paragraph).join('\n\n')
    const { adapter, project, dispose } = mount(markdown)
    try {
      adapter.setSelection({ anchor: 4, head: 4 })
      for (const text of ['a', 'b', '中']) adapter.insertText(text)
      expect(markdown.length).toBeGreaterThan(20_000)
      expect(project).toHaveBeenCalledTimes(3)
      expect(project.mock.calls.every(([snapshot]) => snapshot.markdown.length < paragraph.length + 4)).toBe(true)
      expectMapMatchesFull(adapter)
    } finally { dispose() }
  })

})
