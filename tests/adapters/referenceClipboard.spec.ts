import { referenceMarkdown, scanReferences } from '../../packages/editor-core/src'
import { describe, expect, it } from 'vitest'

import { TiptapTransactionPatchPlanner, TiptapVisualAdapter, serializeOrdinaryTiptapPatch } from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

function mount(markdown: string) {
  const host = document.createElement('div')
  document.body.append(host)
  const session = new DocumentSession({ documentId: 'formula-clipboard', markdown })
  const failures: unknown[] = []
  const plans: PatchPlan[] = []
  const adapter = new TiptapVisualAdapter({
    host,
    onTransaction: ({ patchPlan }) => { if (patchPlan !== null) plans.push(patchPlan) },
    onTransactionFailure: ({ failure }) => { failures.push(failure) },
    patchPlanner: new TiptapTransactionPatchPlanner({
      createTransactionId: () => 'formula:paste',
      serialize: serializeOrdinaryTiptapPatch,
    }),
    project: projectOrdinaryMarkdown,
    session,
  })
  const commit = () => {
    expect(failures).toEqual([])
    const plan = plans.at(-1)
    expect(plan).toBeDefined()
    session.commitPatchPlan(plan!)
    const snapshot = session.snapshot()
    adapter.acknowledgeSynchronization({ map: projectOrdinaryMarkdown(snapshot).map, snapshot })
  }
  return { adapter, commit, failures, host, plans, session, destroy: () => { adapter.destroy(); host.remove() } }
}

function clipboardEvent(type: 'copy' | 'paste', data: Map<string, string>): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: {
    clearData: () => data.clear(),
    getData: (format: string) => data.get(format) ?? '',
    setData: (format: string, value: string) => data.set(format, value),
    files: [],
    items: [],
    types: [...data.keys()],
  } })
  return event
}

describe('reference clipboard and projection', () => {
  it('preserves a cut reference number when pasted into the same document', () => {
    const a = referenceMarkdown({ id: 'a', number: 1, text: 'A' })
    const b = referenceMarkdown({ id: 'b', number: 2, text: 'B' })
    const source = mount(`${a} ${b}`)
    try {
      source.adapter.setSelection({ anchor: 1, head: 2 })
      const clipboard = new Map<string, string>()
      source.host.querySelector('.ProseMirror')!.dispatchEvent(clipboardEvent('copy', clipboard))
      source.adapter.insertText('')
      source.commit()
      source.adapter.setSelection({ anchor: 3, head: 3 })
      source.host.querySelector('.ProseMirror')!.dispatchEvent(clipboardEvent('paste', clipboard))
      source.commit()
      expect(source.session.snapshot().markdown).toContain(a)
    } finally { source.destroy() }
  })
  it('copies a self-contained reference and retains it after paste and adjacent typing', () => {
    const reference = referenceMarkdown({ id: 'book', number: 7, text: 'A book <safe>' })
    const source = mount(`Before ${reference} after`)
    const target = mount('Target')
    try {
      expect(source.host.querySelector('[data-reference-id="book"]')?.textContent).toBe('[7]')
      expect(source.host.querySelector('.w-reference-list')?.textContent).toContain('A book <safe>')
      const first = source.adapter.schema().nodeFromJSON(source.adapter.documentJSON()).firstChild!
      source.adapter.setSelection({ anchor: 1, head: first.nodeSize - 1 })
      const clipboard = new Map<string, string>()
      source.host.querySelector('.ProseMirror')!.dispatchEvent(clipboardEvent('copy', clipboard))
      expect(clipboard.get('text/plain')).toBe(`Before ${reference} after`)
      target.adapter.setSelection({ anchor: 7, head: 7 })
      target.host.querySelector('.ProseMirror')!.dispatchEvent(clipboardEvent('paste', clipboard))
      target.commit()
      const pastedReference = referenceMarkdown({ id: 'book', number: 1, text: 'A book <safe>' })
      expect(target.session.snapshot().markdown).toBe(`TargetBefore ${pastedReference} after`)
      const footer = target.host.querySelector('.w-reference-list')
      target.adapter.insertText('!')
      target.commit()
      expect(target.host.querySelector('.w-reference-list')).toBe(footer)
      expect(target.session.snapshot().markdown).toContain(pastedReference)
    } finally { source.destroy(); target.destroy() }
  })
  it('retains structured metadata through HTML-only clipboard and serializes null defaults safely', () => {
    const reference = { id: 'structured', number: 8, text: 'Source', metadata: { title: 'Paper', year: '2024' }, style: 'apa' as const }
    const source = mount(referenceMarkdown(reference))
    const target = mount('Target')
    try {
      source.adapter.setSelection({ anchor: 1, head: 2 })
      const clipboard = new Map<string, string>()
      source.host.querySelector('.ProseMirror')!.dispatchEvent(clipboardEvent('copy', clipboard))
      expect(clipboard.get('text/html')).toContain('data-reference-source')
      clipboard.delete('text/plain')
      target.adapter.setSelection({ anchor: 7, head: 7 })
      target.host.querySelector('.ProseMirror')!.dispatchEvent(clipboardEvent('paste', clipboard))
      target.commit()
      expect(scanReferences(target.session.snapshot().markdown)[0]).toMatchObject({ ...reference, number: 1 })
    } finally { source.destroy(); target.destroy() }
  })
  it('clears optional metadata and style in visual edits', () => {
    const source = mount(referenceMarkdown({ id: 'a', number: 2, text: 'Original', metadata: { title: 'Old title' }, style: 'apa' }))
    try {
      source.adapter.updateReference('a', { text: 'Raw text' })
      source.commit()
      const reference = scanReferences(source.session.snapshot().markdown)[0]!
      expect(reference.metadata).toBeUndefined()
      expect(reference.style).toBeUndefined()
      expect(reference.number).toBe(2)
    } finally { source.destroy() }
  })
  it('updates and removes all visual occurrences atomically and notifies only reference changes', () => {
    const reference = { id: 'a', number: 4, text: 'Original', metadata: { title: 'Paper' }, style: 'apa' as const }
    const link = referenceMarkdown(reference)
    const source = mount(`${link} and ${link}`)
    const changes: unknown[] = []
    source.host.addEventListener('w-reference-change', event => changes.push((event as CustomEvent).detail.references))
    try {
      source.adapter.updateReference('a', { text: 'Edited', metadata: reference.metadata, style: reference.style })
      source.commit()
      expect(scanReferences(source.session.snapshot().markdown).map(r => r.text)).toEqual(['Edited', 'Edited'])
      expect(changes).toHaveLength(1)
      source.adapter.setReferenceStyle('mla')
      source.commit()
      expect(scanReferences(source.session.snapshot().markdown).every(r => r.style === 'mla' && r.metadata?.title === 'Paper')).toBe(true)
      source.adapter.setSelection({ anchor: 1, head: 1 })
      const before = changes.length
      source.adapter.insertText('Typed ')
      source.commit()
      expect(changes).toHaveLength(before)
      source.adapter.removeReference('a')
      source.commit()
      expect(scanReferences(source.session.snapshot().markdown)).toEqual([])
      expect(changes.at(-1)).toEqual([])
      expect(source.adapter.undo()).toBe(true)
      source.commit()
      expect(scanReferences(source.session.snapshot().markdown)).toHaveLength(2)
      expect(scanReferences(source.session.snapshot().markdown).every(r => r.text === 'Edited' && r.style === 'mla')).toBe(true)
      expect(source.adapter.redo()).toBe(true)
      source.commit()
      expect(scanReferences(source.session.snapshot().markdown)).toEqual([])
    } finally { source.destroy() }
  })

})
