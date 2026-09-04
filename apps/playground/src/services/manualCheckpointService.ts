import type { DocumentSession, DocumentSnapshot } from '@w-editor/editor-core'
import type { PersistedSnapshotV1 } from './localDocumentRepository'

export const MANUAL_SAVE_COMMAND_ID = 'manual-save'

export interface ManualCheckpointServiceOptions {
  readonly flushPersistence: () => void | Promise<void>
  readonly flushSynchronization: () => void | Promise<void>
  readonly initialCheckpoint: PersistedSnapshotV1 | null
  readonly now?: () => Date
  readonly session: DocumentSession
  readonly writeLatest: (checkpoint: PersistedSnapshotV1) => void | Promise<void>
}

export type ManualDirtySubscriber = (dirty: boolean) => void

export class ManualCheckpointService {
  readonly #flushPersistence: ManualCheckpointServiceOptions['flushPersistence']
  readonly #flushSynchronization: ManualCheckpointServiceOptions['flushSynchronization']
  readonly #now: () => Date
  readonly #session: DocumentSession
  readonly #subscribers = new Set<ManualDirtySubscriber>()
  readonly #unsubscribe: () => void
  readonly #writeLatest: ManualCheckpointServiceOptions['writeLatest']
  #baselineMarkdown: string
  #checkpoint: PersistedSnapshotV1 | null
  #dirty = false

  constructor(options: ManualCheckpointServiceOptions) {
    this.#flushPersistence = options.flushPersistence
    this.#flushSynchronization = options.flushSynchronization
    this.#now = options.now ?? (() => new Date())
    this.#session = options.session
    this.#writeLatest = options.writeLatest
    this.#checkpoint = options.initialCheckpoint
    this.#baselineMarkdown = options.initialCheckpoint?.markdown ?? options.session.snapshot().markdown
    this.#dirty = options.session.snapshot().markdown !== this.#baselineMarkdown
    this.#unsubscribe = options.session.subscribe(({ current }) => this.#compare(current))
  }

  commandId(): typeof MANUAL_SAVE_COMMAND_ID {
    return MANUAL_SAVE_COMMAND_ID
  }

  checkpoint(): PersistedSnapshotV1 | null {
    return this.#checkpoint
  }

  dirty(): boolean {
    return this.#dirty
  }

  subscribe(subscriber: ManualDirtySubscriber): () => void {
    this.#subscribers.add(subscriber)
    return () => { this.#subscribers.delete(subscriber) }
  }

  async save(): Promise<PersistedSnapshotV1> {
    await this.#flushSynchronization()
    await this.#flushPersistence()
    const current = this.#session.snapshot()
    const checkpoint = Object.freeze({
      markdown: current.markdown,
      revision: current.revision,
      savedAt: this.#now().toISOString(),
    })
    await this.#writeLatest(checkpoint)
    this.#checkpoint = checkpoint
    this.#baselineMarkdown = checkpoint.markdown
    this.#setDirty(false)
    return checkpoint
  }

  destroy(): void {
    this.#unsubscribe()
    this.#subscribers.clear()
  }

  #compare(snapshot: DocumentSnapshot): void {
    this.#setDirty(snapshot.markdown !== this.#baselineMarkdown)
  }

  #setDirty(dirty: boolean): void {
    if (dirty === this.#dirty) return
    this.#dirty = dirty
    for (const subscriber of this.#subscribers) subscriber(dirty)
  }
}
