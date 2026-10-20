import { afterEach, describe, expect, it } from 'vitest'

import { TiptapTransactionPatchPlanner, TiptapVisualAdapter, serializeOrdinaryTiptapPatch } from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

const adapters: TiptapVisualAdapter[] = []
const block = '$$\nx+y\n$$'
const inline = '$x+y$'

function mount(markdown: string) {
  const host = document.createElement('div')
  document.body.append(host)
  const session = new DocumentSession({ documentId: 'formula-mode-conversion', markdown })
  const plans: PatchPlan[] = []
  const failures: unknown[] = []
  const adapter = new TiptapVisualAdapter({
    host, session, project: projectOrdinaryMarkdown,
    patchPlanner: new TiptapTransactionPatchPlanner({
      createTransactionId: () => `formula-mode:${plans.length + 1}`,
      serialize: serializeOrdinaryTiptapPatch,
    }),
    onTransaction: ({ patchPlan }) => { if (patchPlan !== null) plans.push(patchPlan) },
    onTransactionFailure: ({ failure }) => { failures.push(failure) },
  })
  adapters.push(adapter)
  const commit = (expectedMarkdown: string) => {
    expect(failures).toEqual([])
    const plan = plans.at(-1)
    expect(plan).toBeDefined()
    for (const patch of plan!.patches) {
      expect(session.snapshot().markdown.slice(patch.from, patch.to)).toBe(patch.expected)
    }
    session.commitPatchPlan(plan!)
    const snapshot = session.snapshot()
    expect(snapshot.markdown).toBe(expectedMarkdown)
    adapter.acknowledgeSynchronization({ snapshot, map: projectOrdinaryMarkdown(snapshot).map })
  }
  const select = (mode: 'inline' | 'block', index = 0) => {
    const node = host.querySelectorAll<HTMLElement>(`[data-formula-mode="${mode}"]`)[index]
    expect(node).toBeDefined()
    node!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    expect(adapter.selectedFormula()).toEqual({ mode, content: 'x+y', source: mode === 'inline' ? inline : block })
  }
  return { adapter, commit, failures, host, plans, select, session }
}

afterEach(() => {
  while (adapters.length > 0) adapters.pop()?.destroy()
  document.body.replaceChildren()
})

describe('formula mode conversion', () => {
  it('renumbers later blocks after conversion, undo and redo without numbering the inline formula', () => {
    const original = `${block}\n\n${block}\n\n${block}`
    const converted = `${block}\n\n${inline}\n\n${block}`
    const app = mount(original)
    const labels = () => [...app.host.querySelectorAll('.formula-node__number')].map(node => node.textContent)
    app.select('block', 1)
    expect(labels()).toEqual(['(1)', '(2)', '(3)'])
    expect(app.adapter.applyFormula('inline', 'x+y')).toEqual({ active: true, changed: true })
    app.commit(converted)
    expect(labels()).toEqual(['(1)', '(2)'])
    expect(app.host.querySelector('.formula-node--inline .formula-node__number')).toBeNull()
    expect(app.adapter.undo()).toBe(true)
    app.commit(original)
    expect(labels()).toEqual(['(1)', '(2)', '(3)'])
    expect(app.adapter.redo()).toBe(true)
    app.commit(converted)
    expect(labels()).toEqual(['(1)', '(2)'])
    expect(app.plans).toHaveLength(3)
    expect(app.adapter.undo()).toBe(true)
    app.commit(original)
    expect(app.adapter.undo()).toBe(false)
  })

  it.each([
    { original: block, expected: inline, index: 0 },
    { original: `Before\n\n${block}\n\nAfter`, expected: `Before\n\n${inline}\n\nAfter`, index: 0 },
    { original: `${block}\n\nMiddle\n\n${block}\n\nAfter`, expected: `${block}\n\nMiddle\n\n${inline}\n\nAfter`, index: 1 },
  ])('replaces the selected block with an active inline formula: $original', ({ original, expected, index }) => {
    const app = mount(original)
    app.select('block', index)

    expect(app.adapter.applyFormula('inline', 'x+y')).toEqual({ active: true, changed: true })
    expect(app.adapter.selectedFormula()).toEqual({ mode: 'inline', content: 'x+y', source: inline })
    expect(app.adapter.selection().kind).toBe('node')
    expect(app.host.querySelectorAll('[data-formula-mode="block"]')).toHaveLength(index)
    expect(app.plans).toHaveLength(1)
    app.commit(expected)

    expect(app.adapter.undo()).toBe(true)
    app.commit(original)
    expect(app.adapter.undo()).toBe(false)
    expect(app.adapter.redo()).toBe(true)
    app.commit(expected)
  })

  it.each([
    { original: inline, expected: block, index: 0 },
    { original: `Before ${inline} after`, expected: `Before \n\n${block}\n\n after`, index: 0 },
    { original: `Before ${inline} + ${inline} after`, expected: `Before ${inline} + \n\n${block}\n\n after`, index: 1 },
  ])('replaces only the selected inline formula with a block: $original', ({ original, expected, index }) => {
    const app = mount(original)
    app.select('inline', index)

    expect(app.adapter.applyFormula('block', 'x+y')).toEqual({ active: true, changed: true })
    expect(app.adapter.selectedFormula()).toEqual({ mode: 'block', content: 'x+y', source: block })
    expect(app.host.querySelectorAll('[data-formula-mode="inline"]')).toHaveLength(index)
    expect(app.host.querySelectorAll('[data-formula-mode="block"]')).toHaveLength(1)
    expect(app.plans).toHaveLength(1)
    app.commit(expected)

    expect(app.adapter.undo()).toBe(true)
    app.commit(original)
    expect(app.adapter.undo()).toBe(false)
    expect(app.adapter.redo()).toBe(true)
    app.commit(expected)
  })

  it.each(['inline', 'block'] as const)('selects the actual %s formula after inserting in an empty document', mode => {
    const app = mount('')

    expect(app.adapter.applyFormula(mode, 'x+y')).toEqual({ active: true, changed: true })
    expect(app.adapter.selectedFormula()).toEqual({ mode, content: 'x+y', source: mode === 'inline' ? inline : block })
    app.commit(mode === 'inline' ? inline : block)
  })

  it('selects the inserted inline formula when replacing a selected non-formula block requires a paragraph', () => {
    const app = mount('---')
    expect(app.adapter.selection().kind).toBe('node')

    expect(app.adapter.applyFormula('inline', 'x+y')).toEqual({ active: true, changed: true })
    expect(app.adapter.selectedFormula()).toEqual({ mode: 'inline', content: 'x+y', source: inline })
    app.commit(inline)
  })

  it('selects a newly inserted inline formula that inherits surrounding text marks', () => {
    const app = mount('**Before after**')
    app.adapter.setSelection({ anchor: 8, head: 8 })

    expect(app.adapter.applyFormula('inline', 'x+y')).toEqual({ active: true, changed: true })
    expect(app.adapter.selectedFormula()).toEqual({ mode: 'inline', content: 'x+y', source: inline })
    app.commit('**Before $x+y$after**')
  })

  it('does not emit a patch or history entry for an unchanged inline formula', () => {
    const app = mount(inline)
    app.select('inline')

    const before = app.adapter.documentJSON()
    expect(app.adapter.applyFormula('inline', 'x+y')).toEqual({ active: true, changed: false })
    expect(app.adapter.documentJSON()).toEqual(before)
    expect(app.adapter.selectedFormula()).toEqual({ mode: 'inline', content: 'x+y', source: inline })
    expect(app.failures).toEqual([])
    expect(app.session.snapshot().markdown).toBe(inline)
    expect(app.plans).toEqual([])
    expect(app.adapter.undo()).toBe(false)
  })

  it.each(['inline', 'block'] as const)('does not add an empty undo step when reapplying the same %s formula attributes', mode => {
    const original = mode === 'inline' ? inline : block
    const updated = mode === 'inline' ? '$z=1$' : '$$\nz=1\n$$'
    const app = mount(original)
    app.select(mode)
    expect(app.adapter.applyFormula(mode, 'z=1')).toEqual({ active: true, changed: true })
    app.commit(updated)
    const before = app.adapter.documentJSON()

    expect(app.adapter.applyFormula(mode, 'z=1')).toEqual({ active: true, changed: false })
    expect(app.adapter.documentJSON()).toEqual(before)
    expect(app.plans).toHaveLength(1)
    expect(app.adapter.undo()).toBe(true)
    app.commit(original)
    expect(app.adapter.undo()).toBe(false)
  })
})
