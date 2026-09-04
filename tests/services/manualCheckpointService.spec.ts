import { describe, expect, it, vi } from 'vitest'

import { DocumentSession } from '../../src/core'
import { MANUAL_SAVE_COMMAND_ID, ManualCheckpointService } from '../../src/services/manualCheckpointService'

describe('ManualCheckpointService', () => {
  it('uses the stable command ID and replaces only the latest manual checkpoint after both preflights', async () => {
    const events: string[] = []
    const writes: unknown[] = []
    const session = new DocumentSession({ documentId: 'welcome', markdown: 'initial' })
    const service = new ManualCheckpointService({
      flushPersistence: () => { events.push('persistence') },
      flushSynchronization: () => { events.push('synchronization') },
      initialCheckpoint: null,
      session,
      writeLatest: (checkpoint) => { events.push('checkpoint'); writes.splice(0, writes.length, checkpoint) },
    })
    expect(service.commandId()).toBe(MANUAL_SAVE_COMMAND_ID)

    session.commitSource({ markdown: 'first', origin: 'cherry-source' })
    const first = await service.save()
    session.commitSource({ markdown: 'second', origin: 'cherry-source' })
    const second = await service.save()

    expect(events).toEqual(['synchronization', 'persistence', 'checkpoint', 'synchronization', 'persistence', 'checkpoint'])
    expect(writes).toEqual([second])
    expect(first.markdown).toBe('first')
    expect(second.markdown).toBe('second')
    service.destroy()
  })

  it('tracks clean and dirty by exact Markdown comparison, independently of autosave and download', async () => {
    const session = new DocumentSession({ documentId: 'welcome', markdown: 'baseline' })
    const writeLatest = vi.fn()
    const service = new ManualCheckpointService({
      flushPersistence: vi.fn(),
      flushSynchronization: vi.fn(),
      initialCheckpoint: null,
      session,
      writeLatest,
    })
    const states: boolean[] = []
    service.subscribe((dirty) => states.push(dirty))

    session.commitSource({ markdown: 'changed', origin: 'cherry-source' })
    session.commitSource({ markdown: 'baseline', origin: 'cherry-source' })
    expect(states).toEqual([true, false])
    expect(writeLatest).not.toHaveBeenCalled()

    session.commitSource({ markdown: 'download-only', origin: 'cherry-source' })
    const downloaded = session.snapshot().markdown
    expect(downloaded).toBe('download-only')
    expect(service.dirty()).toBe(true)
    expect(writeLatest).not.toHaveBeenCalled()
    service.destroy()
  })
})
