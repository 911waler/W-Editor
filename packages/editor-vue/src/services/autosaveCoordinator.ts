import { BoundedScheduler, type ActionableOperationFailure, type DocumentSnapshot } from '@w-editor/editor-core'
import type { AutosaveState } from './applicationCompositionRoot'

export interface AutosaveCoordinatorOptions {
  readonly pageLifecycle?: Pick<Window, 'addEventListener' | 'removeEventListener'>
  readonly persist: (snapshot: DocumentSnapshot) => void | Promise<void>
}

export type AutosaveSubscriber = (state: AutosaveState) => void

function autosaveFailure(failure: unknown): ActionableOperationFailure {
  return Object.freeze({
    actions: Object.freeze(['retry', 'raw-export']) as readonly ['retry', 'raw-export'],
    code: typeof failure === 'object' && failure !== null && 'code' in failure && typeof failure.code === 'string'
      ? failure.code
      : 'AUTOSAVE_FAILED',
    message: failure instanceof Error ? failure.message : 'Automatic recovery save failed.',
    sourceLocation: null,
  })
}

export class AutosaveCoordinator {
  readonly #pageLifecycle: Pick<Window, 'addEventListener' | 'removeEventListener'> | undefined
  readonly #persist: AutosaveCoordinatorOptions['persist']
  readonly #scheduler: BoundedScheduler<DocumentSnapshot>
  readonly #subscribers = new Set<AutosaveSubscriber>()
  #lastRequested: DocumentSnapshot | null = null
  #state: AutosaveState = Object.freeze({ failure: null, revision: null, status: 'idle' })

  constructor(options: AutosaveCoordinatorOptions) {
    this.#persist = options.persist
    this.#pageLifecycle = options.pageLifecycle
    this.#scheduler = new BoundedScheduler({
      coalesce: (_pending, next) => next,
      maxWaitMs: 5_000,
      run: (snapshot) => this.#save(snapshot),
      trailingDelayMs: 1_000,
    })
    this.#pageLifecycle?.addEventListener('pagehide', this.#handlePageHide)
  }

  snapshot(): AutosaveState {
    return this.#state
  }

  subscribe(subscriber: AutosaveSubscriber): () => void {
    this.#subscribers.add(subscriber)
    return () => { this.#subscribers.delete(subscriber) }
  }

  request(snapshot: DocumentSnapshot): void {
    this.#lastRequested = snapshot
    this.#replace({ failure: null, revision: snapshot.revision, status: 'pending' })
    this.#scheduler.request(snapshot)
  }

  async retry(): Promise<void> {
    if (this.#lastRequested === null) return
    this.request(this.#lastRequested)
    await this.flush()
  }

  async flush(): Promise<void> {
    try {
      await this.#scheduler.flush()
    } catch (failure) {
      if (this.#state.status !== 'failed') {
        this.#replace({ failure: autosaveFailure(failure), revision: this.#state.revision, status: 'failed' })
      }
      throw failure
    }
  }

  destroy(): void {
    this.#pageLifecycle?.removeEventListener('pagehide', this.#handlePageHide)
    this.#scheduler.cancel()
    this.#subscribers.clear()
  }

  readonly #handlePageHide = (): void => {
    void this.flush().catch(() => {
      // The failed state is already observable and the in-memory document is retained.
    })
  }

  async #save(snapshot: DocumentSnapshot): Promise<void> {
    this.#replace({ failure: null, revision: snapshot.revision, status: 'saving' })
    try {
      await this.#persist(snapshot)
      this.#replace({ failure: null, revision: snapshot.revision, status: 'saved' })
    } catch (failure) {
      this.#replace({ failure: autosaveFailure(failure), revision: snapshot.revision, status: 'failed' })
      throw failure
    }
  }

  #replace(state: AutosaveState): void {
    this.#state = Object.freeze(state)
    for (const subscriber of this.#subscribers) subscriber(this.#state)
  }
}
