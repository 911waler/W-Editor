import { describe, expect, it, vi } from 'vitest'

import type { DocumentSnapshot } from '../../src/core'
import {
  activatePreparedMode,
  type CheckpointRepository,
  type ModeAdapter,
  type PreparedModeActivation,
} from '../../src/services/modeContracts'

describe('mode and checkpoint two-phase contracts', () => {
  it('support prepare and checkpoint work before one synchronous visible activation', async () => {
    const events: string[] = []
    const snapshot: DocumentSnapshot = Object.freeze({
      documentId: 'article-1',
      markdown: 'exact\r\nmarkdown',
      revision: 7,
    })
    const current: ModeAdapter = {
      deactivate: () => events.push('deactivate:source'),
      mode: 'source',
      prepare: () => { throw new Error('The active adapter is not the target.') },
    }
    const prepared: PreparedModeActivation = {
      activate: () => events.push('activate:visual'),
      discard: vi.fn(),
      mode: 'visual',
      revision: 7,
    }
    const target: ModeAdapter = {
      deactivate: vi.fn(),
      mode: 'visual',
      prepare: vi.fn(async (input) => {
        events.push(`prepare:${input.revision}`)
        expect(input).toBe(snapshot)
        return prepared
      }),
    }
    const checkpoints: CheckpointRepository = {
      writeLatest: vi.fn(async (write) => {
        events.push(`checkpoint:${write.kind}`)
        expect(write.snapshot).toBe(snapshot)
      }),
    }

    const ready = await target.prepare(snapshot)
    expect(events).toEqual(['prepare:7'])
    expect(target.deactivate).not.toHaveBeenCalled()
    expect(prepared.discard).not.toHaveBeenCalled()

    await checkpoints.writeLatest({ kind: 'pre-mode-switch', snapshot })
    activatePreparedMode(current, ready)

    expect(events).toEqual([
      'prepare:7',
      'checkpoint:pre-mode-switch',
      'deactivate:source',
      'activate:visual',
    ])
  })
})
