import { describe, expect, it } from 'vitest'

import {
  TiptapTransactionPatchPlanner,
  TiptapVisualAdapter,
  serializeOrdinaryTiptapPatch,
} from '../../src/adapters'
import { ALIGNMENT_VALUES, projectOrdinaryMarkdown, type AlignmentCommandId } from '../../src/codecs'
import { DocumentSession, SynchronizationStateStore, type PatchPlan } from '../../src/core'
import { VisualSynchronizationService } from '../../src/services'

function pressEnter(surface: Element): void {
  surface.dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'Enter',
  }))
}

function pressKey(surface: Element, key: 'Backspace' | 'Delete' | 'Enter'): void {
  surface.dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key,
  }))
}

function alignmentHarness(markdown: string, documentId: string): Readonly<{
  adapter: TiptapVisualAdapter
  destroy: () => void
  failures: unknown[]
  host: HTMLElement
  plans: PatchPlan[]
  service: VisualSynchronizationService
  session: DocumentSession
  state: SynchronizationStateStore
}> {
  const host = document.createElement('div')
  document.body.append(host)
  const session = new DocumentSession({ documentId, markdown })
  const state = new SynchronizationStateStore(session.snapshot())
  const failures: unknown[] = []
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
    onTransactionFailure: ({ failure }) => failures.push(failure),
    patchPlanner: new TiptapTransactionPatchPlanner({
      createTransactionId: () => `alignment-regression-${documentId}-${++sequence}`,
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
    failures,
    host,
    plans,
    service,
    session,
    state,
  })
}

describe('direct visual alignment', () => {
  it('undoes the latest of two adjacent duplicate-paragraph alignments without projection recovery failure', async () => {
    const { adapter, destroy, failures, plans, service, session } = alignmentHarness(
      'Same\n\nSame\n\nTail',
      'alignment-adjacent-duplicates',
    )
    try {
      const first = adapter.search('Same')[0]
      if (first === undefined) throw new Error('Expected the first duplicate paragraph.')
      adapter.setSelection({ anchor: first.from, head: first.to })
      expect(adapter.applyAlignment('align.center')).toEqual({ active: true, changed: true })
      await service.flush()

      const second = adapter.search('Same')[1]
      if (second === undefined) throw new Error('Expected the second duplicate paragraph.')
      adapter.setSelection({ anchor: second.from, head: second.to })
      expect(adapter.applyAlignment('align.right')).toEqual({ active: true, changed: true })
      await service.flush()
      expect(session.snapshot().markdown).toBe('::: center\nSame\n:::\n\n::: right\nSame\n:::\n\nTail')

      expect(adapter.undo()).toBe(true)
      await service.flush()

      const expectedAfterUndo = '::: center\nSame\n:::\n\nSame\n\nTail'
      expect(plans.at(-1)?.patches).toEqual([{
        codecId: 'alignment-right',
        expected: '::: right\nSame\n:::',
        from: 21,
        replacement: 'Same',
        to: 39,
      }])
      expect(failures).toEqual([])
      expect(session.snapshot().markdown).toBe(expectedAfterUndo)
      const expectedProjection = projectOrdinaryMarkdown(session.snapshot())
      expect(adapter.projection().map.entries.map(({ codecId, sourceSpan }) => ({ codecId, sourceSpan })))
        .toEqual(expectedProjection.map.entries.map(({ codecId, sourceSpan }) => ({ codecId, sourceSpan })))

      const restoredSecond = adapter.search('Same')[1]
      if (restoredSecond === undefined) throw new Error('Expected the restored second duplicate paragraph.')
      adapter.setSelection({ anchor: restoredSecond.from, head: restoredSecond.to })
      expect(adapter.applyAlignment('align.right')).toEqual({ active: true, changed: true })
      await service.flush()
      expect(failures).toEqual([])
      expect(plans.at(-1)?.patches).toEqual([{
        codecId: 'alignment-wrap',
        expected: 'Same',
        from: 21,
        replacement: '::: right\nSame\n:::',
        to: 25,
      }])
      expect(session.snapshot().markdown).toBe('::: center\nSame\n:::\n\n::: right\nSame\n:::\n\nTail')
    } finally {
      destroy()
    }
  })

  it('keeps untouched CRLF and consecutive empty paragraphs byte-exact when undo recovery remaps duplicates', async () => {
    const initial = 'Intro\r\n\r\n\r\n\r\nSame\r\n\r\nSame\r\n\r\nTail'
    const { adapter, destroy, failures, service, session } = alignmentHarness(
      initial,
      'alignment-crlf-empty-duplicates',
    )
    try {
      const first = adapter.search('Same')[0]
      if (first === undefined) throw new Error('Expected the first duplicate paragraph.')
      adapter.setSelection({ anchor: first.from, head: first.to })
      expect(adapter.applyAlignment('align.center')).toEqual({ active: true, changed: true })
      await service.flush()

      const second = adapter.search('Same')[1]
      if (second === undefined) throw new Error('Expected the second duplicate paragraph.')
      adapter.setSelection({ anchor: second.from, head: second.to })
      expect(adapter.applyAlignment('align.right')).toEqual({ active: true, changed: true })
      await service.flush()
      expect(adapter.undo()).toBe(true)
      await service.flush()

      expect(failures).toEqual([])
      expect(session.snapshot().markdown).toBe('Intro\r\n\r\n\r\n\r\n::: center\nSame\n:::\r\n\r\nSame\r\n\r\nTail')
    } finally {
      destroy()
    }
  })

  it.each(ALIGNMENT_VALUES)('wraps a compatible multi-block range for %s and preserves one native history step', (alignment) => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: alignment, markdown: '# Heading\n\nParagraph' })
    const plans: PatchPlan[] = []
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `align:${alignment}:${plans.length + 1}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    try {
      adapter.setSelection({ anchor: 1, head: 999 })
      const commandId = `align.${alignment}` as AlignmentCommandId
      expect(adapter.canApplyAlignment()).toBe(true)
      expect(adapter.applyAlignment(commandId)).toEqual({ active: true, changed: true })
      expect(plans).toHaveLength(1)
      expect(plans[0]?.patches).toEqual([{
        codecId: 'ordinary-wrap',
        expected: '# Heading\n\nParagraph',
        from: 0,
        replacement: `::: ${alignment}\n# Heading\n\nParagraph\n:::`,
        to: 20,
      }])
      session.commitPatchPlan(plans[0]!)
      const synchronized = projectOrdinaryMarkdown(session.snapshot())
      adapter.acknowledgeSynchronization({ map: synchronized.map, snapshot: session.snapshot() })
      expect(adapter.undo()).toBe(true)
      expect(plans.at(-1)?.patches[0]?.replacement).toBe('# Heading\n\nParagraph')
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('disables alignment for a semantic node selection', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'semantic', markdown: '::: info Title\nBody\n:::' })
    const adapter = new TiptapVisualAdapter({ host, project: projectOrdinaryMarkdown, session })
    try {
      expect(adapter.canApplyAlignment()).toBe(false)
      expect(adapter.applyAlignment('align.center')).toEqual({ active: false, changed: false })
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it.each(ALIGNMENT_VALUES)('exits %s alignment after two Enter presses and keeps subsequent typing mapped', async (alignment) => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: `alignment-enter-${alignment}`, markdown: 'Alpha' })
    const state = new SynchronizationStateStore(session.snapshot())
    let sequence = 0
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
      onTransactionFailure: ({ failure }) => {
        synchronization.rejectTransaction({
          failure,
          operationId: `alignment-enter-rejected-${alignment}`,
          recover: () => adapter.rebuildFromAuthority(),
        })
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `alignment-enter-${alignment}-${++sequence}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })

    try {
      adapter.setSelection({ anchor: 1, head: 6 })
      expect(adapter.applyAlignment(`align.${alignment}`)).toEqual({ active: true, changed: true })
      await synchronization.flush()
      expect(session.snapshot().markdown).toBe(`::: ${alignment}\nAlpha\n:::`)

      const surface = host.querySelector('.ProseMirror')
      if (surface === null) throw new Error('Expected the visual editor surface.')
      const alpha = adapter.search('Alpha')[0]
      if (alpha === undefined) throw new Error('Expected the aligned paragraph.')
      adapter.setSelection({ anchor: alpha.to, head: alpha.to })
      pressEnter(surface)
      pressEnter(surface)
      expect(adapter.documentJSON().content?.map((node) => node.type)).toEqual(['alignmentBlock', 'paragraph'])
      adapter.insertText('Outside')
      await synchronization.flush()

      expect(state.snapshot().status).toBe('synchronized')
      expect(session.snapshot().markdown).toBe(`::: ${alignment}\nAlpha\n:::\n\nOutside`)
    } finally {
      synchronization.cancel()
      adapter.destroy()
      host.remove()
    }
  })

  it.each(ALIGNMENT_VALUES)('cancels and switches an existing %s alignment without nesting', async (alignment) => {
    const target = ALIGNMENT_VALUES.find((candidate) => candidate !== alignment)
    if (target === undefined) throw new Error('Expected a distinct alignment target.')
    const { adapter, destroy, service, session } = alignmentHarness(
      'Alpha\n\nBeta',
      `alignment-toggle-${alignment}`,
    )
    try {
      adapter.setSelection({ anchor: 1, head: 6 })
      expect(adapter.applyAlignment(`align.${alignment}`)).toEqual({ active: true, changed: true })
      await service.flush()

      expect(adapter.isAlignmentActive(`align.${alignment}`)).toBe(true)
      expect(adapter.applyAlignment(`align.${target}`)).toEqual({ active: true, changed: true })
      await service.flush()
      expect(session.snapshot().markdown).toBe(`::: ${target}\nAlpha\n:::\n\nBeta`)
      expect(adapter.isAlignmentActive(`align.${alignment}`)).toBe(false)
      expect(adapter.isAlignmentActive(`align.${target}`)).toBe(true)
      expect(adapter.documentJSON().content?.map((node) => node.type)).toEqual(['alignmentBlock', 'paragraph'])

      expect(adapter.applyAlignment(`align.${target}`)).toEqual({ active: false, changed: true })
      await service.flush()
      expect(session.snapshot().markdown).toBe('Alpha\n\nBeta')
      expect(adapter.isAlignmentActive(`align.${target}`)).toBe(false)
      expect(adapter.documentJSON().content?.map((node) => node.type)).toEqual(['paragraph', 'paragraph'])
    } finally {
      destroy()
    }
  })

  it.each(ALIGNMENT_VALUES)('updates and clears the text alignment on projected %s children', async (alignment) => {
    const target = ALIGNMENT_VALUES.find((candidate) => candidate !== alignment)
    if (target === undefined) throw new Error('Expected a distinct alignment target.')
    const { adapter, destroy, service, session } = alignmentHarness(
      `::: ${alignment}\nAlpha\n\nBeta\n:::\n\nTail`,
      `alignment-projected-toggle-${alignment}`,
    )
    try {
      const alpha = adapter.search('Alpha')[0]
      if (alpha === undefined) throw new Error('Expected the projected Alpha paragraph.')
      adapter.setSelection({ anchor: alpha.from, head: alpha.to })
      expect(adapter.applyAlignment(`align.${target}`)).toEqual({ active: true, changed: true })
      await service.flush()
      expect(session.snapshot().markdown).toBe(`::: ${target}\nAlpha\n\nBeta\n:::\n\nTail`)
      expect((adapter.documentJSON().content ?? [])[0]?.content?.map((node) => node.attrs?.['textAlign']))
        .toEqual([target, target])

      expect(adapter.applyAlignment(`align.${target}`)).toEqual({ active: false, changed: true })
      await service.flush()
      expect(session.snapshot().markdown).toBe('Alpha\n\nBeta\n\nTail')
      expect((adapter.documentJSON().content ?? []).slice(0, 2).map((node) => node.attrs?.['textAlign']))
        .toEqual([null, null])

      expect(adapter.undo()).toBe(true)
      await service.flush()
      expect(session.snapshot().markdown).toBe(`::: ${target}\nAlpha\n\nBeta\n:::\n\nTail`)
      expect((adapter.documentJSON().content ?? [])[0]?.content?.map((node) => node.attrs?.['textAlign']))
        .toEqual([target, target])
      expect(adapter.redo()).toBe(true)
      await service.flush()
      expect(session.snapshot().markdown).toBe('Alpha\n\nBeta\n\nTail')
    } finally {
      destroy()
    }
  })

  for (const alignment of ALIGNMENT_VALUES) {
    for (const key of ['Backspace', 'Delete'] as const) {
      it(`${key} after a double Enter at a ${alignment} boundary maps to one deletion and remains undoable`, async () => {
        const { adapter, destroy, failures, host, service, session, state } = alignmentHarness(
          'Alpha\n\nBeta',
          `alignment-boundary-${alignment}-${key}`,
        )
        try {
          adapter.setSelection({ anchor: 1, head: 6 })
          expect(adapter.applyAlignment(`align.${alignment}`)).toEqual({ active: true, changed: true })
          await service.flush()

          const alpha = adapter.search('Alpha')[0]
          const surface = host.querySelector('.ProseMirror')
          if (alpha === undefined || surface === null) throw new Error('Expected the aligned Alpha paragraph and editor surface.')
          adapter.setSelection({ anchor: alpha.to, head: alpha.to })
          pressEnter(surface)
          pressEnter(surface)
          await service.flush()
          expect(session.snapshot().markdown).toBe(`::: ${alignment}\nAlpha\n:::\n\n\n\nBeta`)

          pressKey(surface, key)
          await service.flush()
          expect(failures).toEqual([])
          expect(state.snapshot().status).toBe('synchronized')
          const afterKey = key === 'Backspace'
            ? `::: ${alignment}\nAlpha\n\n\n:::\n\nBeta`
            : `::: ${alignment}\nAlpha\n:::\n\nBeta`
          expect(session.snapshot().markdown).toBe(afterKey)
          expect(adapter.documentJSON().content?.map((node) => node.type)).toEqual(['alignmentBlock', 'paragraph'])

          expect(adapter.undo()).toBe(true)
          await service.flush()
          expect(session.snapshot().markdown).toBe(`::: ${alignment}\nAlpha\n:::\n\n\n\nBeta`)
          expect(adapter.redo()).toBe(true)
          await service.flush()
          expect(session.snapshot().markdown).toBe(afterKey)
          expect(state.snapshot().status).toBe('synchronized')
        } finally {
          destroy()
        }
      })
    }
  }
})
