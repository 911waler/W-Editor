import { describe, expect, it } from 'vitest'

import {
  TiptapTransactionPatchPlanner,
  TiptapVisualAdapter,
  serializeOrdinaryTiptapPatch,
} from '../../src/adapters'
import { RICH_INLINE_MARK_SPECS, formatRichInlineMark, projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

const VALUES = {
  'text.background': '#fde68a',
  'text.color': '#c2410c',
  'text.ruby': 'annotation',
  'text.size': '18',
} as const

describe('direct visual attributed inline marks', () => {
  it.each([
    ['text.color', '#2563eb', '!!#2563eb Next!!'],
    ['text.background', '#bbf7d0', '!!!#bbf7d0 Next!!!'],
  ] as const)('stores %s at an empty caret and applies it to subsequently typed text', (commandId, value, expected) => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: `${commandId}-stored`, markdown: 'Alpha' })
    const plans: PatchPlan[] = []
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `${commandId}:stored`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    try {
      adapter.setSelection({ anchor: 6, head: 6 })
      expect(adapter.applyRichInlineMark(commandId, value)).toEqual({
        active: true,
        changed: true,
        value,
      })
      expect(plans).toHaveLength(0)

      adapter.insertText('Next')
      expect(plans).toHaveLength(1)
      expect(plans[0]?.patches[0]?.replacement).toBe(`Alpha${expected}`)
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it.each(RICH_INLINE_MARK_SPECS)('applies $commandId with its selected value and exact Markdown', (spec) => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: spec.commandId, markdown: 'Alpha' })
    const plans: PatchPlan[] = []
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `${spec.commandId}:apply`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    try {
      adapter.setSelection({ anchor: 1, head: 6 })
      expect(adapter.applyRichInlineMark(spec.commandId, VALUES[spec.commandId])).toEqual({
        active: true,
        changed: true,
        value: VALUES[spec.commandId],
      })
      expect(plans).toHaveLength(1)
      expect(plans[0]?.patches[0]?.replacement).toBe(
        formatRichInlineMark(spec.commandId, 'Alpha', VALUES[spec.commandId]),
      )
      session.commitPatchPlan(plans[0] as PatchPlan)
      adapter.acknowledgeSynchronization({
        map: projectOrdinaryMarkdown(session.snapshot()).map,
        snapshot: session.snapshot(),
      })
      expect(adapter.richInlineMarkValue(spec.commandId)).toBe(VALUES[spec.commandId])
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('replaces the selected ruby base and emits one exact authoritative patch', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'visual-ruby-base', markdown: 'Alpha' })
    const plans: PatchPlan[] = []
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => 'visual-ruby-base:apply',
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    try {
      adapter.setSelection({ anchor: 1, head: 6 })
      expect(adapter.selectedText()).toBe('Alpha')
      expect(adapter.applyRichInlineMark('text.ruby', 'han4', '汉')).toEqual({
        active: true,
        changed: true,
        value: 'han4',
      })
      expect(plans).toHaveLength(1)
      expect(plans[0]?.patches[0]?.replacement).toBe('{ 汉 | han4 }')
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('serializes color plus background in the Cherry-safe canonical nesting order', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'compound-rich-marks', markdown: 'B' })
    const plans: PatchPlan[] = []
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `compound-rich-marks:${plans.length}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    try {
      adapter.setSelection({ anchor: 1, head: 2 })
      adapter.applyRichInlineMark('text.color', '#0066cc')
      session.commitPatchPlan(plans.at(-1) as PatchPlan)
      adapter.acknowledgeSynchronization({
        map: projectOrdinaryMarkdown(session.snapshot()).map,
        snapshot: session.snapshot(),
      })

      adapter.setSelection({ anchor: 1, head: 2 })
      adapter.applyRichInlineMark('text.background', '#00ff00')

      expect(plans.at(-1)?.patches[0]?.replacement).toBe('!!!#00ff00 !!#0066cc B!!!!!')
    } finally {
      adapter.destroy()
      host.remove()
    }
  })
})
