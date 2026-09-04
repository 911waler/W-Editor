import type { DocumentSnapshot } from '../publicContracts'

export type ObservableOperationKind =
  | 'convert-mode'
  | 'persist-recovery'
  | 'render-preview'
  | 'run-integration'
  | 'synchronize-visual-patch'

export interface OperationMetadata {
  readonly kind: ObservableOperationKind
  readonly operationId: string
  readonly requestedRevision: number
}

export type FailureAction = 'locate-source' | 'raw-export' | 'recover' | 'retry'

export interface SourceLocation {
  readonly from: number
  readonly to: number
}

export interface ActionableOperationFailure {
  readonly actions: readonly [FailureAction, ...FailureAction[]]
  readonly code: string
  readonly message: string
  readonly sourceLocation: SourceLocation | null
}

export type SynchronizationStatus = 'failed' | 'pending' | 'running' | 'synchronized' | 'waiting-composition'

export interface SynchronizationState {
  readonly failure: ActionableOperationFailure | null
  readonly lastValidSnapshot: DocumentSnapshot
  readonly operation: OperationMetadata | null
  readonly status: SynchronizationStatus
}

export type SynchronizationSubscriber = (state: SynchronizationState) => void

function freezeOperation(operation: OperationMetadata): OperationMetadata {
  return Object.freeze({ ...operation })
}

function freezeFailure(failure: ActionableOperationFailure): ActionableOperationFailure {
  return Object.freeze({
    ...failure,
    actions: Object.freeze([...failure.actions]) as readonly [FailureAction, ...FailureAction[]],
    sourceLocation: failure.sourceLocation === null ? null : Object.freeze({ ...failure.sourceLocation }),
  })
}

export class SynchronizationStateStore {
  readonly #subscribers = new Set<SynchronizationSubscriber>()
  #state: SynchronizationState

  constructor(lastValidSnapshot: DocumentSnapshot) {
    this.#state = Object.freeze({
      failure: null,
      lastValidSnapshot,
      operation: null,
      status: 'synchronized',
    })
  }

  snapshot(): SynchronizationState {
    return this.#state
  }

  subscribe(subscriber: SynchronizationSubscriber): () => void {
    this.#subscribers.add(subscriber)
    return () => {
      this.#subscribers.delete(subscriber)
    }
  }

  queue(operation: OperationMetadata): void {
    this.#transition({
      failure: null,
      lastValidSnapshot: this.#state.lastValidSnapshot,
      operation: freezeOperation(operation),
      status: 'pending',
    })
  }

  start(operation: OperationMetadata): void {
    this.#transition({
      failure: null,
      lastValidSnapshot: this.#state.lastValidSnapshot,
      operation: freezeOperation(operation),
      status: 'running',
    })
  }

  waitForComposition(operation: OperationMetadata): void {
    this.#transition({
      failure: null,
      lastValidSnapshot: this.#state.lastValidSnapshot,
      operation: freezeOperation(operation),
      status: 'waiting-composition',
    })
  }

  succeed(snapshot: DocumentSnapshot): void {
    this.#transition({
      failure: null,
      lastValidSnapshot: snapshot,
      operation: null,
      status: 'synchronized',
    })
  }

  acceptAuthoritativeSnapshot(snapshot: DocumentSnapshot): void {
    if (
      this.#state.status === 'synchronized'
      && this.#state.failure === null
      && this.#state.operation === null
    ) {
      this.#state = Object.freeze({ ...this.#state, lastValidSnapshot: snapshot })
      return
    }
    this.succeed(snapshot)
  }

  fail(operation: OperationMetadata, failure: ActionableOperationFailure): void {
    if (failure.actions.length === 0) {
      throw new TypeError('An observable operation failure requires at least one actionable response.')
    }
    this.#transition({
      failure: freezeFailure(failure),
      lastValidSnapshot: this.#state.lastValidSnapshot,
      operation: freezeOperation(operation),
      status: 'failed',
    })
  }

  #transition(state: SynchronizationState): void {
    this.#state = Object.freeze(state)
    for (const subscriber of this.#subscribers) {
      subscriber(this.#state)
    }
  }
}
