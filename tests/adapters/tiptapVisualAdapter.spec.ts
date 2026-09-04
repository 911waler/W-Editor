import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Transaction } from '@tiptap/pm/state'

import {
  TIPTAP_EXTERNAL_HYDRATION_META,
  TiptapVisualAdapter,
  type TiptapVisualProjection,
} from '../../src/adapters/tiptapVisualAdapter'
import {
  InvalidTiptapPatchSerializationError,
  TiptapTransactionPatchPlanner,
  serializeOrdinaryTiptapPatch,
} from '../../src/adapters'
import type { ProjectionMapEntry } from '../../src/codecs'
import { projectOrdinaryMarkdown } from '../../src/codecs/ordinaryBlocks'
import { DocumentSession, SynchronizationStateStore, type DocumentSnapshot } from '../../src/core'
import { VisualSynchronizationService } from '../../src/services'

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

function project(snapshot: DocumentSnapshot): TiptapVisualProjection {
  const lines = snapshot.markdown.split('\n')
  let sourceOffset = 0
  const entries: ProjectionMapEntry[] = []
  const content = lines.map((line, index) => {
    const from = sourceOffset
    const to = from + line.length
    sourceOffset = to + (index < lines.length - 1 ? 1 : 0)
    const projectionId = `paragraph-${index}`
    entries.push({
      codecId: 'paragraph',
      originalSource: line,
      projectionId,
      safePatchUnit: {
        codecId: 'paragraph',
        expectedSource: line,
        sourceSpan: { from, to },
        strategy: { kind: 'direct', scope: 'block' },
        structural: false,
        unitId: `${projectionId}-unit`,
      },
      sourceSpan: { from, to },
    })
    return {
      type: 'paragraph',
      attrs: {
        codecId: 'paragraph',
        originalSource: line,
        projectionId,
        revision: snapshot.revision,
        sourceFrom: from,
        sourceTo: to,
      },
      ...(line.length === 0 ? {} : { content: [{ type: 'text', text: line }] }),
    }
  })

  return {
    content: { type: 'doc', content },
    map: {
      documentLength: snapshot.markdown.length,
      entries,
      revision: snapshot.revision,
    },
    revision: snapshot.revision,
  }
}

function projectWithSource(snapshot: DocumentSnapshot): TiptapVisualProjection {
  return Object.freeze({ ...project(snapshot), source: snapshot.markdown })
}

function mount(markdown = 'alpha'): {
  readonly adapter: TiptapVisualAdapter
  readonly host: HTMLElement
  readonly session: DocumentSession
} {
  const host = document.createElement('div')
  document.body.append(host)
  const session = new DocumentSession({ documentId: 'visual', markdown })
  const adapter = new TiptapVisualAdapter({ host, project, session })
  return { adapter, host, session }
}

describe('TiptapVisualAdapter', () => {
  it('navigates case-aware visual matches and emits checked replacement patches without crossing blocks', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'visual', markdown: 'Alpha alpha\nbeta Alpha' })
    const plans: unknown[] = []
    const planner = new TiptapTransactionPatchPlanner({
      createTransactionId: () => 'visual-search-replace',
      serialize: serializeOrdinaryTiptapPatch,
    })
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: planner,
      project,
      session,
    })

    try {
      const insensitive = adapter.search('alpha')
      expect(insensitive.map(({ text }) => text)).toEqual(['Alpha', 'alpha', 'Alpha'])
      expect(adapter.search('Alpha', true).map(({ text }) => text)).toEqual(['Alpha', 'Alpha'])
      adapter.setSearchHighlights(insensitive, 1)
      expect(host.querySelectorAll('[data-search-match]')).toHaveLength(3)
      expect(host.querySelectorAll('[data-search-active="true"]')).toHaveLength(1)
      expect(host.querySelector('[data-search-active="true"]')?.textContent).toBe('alpha')
      adapter.clearSearchHighlights()
      expect(host.querySelectorAll('[data-search-match]')).toHaveLength(0)
      const second = insensitive[1]
      expect(second).toBeDefined()
      adapter.setSelection({ anchor: second?.from ?? 0, head: second?.to ?? 0 })
      expect(adapter.selectedText()).toBe('alpha')

      expect(adapter.replaceSearchMatches(insensitive, 'Omega')).toEqual({ active: true, changed: true })
      expect(adapter.documentJSON().content?.map((node) => node.content?.[0]?.text)).toEqual([
        'Omega Omega',
        'beta Omega',
      ])
      expect(plans).toEqual([
        expect.objectContaining({
          baseRevision: 0,
          patches: [
            expect.objectContaining({ codecId: 'paragraph', expected: 'Alpha alpha', replacement: 'Omega Omega' }),
            expect.objectContaining({ codecId: 'paragraph', expected: 'beta Alpha', replacement: 'beta Omega' }),
          ],
          transactionId: 'visual-search-replace',
        }),
      ])
      expect(session.snapshot()).toEqual({ documentId: 'visual', markdown: 'Alpha alpha\nbeta Alpha', revision: 0 })
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('mounts the published base schema and hydrates the initial projection', () => {
    const { adapter, host } = mount('heading\nparagraph')
    try {
      expect(host.querySelector('.ProseMirror')).not.toBeNull()
      expect(adapter.text()).toBe('headingparagraph')
      expect(adapter.documentJSON().content).toHaveLength(2)
      expect(adapter.schema().nodes).toEqual(expect.objectContaining({
        heading: expect.anything(),
        paragraph: expect.anything(),
        rawBlock: expect.anything(),
        rawInline: expect.anything(),
        semanticBlock: expect.anything(),
        table: expect.anything(),
        taskList: expect.anything(),
      }))
      expect(adapter.schema().marks).toEqual(expect.objectContaining({
        highlight: expect.anything(),
        link: expect.anything(),
        subscript: expect.anything(),
        superscript: expect.anything(),
        textStyle: expect.anything(),
        underline: expect.anything(),
      }))
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('hydrates external revisions outside history and restores selection by projection identity', () => {
    const events = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'visual', markdown: 'alpha\nbravo' })
    const adapter = new TiptapVisualAdapter({ host, onTransaction: events, project, session })

    try {
      adapter.setSelection({ anchor: 8, head: 13 })
      expect(adapter.selectedText()).toBe('bravo')

      session.commitSource({
        markdown: 'expanded alpha\nbravo',
        origin: 'import',
        transactionId: 'external-visual-hydration',
      })

      expect(adapter.text()).toBe('expanded alphabravo')
      expect(adapter.selectedText()).toBe('bravo')
      expect(adapter.selection()).toEqual({ anchor: 17, head: 22, kind: 'text' })
      expect(adapter.projection().revision).toBe(1)
      const hydration = events.mock.calls
        .map(([event]) => event as Parameters<NonNullable<ConstructorParameters<typeof TiptapVisualAdapter>[0]['onTransaction']>>[0])
        .find((event) => event.external)
      expect(hydration?.transaction.getMeta('addToHistory')).toBe(false)
      expect(hydration?.transaction.getMeta(TIPTAP_EXTERNAL_HYDRATION_META)).toEqual({
        addToHistory: false,
        revision: 1,
      })
      expect(session.snapshot().revision).toBe(1)
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('keeps external hydration out of native undo and redo history', () => {
    const { adapter, host, session } = mount('initial')
    try {
      session.commitSource({ markdown: 'external', origin: 'import', transactionId: 'external-1' })
      adapter.setSelection({ anchor: 9, head: 9 })
      adapter.insertText('!')
      expect(adapter.text()).toBe('external!')

      expect(adapter.undo()).toBe(true)
      expect(adapter.text()).toBe('external')
      expect(adapter.undo()).toBe(false)
      expect(adapter.text()).toBe('external')
      expect(adapter.redo()).toBe(true)
      expect(adapter.text()).toBe('external!')
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('restores a checkpoint as one authoritative revision that native undo can recover', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'visual', markdown: 'current content', revision: 4 })
    const onCheckpointHistoryCommit = vi.fn()
    const adapter = new TiptapVisualAdapter({
      host,
      onCheckpointHistoryCommit,
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => 'ordinary-history',
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project,
      session,
    })

    try {
      expect(adapter.restoreCheckpoint('protected content', 'restore-checkpoint')).toEqual({
        changed: true,
        documentId: 'visual',
        origin: 'checkpoint-restore',
        previousRevision: 4,
        revision: 5,
        transactionId: 'restore-checkpoint',
      })
      expect(session.snapshot()).toEqual({ documentId: 'visual', markdown: 'protected content', revision: 5 })
      expect(adapter.text()).toBe('protected content')

      expect(adapter.undo()).toBe(true)
      expect(session.snapshot()).toEqual({ documentId: 'visual', markdown: 'current content', revision: 6 })
      expect(adapter.text()).toBe('current content')
      expect(adapter.undo()).toBe(false)
      expect(onCheckpointHistoryCommit).toHaveBeenCalledOnce()

      expect(adapter.redo()).toBe(true)
      expect(session.snapshot()).toEqual({ documentId: 'visual', markdown: 'protected content', revision: 7 })
      expect(adapter.text()).toBe('protected content')
      expect(onCheckpointHistoryCommit).toHaveBeenCalledTimes(2)
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('advances the planner projection after an acknowledged own-origin synchronization', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'visual', markdown: 'alpha' })
    const planner = { plan: vi.fn<(transaction: Transaction, projection: TiptapVisualProjection) => null>(() => null) }
    const adapter = new TiptapVisualAdapter({ host, patchPlanner: planner, project, session })

    try {
      adapter.setSelection({ anchor: 1, head: 6 })
      expect(adapter.selectedText()).toBe('alpha')
      adapter.insertText('OMEGA')
      const initialDocumentChanges = planner.plan.mock.calls.filter(([transaction]) => transaction.docChanged)
      expect(initialDocumentChanges).toHaveLength(1)
      expect(initialDocumentChanges[0]?.[1].revision).toBe(0)

      session.commitPatchPlan({
        baseRevision: 0,
        patches: [{ codecId: 'paragraph', expected: 'alpha', from: 0, replacement: 'OMEGA', to: 5 }],
        transactionId: 'visual-ack-1',
      })
      const acknowledged = project(session.snapshot())
      adapter.acknowledgeSynchronization({ map: acknowledged.map, snapshot: session.snapshot() })
      expect(adapter.projection().revision).toBe(1)

      vi.advanceTimersByTime(600)
      adapter.setSelection({ anchor: 6, head: 6 })
      adapter.insertText('!')
      const documentChanges = planner.plan.mock.calls.filter(([transaction]) => transaction.docChanged)
      expect(documentChanges.at(-1)?.[1].revision).toBe(1)
      expect(adapter.undo()).toBe(true)
      expect(adapter.text()).toBe('OMEGA')
      expect(adapter.undo()).toBe(true)
      expect(adapter.text()).toBe('alpha')
      expect(adapter.undo()).toBe(false)
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('rebases a malformed optimistic candidate to the local Tiptap document without losing input', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'visual-local-rebase', markdown: 'alpha' })
    const state = new SynchronizationStateStore(session.snapshot())
    const failures: unknown[] = []
    const planner = {
      plan: vi.fn<(transaction: Transaction, projection: TiptapVisualProjection) => ReturnType<TiptapTransactionPatchPlanner['plan']>>(
        (transaction) => transaction.docChanged
          ? {
              baseRevision: 0,
              patches: [{ codecId: 'paragraph', expected: 'alpha', from: 0, replacement: 'alpha\n\nwrong', to: 5 }],
              transactionId: 'visual-local-rebase',
            }
          : null,
      ),
    }
    const service = new VisualSynchronizationService({
      onAcknowledgement: ({ snapshot }) => {
        const projection = projectWithSource(snapshot)
        adapter.acknowledgeSynchronization({ map: projection.map, snapshot })
      },
      session,
      state,
    })
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) service.request(patchPlan)
      },
      onTransactionFailure: ({ failure }) => failures.push(failure),
      patchPlanner: planner,
      project: projectWithSource,
      session,
    })

    try {
      adapter.setSelection({ anchor: 6, head: 6 })
      adapter.insertText('!')
      await service.flush()

      expect(failures).toEqual([])
      expect(adapter.text()).toBe('alpha!')
      expect(state.snapshot().status).toBe('synchronized')
      expect(session.snapshot()).toEqual({ documentId: 'visual-local-rebase', markdown: 'alpha!', revision: 1 })
    } finally {
      service.cancel()
      adapter.destroy()
      host.remove()
    }
  })

  it('restores the selection that belongs to the visual edit being undone', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'visual-selection-history', markdown: 'First\n\nMiddle\n\nLast' })
    let sequence = 0
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan === null) return
        session.commitPatchPlan(patchPlan)
        const acknowledged = project(session.snapshot())
        adapter.acknowledgeSynchronization({ map: acknowledged.map, snapshot: session.snapshot() })
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `visual-selection-history:${++sequence}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project,
      session,
    })

    try {
      const firstEnd = adapter.search('First')[0]?.to
      if (firstEnd === undefined) throw new Error('Expected the first paragraph.')
      adapter.setSelection({ anchor: firstEnd, head: firstEnd })
      adapter.insertText('[one]')

      const lastEnd = adapter.search('Last')[0]?.to
      if (lastEnd === undefined) throw new Error('Expected the last paragraph.')
      const lastBlock = Array.from(host.querySelectorAll<HTMLElement>('.ProseMirror p'))
        .find((block) => block.textContent === 'Last')
      const lastText = lastBlock?.firstChild
      if (!(lastText instanceof Text)) throw new Error('Expected the last paragraph text node.')
      const browserRange = document.createRange()
      browserRange.setStart(lastText, lastText.data.length)
      browserRange.collapse(true)
      const browserSelection = window.getSelection()
      browserSelection?.removeAllRanges()
      browserSelection?.addRange(browserRange)
      host.querySelector<HTMLElement>('.ProseMirror')?.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: '[two]',
        inputType: 'insertText',
      }))

      expect(adapter.selection()).toEqual({ anchor: lastEnd, head: lastEnd, kind: 'text' })
      adapter.insertText('[two]')

      expect(adapter.undo()).toBe(true)
      const restoredLastEnd = adapter.search('Last')[0]?.to
      expect(restoredLastEnd).toBeDefined()
      expect(adapter.selection()).toEqual({
        anchor: restoredLastEnd,
        head: restoredLastEnd,
        kind: 'text',
      })

      expect(adapter.undo()).toBe(true)
      expect(adapter.redo()).toBe(true)
      const restoredFirstEnd = adapter.search('First[one]')[0]?.to
      expect(restoredFirstEnd).toBeDefined()
      expect(adapter.selection()).toEqual({
        anchor: restoredFirstEnd,
        head: restoredFirstEnd,
        kind: 'text',
      })
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('unsubscribes and destroys the visual surface before later authority changes', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'visual', markdown: 'before' })
    const projector = vi.fn(project)
    const adapter = new TiptapVisualAdapter({ host, project: projector, session })
    expect(projector).toHaveBeenCalledOnce()

    adapter.destroy()
    session.commitSource({ markdown: 'after', origin: 'import', transactionId: 'after-destroy' })

    expect(projector).toHaveBeenCalledOnce()
    expect(host.querySelector('.ProseMirror')).toBeNull()
    expect(session.snapshot()).toEqual({ documentId: 'visual', markdown: 'after', revision: 1 })
    host.remove()
  })

  it('forwards composition lifecycle from the editable surface and removes those listeners on teardown', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'visual', markdown: 'alpha' })
    const onCompositionStart = vi.fn()
    const onCompositionEnd = vi.fn()
    const adapter = new TiptapVisualAdapter({
      host,
      onCompositionEnd,
      onCompositionStart,
      project,
      session,
    })
    const surface = host.querySelector('.ProseMirror')
    if (surface === null) throw new Error('Expected the visual editor surface.')

    surface.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    expect(adapter.composing()).toBe(true)
    expect(onCompositionStart).toHaveBeenCalledOnce()
    surface.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    expect(adapter.composing()).toBe(false)
    expect(onCompositionEnd).toHaveBeenCalledOnce()

    adapter.destroy()
    surface.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    expect(onCompositionStart).toHaveBeenCalledOnce()
    host.remove()
  })

  it.each([
    {
      failure: new InvalidTiptapPatchSerializationError(
        'Projection id paragraph-0 occurs more than once in the Tiptap document.',
      ),
      name: 'duplicate projection identity',
    },
    {
      failure: new InvalidTiptapPatchSerializationError(
        'A Tiptap safe-unit serializer returned a non-string replacement.',
      ),
      name: 'serializer rejection',
    },
  ])('contains $name, retains the visible draft, and permits an authoritative rebuild', ({ failure }) => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'visual', markdown: 'alpha' })
    const onTransactionFailure = vi.fn()
    const adapter = new TiptapVisualAdapter({
      host,
      onTransactionFailure,
      patchPlanner: {
        plan: (transaction) => {
          if (!transaction.docChanged) return null
          throw failure
        },
      },
      project,
      session,
    })

    try {
      adapter.setSelection({ anchor: 6, head: 6 })

      expect(() => adapter.insertText('!')).not.toThrow()
      expect(adapter.text()).toBe('alpha!')
      expect(session.snapshot()).toEqual({ documentId: 'visual', markdown: 'alpha', revision: 0 })
      expect(onTransactionFailure).toHaveBeenCalledOnce()
      expect(onTransactionFailure).toHaveBeenCalledWith(expect.objectContaining({
        failure,
        projection: expect.objectContaining({ revision: 0 }),
        transaction: expect.objectContaining({ docChanged: true }),
      }))

      adapter.rebuildFromAuthority()

      expect(adapter.text()).toBe('alpha')
      expect(adapter.projection().revision).toBe(0)
      expect(session.snapshot()).toEqual({ documentId: 'visual', markdown: 'alpha', revision: 0 })
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('keeps a newly split paragraph editable after Delete merges it with the next block', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'visual-delete-identity', markdown: 'Alpha\n\nBravo' })
    const failures: unknown[] = []
    const adapter = new TiptapVisualAdapter({
      host,
      onTransactionFailure: ({ failure }) => failures.push(failure),
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `visual-delete-identity:${failures.length}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })

    try {
      const surface = host.querySelector('.ProseMirror')
      const alpha = adapter.search('Alpha')[0]
      if (surface === null || alpha === undefined) throw new Error('Expected the Visual paragraph.')
      adapter.setSelection({ anchor: alpha.to, head: alpha.to })
      surface.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }))

      const splitSelection = adapter.selection()
      adapter.setSelection({ anchor: splitSelection.head, head: splitSelection.head })
      surface.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Delete' }))
      const topLevelIds = (adapter.documentJSON().content ?? []).map((node) => node.attrs?.['projectionId'] ?? null)
      expect(topLevelIds).toEqual(['paragraph:0:5', expect.any(String)])
      expect(new Set(topLevelIds).size).toBe(topLevelIds.length)
      adapter.insertText('x')

      expect(failures).toEqual([])
      expect(adapter.text()).toContain('xBravo')
    } finally {
      adapter.destroy()
      host.remove()
    }
  })
})
