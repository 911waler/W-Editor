import type { CommitAcknowledgement } from '@w-editor/editor-core'
import type { PersistedSnapshotV1 } from './localDocumentRepository'

export type RestorableCheckpointKind = 'pre-destructive-replace' | 'pre-mode-switch'

export interface CheckpointRestoreAdapter {
  readonly restoreCheckpoint: (markdown: string, transactionId: string) => CommitAcknowledgement
}

export interface CheckpointRestoreServiceOptions {
  readonly confirm: (kind: RestorableCheckpointKind, checkpoint: PersistedSnapshotV1) => boolean | Promise<boolean>
  readonly flushPersistence: () => void | Promise<void>
  readonly flushSynchronization: () => void | Promise<void>
  readonly getCheckpoint: (kind: RestorableCheckpointKind) => PersistedSnapshotV1 | null
  readonly restoreAdapter: CheckpointRestoreAdapter
}

export type CheckpointRestoreResult =
  | { readonly changed: false; readonly kind: RestorableCheckpointKind; readonly status: 'cancelled' | 'unavailable' }
  | {
      readonly acknowledgement: CommitAcknowledgement
      readonly changed: boolean
      readonly kind: RestorableCheckpointKind
      readonly status: 'restored'
    }

export class CheckpointRestoreService {
  readonly #options: CheckpointRestoreServiceOptions

  constructor(options: CheckpointRestoreServiceOptions) {
    this.#options = options
  }

  async restore(kind: RestorableCheckpointKind, transactionId: string): Promise<CheckpointRestoreResult> {
    await this.#options.flushSynchronization()
    await this.#options.flushPersistence()
    const checkpoint = this.#options.getCheckpoint(kind)
    if (checkpoint === null) return Object.freeze({ changed: false, kind, status: 'unavailable' })
    if (!await this.#options.confirm(kind, checkpoint)) {
      return Object.freeze({ changed: false, kind, status: 'cancelled' })
    }
    const acknowledgement = this.#options.restoreAdapter.restoreCheckpoint(checkpoint.markdown, transactionId)
    await this.#options.flushPersistence()
    return Object.freeze({ acknowledgement, changed: acknowledgement.changed, kind, status: 'restored' })
  }
}
