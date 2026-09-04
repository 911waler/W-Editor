import { describe, expect, it, vi } from 'vitest'

import {
  DocumentSession,
  ProjectionRevisionGate,
  SynchronizationStateStore,
  type PatchPlan,
} from '../../src/core'
import {
  VisualSynchronizationService,
  coalesceVisualPatchBatches,
} from '../../src/services/visualSynchronization'

function plan(
  transactionId: string,
  replacement: string,
  range: { readonly expected: string; readonly from: number; readonly to: number } = {
    expected: 'alpha',
    from: 0,
    to: 5,
  },
): PatchPlan {
  return {
    baseRevision: 0,
    patches: [{ codecId: 'paragraph', replacement, ...range }],
    transactionId,
  }
}

function setup(markdown = 'alpha') {
  const session = new DocumentSession({ documentId: 'visual-sync', markdown })
  const state = new SynchronizationStateStore(session.snapshot())
  const acknowledgements = vi.fn()
  const service = new VisualSynchronizationService({
    onAcknowledgement: acknowledgements,
    session,
    state,
  })
  return { acknowledgements, service, session, state }
}

describe('VisualSynchronizationService', () => {
  it('commits a pending visual patch after the trailing 250 ms delay', async () => {
    const { acknowledgements, service, session, state } = setup()
    service.request(plan('visual-1', 'ALPHA'))

    await vi.advanceTimersByTimeAsync(249)
    expect(session.snapshot()).toEqual({ documentId: 'visual-sync', markdown: 'alpha', revision: 0 })
    expect(state.snapshot().status).toBe('pending')

    await vi.advanceTimersByTimeAsync(1)

    expect(session.snapshot()).toEqual({ documentId: 'visual-sync', markdown: 'ALPHA', revision: 1 })
    expect(state.snapshot()).toEqual({
      failure: null,
      lastValidSnapshot: session.snapshot(),
      operation: null,
      status: 'synchronized',
    })
    expect(acknowledgements).toHaveBeenCalledWith({
      acknowledgement: {
        changed: true,
        documentId: 'visual-sync',
        origin: 'tiptap-visual',
        previousRevision: 0,
        revision: 1,
        transactionId: 'visual-1',
      },
      snapshot: session.snapshot(),
      transactionIds: ['visual-1'],
    })
  })

  it('coalesces continuous edits and advances authority at the 1000 ms maximum wait', async () => {
    const { acknowledgements, service, session } = setup()
    service.request(plan('visual-1', 'a'))
    await vi.advanceTimersByTimeAsync(200)
    service.request(plan('visual-2', 'al'))
    await vi.advanceTimersByTimeAsync(200)
    service.request(plan('visual-3', 'alp'))
    await vi.advanceTimersByTimeAsync(200)
    service.request(plan('visual-4', 'alph'))
    await vi.advanceTimersByTimeAsync(200)
    service.request(plan('visual-5', 'ALPHA'))

    expect(session.snapshot().revision).toBe(0)
    await vi.advanceTimersByTimeAsync(200)

    expect(session.snapshot()).toEqual({ documentId: 'visual-sync', markdown: 'ALPHA', revision: 1 })
    expect(acknowledgements).toHaveBeenCalledOnce()
    expect(acknowledgements.mock.calls[0]?.[0].transactionIds).toEqual([
      'visual-1',
      'visual-2',
      'visual-3',
      'visual-4',
      'visual-5',
    ])
  })

  it('combines disjoint safe ranges into one checked authority commit', async () => {
    const { service, session } = setup('alpha\nbeta')
    service.request(plan('visual-alpha', 'ALPHA'))
    service.request(plan('visual-beta', 'BETA', { expected: 'beta', from: 6, to: 10 }))

    await service.flush()

    expect(session.snapshot()).toEqual({ documentId: 'visual-sync', markdown: 'ALPHA\nBETA', revision: 1 })
  })

  it('force-flushes before the trailing deadline', async () => {
    const { service, session } = setup()
    service.request(plan('visual-flush', 'flushed'))

    await service.flush()

    expect(session.snapshot()).toEqual({ documentId: 'visual-sync', markdown: 'flushed', revision: 1 })
  })

  it('publishes an own-origin revision acknowledgement without hydration feedback', async () => {
    const { service, session } = setup()
    const hydrate = vi.fn()
    const gate = new ProjectionRevisionGate('tiptap-visual', hydrate)
    session.subscribe((change) => gate.receive(change))
    service.request(plan('visual-reflection', 'reflected'))

    await service.flush()

    expect(gate.acknowledgement()).toEqual({
      origin: 'tiptap-visual',
      revision: 1,
      transactionId: 'visual-reflection',
    })
    expect(hydrate).not.toHaveBeenCalled()
  })

  it('suspends intermediate IME patches until compositionend and resolves a waiting lifecycle flush once', async () => {
    const { acknowledgements, service, session, state } = setup()
    const changes = vi.fn()
    session.subscribe(changes)
    service.beginComposition()
    service.request(plan('ime-intermediate', '拼'))

    await vi.advanceTimersByTimeAsync(2_000)
    expect(session.snapshot()).toEqual({ documentId: 'visual-sync', markdown: 'alpha', revision: 0 })
    expect(state.snapshot().status).toBe('waiting-composition')

    service.request(plan('ime-complete', '拼音'))
    let lifecycleFinished = false
    const lifecycleFlush = service.flush().then(() => {
      lifecycleFinished = true
    })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(lifecycleFinished).toBe(false)
    expect(session.snapshot().revision).toBe(0)

    service.endComposition()
    await lifecycleFlush

    expect(session.snapshot()).toEqual({ documentId: 'visual-sync', markdown: '拼音', revision: 1 })
    expect(changes).toHaveBeenCalledOnce()
    expect(acknowledgements.mock.calls[0]?.[0].transactionIds).toEqual([
      'ime-intermediate',
      'ime-complete',
    ])
    expect(state.snapshot().status).toBe('synchronized')
  })

  it('starts the ordinary trailing window at compositionend when no lifecycle flush is waiting', async () => {
    const { service, session } = setup()
    service.beginComposition()
    service.request(plan('ime-complete', 'complete'))
    await vi.advanceTimersByTimeAsync(2_000)

    service.endComposition()
    await vi.advanceTimersByTimeAsync(249)
    expect(session.snapshot().revision).toBe(0)
    await vi.advanceTimersByTimeAsync(1)

    expect(session.snapshot()).toEqual({ documentId: 'visual-sync', markdown: 'complete', revision: 1 })
  })

  it('coalesces consecutive composition batches against one optimistic source before the first batch is acknowledged', async () => {
    const { acknowledgements, service, session, state } = setup()
    service.beginComposition()
    service.request(plan('ime-first-preedit', 'alphani'))
    service.request(plan('ime-first-candidate', 'alpha你', {
      expected: 'alphani',
      from: 0,
      to: 7,
    }))
    service.endComposition()

    service.beginComposition()
    service.request(plan('ime-second-preedit', 'alpha你hao', {
      expected: 'alpha你',
      from: 0,
      to: 6,
    }))
    service.request(plan('ime-second-candidate', 'alpha你好', {
      expected: 'alpha你hao',
      from: 0,
      to: 9,
    }))
    service.endComposition()

    await service.flush()

    expect(session.snapshot()).toEqual({ documentId: 'visual-sync', markdown: 'alpha你好', revision: 1 })
    expect(state.snapshot().status).toBe('synchronized')
    expect(acknowledgements).toHaveBeenCalledOnce()
    expect(acknowledgements.mock.calls[0]?.[0].transactionIds).toEqual([
      'ime-first-preedit',
      'ime-first-candidate',
      'ime-second-preedit',
      'ime-second-candidate',
    ])
  })

  it('releases pending state and retains a stale revision intent for a real retry', async () => {
    const { service, session, state } = setup()
    session.commitSource({ markdown: 'new authority', origin: 'import', transactionId: 'external-revision' })
    service.request(plan('stale-visual-intent', 'ALPHA'))

    await expect(service.flush()).rejects.toMatchObject({ code: 'STALE_REVISION' })

    expect(service.pending()).toBe(false)
    expect(service.retryable()).toBe(true)
    expect(state.snapshot()).toEqual(expect.objectContaining({
      failure: expect.objectContaining({
        actions: ['retry', 'locate-source', 'raw-export'],
        code: 'STALE_REVISION',
      }),
      status: 'failed',
    }))
    await expect(service.retry()).rejects.toMatchObject({ code: 'STALE_REVISION' })
    expect(service.retryable()).toBe(true)
    expect(state.snapshot().status).toBe('failed')
  })

  it('rejects an expected-source mismatch before it can reach authority', () => {
    const { service, session, state } = setup()

    expect(() => service.request(plan('mismatched-visual-intent', 'ALPHA', {
      expected: 'bravo',
      from: 0,
      to: 5,
    }))).toThrowError(expect.objectContaining({ code: 'UNSAFE_VISUAL_PATCH_COALESCENCE' }))

    expect(session.snapshot()).toEqual({ documentId: 'visual-sync', markdown: 'alpha', revision: 0 })
    expect(state.snapshot()).toEqual(expect.objectContaining({ status: 'failed' }))
    service.cancel()
  })

  it('resubmits a retained transaction rejection and synchronizes only after commit acknowledgement is accepted', async () => {
    const session = new DocumentSession({ documentId: 'visual-sync', markdown: 'alpha' })
    const state = new SynchronizationStateStore(session.snapshot())
    const rejection = Object.assign(new Error('Injected transaction rejection.'), { code: 'TRANSACTION_REJECTED' })
    const commit = vi.fn((patchPlan: PatchPlan) => {
      if (commit.mock.calls.length === 1) throw rejection
      return session.commitPatchPlan(patchPlan)
    })
    const service = new VisualSynchronizationService({ commit, session, state })
    service.request(plan('retry-transaction', 'ALPHA'))

    await expect(service.flush()).rejects.toBe(rejection)
    expect(service.pending()).toBe(false)
    expect(state.snapshot().status).toBe('failed')

    await expect(service.retry()).resolves.toBeUndefined()

    expect(commit).toHaveBeenCalledTimes(2)
    expect(session.snapshot()).toEqual({ documentId: 'visual-sync', markdown: 'ALPHA', revision: 1 })
    expect(state.snapshot().status).toBe('synchronized')
    expect(service.retryable()).toBe(false)
  })

  it('retries acknowledgement without committing twice when Visual hydrate/schema acceptance initially rejects', async () => {
    const session = new DocumentSession({ documentId: 'visual-sync', markdown: 'alpha' })
    const state = new SynchronizationStateStore(session.snapshot())
    const schemaFailure = Object.assign(new Error('Visual projection does not satisfy the active Tiptap schema.'), {
      code: 'INVALID_TIPTAP_SCHEMA',
    })
    const commit = vi.fn((patchPlan: PatchPlan) => session.commitPatchPlan(patchPlan))
    const onAcknowledgement = vi.fn(() => {
      if (onAcknowledgement.mock.calls.length === 1) throw schemaFailure
    })
    const service = new VisualSynchronizationService({ commit, onAcknowledgement, session, state })
    service.request(plan('hydrate-retry', 'ALPHA'))

    await expect(service.flush()).rejects.toBe(schemaFailure)

    expect(session.snapshot()).toEqual({ documentId: 'visual-sync', markdown: 'ALPHA', revision: 1 })
    expect(state.snapshot().status).toBe('failed')
    expect(state.snapshot().lastValidSnapshot).toEqual({ documentId: 'visual-sync', markdown: 'alpha', revision: 0 })
    expect(service.pending()).toBe(false)

    await expect(service.retry()).resolves.toBeUndefined()

    expect(commit).toHaveBeenCalledOnce()
    expect(onAcknowledgement).toHaveBeenCalledTimes(2)
    expect(state.snapshot()).toEqual({
      failure: null,
      lastValidSnapshot: session.snapshot(),
      operation: null,
      status: 'synchronized',
    })
  })

  it('publishes an adapter planning rejection and accepts an explicit authoritative rebuild on Retry', async () => {
    const { service, session, state } = setup()
    const serializerFailure = Object.assign(new Error('Injected serializer rejection.'), {
      code: 'INVALID_TIPTAP_PATCH_SERIALIZATION',
    })
    const recover = vi.fn()

    service.rejectTransaction({
      failure: serializerFailure,
      operationId: 'visual-plan-rejected',
      recover,
    })

    expect(service.pending()).toBe(false)
    expect(service.retryable()).toBe(true)
    expect(state.snapshot()).toEqual({
      failure: {
        actions: ['retry', 'locate-source', 'raw-export'],
        code: 'INVALID_TIPTAP_PATCH_SERIALIZATION',
        message: 'Injected serializer rejection.',
        sourceLocation: null,
      },
      lastValidSnapshot: session.snapshot(),
      operation: {
        kind: 'synchronize-visual-patch',
        operationId: 'visual-plan-rejected',
        requestedRevision: 0,
      },
      status: 'failed',
    })

    await service.retry()

    expect(recover).toHaveBeenCalledOnce()
    expect(state.snapshot().status).toBe('synchronized')
    expect(service.retryable()).toBe(false)
  })

  it('explicitly discards a rejected draft without requiring Visual hydrate before Source recovery', async () => {
    const { service, session, state } = setup()
    service.request(plan('stale-before-source', 'ALPHA'))
    session.commitSource({ markdown: 'source authority', origin: 'import', transactionId: 'source-won' })
    await expect(service.flush()).rejects.toMatchObject({ code: 'STALE_REVISION' })

    service.discard()

    expect(service.pending()).toBe(false)
    expect(service.retryable()).toBe(false)
    expect(state.snapshot()).toEqual({
      failure: null,
      lastValidSnapshot: session.snapshot(),
      operation: null,
      status: 'synchronized',
    })
    expect(session.snapshot().markdown).toBe('source authority')
  })
})

describe('coalesceVisualPatchBatches', () => {
  it('composes a later patch that is based on the optimistic result of the first patch', async () => {
    const { service, session, state } = setup()
    service.request(plan('visual-first', 'ALPHA'))
    service.request(plan('visual-second', 'ALPHAX', {
      expected: 'ALPHA',
      from: 0,
      to: 5,
    }))

    await expect(service.flush()).resolves.toBeUndefined()

    expect(session.snapshot()).toEqual({ documentId: 'visual-sync', markdown: 'ALPHAX', revision: 1 })
    expect(state.snapshot().status).toBe('synchronized')
  })

  it('rejects a stale follow-up before it can reach authority while a local batch is pending', () => {
    const { service, session, state } = setup()
    service.request(plan('visual-first', 'ALPHA'))

    expect(() => service.request({
      baseRevision: 0,
      patches: [{ codecId: 'paragraph', expected: 'bravo', from: 0, replacement: 'ALPHAX', to: 5 }],
      transactionId: 'visual-stale-follow-up',
    })).toThrowError(expect.objectContaining({ code: 'UNSAFE_VISUAL_PATCH_COALESCENCE' }))

    expect(session.snapshot()).toEqual({ documentId: 'visual-sync', markdown: 'alpha', revision: 0 })
    expect(state.snapshot()).toEqual(expect.objectContaining({ status: 'failed' }))
    service.cancel()
  })

  it('rebases local recovery over a pending optimistic batch without rejecting local input', async () => {
    const { service, session, state } = setup()
    service.request(plan('visual-first', 'ALPHA'))
    service.request({
      baseRevision: 0,
      patches: [{
        codecId: 'tiptap-visual-recovery',
        expected: 'alpha',
        from: 0,
        replacement: 'local!',
        to: 5,
      }],
      transactionId: 'visual-recovery',
    })

    await expect(service.flush()).resolves.toBeUndefined()

    expect(session.snapshot()).toEqual({ documentId: 'visual-sync', markdown: 'local!', revision: 1 })
    expect(state.snapshot().status).toBe('synchronized')
  })

  it('retains a zero-net structural transaction while composing the following edit', async () => {
    const { service, session, state } = setup('')
    service.request({
      baseRevision: 0,
      patches: [{ codecId: 'paragraph', expected: '', from: 0, replacement: '>', to: 0 }],
      transactionId: 'structural-prefix',
    })
    service.request({
      baseRevision: 0,
      patches: [{ codecId: 'blockquote', expected: '>', from: 0, replacement: '>', to: 1 }],
      transactionId: 'structural-noop',
    })
    service.request({
      baseRevision: 0,
      patches: [{ codecId: 'blockquote', expected: '>', from: 0, replacement: '> I', to: 1 }],
      transactionId: 'structural-following-edit',
    })

    await service.flush()

    expect(session.snapshot()).toEqual({ documentId: 'visual-sync', markdown: '> I', revision: 1 })
    expect(state.snapshot().status).toBe('synchronized')
  })

  it('composes mixed optimistic inserts, deletes, and replacements against one authority revision', async () => {
    const session = new DocumentSession({ documentId: 'visual-sync-mixed', markdown: '0123456789' })
    const state = new SynchronizationStateStore(session.snapshot())
    const service = new VisualSynchronizationService({ session, state })
    let expected = session.snapshot().markdown
    const edits = [
      { from: 5, replacement: 'XYZ', to: 5 },
      { from: 0, replacement: '', to: 2 },
      { from: 4, replacement: 'q', to: 7 },
      { from: 3, replacement: 'LM', to: 3 },
      { from: 1, replacement: '!', to: 5 },
    ] as const

    for (const [index, edit] of edits.entries()) {
      const current = expected.slice(edit.from, edit.to)
      service.request({
        baseRevision: 0,
        patches: [{ codecId: 'paragraph', expected: current, from: edit.from, replacement: edit.replacement, to: edit.to }],
        transactionId: `mixed-${index}`,
      })
      expected = `${expected.slice(0, edit.from)}${edit.replacement}${expected.slice(edit.to)}`
    }

    await service.flush()

    expect(session.snapshot()).toEqual({ documentId: 'visual-sync-mixed', markdown: expected, revision: 1 })
    expect(state.snapshot().status).toBe('synchronized')
  })

  it('composes optimistic hard-break edits without adding a trailing newline', async () => {
    const session = new DocumentSession({ documentId: 'visual-sync-hard-break', markdown: 'Alpha' })
    const state = new SynchronizationStateStore(session.snapshot())
    const committed: PatchPlan[] = []
    const service = new VisualSynchronizationService({
      commit: (current) => {
        committed.push(current)
        return session.commitPatchPlan(current)
      },
      session,
      state,
    })
    service.request({
      baseRevision: 0,
      patches: [{ codecId: 'paragraph', expected: 'Alpha', from: 0, replacement: 'Alpha  \n', to: 5 }],
      transactionId: 'hard-break-first',
    })
    service.request({
      baseRevision: 0,
      patches: [{ codecId: 'paragraph', expected: 'Alpha  \n', from: 0, replacement: 'Alpha  \nBravo', to: 8 }],
      transactionId: 'hard-break-second',
    })

    await service.flush()

    expect(committed).toHaveLength(1)
    expect(committed[0]?.patches).toEqual([{
      codecId: 'paragraph',
      expected: 'Alpha',
      from: 0,
      replacement: 'Alpha  \nBravo',
      to: 5,
    }])
    expect(session.snapshot().markdown).toBe('Alpha  \nBravo')
  })

  it('composes sequential optimistic edits at disjoint source ranges without widening them', async () => {
    const session = new DocumentSession({ documentId: 'visual-sync-disjoint', markdown: 'alpha\nbeta\ngamma' })
    const state = new SynchronizationStateStore(session.snapshot())
    const committed: PatchPlan[] = []
    const service = new VisualSynchronizationService({
      commit: (current) => {
        committed.push(current)
        return session.commitPatchPlan(current)
      },
      session,
      state,
    })
    service.request({
      baseRevision: 0,
      patches: [{ codecId: 'paragraph', expected: 'alpha', from: 0, replacement: 'ALPHA', to: 5 }],
      transactionId: 'disjoint-first',
    })
    service.request({
      baseRevision: 0,
      patches: [{ codecId: 'paragraph', expected: 'beta', from: 6, replacement: 'BETA', to: 10 }],
      transactionId: 'disjoint-second',
    })

    await service.flush()

    expect(committed[0]?.patches).toEqual([
      { codecId: 'paragraph', expected: 'alpha', from: 0, replacement: 'ALPHA', to: 5 },
      { codecId: 'paragraph', expected: 'beta', from: 6, replacement: 'BETA', to: 10 },
    ])
    expect(session.snapshot().markdown).toBe('ALPHA\nBETA\ngamma')
  })

  it('lets a later wider safe unit supersede contained earlier patches', () => {
    const result = coalesceVisualPatchBatches(
      { plan: plan('first', 'ALPHA'), transactionIds: ['first'] },
      {
        plan: {
          baseRevision: 0,
          patches: [{
            codecId: 'paragraph',
            expected: 'alpha\nbeta',
            from: 0,
            replacement: 'ALPHABETA',
            to: 10,
          }],
          transactionId: 'joined',
        },
        transactionIds: ['joined'],
      },
    )

    expect(result).toEqual({
      plan: {
        baseRevision: 0,
        patches: [{
          codecId: 'paragraph',
          expected: 'alpha\nbeta',
          from: 0,
          replacement: 'ALPHABETA',
          to: 10,
        }],
        transactionId: 'joined',
      },
      transactionIds: ['first', 'joined'],
    })
  })
})
