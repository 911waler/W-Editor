import type { CommitAcknowledgement, DocumentSession, DocumentSnapshot } from '@w-editor/editor-core'
import type { CheckpointRepository } from '@w-editor/editor-core'

export type DestructiveReplacementKind = 'clear' | 'import' | 'reset'

export interface DestructiveReplacementConfirmation {
  readonly current: DocumentSnapshot
  readonly kind: DestructiveReplacementKind
  readonly replacement: string
}

export interface DestructiveReplacementRequest {
  readonly beforeCommit?: () => void | Promise<void>
  readonly kind: DestructiveReplacementKind
  readonly readReplacement: () => string | Promise<string>
  readonly transactionId: string
}

export interface DestructiveReplacementCoordinatorOptions {
  readonly checkpoints: CheckpointRepository
  readonly confirm: (confirmation: DestructiveReplacementConfirmation) => boolean | Promise<boolean>
  readonly flushComposition: () => void | Promise<void>
  readonly flushPersistence: () => void | Promise<void>
  readonly flushSynchronization: () => void | Promise<void>
  readonly session: DocumentSession
}

export type DestructiveReplacementResult =
  | { readonly changed: false; readonly kind: DestructiveReplacementKind; readonly status: 'cancelled' }
  | {
      readonly acknowledgement: CommitAcknowledgement
      readonly changed: boolean
      readonly kind: DestructiveReplacementKind
      readonly status: 'committed'
    }

export class InvalidReplacementInputError extends Error {
  readonly code = 'INVALID_REPLACEMENT_INPUT'

  constructor() {
    super('Destructive replacement input must be readable Markdown text.')
    this.name = 'InvalidReplacementInputError'
  }
}

export class DestructiveReplacementCoordinator {
  readonly #options: DestructiveReplacementCoordinatorOptions
  #queue: Promise<void> = Promise.resolve()

  constructor(options: DestructiveReplacementCoordinatorOptions) {
    this.#options = options
  }

  execute(request: DestructiveReplacementRequest): Promise<DestructiveReplacementResult> {
    const operation = this.#queue.then(
      () => this.#replace(request),
      () => this.#replace(request),
    )
    this.#queue = operation.then(() => undefined, () => undefined)
    return operation
  }

  async #replace(request: DestructiveReplacementRequest): Promise<DestructiveReplacementResult> {
    await this.#options.flushComposition()
    await this.#options.flushSynchronization()
    await this.#options.flushPersistence()
    const replacement: unknown = await request.readReplacement()
    if (typeof replacement !== 'string') throw new InvalidReplacementInputError()
    const current = this.#options.session.snapshot()
    const confirmed = await this.#options.confirm(Object.freeze({ current, kind: request.kind, replacement }))
    if (!confirmed) return Object.freeze({ changed: false, kind: request.kind, status: 'cancelled' })
    await request.beforeCommit?.()
    await this.#options.checkpoints.writeLatest({ kind: 'pre-destructive-replace', snapshot: current })
    const acknowledgement = this.#options.session.commitSource({
      markdown: replacement,
      origin: request.kind,
      transactionId: request.transactionId,
    })
    return Object.freeze({ acknowledgement, changed: acknowledgement.changed, kind: request.kind, status: 'committed' })
  }
}
