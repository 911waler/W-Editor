import { describe, expect, it, vi } from 'vitest'

import type { DocumentSnapshot } from '../../src/core/documentSession'
import { SynchronizationStateStore, type OperationMetadata } from '../../src/core/operationState'

const initial: DocumentSnapshot = Object.freeze({ documentId: 'article', markdown: 'valid', revision: 4 })
const operation: OperationMetadata = {
  kind: 'synchronize-visual-patch',
  operationId: 'sync-5',
  requestedRevision: 5,
}

describe('observable synchronization and failure state', () => {
  it('publishes queue, running, and successful states with the new valid snapshot', () => {
    const store = new SynchronizationStateStore(initial)
    const subscriber = vi.fn()
    store.subscribe(subscriber)

    store.queue(operation)
    store.start(operation)
    const next = Object.freeze({ documentId: 'article', markdown: 'next', revision: 5 })
    store.succeed(next)

    expect(subscriber).toHaveBeenCalledTimes(3)
    expect(store.snapshot()).toEqual({
      failure: null,
      lastValidSnapshot: next,
      operation: null,
      status: 'synchronized',
    })
  })

  it('retains the last valid snapshot and actionable operation metadata on failure', () => {
    const store = new SynchronizationStateStore(initial)
    store.queue(operation)
    store.fail(operation, {
      actions: ['retry', 'locate-source', 'raw-export'],
      code: 'EXPECTED_SOURCE_MISMATCH',
      message: 'The paragraph changed before synchronization completed.',
      sourceLocation: { from: 12, to: 31 },
    })

    expect(store.snapshot()).toEqual({
      failure: {
        actions: ['retry', 'locate-source', 'raw-export'],
        code: 'EXPECTED_SOURCE_MISMATCH',
        message: 'The paragraph changed before synchronization completed.',
        sourceLocation: { from: 12, to: 31 },
      },
      lastValidSnapshot: initial,
      operation,
      status: 'failed',
    })
    expect(Object.isFrozen(store.snapshot())).toBe(true)
    expect(Object.isFrozen(store.snapshot().failure?.actions)).toBe(true)
  })

  it('refreshes an already synchronized authoritative snapshot without republishing the same visible state', () => {
    const store = new SynchronizationStateStore(initial)
    const subscriber = vi.fn()
    store.subscribe(subscriber)
    const next = Object.freeze({ documentId: 'article', markdown: 'source edit', revision: 5 })

    store.acceptAuthoritativeSnapshot(next)

    expect(store.snapshot()).toEqual({
      failure: null,
      lastValidSnapshot: next,
      operation: null,
      status: 'synchronized',
    })
    expect(subscriber).not.toHaveBeenCalled()
  })

  it('publishes when an authoritative snapshot clears a visible synchronization failure', () => {
    const store = new SynchronizationStateStore(initial)
    const subscriber = vi.fn()
    const failure = {
      actions: ['retry', 'raw-export'] as const,
      code: 'UNMAPPED_TIPTAP_TRANSACTION',
      message: 'The visual transaction could not be mapped.',
      sourceLocation: null,
    }
    store.fail(operation, failure)
    store.subscribe(subscriber)
    const recovered = Object.freeze({ documentId: 'article', markdown: 'recovered source', revision: 5 })

    store.acceptAuthoritativeSnapshot(recovered)

    expect(store.snapshot()).toEqual({
      failure: null,
      lastValidSnapshot: recovered,
      operation: null,
      status: 'synchronized',
    })
    expect(subscriber).toHaveBeenCalledOnce()
  })
})
