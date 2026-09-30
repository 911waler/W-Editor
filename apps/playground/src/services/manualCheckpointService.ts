import type { DocumentSession, DocumentSnapshot } from '@w-editor/editor-core'
import type { PersistedSnapshotV1 } from './localDocumentRepository'

export const MANUAL_SAVE_COMMAND_ID = 'manual-save'

export interface ManualCheckpointServiceOptions {
  readonly flushPersistence: () => void | Promise<void>
  readonly flushSynchronization: () => void | Promise<void>
  readonly initialBaselineMarkdown?: string
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
    this.#baselineMarkdown = options.initialBaselineMarkdown ?? options.initialCheckpoint?.markdown ?? options.session.snapshot().markdown
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

  acceptSavedMarkdown(markdown: string): void {
    this.#baselineMarkdown = markdown
    this.#compare(this.#session.snapshot())
  }

  async discard(persist: (snapshot: DocumentSnapshot) => void | Promise<void>): Promise<void> {
    await this.#flushSynchronization()
    await this.#flushPersistence()
    const current = this.#session.snapshot()
    const baselineMarkdown = this.#baselineMarkdown
    // Persist the replacement before changing the live document; failure keeps edits open.
    await persist({ ...current, markdown: baselineMarkdown, revision: current.revision + 1 })
    await this.#flushSynchronization()
    if (this.#session.snapshot().revision !== current.revision || this.#baselineMarkdown !== baselineMarkdown) {
      // A delayed server response must not erase edits made while it was pending.
      await this.#flushPersistence()
      throw new Error('The document changed while discarding; newer changes were kept.')
    }
    this.#session.commitSource({ markdown: baselineMarkdown, origin: 'cherry-source' })
    await this.#flushPersistence()
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
