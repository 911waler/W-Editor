import { describe, expect, it } from 'vitest'

import {
  TiptapTransactionPatchPlanner,
  TiptapVisualAdapter,
  serializeOrdinaryTiptapPatch,
} from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

function harness(documentId: string, markdown: string) {
  const host = document.createElement('div')
  document.body.append(host)
  const session = new DocumentSession({ documentId, markdown })
  const plans: PatchPlan[] = []
  const adapter = new TiptapVisualAdapter({
    host,
    onTransaction: ({ patchPlan }) => {
      if (patchPlan !== null) plans.push(patchPlan)
    },
    patchPlanner: new TiptapTransactionPatchPlanner({
      createTransactionId: () => `${documentId}:${plans.length + 1}`,
      serialize: serializeOrdinaryTiptapPatch,
    }),
    project: projectOrdinaryMarkdown,
    session,
  })
  return { adapter, host, plans, session }
}

describe('direct visual simple inserts', () => {
  it('applies direct link and inline-code marks', () => {
    for (const command of ['link', 'code'] as const) {
      const { adapter, host, plans } = harness(command, 'Alpha')
      try {
        adapter.setSelection({ anchor: 1, head: 6 })
        const result = command === 'link' ? adapter.applyLink('https://example.com') : adapter.toggleInlineCode()
        expect(result).toEqual({ active: true, changed: true })
        expect(plans.at(-1)?.patches[0]?.replacement).toBe(
          command === 'link' ? '[Alpha](https://example.com)' : '`Alpha`',
        )
      } finally {
        adapter.destroy()
        host.remove()
      }
    }
  })

  it('inserts a direct hard break at the caret', () => {
    const { adapter, host, plans } = harness('hard-break', 'AlphaBravo')
    try {
      adapter.setSelection({ anchor: 6, head: 6 })
      expect(adapter.insertHardBreak().changed).toBe(true)
      expect(plans.at(-1)?.patches[0]?.replacement).toBe('Alpha  \nBravo')
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it.each([
    ['insert.horizontal-rule', 'Alpha\n\n---'],
    ['insert.toc', 'Alpha\n\n[[toc]]'],
  ] as const)('inserts %s as a separate direct/semantic block', (commandId, expected) => {
    const { adapter, host, plans } = harness(commandId, 'Alpha')
    try {
      adapter.setSelection({ anchor: 6, head: 6 })
      expect(adapter.insertSimpleBlock(commandId).changed).toBe(true)
      expect(plans.at(-1)?.patches[0]?.replacement).toBe(expected)
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('focuses the existing TOC without changing the document or creating a patch', () => {
    const { adapter, host, plans } = harness('existing-toc', '# Alpha\n\n[[toc]]')
    try {
      const before = JSON.stringify(adapter.documentJSON())
      const result = adapter.insertSimpleBlock('insert.toc')

      expect(result).toEqual({ active: true, changed: false })
      expect(JSON.stringify(adapter.documentJSON())).toBe(before)
      expect(adapter.selection().kind).toBe('node')
      expect(adapter.documentJSON().content?.filter((node) => node.type === 'tocBlock')).toHaveLength(1)
      expect(plans).toHaveLength(0)
      expect(host.contains(document.activeElement)).toBe(true)
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('selects the first existing TOC when legacy duplicates are present', () => {
    const markdown = '# Alpha\n\n[[toc]]\n\n# Beta\n\n[[toc]]'
    const { adapter, host, plans } = harness('legacy-duplicate-toc', markdown)
    try {
      const before = JSON.stringify(adapter.documentJSON())
      const result = adapter.insertSimpleBlock('insert.toc')
      const nodes = [...host.querySelectorAll<HTMLElement>('[data-w-editor-node="toc"]')]

      expect(result).toEqual({ active: true, changed: false })
      expect(JSON.stringify(adapter.documentJSON())).toBe(before)
      expect(plans).toHaveLength(0)
      expect(nodes).toHaveLength(2)
      expect(nodes[0]?.classList.contains('ProseMirror-selectednode')).toBe(true)
      expect(nodes[1]?.classList.contains('ProseMirror-selectednode')).toBe(false)
      expect(adapter.selection().kind).toBe('node')
    } finally {
      adapter.destroy()
      host.remove()
    }
  })
})
