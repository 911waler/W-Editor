import { describe, expect, it, vi } from 'vitest'

import {
  TiptapTransactionPatchPlanner,
  TiptapVisualAdapter,
  serializeOrdinaryTiptapPatch,
} from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'
import type { ListCommandId } from '../../src/services'

const CASES: readonly Readonly<{ commandId: ListCommandId; paragraph: string; prefix: string }>[] = [
  { commandId: 'list.ordered', paragraph: '1. Alpha\n\nTail', prefix: '1. ' },
  { commandId: 'list.unordered', paragraph: '- Alpha\n\nTail', prefix: '- ' },
  { commandId: 'list.task', paragraph: '- [ ] Alpha\n\nTail', prefix: '- [ ] ' },
]

describe('direct visual lists', () => {
  it.each(['Before\n\n', 'Before\n\n\n\nAfter', '3. Alpha', 'Alpha\nBeta'])('converts the last paragraph of %j to an ordered list', (markdown) => {
    const host = document.createElement('div'); document.body.append(host)
    const session = new DocumentSession({ documentId: 'list-context', markdown })
    const failures: unknown[] = []
    const adapter = new TiptapVisualAdapter({ host, session, project: projectOrdinaryMarkdown,
      onTransactionFailure: ({ failure }) => failures.push(failure),
      patchPlanner: new TiptapTransactionPatchPlanner({ createTransactionId: () => 'context', serialize: serializeOrdinaryTiptapPatch }),
    })
    try {
      const block = host.querySelector('.ProseMirror')!.lastElementChild as HTMLElement
      adapter.selectDomBlock(block)
      adapter.applyList('list.ordered')
      adapter.insertText('Added')
      expect(failures).toEqual([])
    } finally { adapter.destroy(); host.remove() }
  })

  it.each(CASES)('preserves line breaks when converting and reloading $commandId', ({ commandId, prefix }) => {
    const host = document.createElement('div'); document.body.append(host)
    const session = new DocumentSession({ documentId: 'multiline-list', markdown: 'Alpha\nBeta' })
    const plans: PatchPlan[] = []
    const failures: unknown[] = []
    const adapter = new TiptapVisualAdapter({ host, session, project: projectOrdinaryMarkdown,
      onTransaction: ({ patchPlan }) => { if (patchPlan) plans.push(patchPlan) },
      onTransactionFailure: ({ failure }) => failures.push(failure),
      patchPlanner: new TiptapTransactionPatchPlanner({ createTransactionId: () => 'multiline', serialize: serializeOrdinaryTiptapPatch }),
    })
    try {
      adapter.setSelection({ anchor: 1, head: 1 })
      adapter.applyList(commandId)
      expect(failures).toEqual([])
      expect(plans).toHaveLength(1)
      session.commitPatchPlan(plans[0]!)
      expect(session.snapshot().markdown).toBe(`${prefix}Alpha  \n${' '.repeat(prefix.length)}Beta`)
      const projected = projectOrdinaryMarkdown(session.snapshot())
      expect(projected.content.content).toHaveLength(1)
      expect(projected.content.content?.[0]?.content?.[0]?.content?.[0]?.content).toEqual([
        { type: 'text', text: 'Alpha' }, { type: 'hardBreak' }, { type: 'text', text: 'Beta' },
      ])
    } finally { adapter.destroy(); host.remove() }
  })

  it.each(CASES)('starts $commandId in an empty document and accepts text', ({ commandId, prefix }) => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'empty-list', markdown: '' })
    const plans: PatchPlan[] = []
    const failures: unknown[] = []
    const adapter = new TiptapVisualAdapter({ host, session, project: projectOrdinaryMarkdown,
      onTransaction: ({ patchPlan }) => { if (patchPlan) plans.push(patchPlan) },
      onTransactionFailure: ({ failure }) => failures.push(failure),
      patchPlanner: new TiptapTransactionPatchPlanner({ createTransactionId: () => `empty:${plans.length}`, serialize: serializeOrdinaryTiptapPatch }),
    })
    try {
      adapter.setSelection({ anchor: 1, head: 1 })
      adapter.applyList(commandId)
      adapter.insertText('Alpha')
      expect(failures).toEqual([])
      expect(plans.at(-1)?.patches[0]?.replacement).toBe(`${prefix}Alpha`)
    } finally { adapter.destroy(); host.remove() }
  })

  it.each(CASES)('unwraps a middle $commandId paragraph without serializing its siblings into the patch', ({ commandId }) => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({
      documentId: `${commandId}:middle-toggle`,
      markdown: 'Before\n\nAlpha\n\nAfter',
    })
    const plans: PatchPlan[] = []
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `${commandId}:middle-toggle:${plans.length + 1}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    const commitLatest = (): void => {
      const plan = plans.at(-1)
      if (plan === undefined) throw new Error('Expected a visual list patch.')
      session.commitPatchPlan(plan)
      adapter.acknowledgeSynchronization({
        map: projectOrdinaryMarkdown(session.snapshot()).map,
        snapshot: session.snapshot(),
      })
    }
    try {
      adapter.setSelection({ anchor: 9, head: 14 })
      expect(adapter.applyList(commandId)).toEqual({ active: true, changed: true })
      commitLatest()

      adapter.setSelection({ anchor: 11, head: 11 })
      expect(adapter.applyList(commandId)).toEqual({ active: false, changed: true })
      expect(plans.at(-1)?.patches[0]).toMatchObject({
        expected: commandId === 'list.ordered' ? '1. Alpha' : commandId === 'list.task' ? '- [ ] Alpha' : '- Alpha',
        replacement: 'Alpha',
      })
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it.each(CASES)('applies, splits, and joins $commandId with exact safe-unit patches', ({ commandId, prefix }) => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: commandId, markdown: 'Alpha' })
    const plans: PatchPlan[] = []
    let transactionSequence = 0
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `${commandId}:${++transactionSequence}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    const commitLatest = (): void => {
      const plan = plans.at(-1)
      if (plan === undefined) throw new Error('Expected a visual list patch.')
      session.commitPatchPlan(plan)
      adapter.acknowledgeSynchronization({
        map: projectOrdinaryMarkdown(session.snapshot()).map,
        snapshot: session.snapshot(),
      })
    }
    try {
      adapter.setSelection({ anchor: 1, head: 6 })
      expect(adapter.applyList(commandId)).toEqual({ active: true, changed: true })
      expect(plans.at(-1)?.patches[0]?.replacement).toBe(`${prefix}Alpha`)
      commitLatest()
      expect(adapter.isListActive(commandId)).toBe(true)

      adapter.setSelection({ anchor: 5, head: 5 })
      expect(adapter.dispatchKey('Enter')).toBe(true)
      const splitSource = commandId === 'list.ordered'
        ? '1. Al\n2. pha'
        : `${prefix}Al\n${prefix}pha`
      expect(plans.at(-1)?.patches[0]?.replacement).toBe(splitSource)
      commitLatest()

      adapter.setSelection({ anchor: 9, head: 9 })
      expect(adapter.dispatchKey('Backspace')).toBe(true)
      expect(plans.at(-1)?.patches[0]?.replacement).toBe(`${prefix}Alpha`)
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('toggles a task checkbox and keeps task text directly editable', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'task-edit', markdown: '- [ ] Alpha' })
    const plans: PatchPlan[] = []
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `task-edit:${plans.length + 1}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    try {
      adapter.setSelection({ anchor: 3, head: 3 })
      expect(adapter.toggleTaskItemChecked()).toEqual({ active: true, changed: true })
      expect(plans.at(-1)?.patches[0]?.replacement).toBe('- [x] Alpha')

      adapter.setSelection({ anchor: 8, head: 8 })
      adapter.insertText('!')
      expect(plans.at(-1)?.patches[0]?.replacement).toBe('- [x] Alpha!')
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('routes a read-only task checkbox through the authority callback without mutating Tiptap locally', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'readonly-task', markdown: '- [ ] Alpha' })
    const onReadOnlyTaskToggle = vi.fn(() => true)
    const adapter = new TiptapVisualAdapter({
      host,
      onReadOnlyTaskToggle,
      project: projectOrdinaryMarkdown,
      session,
    })
    try {
      adapter.setPresentationMode(true)
      const editor = host.querySelector<HTMLElement>('.ProseMirror')
      const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')
      if (editor === null || checkbox === null) throw new Error('Expected the read-only task DOM.')
      expect(editor.getAttribute('contenteditable')).toBe('false')

      checkbox.checked = true
      checkbox.dispatchEvent(new Event('change', { bubbles: true }))

      expect(onReadOnlyTaskToggle).toHaveBeenCalledWith({ checked: true, index: 0 })
      expect(adapter.documentJSON()).toMatchObject({
        content: [{ content: [{ attrs: { checked: false } }] }],
      })
      adapter.setPresentationMode(false)
      expect(editor.getAttribute('contenteditable')).toBe('true')
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it.each(CASES)('serializes immediate empty-item exit and typing for $commandId from the original authority', ({ commandId, paragraph }) => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: `${commandId}:exit`, markdown: 'Alpha' })
    const plans: PatchPlan[] = []
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `${commandId}:exit:${plans.length + 1}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    try {
      adapter.setSelection({ anchor: 1, head: 6 })
      adapter.applyList(commandId)
      adapter.setSelection({ anchor: 8, head: 8 })
      const editor = host.querySelector<HTMLElement>('.ProseMirror')
      if (editor === null) throw new Error('Expected the visual editor DOM.')
      editor.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }))
      editor.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }))
      adapter.insertText('Tail')
      expect(plans.at(-1)?.patches[0]?.replacement).toBe(paragraph)
    } finally {
      adapter.destroy()
      host.remove()
    }
  })
})
