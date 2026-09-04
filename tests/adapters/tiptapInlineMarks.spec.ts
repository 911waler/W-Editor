import { describe, expect, it } from 'vitest'

import {
  TiptapTransactionPatchPlanner,
  TiptapVisualAdapter,
  serializeOrdinaryTiptapPatch,
} from '../../src/adapters'
import { INLINE_MARK_SPECS, projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

describe('direct visual inline marks', () => {
  it.each(INLINE_MARK_SPECS)('applies and removes $commandId with its Tiptap mark and checked Markdown', (spec) => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: spec.commandId, markdown: 'Alpha' })
    const plans: PatchPlan[] = []
    let transactionSequence = 0
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `${spec.commandId}:${++transactionSequence}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    const commitLatest = (): void => {
      const plan = plans.at(-1)
      if (plan === undefined) throw new Error('Expected a visual inline-mark patch.')
      session.commitPatchPlan(plan)
      adapter.acknowledgeSynchronization({
        map: projectOrdinaryMarkdown(session.snapshot()).map,
        snapshot: session.snapshot(),
      })
    }
    try {
      adapter.setSelection({ anchor: 1, head: 6 })
      expect(adapter.toggleInlineMark(spec.commandId)).toEqual({ active: true, changed: true })
      expect(plans).toHaveLength(1)
      expect(plans[0]?.patches).toEqual([{
        codecId: 'paragraph',
        expected: 'Alpha',
        from: 0,
        replacement: `${spec.open}Alpha${spec.close}`,
        to: 5,
      }])
      commitLatest()
      expect(adapter.isInlineMarkActive(spec.commandId)).toBe(true)

      expect(adapter.toggleInlineMark(spec.commandId)).toEqual({ active: false, changed: true })
      expect(plans).toHaveLength(2)
      commitLatest()
      expect(session.snapshot().markdown).toBe('Alpha')
    } finally {
      adapter.destroy()
      host.remove()
    }
  })
})
