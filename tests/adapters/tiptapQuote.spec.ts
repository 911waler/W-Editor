import { describe, expect, it } from 'vitest'

import {
  TiptapTransactionPatchPlanner,
  TiptapVisualAdapter,
  serializeOrdinaryTiptapPatch,
} from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

describe('contextual visual Quote', () => {
  it('projects exact blockquote source as an editable Tiptap block with a direct source mapping', () => {
    const markdown = '> Alpha\n> Beta'
    const projection = projectOrdinaryMarkdown({ documentId: 'quote-projection', markdown, revision: 4 })

    expect(projection.content.content).toEqual([
      expect.objectContaining({
        attrs: expect.objectContaining({ originalSource: markdown }),
        content: [expect.objectContaining({ type: 'paragraph' })],
        type: 'blockquote',
      }),
    ])
    expect(projection.map.entries).toEqual([
      expect.objectContaining({
        codecId: 'blockquote',
        originalSource: markdown,
        sourceSpan: { from: 0, to: markdown.length },
      }),
    ])
  })

  it('turns the selected whole block into exact quote Markdown through one accepted patch', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'quote-command', markdown: 'Alpha' })
    const plans: PatchPlan[] = []
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `quote:${plans.length + 1}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })

    try {
      adapter.setSelection({ anchor: 1, head: 1 })
      expect(adapter.canApplyBlockquote()).toBe(true)
      expect(adapter.applyBlockquote()).toEqual({ active: true, changed: true })
      expect(plans).toHaveLength(1)
      expect(plans[0]?.patches).toEqual([{
        codecId: 'paragraph',
        expected: 'Alpha',
        from: 0,
        replacement: '> Alpha',
        to: 5,
      }])
    } finally {
      adapter.destroy()
      host.remove()
    }
  })
})
