import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  TiptapTransactionPatchPlanner,
  TiptapVisualAdapter,
  serializeOrdinaryTiptapPatch,
  type TiptapVisualProjection,
} from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs/ordinaryBlocks'
import { DocumentSession, SynchronizationStateStore, type DocumentSnapshot, type PatchPlan } from '../../src/core'
import { VisualSynchronizationService } from '../../src/services'

const rangePrototype = Range.prototype
const originalRangeGetClientRects = Object.getOwnPropertyDescriptor(rangePrototype, 'getClientRects')
let installedRangeGetClientRects = false

// ProseMirror scrolls history selections through Range geometry, which jsdom does not implement.
beforeAll(() => {
  if (typeof rangePrototype.getClientRects === 'function') return
  Object.defineProperty(rangePrototype, 'getClientRects', {
    configurable: true,
    value(this: Range): DOMRectList {
      const rect = new DOMRect(0, 0, 1, 1)
      const rects = Object.assign([rect], {
        item: (index: number): DOMRect | null => index === 0 ? rect : null,
      })
      return rects as unknown as DOMRectList
    },
  })
  installedRangeGetClientRects = true
})

afterAll(() => {
  if (!installedRangeGetClientRects) return
  if (originalRangeGetClientRects === undefined) {
    Reflect.deleteProperty(rangePrototype, 'getClientRects')
    return
  }
  Object.defineProperty(rangePrototype, 'getClientRects', originalRangeGetClientRects)
})

function mount(
  markdown: string,
  project: (snapshot: DocumentSnapshot) => TiptapVisualProjection = projectOrdinaryMarkdown,
): {
  readonly adapter: TiptapVisualAdapter
  readonly host: HTMLElement
} {
  const host = document.createElement('div')
  document.body.append(host)
  const session = new DocumentSession({ documentId: 'join-behavior', markdown })
  return { adapter: new TiptapVisualAdapter({ host, project, session }), host }
}

function atomicProjection(snapshot: DocumentSnapshot): TiptapVisualProjection {
  return {
    content: {
      content: [
        { attrs: { ordinaryClass: true, projectionId: 'before' }, content: [{ text: 'A', type: 'text' }], type: 'paragraph' },
        { attrs: { kind: 'code-block', projectionId: 'atomic', source: '```js\nx\n```' }, type: 'semanticBlock' },
        { attrs: { ordinaryClass: true, projectionId: 'after' }, content: [{ text: 'B', type: 'text' }], type: 'paragraph' },
      ],
      type: 'doc',
    },
    map: { documentLength: snapshot.markdown.length, entries: [], revision: snapshot.revision },
    revision: snapshot.revision,
  }
}

describe('symmetric ordinary block joins', () => {
  it('keeps rapid consecutive Delete joins synchronized and undoable', async () => {
    const markdown = 'Alpha\n\nBravo\n\nCharlie'
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'rapid-delete-joins', markdown })
    const state = new SynchronizationStateStore(session.snapshot())
    const failures: unknown[] = []
    const synchronization = new VisualSynchronizationService({
      onAcknowledgement: ({ snapshot }) => {
        const projection = projectOrdinaryMarkdown(snapshot)
        adapter.acknowledgeSynchronization({ map: projection.map, snapshot })
      },
      session,
      state,
    })
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) synchronization.request(patchPlan)
      },
      onTransactionFailure: ({ failure }) => failures.push(failure),
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `rapid-delete:${failures.length}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })

    try {
      const alpha = adapter.search('Alpha')[0]
      if (alpha === undefined) throw new Error('Expected Alpha.')
      adapter.setSelection({ anchor: alpha.to, head: alpha.to })
      expect(adapter.dispatchKey('Delete')).toBe(true)

      const firstJoin = adapter.search('AlphaBravo')[0]
      if (firstJoin === undefined) throw new Error('Expected the first joined block.')
      adapter.setSelection({ anchor: firstJoin.to, head: firstJoin.to })
      expect(adapter.dispatchKey('Delete')).toBe(true)

      await synchronization.flush()

      expect(failures).toEqual([])
      expect(session.snapshot().markdown).toBe('AlphaBravoCharlie')
      expect(state.snapshot().status).toBe('synchronized')

      expect(adapter.undo()).toBe(true)
      await synchronization.flush()
      expect(session.snapshot().markdown).toBe(markdown)
      expect(adapter.redo()).toBe(true)
      await synchronization.flush()
      expect(session.snapshot().markdown).toBe('AlphaBravoCharlie')
    } finally {
      synchronization.cancel()
      adapter.destroy()
      host.remove()
    }
  })

  it('synchronizes a just-moved browser caret before Backspace so undo restores that location', () => {
    const { adapter, host } = mount('First\n\nMiddle\n\nLast')
    try {
      const targetStart = adapter.search('Middle')[0]?.from
      const staleLastStart = adapter.search('Last')[0]?.from
      if (targetStart === undefined || staleLastStart === undefined) {
        throw new Error('Expected the middle and last paragraphs.')
      }
      adapter.setSelection({ anchor: staleLastStart, head: staleLastStart })

      const blocks = Array.from(host.querySelectorAll<HTMLElement>('.ProseMirror p'))
      const target = blocks.find((block) => block.textContent === 'Middle')
      const targetText = target?.firstChild
      if (!(targetText instanceof Text)) throw new Error('Expected the middle paragraph text node.')
      const range = document.createRange()
      range.setStart(targetText, 0)
      range.collapse(true)
      const browserSelection = window.getSelection()
      browserSelection?.removeAllRanges()
      browserSelection?.addRange(range)

      host.querySelector<HTMLElement>('.ProseMirror')?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Backspace',
      }))

      expect(Array.from(host.querySelectorAll<HTMLElement>('.ProseMirror p'), (block) => block.textContent))
        .toEqual(['FirstMiddle', 'Last'])
      expect(adapter.undo()).toBe(true)
      expect(Array.from(host.querySelectorAll<HTMLElement>('.ProseMirror p'), (block) => block.textContent))
        .toEqual(['First', 'Middle', 'Last'])
      expect(adapter.selection()).toEqual({ anchor: targetStart, head: targetStart, kind: 'text' })
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it.each([
    { key: 'Backspace' as const, markdown: 'Alpha\n\nBravo', position: 8 },
    { key: 'Delete' as const, markdown: 'Alpha\n\nBravo', position: 6 },
    { key: 'Backspace' as const, markdown: '# Alpha\n\nBravo', position: 8 },
    { key: 'Delete' as const, markdown: 'Alpha\n\n# Bravo', position: 6 },
  ])('$key joins compatible blocks in "$markdown" at position $position', ({ key, markdown, position }) => {
    const { adapter, host } = mount(markdown)
    try {
      adapter.setSelection({ anchor: position, head: position })

      expect(adapter.dispatchKey(key)).toBe(true)
      expect(adapter.text()).toBe('AlphaBravo')
      expect(adapter.documentJSON().content).toHaveLength(1)
      expect(adapter.selection()).toEqual({ anchor: 6, head: 6, kind: 'text' })
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it.each([
    { key: 'Delete' as const, position: 2 },
    { key: 'Backspace' as const, position: 5 },
  ])('$key selects rather than corrupting an adjacent atomic semantic node', ({ key, position }) => {
    const markdown = 'A\n\n```js\nx\n```\n\nB'
    const { adapter, host } = mount(markdown, atomicProjection)
    try {
      adapter.setSelection({ anchor: position, head: position })

      expect(adapter.dispatchKey(key)).toBe(true)
      expect(adapter.text()).toBe('AB')
      expect(adapter.documentJSON().content).toHaveLength(3)
      expect(adapter.selection().kind).toBe('node')
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('does not turn an atomic NodeSelection into a text selection at the keydown boundary', () => {
    const markdown = 'A\n\n```js\nx\n```\n\nB'
    const { adapter, host } = mount(markdown, atomicProjection)
    try {
      adapter.setSelection({ anchor: 2, head: 2 })
      expect(adapter.dispatchKey('Delete')).toBe(true)
      expect(adapter.selection().kind).toBe('node')

      host.querySelector<HTMLElement>('.ProseMirror')?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'F1',
      }))

      expect(adapter.selection().kind).toBe('node')
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('does not dispatch a browser-selection synchronization transaction during IME composition', () => {
    const { adapter, host } = mount('First\n\nMiddle\n\nLast')
    try {
      const targetStart = adapter.search('Middle')[0]?.from
      const staleLastStart = adapter.search('Last')[0]?.from
      if (targetStart === undefined || staleLastStart === undefined) {
        throw new Error('Expected the middle and last paragraphs.')
      }
      adapter.setSelection({ anchor: staleLastStart, head: staleLastStart })

      const target = Array.from(host.querySelectorAll<HTMLElement>('.ProseMirror p'))
        .find((block) => block.textContent === 'Middle')
      const targetText = target?.firstChild
      if (!(targetText instanceof Text)) throw new Error('Expected the middle paragraph text node.')
      const range = document.createRange()
      range.setStart(targetText, 0)
      range.collapse(true)
      const browserSelection = window.getSelection()
      browserSelection?.removeAllRanges()
      browserSelection?.addRange(range)

      const editor = host.querySelector<HTMLElement>('.ProseMirror')
      editor?.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      editor?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        isComposing: true,
        key: 'Process',
      }))
      editor?.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: '拼',
        inputType: 'insertCompositionText',
        isComposing: true,
      }))

      expect(adapter.selection()).toEqual({ anchor: staleLastStart, head: staleLastStart, kind: 'text' })
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('plans one checked patch for exactly the joined blocks and their separator', () => {
    const markdown = 'Keep\n\nAlpha\n\nBravo\n\nTail'
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'join-plan', markdown })
    const plans: PatchPlan[] = []
    const planner = new TiptapTransactionPatchPlanner({
      createTransactionId: () => 'join-middle-blocks',
      serialize: serializeOrdinaryTiptapPatch,
    })
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: planner,
      project: projectOrdinaryMarkdown,
      session,
    })
    try {
      adapter.setSelection({ anchor: 14, head: 14 })

      expect(adapter.dispatchKey('Backspace')).toBe(true)
      expect(plans).toEqual([{
        baseRevision: 0,
        patches: [{
          codecId: 'ordinary-join',
          expected: 'Alpha\n\nBravo',
          from: 6,
          replacement: 'AlphaBravo',
          to: 18,
        }],
        transactionId: 'join-middle-blocks',
      }])
      expect(session.previewPatchPlan(plans[0]!)).toBe('Keep\n\nAlphaBravo\n\nTail')
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it.each([
    { key: 'Backspace' as const, markdown: 'Alpha\n\nBravo', position: 8, replacement: 'AlphaBravo' },
    { key: 'Delete' as const, markdown: 'Alpha\n\nBravo', position: 6, replacement: 'AlphaBravo' },
    { key: 'Backspace' as const, markdown: '# Alpha\n\nBravo', position: 8, replacement: '# AlphaBravo' },
    { key: 'Delete' as const, markdown: 'Alpha\n\n# Bravo', position: 6, replacement: 'AlphaBravo' },
  ])('$key join is one visual transaction, one checked patch, and one undo step for "$markdown"', ({
    key,
    markdown,
    position,
    replacement,
  }) => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'join-history', markdown })
    const plans: PatchPlan[] = []
    let documentTransactions = 0
    let transactionSequence = 0
    const planner = new TiptapTransactionPatchPlanner({
      createTransactionId: () => `join-history:${++transactionSequence}`,
      serialize: serializeOrdinaryTiptapPatch,
    })
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan, transaction }) => {
        if (transaction.docChanged) documentTransactions += 1
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: planner,
      project: projectOrdinaryMarkdown,
      session,
    })
    const commitLatestPlan = (): void => {
      const plan = plans.at(-1)
      if (plan === undefined) throw new Error('Expected a visual patch plan.')
      session.commitPatchPlan(plan)
      const projection = projectOrdinaryMarkdown(session.snapshot())
      adapter.acknowledgeSynchronization({ map: projection.map, snapshot: session.snapshot() })
    }
    try {
      adapter.setSelection({ anchor: position, head: position })

      expect(adapter.dispatchKey(key)).toBe(true)
      expect(documentTransactions).toBe(1)
      expect(plans).toHaveLength(1)
      expect(plans[0]?.patches).toEqual([{
        codecId: 'ordinary-join',
        expected: markdown,
        from: 0,
        replacement,
        to: markdown.length,
      }])
      expect(adapter.selection()).toEqual({ anchor: 6, head: 6, kind: 'text' })
      commitLatestPlan()
      expect(session.snapshot().markdown).toBe(replacement)

      expect(adapter.undo()).toBe(true)
      expect(documentTransactions).toBe(2)
      expect(plans).toHaveLength(2)
      expect(plans[1]?.patches).toHaveLength(1)
      commitLatestPlan()
      expect(session.snapshot().markdown).toBe(markdown)
      expect(adapter.undo()).toBe(false)
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('restores a synchronized joined pair without dropping its restored block between unaffected neighbors', () => {
    const markdown = 'Keep\n\nAlpha\n\nBravo\n\nTail'
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'surrounded-join-history', markdown })
    const plans: PatchPlan[] = []
    let transactionSequence = 0
    const planner = new TiptapTransactionPatchPlanner({
      createTransactionId: () => `surrounded-join-history:${++transactionSequence}`,
      serialize: serializeOrdinaryTiptapPatch,
    })
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: planner,
      project: projectOrdinaryMarkdown,
      session,
    })
    const commitLatestPlan = (): void => {
      const plan = plans.at(-1)
      if (plan === undefined) throw new Error('Expected a visual patch plan.')
      session.commitPatchPlan(plan)
      const projection = projectOrdinaryMarkdown(session.snapshot())
      adapter.acknowledgeSynchronization({ map: projection.map, snapshot: session.snapshot() })
    }
    try {
      adapter.setSelection({ anchor: 14, head: 14 })
      expect(adapter.dispatchKey('Backspace')).toBe(true)
      commitLatestPlan()
      expect(session.snapshot().markdown).toBe('Keep\n\nAlphaBravo\n\nTail')

      expect(adapter.undo()).toBe(true)
      const undoPlan = plans.at(-1)
      expect(undoPlan).toBeDefined()
      expect(session.previewPatchPlan(undoPlan!)).toBe(markdown)
      commitLatestPlan()
      expect(session.snapshot().markdown).toBe(markdown)
    } finally {
      adapter.destroy()
      host.remove()
    }
  })
})
