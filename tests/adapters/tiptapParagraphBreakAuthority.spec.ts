import { describe, expect, it, vi } from 'vitest'

import {
  TiptapTransactionPatchPlanner,
  TiptapVisualAdapter,
  serializeOrdinaryTiptapPatch,
} from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs/ordinaryBlocks'
import { DocumentSession, type PatchPlan, SynchronizationStateStore } from '../../src/core'
import { VisualSynchronizationService } from '../../src/services'

function pressEnter(surface: Element, shiftKey = false): void {
  surface.dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'Enter',
    shiftKey,
  }))
}

function harness(markdown: string): Readonly<{
  adapter: TiptapVisualAdapter
  destroy: () => void
  host: HTMLElement
  plans: PatchPlan[]
  service: VisualSynchronizationService
  session: DocumentSession
  state: SynchronizationStateStore
}> {
  const host = document.createElement('div')
  document.body.append(host)
  const session = new DocumentSession({ documentId: 'paragraph-breaks', markdown })
  const state = new SynchronizationStateStore(session.snapshot())
  const plans: PatchPlan[] = []
  let sequence = 0
  const service = new VisualSynchronizationService({
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
      if (patchPlan !== null) {
        plans.push(patchPlan)
        service.request(patchPlan)
      }
    },
    patchPlanner: new TiptapTransactionPatchPlanner({
      createTransactionId: () => `paragraph-break-${++sequence}`,
      serialize: serializeOrdinaryTiptapPatch,
    }),
    project: projectOrdinaryMarkdown,
    session,
  })
  return Object.freeze({
    adapter,
    destroy: () => {
      service.cancel()
      adapter.destroy()
      host.remove()
    },
    host,
    plans,
    service,
    session,
    state,
  })
}

function projectionIds(adapter: TiptapVisualAdapter): string[] {
  const ids: string[] = []
  for (const node of adapter.documentJSON().content ?? []) {
    const id = node.attrs?.['projectionId']
    if (typeof id === 'string' && id.length > 0) ids.push(id)
  }
  return ids
}

function placeCaretAfter(adapter: TiptapVisualAdapter, text: string): void {
  const upperBound = adapter.text().length + (adapter.documentJSON().content?.length ?? 0) * 4 + 8
  for (let position = 0; position < upperBound; position += 1) {
    adapter.setSelection({ anchor: position, head: position + 1 })
    if (adapter.selectedText() !== text) continue
    const selection = adapter.selection()
    adapter.setSelection({ anchor: selection.head, head: selection.head })
    return
  }
  throw new Error(`Could not locate ${JSON.stringify(text)} in the visual document.`)
}

describe('Tiptap paragraph and hard-break authority convergence', () => {
  it('keeps the first paragraph authoritative when Enter inserts a blank after a panel', async () => {
    const panel = '::: info Information\nPanel body\n:::'
    const markdown = [panel, '1', '2', '3', '4', '5', '6'].join('\n\n')
    const { adapter, destroy, host, service, session, state } = harness(markdown)
    try {
      const surface = host.querySelector('.ProseMirror')
      if (surface === null) throw new Error('Expected the visual editor surface.')
      placeCaretAfter(adapter, '1')

      pressEnter(surface)
      expect((adapter.documentJSON().content ?? []).slice(1).map((node) => node.content?.[0]?.text ?? ''))
        .toEqual(['1', '', '2', '3', '4', '5', '6'])
      await service.flush()

      expect(session.snapshot().markdown).toBe([panel, '1', '', '2', '3', '4', '5', '6'].join('\n\n'))
      expect(state.snapshot().status).toBe('synchronized')
    } finally {
      destroy()
    }
  })

  it('keeps Enter plus immediate typing after a semantic panel as one mappable patch', async () => {
    const panel = '::: info Information\nPanel body\n:::'
    const { adapter, destroy, host, service, session, state } = harness(panel)
    try {
      const surface = host.querySelector('.ProseMirror')
      const semantic = host.querySelector('[data-w-editor-node="semantic-block"]')
      if (surface === null || semantic === null) throw new Error('Expected the semantic panel fixture.')
      adapter.setSelection({ anchor: 0, head: 0 })

      pressEnter(surface)
      adapter.insertText('After')
      await service.flush()

      expect(session.snapshot().markdown).toBe(`${panel}\n\nAfter`)
      expect(state.snapshot().status).toBe('synchronized')
      expect(host.querySelector('.ProseMirror > p')?.textContent).toBe('After')
    } finally {
      destroy()
    }
  })

  it('keeps Enter plus immediate continued typing mappable until one bounded acknowledgement', async () => {
    const { adapter, destroy, host, service, session, state } = harness('Alpha')
    try {
      adapter.setSelection({ anchor: 6, head: 6 })
      const surface = host.querySelector('.ProseMirror')
      if (surface === null) throw new Error('Expected the visual editor surface.')

      pressEnter(surface)
      expect(() => adapter.insertText('Bravo')).not.toThrow()

      const blocks = adapter.documentJSON().content ?? []
      expect(blocks.map(({ type }) => type)).toEqual(['paragraph', 'paragraph'])
      expect(blocks.map(({ content }) => content?.[0]?.text ?? '')).toEqual(['Alpha', 'Bravo'])
      const idsBeforeAcknowledgement = projectionIds(adapter)
      expect(new Set(idsBeforeAcknowledgement).size).toBe(idsBeforeAcknowledgement.length)
      expect(state.snapshot().status).toBe('pending')
      expect(session.snapshot()).toEqual({ documentId: 'paragraph-breaks', markdown: 'Alpha', revision: 0 })

      await vi.advanceTimersByTimeAsync(249)
      expect(session.snapshot().revision).toBe(0)
      await vi.advanceTimersByTimeAsync(1)

      expect(session.snapshot()).toEqual({
        documentId: 'paragraph-breaks',
        markdown: 'Alpha\n\nBravo',
        revision: 1,
      })
      expect(state.snapshot().status).toBe('synchronized')
      expect(adapter.selectedText()).toBe('')
      expect(adapter.selection()).toEqual({ anchor: 13, head: 13, kind: 'text' })
      const acknowledgedIds = projectionIds(adapter)
      expect(acknowledgedIds).toHaveLength(2)
      expect(new Set(acknowledgedIds).size).toBe(2)

      expect(adapter.undo()).toBe(true)
      await service.flush()
      expect(session.snapshot().markdown).toBe('Alpha')
      expect(adapter.undo()).toBe(false)
    } finally {
      destroy()
    }
  })

  it('undoes and redoes ten rapid paragraph breaks one at a time without entering an older end-of-article step', async () => {
    const paragraphs = Array.from({ length: 100 }, (_, index) => `Rapid paragraph-break history ${index + 1}`)
    const targetIndex = 48
    const original = paragraphs.join('\n\n')
    const endEdit = ' [older end edit]'
    const baselineParagraphs = [...paragraphs]
    baselineParagraphs[baselineParagraphs.length - 1] += endEdit
    const baseline = baselineParagraphs.join('\n\n')
    const withParagraphBreaks = (count: number) => [
      ...baselineParagraphs.slice(0, targetIndex + 1),
      ...Array.from({ length: count }, () => ''),
      ...baselineParagraphs.slice(targetIndex + 1),
    ].join('\n\n')
    const { adapter, destroy, host, plans, service, session } = harness(original)
    try {
      const surface = host.querySelector('.ProseMirror')
      if (surface === null) throw new Error('Expected the visual editor surface.')
      const lastParagraph = adapter.search(paragraphs.at(-1) ?? '')[0]
      if (lastParagraph === undefined) throw new Error('Could not locate the end-of-article history fixture.')
      adapter.setSelection({ anchor: lastParagraph.to, head: lastParagraph.to })
      adapter.insertText(endEdit)
      await service.flush()
      expect(session.snapshot().markdown).toBe(baseline)

      const target = adapter.search(paragraphs[targetIndex] ?? '')[0]
      if (target === undefined) throw new Error('Could not locate the paragraph-break history target.')
      adapter.setSelection({ anchor: target.to, head: target.to })

      for (let count = 0; count < 10; count += 1) pressEnter(surface)
      await service.flush()
      expect(session.snapshot().markdown).toBe(withParagraphBreaks(10))

      for (let remaining = 9; remaining >= 0; remaining -= 1) {
        const planCount = plans.length
        expect(adapter.undo()).toBe(true)
        expect(adapter.documentJSON().content).toHaveLength(100 + remaining)
        expect(service.pending()).toBe(true)
        expect(plans).toHaveLength(planCount + 1)
        const localPatch = plans.at(-1)?.patches
        expect(localPatch).toHaveLength(1)
        const current = withParagraphBreaks(remaining + 1)
        const localFrom = current.indexOf(paragraphs[targetIndex] ?? '')
        const nextParagraphTo = current.indexOf(paragraphs[targetIndex + 1] ?? '')
          + (paragraphs[targetIndex + 1]?.length ?? 0)
        expect(localPatch?.[0]?.from).toBeGreaterThanOrEqual(localFrom)
        expect(localPatch?.[0]?.to).toBeLessThanOrEqual(nextParagraphTo)
        await service.flush()
        expect(session.snapshot().markdown).toBe(withParagraphBreaks(remaining))
        const localSelection = adapter.selection()
        const localTarget = adapter.search(paragraphs[targetIndex] ?? '')[0]
        const localNext = adapter.search(paragraphs[targetIndex + 1] ?? '')[0]
        if (localTarget === undefined || localNext === undefined) throw new Error('Lost the local paragraph-break fixture.')
        expect(localSelection.head).toBeGreaterThanOrEqual(localTarget.from)
        expect(localSelection.head).toBeLessThanOrEqual(localNext.from)
        expect(adapter.text()).toContain(`${paragraphs.at(-1)}${endEdit}`)
      }
      expect(session.snapshot().markdown).toBe(baseline)

      for (let count = 1; count <= 10; count += 1) {
        expect(adapter.redo()).toBe(true)
        await service.flush()
        expect(session.snapshot().markdown).toBe(withParagraphBreaks(count))
        const localSelection = adapter.selection()
        const localTarget = adapter.search(paragraphs[targetIndex] ?? '')[0]
        const localNext = adapter.search(paragraphs[targetIndex + 1] ?? '')[0]
        if (localTarget === undefined || localNext === undefined) throw new Error('Lost the local paragraph-break fixture.')
        expect(localSelection.head).toBeGreaterThanOrEqual(localTarget.from)
        expect(localSelection.head).toBeLessThanOrEqual(localNext.from)
        expect(adapter.text()).toContain(`${paragraphs.at(-1)}${endEdit}`)
      }
    } finally {
      destroy()
    }
  })

  it('keeps undo and redo local when Enter splits one of multiple pre-existing empty paragraphs', async () => {
    const original = ['Before', '', '', 'After'].join('\n\n')
    const edited = ['Before', '', '', '', 'After'].join('\n\n')
    const { adapter, destroy, host, service, session } = harness(original)
    try {
      const surface = host.querySelector('.ProseMirror')
      if (surface === null) throw new Error('Expected the visual editor surface.')
      const initialDocument = adapter.schema().nodeFromJSON(adapter.documentJSON())
      expect(initialDocument.childCount).toBe(4)
      expect(initialDocument.child(1).textContent).toBe('')
      expect(initialDocument.child(2).textContent).toBe('')
      const targetPosition = 1 + initialDocument.child(0).nodeSize
      adapter.setSelection({ anchor: targetPosition, head: targetPosition })

      pressEnter(surface)
      await service.flush()
      expect(session.snapshot().markdown).toBe(edited)
      expect(adapter.documentJSON().content).toHaveLength(5)
      expect(adapter.selection()).toEqual({ anchor: targetPosition + 2, head: targetPosition + 2, kind: 'text' })

      expect(adapter.undo()).toBe(true)
      await service.flush()
      expect(session.snapshot().markdown).toBe(original)
      expect(adapter.documentJSON().content).toHaveLength(4)
      expect(adapter.selection()).toEqual({ anchor: targetPosition, head: targetPosition, kind: 'text' })

      expect(adapter.redo()).toBe(true)
      await service.flush()
      expect(session.snapshot().markdown).toBe(edited)
      expect(adapter.documentJSON().content).toHaveLength(5)
      expect(adapter.selection()).toEqual({ anchor: targetPosition + 2, head: targetPosition + 2, kind: 'text' })
    } finally {
      destroy()
    }
  })

  it.each([10, 100])('preserves %i pre-existing empty paragraphs and a local Enter through undo and redo', async (emptyCount) => {
    const original = ['Before', ...Array.from({ length: emptyCount }, () => ''), 'After'].join('\n\n')
    const targetIndex = 1 + Math.floor(emptyCount / 2)
    const editedBlocks = ['Before', ...Array.from({ length: emptyCount }, () => ''), 'After']
    editedBlocks.splice(targetIndex, 0, '')
    const edited = editedBlocks.join('\n\n')
    const { adapter, destroy, host, service, session } = harness(original)
    try {
      const surface = host.querySelector('.ProseMirror')
      if (surface === null) throw new Error('Expected the visual editor surface.')
      const initialDocument = adapter.schema().nodeFromJSON(adapter.documentJSON())
      expect(initialDocument.childCount).toBe(emptyCount + 2)
      let targetPosition = 1
      for (let index = 0; index < targetIndex; index += 1) targetPosition += initialDocument.child(index).nodeSize
      adapter.setSelection({ anchor: targetPosition, head: targetPosition })

      pressEnter(surface)
      await service.flush()
      expect(session.snapshot().markdown).toBe(edited)
      expect(adapter.documentJSON().content).toHaveLength(emptyCount + 3)
      expect(adapter.selection()).toEqual({ anchor: targetPosition + 2, head: targetPosition + 2, kind: 'text' })

      expect(adapter.undo()).toBe(true)
      await service.flush()
      expect(session.snapshot().markdown).toBe(original)
      expect(adapter.documentJSON().content).toHaveLength(emptyCount + 2)
      expect(adapter.selection()).toEqual({ anchor: targetPosition, head: targetPosition, kind: 'text' })

      expect(adapter.redo()).toBe(true)
      await service.flush()
      expect(session.snapshot().markdown).toBe(edited)
      expect(adapter.documentJSON().content).toHaveLength(emptyCount + 3)
      expect(adapter.selection()).toEqual({ anchor: targetPosition + 2, head: targetPosition + 2, kind: 'text' })
    } finally {
      destroy()
    }
  })

  it('restores exactly one pre-existing empty paragraph when undo reverses Backspace', async () => {
    const original = ['Before', ...Array.from({ length: 6 }, () => ''), 'After'].join('\n\n')
    const afterBackspace = ['Before', ...Array.from({ length: 5 }, () => ''), 'After'].join('\n\n')
    const targetIndex = 3
    const { adapter, destroy, host, service, session } = harness(original)
    try {
      const surface = host.querySelector('.ProseMirror')
      if (surface === null) throw new Error('Expected the visual editor surface.')
      const initialDocument = adapter.schema().nodeFromJSON(adapter.documentJSON())
      let targetPosition = 1
      for (let index = 0; index < targetIndex; index += 1) targetPosition += initialDocument.child(index).nodeSize
      adapter.setSelection({ anchor: targetPosition, head: targetPosition })

      surface.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Backspace',
      }))
      await service.flush()
      expect(session.snapshot().markdown).toBe(afterBackspace)
      expect(adapter.documentJSON().content).toHaveLength(7)

      expect(adapter.undo()).toBe(true)
      await service.flush()
      expect(session.snapshot().markdown).toBe(original)
      expect(adapter.documentJSON().content).toHaveLength(8)
      expect(adapter.selection()).toEqual({ anchor: targetPosition, head: targetPosition, kind: 'text' })
    } finally {
      destroy()
    }
  })

  it('restores the original CRLF paragraph separator when undo reverses Backspace', async () => {
    const separator = '\r\n\r\n'
    const original = ['Before', '', '', 'After'].join(separator)
    const afterBackspace = ['Before', '', 'After'].join(separator)
    const { adapter, destroy, host, service, session } = harness(original)
    try {
      const surface = host.querySelector('.ProseMirror')
      if (surface === null) throw new Error('Expected the visual editor surface.')
      const initialDocument = adapter.schema().nodeFromJSON(adapter.documentJSON())
      const targetPosition = 1 + initialDocument.child(0).nodeSize + initialDocument.child(1).nodeSize
      adapter.setSelection({ anchor: targetPosition, head: targetPosition })

      surface.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Backspace',
      }))
      await service.flush()
      expect(session.snapshot().markdown).toBe(afterBackspace)

      expect(adapter.undo()).toBe(true)
      await service.flush()
      expect(session.snapshot().markdown).toBe(original)
    } finally {
      destroy()
    }
  })

  it.each(['Backspace', 'Delete'] as const)(
    'removes one empty paragraph between a semantic panel and a code block with %s while preserving a table',
    async (key) => {
      const panel = '::: success Success\nDescribe the successful outcome.\n:::'
      const code = "```javascript\nconsole.log('Hello from W-Editor')\n```"
      const table = '| Plain | Explicit |\n| --- | :------ |\n| A | B |'
      const original = [panel, '', code, table].join('\n\n')
      const edited = [panel, code, table].join('\n\n')
      const { adapter, destroy, host, plans, service, session } = harness(original)
      try {
        const surface = host.querySelector('.ProseMirror')
        if (surface === null) throw new Error('Expected the visual editor surface.')
        const initialDocument = adapter.schema().nodeFromJSON(adapter.documentJSON())
        expect(Array.from({ length: initialDocument.childCount }, (_, index) => initialDocument.child(index).type.name))
          .toEqual(['semanticBlock', 'paragraph', 'codeBlock', 'table'])
        const targetPosition = 1 + initialDocument.child(0).nodeSize
        adapter.setSelection({ anchor: targetPosition, head: targetPosition })

        surface.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key,
        }))
        await service.flush()

        expect(session.snapshot().markdown).toBe(edited)
        expect((adapter.documentJSON().content ?? []).map(({ type }) => type))
          .toEqual(['semanticBlock', 'codeBlock', 'table'])
        expect(adapter.selection().head).toBeGreaterThanOrEqual(initialDocument.child(0).nodeSize)
        expect(adapter.selection().head).toBeLessThanOrEqual(initialDocument.child(0).nodeSize + 2)

        expect(adapter.undo()).toBe(true)
        await service.flush()
        expect(session.snapshot().markdown).toBe(original)
        expect((adapter.documentJSON().content ?? []).map(({ type }) => type))
          .toEqual(['semanticBlock', 'paragraph', 'codeBlock', 'table'])
        expect(plans.at(-1)?.patches).toEqual([expect.objectContaining({
          codecId: 'ordinary-paragraph-breaks',
          from: edited.indexOf(code),
          replacement: '\n\n',
          to: edited.indexOf(code),
        })])

        expect(adapter.redo()).toBe(true)
        await service.flush()
        expect(session.snapshot().markdown).toBe(edited)
        expect((adapter.documentJSON().content ?? []).map(({ type }) => type))
          .toEqual(['semanticBlock', 'codeBlock', 'table'])
      } finally {
        destroy()
      }
    },
  )

  it.each([
    ['LF', '\n\n'],
    ['CRLF', '\r\n\r\n'],
  ] as const)('deletes, undoes, and redoes exactly two selected empty paragraphs with %s separators', async (_label, separator) => {
    const original = ['Before', '', '', 'After'].join(separator)
    const edited = ['Before', 'After'].join(separator)
    const { adapter, destroy, host, plans, service, session, state } = harness(original)
    try {
      const surface = host.querySelector('.ProseMirror')
      if (surface === null) throw new Error('Expected the visual editor surface.')
      const initialDocument = adapter.schema().nodeFromJSON(adapter.documentJSON())
      expect(Array.from({ length: initialDocument.childCount }, (_, index) => initialDocument.child(index).type.name))
        .toEqual(['paragraph', 'paragraph', 'paragraph', 'paragraph'])
      const firstEmptyPosition = 1 + initialDocument.child(0).nodeSize
      const afterSecondEmptyPosition = firstEmptyPosition
        + initialDocument.child(1).nodeSize
        + initialDocument.child(2).nodeSize
      adapter.setSelection({ anchor: firstEmptyPosition, head: afterSecondEmptyPosition })

      surface.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Delete',
      }))
      expect((adapter.documentJSON().content ?? []).map(({ type }) => type))
        .toEqual(['paragraph', 'paragraph'])
      await service.flush()

      expect(session.snapshot().markdown).toBe(edited)
      expect(state.snapshot().status).toBe('synchronized')
      expect((adapter.documentJSON().content ?? []).map(({ type }) => type))
        .toEqual(['paragraph', 'paragraph'])
      expect(plans.at(-1)?.patches).toEqual([expect.objectContaining({
        codecId: 'ordinary-paragraph-breaks',
      })])

      expect(adapter.undo()).toBe(true)
      await service.flush()
      expect(session.snapshot().markdown).toBe(original)
      expect(adapter.documentJSON().content).toHaveLength(4)

      expect(adapter.redo()).toBe(true)
      await service.flush()
      expect(session.snapshot().markdown).toBe(edited)
      expect(adapter.documentJSON().content).toHaveLength(2)
    } finally {
      destroy()
    }
  })

  it('serializes Shift+Enter as one hard break without creating a second paragraph identity', async () => {
    const { adapter, destroy, host, service, session, state } = harness('Alpha')
    try {
      adapter.setSelection({ anchor: 6, head: 6 })
      const surface = host.querySelector('.ProseMirror')
      if (surface === null) throw new Error('Expected the visual editor surface.')

      pressEnter(surface, true)
      adapter.insertText('Bravo')
      const blocks = adapter.documentJSON().content ?? []
      expect(blocks).toHaveLength(1)
      expect(blocks[0]?.type).toBe('paragraph')
      expect(blocks[0]?.content?.map(({ type }) => type)).toEqual(['text', 'hardBreak', 'text'])
      expect(projectionIds(adapter)).toHaveLength(1)

      await service.flush()
      expect(session.snapshot()).toEqual({
        documentId: 'paragraph-breaks',
        markdown: 'Alpha  \nBravo',
        revision: 1,
      })
      expect(state.snapshot().status).toBe('synchronized')
    } finally {
      destroy()
    }
  })
})
