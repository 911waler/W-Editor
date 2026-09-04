import { describe, expect, it, vi } from 'vitest'

import type { DocumentSnapshot } from '../../src/core'
import {
  createApplicationCompositionRoot,
  type CheckpointRepository,
  type EditorMode,
  type ModeAdapter,
} from '../../src/services'

function modeAdapter(mode: EditorMode): ModeAdapter {
  return {
    deactivate: vi.fn(),
    mode,
    prepare: async (snapshot: DocumentSnapshot) => ({
      activate: vi.fn(),
      discard: vi.fn(),
      mode,
      revision: snapshot.revision,
    }),
  }
}

function setup() {
  const checkpoints: CheckpointRepository = { writeLatest: vi.fn() }
  const root = createApplicationCompositionRoot({
    adapters: {
      preview: modeAdapter('preview'),
      source: modeAdapter('source'),
      visual: modeAdapter('visual'),
    },
    checkpoints,
    flushRecoveryPersistence: vi.fn(),
    flushSynchronization: vi.fn(),
    initialDocument: { documentId: 'article-1', markdown: 'initial' },
    initialMode: 'source',
  })
  return { checkpoints, root }
}

describe('ApplicationCompositionRoot observable state', () => {
  it('publishes active document, mode, synchronization, autosave, manual dirty, modal, and error state', async () => {
    const { root } = setup()
    const subscriber = vi.fn()
    root.subscribe(subscriber)

    root.session.commitSource({ markdown: 'changed', origin: 'cherry-source', transactionId: 'change-1' })
    expect(root.snapshot()).toMatchObject({
      activeDocument: { documentId: 'article-1', markdown: 'changed', revision: 1 },
      autosave: { failure: null, revision: 1, status: 'pending' },
      manualDirty: true,
      mode: 'source',
    })

    root.setAutosave({ failure: null, revision: 1, status: 'saved' })
    root.markManualCheckpointSaved()
    root.setModalActivity('search-replace')
    await root.modeCoordinator.request('visual')

    expect(root.snapshot()).toMatchObject({
      autosave: { failure: null, revision: 1, status: 'saved' },
      manualDirty: false,
      modalActivity: 'search-replace',
      mode: 'visual',
      synchronization: { status: 'synchronized' },
    })

    const operation = { kind: 'convert-mode' as const, operationId: 'failed-preview', requestedRevision: 1 }
    root.synchronization.fail(operation, {
      actions: ['retry', 'raw-export'],
      code: 'RENDER_FAILED',
      message: 'Preview could not render.',
      sourceLocation: null,
    })
    expect(root.snapshot().error).toEqual({
      actions: ['retry', 'raw-export'],
      code: 'RENDER_FAILED',
      message: 'Preview could not render.',
      sourceLocation: null,
    })
    expect(subscriber).toHaveBeenCalled()
    root.destroy()
  })

  it('stops publishing after teardown', () => {
    const { root } = setup()
    const subscriber = vi.fn()
    root.subscribe(subscriber)
    root.destroy()

    root.session.commitSource({ markdown: 'after', origin: 'import', transactionId: 'after-destroy' })

    expect(subscriber).not.toHaveBeenCalled()
  })

  it('does not let a successful autosave hide an active synchronization failure', () => {
    const { root } = setup()
    const failure = {
      actions: ['retry', 'raw-export'] as const,
      code: 'UNMAPPED_TIPTAP_TRANSACTION',
      message: 'A document-changing Tiptap transaction did not map to a declared safe projection unit.',
      sourceLocation: null,
    }

    root.synchronization.fail(
      { kind: 'convert-mode', operationId: 'visual-sync-failure', requestedRevision: 0 },
      failure,
    )
    root.setAutosave({ failure: null, revision: 0, status: 'saved' })

    expect(root.snapshot().error).toEqual(failure)
    root.destroy()
  })

  it('does not republish the same pending autosave revision after a source commit', () => {
    const { root } = setup()
    const published: Array<Readonly<{ revision: number | null; status: string }>> = []
    root.subscribe((state) => published.push(Object.freeze({
      revision: state.autosave.revision,
      status: state.autosave.status,
    })))

    root.session.commitSource({ markdown: 'changed', origin: 'cherry-source', transactionId: 'source-change-1' })
    root.setAutosave({ failure: null, revision: 1, status: 'pending' })

    expect(published).toEqual([
      { revision: 1, status: 'pending' },
    ])
    expect(root.snapshot()).toMatchObject({
      activeDocument: { markdown: 'changed', revision: 1 },
      autosave: { failure: null, revision: 1, status: 'pending' },
      manualDirty: true,
    })
    root.destroy()
  })
})
