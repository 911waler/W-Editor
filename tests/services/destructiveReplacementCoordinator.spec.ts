import { describe, expect, it, vi } from 'vitest'

import { DocumentSession } from '../../src/core'
import { DestructiveReplacementCoordinator } from '../../src/services/destructiveReplacementCoordinator'

function fixture(confirm = vi.fn(() => true)) {
  const events: string[] = []
  const session = new DocumentSession({ documentId: 'welcome', markdown: 'before' })
  const checkpoints = {
    writeLatest: vi.fn(({ snapshot }) => { events.push(`checkpoint:${snapshot.markdown}`) }),
  }
  const coordinator = new DestructiveReplacementCoordinator({
    checkpoints,
    confirm,
    flushComposition: () => { events.push('composition') },
    flushPersistence: () => { events.push('persistence') },
    flushSynchronization: () => { events.push('synchronization') },
    session,
  })
  session.subscribe(({ acknowledgement }) => events.push(`commit:${acknowledgement.origin}`))
  return { checkpoints, coordinator, events, session }
}

describe('DestructiveReplacementCoordinator', () => {
  it.each([
    ['import', '# Imported'],
    ['clear', ''],
    ['reset', '# Initial template'],
  ] as const)('commits confirmed %s as one revision after flush and checkpoint', async (kind, markdown) => {
    const { coordinator, events, session } = fixture()

    const result = await coordinator.execute({ kind, readReplacement: () => markdown, transactionId: `${kind}-1` })

    expect(result).toMatchObject({ changed: true, kind, status: 'committed' })
    expect(session.snapshot()).toEqual({ documentId: 'welcome', markdown, revision: 1 })
    expect(events).toEqual(['composition', 'synchronization', 'persistence', 'checkpoint:before', `commit:${kind}`])
  })

  it('makes cancellation a checkpoint-free and revision-free no-op', async () => {
    const confirm = vi.fn(() => false)
    const { checkpoints, coordinator, session } = fixture(confirm)

    await expect(coordinator.execute({ kind: 'import', readReplacement: () => 'candidate', transactionId: 'cancel' }))
      .resolves.toEqual({ changed: false, kind: 'import', status: 'cancelled' })

    expect(session.snapshot()).toEqual({ documentId: 'welcome', markdown: 'before', revision: 0 })
    expect(checkpoints.writeLatest).not.toHaveBeenCalled()
  })

  it('runs a confirmed pre-commit transition before checkpointing and committing', async () => {
    const { coordinator, events, session } = fixture()

    await expect(coordinator.execute({
      beforeCommit: () => { events.push('before-commit') },
      kind: 'import',
      readReplacement: () => '# Large imported document',
      transactionId: 'large-import',
    })).resolves.toMatchObject({ status: 'committed' })

    expect(events).toEqual([
      'composition',
      'synchronization',
      'persistence',
      'before-commit',
      'checkpoint:before',
      'commit:import',
    ])
    expect(session.snapshot().markdown).toBe('# Large imported document')
  })

  it('does not run a pre-commit transition when replacement is cancelled', async () => {
    const { coordinator, events } = fixture(vi.fn(() => false))

    await coordinator.execute({
      beforeCommit: () => { events.push('before-commit') },
      kind: 'import',
      readReplacement: () => '# Cancelled import',
      transactionId: 'cancelled-large-import',
    })

    expect(events).toEqual(['composition', 'synchronization', 'persistence'])
  })

  it('does not confirm, checkpoint, or commit when reading the candidate fails', async () => {
    const confirm = vi.fn(() => true)
    const { checkpoints, coordinator, session } = fixture(confirm)
    const failure = new Error('file read failed')

    await expect(coordinator.execute({
      kind: 'import',
      readReplacement: async () => { throw failure },
      transactionId: 'bad-file',
    })).rejects.toBe(failure)

    expect(confirm).not.toHaveBeenCalled()
    expect(checkpoints.writeLatest).not.toHaveBeenCalled()
    expect(session.snapshot().revision).toBe(0)
  })

  it('blocks replacement when checkpoint persistence fails', async () => {
    const { checkpoints, coordinator, session } = fixture()
    const failure = new Error('checkpoint quota failed')
    checkpoints.writeLatest.mockImplementationOnce(() => { throw failure })

    await expect(coordinator.execute({ kind: 'clear', readReplacement: () => '', transactionId: 'blocked' }))
      .rejects.toBe(failure)

    expect(session.snapshot()).toEqual({ documentId: 'welcome', markdown: 'before', revision: 0 })
  })
})
