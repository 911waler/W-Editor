import type {
  DocumentSession,
  OperationMetadata,
  SourceLocation,
  SynchronizationStateStore,
} from '@w-editor/editor-core'
import {
  activatePreparedMode,
  type CheckpointRepository,
  type EditorMode,
  type ModeAdapter,
  type PreparedModeActivation,
} from '@w-editor/editor-core'

export interface ModeCoordinatorOptions {
  readonly adapters: Readonly<Record<EditorMode, ModeAdapter>>
  readonly checkpoints: CheckpointRepository
  readonly flushRecoveryPersistence: () => void | Promise<void>
  readonly flushSynchronization: () => void | Promise<void>
  readonly initialMode: EditorMode
  readonly session: DocumentSession
  readonly state: SynchronizationStateStore
}

export interface ActiveModeState {
  readonly mode: EditorMode
  readonly revision: number
}

export interface ModeTransitionResult {
  readonly changed: boolean
  readonly from: EditorMode
  readonly revision: number
  readonly to: EditorMode
}

export type ActiveModeSubscriber = (state: ActiveModeState) => void

export class InvalidPreparedModeActivationError extends Error {
  readonly code = 'INVALID_PREPARED_MODE_ACTIVATION'

  constructor(message: string) {
    super(message)
    this.name = 'InvalidPreparedModeActivationError'
  }
}

function assertPrepared(
  target: EditorMode,
  revision: number,
  prepared: PreparedModeActivation,
): void {
  if (prepared.mode !== target) {
    throw new InvalidPreparedModeActivationError(`Prepared ${prepared.mode} mode cannot activate requested ${target} mode.`)
  }
  if (prepared.revision !== revision) {
    throw new InvalidPreparedModeActivationError(
      `Prepared mode revision ${prepared.revision} does not match authoritative revision ${revision}.`,
    )
  }
}

export class ModeCoordinator {
  readonly #adapters: Readonly<Record<EditorMode, ModeAdapter>>
  readonly #checkpoints: CheckpointRepository
  readonly #flushRecoveryPersistence: () => void | Promise<void>
  readonly #flushSynchronization: () => void | Promise<void>
  readonly #session: DocumentSession
  readonly #subscribers = new Set<ActiveModeSubscriber>()
  readonly #state: SynchronizationStateStore
  #activeMode: EditorMode
  #queue: Promise<void> = Promise.resolve()

  constructor(options: ModeCoordinatorOptions) {
    this.#adapters = options.adapters
    this.#checkpoints = options.checkpoints
    this.#flushRecoveryPersistence = options.flushRecoveryPersistence
    this.#flushSynchronization = options.flushSynchronization
    this.#activeMode = options.initialMode
    this.#session = options.session
    this.#state = options.state
    for (const mode of ['source', 'visual', 'preview'] as const) {
      if (this.#adapters[mode].mode !== mode) {
        throw new TypeError(`Mode adapter registered as ${mode} declares ${this.#adapters[mode].mode}.`)
      }
    }
  }

  activeMode(): EditorMode {
    return this.#activeMode
  }

  snapshot(): ActiveModeState {
    return Object.freeze({ mode: this.#activeMode, revision: this.#session.snapshot().revision })
  }

  subscribe(subscriber: ActiveModeSubscriber): () => void {
    this.#subscribers.add(subscriber)
    return () => {
      this.#subscribers.delete(subscriber)
    }
  }

  request(target: EditorMode): Promise<ModeTransitionResult> {
    const transition = this.#queue.then(
      () => this.#transition(target),
      () => this.#transition(target),
    )
    this.#queue = transition.then(() => undefined, () => undefined)
    return transition
  }

  async #transition(target: EditorMode): Promise<ModeTransitionResult> {
    const from = this.#activeMode
    if (target === from) {
      return Object.freeze({
        changed: false,
        from,
        revision: this.#session.snapshot().revision,
        to: target,
      })
    }

    const operation = Object.freeze({
      kind: 'convert-mode',
      operationId: `mode:${from}->${target}:${this.#session.snapshot().revision}`,
      requestedRevision: this.#session.snapshot().revision,
    }) satisfies OperationMetadata
    this.#state.start(operation)
    let prepared: PreparedModeActivation | null = null
    try {
      await this.#flushSynchronization()
      await this.#flushRecoveryPersistence()
      const snapshot = this.#session.snapshot()
      prepared = await this.#adapters[target].prepare(snapshot)
      assertPrepared(target, snapshot.revision, prepared)
      await this.#checkpoints.writeLatest({ kind: 'pre-mode-switch', snapshot })
      activatePreparedMode(this.#adapters[from], prepared)
      this.#activeMode = target
      this.#state.succeed(snapshot)
      this.#publish()
      return Object.freeze({ changed: true, from, revision: snapshot.revision, to: target })
    } catch (failure) {
      prepared?.discard()
      this.#state.fail(operation, {
        actions: ['retry', 'locate-source', 'raw-export'],
        code: modeFailureCode(failure),
        message: failure instanceof Error ? failure.message : 'Mode conversion failed.',
        sourceLocation: modeFailureLocation(failure),
      })
      throw failure
    }
  }

  #publish(): void {
    const state = this.snapshot()
    for (const subscriber of this.#subscribers) subscriber(state)
  }
}

function modeFailureCode(failure: unknown): string {
  if (typeof failure === 'object' && failure !== null && 'code' in failure && typeof failure.code === 'string') {
    return failure.code
  }
  return 'MODE_CONVERSION_FAILED'
}

function modeFailureLocation(failure: unknown): SourceLocation | null {
  if (typeof failure !== 'object' || failure === null || !('sourceLocation' in failure)) return null
  const location = failure.sourceLocation
  if (
    typeof location !== 'object'
    || location === null
    || !('from' in location)
    || !('to' in location)
    || typeof location.from !== 'number'
    || typeof location.to !== 'number'
  ) return null
  return Object.freeze({ from: location.from, to: location.to })
}
