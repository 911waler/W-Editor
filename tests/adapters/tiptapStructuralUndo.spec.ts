import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  TiptapTransactionPatchPlanner,
  TiptapVisualAdapter,
  serializeOrdinaryTiptapPatch,
} from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'
import { formulaSource, type ListCommandId } from '../../src/services'

type StructuralCommand =
  | ListCommandId
  | 'insert.formula'
  | 'insert.horizontal-rule'
  | 'insert.toc'

const rangePrototype = Range.prototype
const originalRangeGetClientRects = Object.getOwnPropertyDescriptor(rangePrototype, 'getClientRects')
let installedRangeGetClientRects = false

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

const CASES: readonly Readonly<{ commandId: StructuralCommand; expected: string }>[] = [
  { commandId: 'list.ordered', expected: '1. Alpha' },
  { commandId: 'list.unordered', expected: '- Alpha' },
  { commandId: 'list.task', expected: '- [ ] Alpha' },
  { commandId: 'insert.horizontal-rule', expected: 'Alpha\n\n---' },
  { commandId: 'insert.toc', expected: 'Alpha\n\n[[toc]]' },
  { commandId: 'insert.formula', expected: 'Alpha\n\n$$\nx + y\n$$' },
]

describe('visual structural command history', () => {
  it.each(CASES)('keeps $commandId as one synchronized undo/redo step', ({ commandId, expected }) => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: commandId, markdown: 'Alpha' })
    const plans: PatchPlan[] = []
    let sequence = 0
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `${commandId}:${++sequence}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    const commitLatest = (): void => {
      const plan = plans.at(-1)
      if (plan === undefined) throw new Error('Expected a visual structural patch plan.')
      session.commitPatchPlan(plan)
      const projection = projectOrdinaryMarkdown(session.snapshot())
      adapter.acknowledgeSynchronization({ map: projection.map, snapshot: session.snapshot() })
    }
    try {
      adapter.setSelection({ anchor: 1, head: 6 })
      if (commandId.startsWith('list.')) {
        adapter.applyList(commandId as ListCommandId)
      } else if (commandId === 'insert.formula') {
        adapter.applyFormula(formulaSource('x + y'))
      } else {
        adapter.insertSimpleBlock(commandId as 'insert.horizontal-rule' | 'insert.toc')
      }
      expect(plans.at(-1)?.patches[0]?.replacement).toBe(expected)
      commitLatest()

      expect(adapter.undo()).toBe(true)
      expect(plans.at(-1)?.patches[0]?.replacement).toBe('Alpha')
      commitLatest()

      expect(adapter.redo()).toBe(true)
      expect(plans.at(-1)?.patches[0]?.replacement).toBe(expected)
      commitLatest()
      expect(session.snapshot().markdown).toBe(expected)
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('repeated TOC command creates one undoable history step', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'repeated-toc-history', markdown: '# Alpha' })
    const plans: PatchPlan[] = []
    let sequence = 0
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `repeated-toc-history:${++sequence}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    const tocCount = (): number => adapter.documentJSON().content?.filter((node) => node.type === 'tocBlock').length ?? 0
    try {
      const first = adapter.insertSimpleBlock('insert.toc')
      expect(first).toEqual({ active: true, changed: true })
      expect(tocCount()).toBe(1)
      expect(plans).toHaveLength(1)
      expect(plans[0]?.patches.filter((patch) => patch.replacement.includes('[[toc]]'))).toHaveLength(1)

      const second = adapter.insertSimpleBlock('insert.toc')
      expect(second).toEqual({ active: true, changed: false })
      expect(tocCount()).toBe(1)
      expect(plans).toHaveLength(1)

      expect(adapter.undo()).toBe(true)
      expect(tocCount()).toBe(0)
      expect(plans).toHaveLength(2)
      expect(plans.at(-1)?.patches).toHaveLength(1)
      expect(plans.at(-1)?.patches[0]?.replacement).toBe('# Alpha')

      expect(adapter.undo()).toBe(false)
      expect(plans).toHaveLength(2)
    } finally {
      adapter.destroy()
      host.remove()
    }
  })
})
