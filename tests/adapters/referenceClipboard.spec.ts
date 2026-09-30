import { referenceMarkdown } from '../../packages/editor-core/src'
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
})
