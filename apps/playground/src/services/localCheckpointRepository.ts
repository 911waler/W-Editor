import type { DocumentSnapshot } from '@w-editor/editor-core'
import type { CheckpointRepository, CheckpointWrite } from '@w-editor/editor-core'
import {
  LocalDocumentRepository,
  type DocumentEnvelopeV1,
  type PersistedSnapshotV1,
} from './localDocumentRepository'

export interface LocalCheckpointRepositoryOptions {
  readonly documentId: string
  readonly now?: () => Date
  readonly repository: LocalDocumentRepository
}

function persisted(snapshot: DocumentSnapshot, savedAt: string): PersistedSnapshotV1 {
  return Object.freeze({ markdown: snapshot.markdown, revision: snapshot.revision, savedAt })
}

export class LocalCheckpointRepository implements CheckpointRepository {
  readonly #documentId: string
  readonly #now: () => Date
  readonly #repository: LocalDocumentRepository

  constructor(options: LocalCheckpointRepositoryOptions) {
    this.#documentId = options.documentId
    this.#now = options.now ?? (() => new Date())
    this.#repository = options.repository
  }

  writeLatest(checkpoint: CheckpointWrite): void {
    if (checkpoint.snapshot.documentId !== this.#documentId) {
      throw new TypeError('Checkpoint document identity does not match its repository.')
    }
    const current = this.#repository.readDocument(this.#documentId)
    const nextCheckpoint = persisted(checkpoint.snapshot, this.#now().toISOString())
    const base: DocumentEnvelopeV1 = current.status === 'valid'
      ? current.value
      : Object.freeze({
          autosave: nextCheckpoint,
          documentId: this.#documentId,
          manualCheckpoint: null,
          preDestructiveReplace: null,
          preModeSwitch: null,
          schemaVersion: 1,
          status: Object.freeze({ lastPersistenceFailure: null }),
        })
    const next: DocumentEnvelopeV1 = checkpoint.kind === 'manual-save'
      ? Object.freeze({ ...base, manualCheckpoint: nextCheckpoint })
      : checkpoint.kind === 'pre-mode-switch'
        ? Object.freeze({ ...base, preModeSwitch: nextCheckpoint })
        : Object.freeze({ ...base, preDestructiveReplace: nextCheckpoint })
    this.#repository.writeDocument(next)
  }
}
