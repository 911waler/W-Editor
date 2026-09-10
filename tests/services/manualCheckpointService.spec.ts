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

it('discards to the saved baseline, replaces recovery, and never manually saves', async () => {
  const session = new DocumentSession({documentId:'article',markdown:'restored draft'})
  const writeLatest=vi.fn()
  const service=new ManualCheckpointService({session,initialBaselineMarkdown:'server saved',initialCheckpoint:null,flushPersistence:vi.fn(),flushSynchronization:vi.fn(),writeLatest})
  expect(service.dirty()).toBe(true)
  session.commitSource({markdown:'more edits',origin:'cherry-source'})
  const persist=vi.fn()
  await service.discard(persist)
  expect(persist).toHaveBeenCalledWith(expect.objectContaining({markdown:'server saved'}))
  expect(session.snapshot().markdown).toBe('server saved')
  expect(service.dirty()).toBe(false)
  expect(writeLatest).not.toHaveBeenCalled()
  service.destroy()
})

it('keeps edits and dirty state when discarding cannot persist the replacement', async () => {
  const session = new DocumentSession({documentId:'article',markdown:'saved'})
  const service=new ManualCheckpointService({session,initialCheckpoint:null,flushPersistence:vi.fn(),flushSynchronization:vi.fn(),writeLatest:vi.fn()})
  session.commitSource({markdown:'edits',origin:'cherry-source'})
  await expect(service.discard(async()=>{throw new Error('offline')})).rejects.toThrow('offline')
  expect(session.snapshot().markdown).toBe('edits')
  expect(service.dirty()).toBe(true)
  service.destroy()
})

it('advances the discard baseline after a successful external publication', async () => {
  const session=new DocumentSession({documentId:'article',markdown:'old'})
  const service=new ManualCheckpointService({session,initialCheckpoint:null,flushPersistence:vi.fn(),flushSynchronization:vi.fn(),writeLatest:vi.fn()})
  session.commitSource({markdown:'published',origin:'cherry-source'})
  service.acceptSavedMarkdown('published')
  expect(service.dirty()).toBe(false)
  session.commitSource({markdown:'unsaved',origin:'cherry-source'})
  await service.discard(vi.fn())
  expect(session.snapshot().markdown).toBe('published')
  service.destroy()
})
