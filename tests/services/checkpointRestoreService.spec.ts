import { describe, expect, it, vi } from 'vitest'

import { DocumentSession } from '../../src/core'
import { CheckpointRestoreService } from '../../src/services/checkpointRestoreService'

describe('CheckpointRestoreService', () => {
  it('restores as one new revision, autosaves it, and leaves the replaced content recoverable by adapter undo', async () => {
    const session = new DocumentSession({ documentId: 'welcome', markdown: 'current', revision: 5 })
    let undoMarkdown: string | null = null
    const restoreAdapter = {
      restoreCheckpoint: (markdown: string, transactionId: string) => {
        undoMarkdown = session.snapshot().markdown
        return session.commitSource({ markdown, origin: 'checkpoint-restore', transactionId })
      },
      undo: () => {
        if (undoMarkdown === null) return false
        const markdown = undoMarkdown
        undoMarkdown = null
        session.commitSource({ markdown, origin: 'cherry-source', transactionId: 'undo-restore' })
        return true
      },
    }
    const persisted: string[] = []
    const service = new CheckpointRestoreService({
      confirm: () => true,
      flushPersistence: () => { persisted.push(session.snapshot().markdown) },
      flushSynchronization: vi.fn(),
      getCheckpoint: () => ({ markdown: 'protected', revision: 2, savedAt: '2026-01-15T12:00:00.000Z' }),
      restoreAdapter,
    })

    const result = await service.restore('pre-destructive-replace', 'restore-1')

    expect(result).toMatchObject({ changed: true, kind: 'pre-destructive-replace', status: 'restored' })
    expect(session.snapshot()).toEqual({ documentId: 'welcome', markdown: 'protected', revision: 6 })
    expect(persisted).toEqual(['current', 'protected'])
    expect(restoreAdapter.undo()).toBe(true)
    expect(session.snapshot()).toEqual({ documentId: 'welcome', markdown: 'current', revision: 7 })
  })

  it.each([
    ['pre-mode-switch', null, 'unavailable'],
    ['pre-destructive-replace', { markdown: 'protected', revision: 1, savedAt: 'time' }, 'cancelled'],
  ] as const)('makes %s %s restore a revision-free no-op', async (kind, checkpoint, status) => {
    const session = new DocumentSession({ documentId: 'welcome', markdown: 'current' })
    const restoreAdapter = { restoreCheckpoint: vi.fn() }
    const service = new CheckpointRestoreService({
      confirm: () => false,
      flushPersistence: vi.fn(),
      flushSynchronization: vi.fn(),
      getCheckpoint: () => checkpoint,
      restoreAdapter,
    })

    await expect(service.restore(kind, 'no-op')).resolves.toEqual({ changed: false, kind, status })
    expect(restoreAdapter.restoreCheckpoint).not.toHaveBeenCalled()
    expect(session.snapshot().revision).toBe(0)
  })
})
