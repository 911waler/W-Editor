import { describe, expect, it, vi } from 'vitest'

import { DocumentSession, SynchronizationStateStore } from '../../src/core'
import {
  ModeCoordinator,
  type CheckpointRepository,
  type EditorMode,
  type ModeAdapter,
  type PreparedModeActivation,
} from '../../src/services'

function prepared(mode: EditorMode, revision: number, events: string[]): PreparedModeActivation {
  return {
    activate: () => events.push(`activate:${mode}`),
    discard: () => events.push(`discard:${mode}`),
    mode,
    revision,
  }
}

function adapter(
  mode: EditorMode,
  events: string[],
  prepare: ModeAdapter['prepare'] = async (snapshot) => {
    events.push(`prepare:${mode}:${snapshot.revision}`)
    return prepared(mode, snapshot.revision, events)
  },
): ModeAdapter {
  return {
    deactivate: () => events.push(`deactivate:${mode}`),
    mode,
    prepare,
  }
}

function coordinatorFixture(options: { readonly visualPrepare?: ModeAdapter['prepare'] } = {}) {
  const events: string[] = []
  const session = new DocumentSession({ documentId: 'article', markdown: 'draft' })
  const checkpoints: CheckpointRepository = {
    writeLatest: vi.fn(async ({ kind, snapshot }) => {
      events.push(`checkpoint:${kind}:${snapshot.revision}`)
    }),
  }
  const state = new SynchronizationStateStore(session.snapshot())
  const adapters = {
    preview: adapter('preview', events),
    source: adapter('source', events),
    visual: adapter('visual', events, options.visualPrepare),
  }
  const flushSynchronization = vi.fn(async () => {
    events.push('flush:synchronization')
  })
  const flushRecoveryPersistence = vi.fn(async () => {
    events.push('flush:recovery')
  })
  const coordinator = new ModeCoordinator({
    adapters,
    checkpoints,
    flushRecoveryPersistence,
    flushSynchronization,
    initialMode: 'source',
    session,
    state,
  })
  return {
    adapters,
    checkpoints,
    coordinator,
    events,
    flushRecoveryPersistence,
    flushSynchronization,
    session,
    state,
  }
}

describe('ModeCoordinator', () => {
  it('keeps the source surface active until visual preparation and checkpoint persistence finish', async () => {
    const fixture = coordinatorFixture()
    const states = vi.fn()
    fixture.coordinator.subscribe(states)

    const result = await fixture.coordinator.request('visual')

    expect(result).toEqual({ changed: true, from: 'source', revision: 0, to: 'visual' })
    expect(fixture.events).toEqual([
      'flush:synchronization',
      'flush:recovery',
      'prepare:visual:0',
      'checkpoint:pre-mode-switch:0',
      'deactivate:source',
      'activate:visual',
    ])
    expect(fixture.coordinator.activeMode()).toBe('visual')
    expect(states).toHaveBeenCalledOnce()
    expect(states).toHaveBeenCalledWith({ mode: 'visual', revision: 0 })
  })

  it('captures the exact authoritative snapshot only after required flushes finish', async () => {
    const fixture = coordinatorFixture()
    fixture.flushSynchronization.mockImplementationOnce(async () => {
      fixture.events.push('flush:synchronization')
      fixture.session.commitSource({
        markdown: 'flushed\r\nsource',
        origin: 'cherry-source',
        transactionId: 'source-flush',
      })
    })

    const result = await fixture.coordinator.request('preview')

    expect(result.revision).toBe(1)
    expect(fixture.events).toContain('prepare:preview:1')
    expect(fixture.checkpoints.writeLatest).toHaveBeenCalledWith({
      kind: 'pre-mode-switch',
      snapshot: { documentId: 'article', markdown: 'flushed\r\nsource', revision: 1 },
    })
  })

  it('treats a request for the active mode as a no-op without flushing or overwriting a checkpoint', async () => {
    const fixture = coordinatorFixture()

    await expect(fixture.coordinator.request('source')).resolves.toEqual({
      changed: false,
      from: 'source',
      revision: 0,
      to: 'source',
    })

    expect(fixture.events).toEqual([])
    expect(fixture.flushSynchronization).not.toHaveBeenCalled()
    expect(fixture.checkpoints.writeLatest).not.toHaveBeenCalled()
  })

  it('serializes overlapping mode requests in arrival order', async () => {
    let finishVisualPreparation: ((value: PreparedModeActivation) => void) | undefined
    const fixture = coordinatorFixture({
      visualPrepare: async (snapshot) => {
        fixture.events.push(`prepare:visual:${snapshot.revision}`)
        return new Promise<PreparedModeActivation>((resolve) => {
          finishVisualPreparation = resolve
        })
      },
    })

    const visualRequest = fixture.coordinator.request('visual')
    const previewRequest = fixture.coordinator.request('preview')
    for (let turn = 0; turn < 10 && finishVisualPreparation === undefined; turn += 1) {
      await Promise.resolve()
    }
    expect(finishVisualPreparation).toBeTypeOf('function')
    expect(fixture.events).toEqual([
      'flush:synchronization',
      'flush:recovery',
      'prepare:visual:0',
    ])

    finishVisualPreparation?.(prepared('visual', 0, fixture.events))
    await visualRequest
    await previewRequest

    expect(fixture.events).toEqual([
      'flush:synchronization',
      'flush:recovery',
      'prepare:visual:0',
      'checkpoint:pre-mode-switch:0',
      'deactivate:source',
      'activate:visual',
      'flush:synchronization',
      'flush:recovery',
      'prepare:preview:0',
      'checkpoint:pre-mode-switch:0',
      'deactivate:visual',
      'activate:preview',
    ])
  })
})
