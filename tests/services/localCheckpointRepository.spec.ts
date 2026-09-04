import { describe, expect, it } from 'vitest'

import { LocalCheckpointRepository } from '../../src/services/localCheckpointRepository'
import { LocalDocumentRepository } from '../../src/services/localDocumentRepository'

describe('LocalCheckpointRepository', () => {
  it('keeps pre-mode-switch and pre-destructive-replace as independent latest-only checkpoints', () => {
    const storage = window.localStorage
    const documents = new LocalDocumentRepository(storage)
    const checkpoints = new LocalCheckpointRepository({ documentId: 'welcome', repository: documents })

    checkpoints.writeLatest({
      kind: 'pre-mode-switch',
      snapshot: { documentId: 'welcome', markdown: 'before mode 1', revision: 1 },
    })
    checkpoints.writeLatest({
      kind: 'pre-destructive-replace',
      snapshot: { documentId: 'welcome', markdown: 'before replace 1', revision: 2 },
    })
    checkpoints.writeLatest({
      kind: 'pre-mode-switch',
      snapshot: { documentId: 'welcome', markdown: 'before mode 2', revision: 3 },
    })

    const stored = documents.readDocument('welcome')
    expect(stored.status).toBe('valid')
    if (stored.status !== 'valid') throw new Error('Expected a valid stored document.')
    expect(stored.value.preModeSwitch?.markdown).toBe('before mode 2')
    expect(stored.value.preDestructiveReplace?.markdown).toBe('before replace 1')
    expect(stored.value.manualCheckpoint).toBeNull()
  })

  it('does not let a manual checkpoint overwrite either recovery boundary', () => {
    const documents = new LocalDocumentRepository(window.localStorage)
    const checkpoints = new LocalCheckpointRepository({ documentId: 'welcome', repository: documents })
    for (const [kind, markdown, revision] of [
      ['pre-mode-switch', 'mode', 1],
      ['pre-destructive-replace', 'replace', 2],
      ['manual-save', 'manual', 3],
    ] as const) {
      checkpoints.writeLatest({ kind, snapshot: { documentId: 'welcome', markdown, revision } })
    }
    const stored = documents.readDocument('welcome')
    if (stored.status !== 'valid') throw new Error('Expected a valid stored document.')
    expect(stored.value).toMatchObject({
      manualCheckpoint: { markdown: 'manual' },
      preDestructiveReplace: { markdown: 'replace' },
      preModeSwitch: { markdown: 'mode' },
    })
  })
})
