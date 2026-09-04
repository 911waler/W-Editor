import { describe, expect, it, vi } from 'vitest'

import { DocumentSession, SynchronizationStateStore } from '../../src/core'
import {
  ModeCoordinator,
  type CheckpointRepository,
  type EditorMode,
  type ModeAdapter,
  type PreparedModeActivation,
} from '../../src/services'

interface FailureCase {
  readonly code: string
  readonly stage: 'checkpoint' | 'prepare' | 'synchronization'
  readonly target: Extract<EditorMode, 'preview' | 'visual'>
}

const cases: readonly FailureCase[] = [
  { code: 'CODEC_THROW', stage: 'prepare', target: 'visual' },
  { code: 'INVALID_TIPTAP_SCHEMA', stage: 'prepare', target: 'visual' },
  { code: 'STALE_REVISION', stage: 'synchronization', target: 'visual' },
  { code: 'CORRUPT_PROJECTION', stage: 'prepare', target: 'visual' },
  { code: 'CHECKPOINT_WRITE_FAILED', stage: 'checkpoint', target: 'visual' },
  { code: 'CHERRY_RENDER_FAILED', stage: 'prepare', target: 'preview' },
]

function injectedFailure(code: string): Error & { readonly code: string } {
  return Object.assign(new Error(`Injected ${code} failure.`), { code })
}

describe('ModeCoordinator conversion failure containment', () => {
  for (const failureCase of cases) {
    it(`preserves the active mode and content after ${failureCase.code}`, async () => {
      const events: string[] = []
      const session = new DocumentSession({ documentId: 'article', markdown: 'last valid\r\nsource' })
      const state = new SynchronizationStateStore(session.snapshot())
      const failure = injectedFailure(failureCase.code)
      let preparedTarget: PreparedModeActivation | null = null
      const createAdapter = (mode: EditorMode): ModeAdapter => ({
        deactivate: vi.fn(() => events.push(`deactivate:${mode}`)),
        mode,
        prepare: vi.fn(async (snapshot) => {
          events.push(`prepare:${mode}`)
          if (mode === failureCase.target && failureCase.stage === 'prepare') throw failure
          const prepared: PreparedModeActivation = {
            activate: vi.fn(() => events.push(`activate:${mode}`)),
            discard: vi.fn(() => events.push(`discard:${mode}`)),
            mode,
            revision: snapshot.revision,
          }
          if (mode === failureCase.target) preparedTarget = prepared
          return prepared
        }),
      })
      const adapters = {
        preview: createAdapter('preview'),
        source: createAdapter('source'),
        visual: createAdapter('visual'),
      }
      const checkpoints: CheckpointRepository = {
        writeLatest: vi.fn(async () => {
          events.push('checkpoint')
          if (failureCase.stage === 'checkpoint') throw failure
        }),
      }
      const coordinator = new ModeCoordinator({
        adapters,
        checkpoints,
        flushRecoveryPersistence: async () => {
          events.push('flush:recovery')
        },
        flushSynchronization: async () => {
          events.push('flush:synchronization')
          if (failureCase.stage === 'synchronization') throw failure
        },
        initialMode: 'source',
        session,
        state,
      })

      await expect(coordinator.request(failureCase.target)).rejects.toBe(failure)

      expect(coordinator.activeMode()).toBe('source')
      expect(session.snapshot()).toEqual({
        documentId: 'article',
        markdown: 'last valid\r\nsource',
        revision: 0,
      })
      expect(adapters.source.deactivate).not.toHaveBeenCalled()
      expect(events.some((event) => event.startsWith('activate:'))).toBe(false)
      if (failureCase.stage === 'checkpoint') {
        expect(preparedTarget).not.toBeNull()
        expect(events).toContain(`discard:${failureCase.target}`)
      }
      expect(state.snapshot()).toEqual({
        failure: {
          actions: ['retry', 'locate-source', 'raw-export'],
          code: failureCase.code,
          message: `Injected ${failureCase.code} failure.`,
          sourceLocation: null,
        },
        lastValidSnapshot: { documentId: 'article', markdown: 'last valid\r\nsource', revision: 0 },
        operation: {
          kind: 'convert-mode',
          operationId: `mode:source->${failureCase.target}:0`,
          requestedRevision: 0,
        },
        status: 'failed',
      })
    })
  }
})
