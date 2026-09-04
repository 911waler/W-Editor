import {
  DocumentSession,
  SynchronizationStateStore,
  type ActionableOperationFailure,
  type DocumentSnapshot,
  type SynchronizationState,
} from '@w-editor/editor-core'
import { ModeCoordinator } from './modeCoordinator'
import type { CheckpointRepository, EditorMode, ModeAdapter } from '@w-editor/editor-core'

export type AutosaveStatus = 'failed' | 'idle' | 'pending' | 'saved' | 'saving'

export interface AutosaveState {
  readonly failure: ActionableOperationFailure | null
  readonly revision: number | null
  readonly status: AutosaveStatus
}

export interface WorkspaceState {
  readonly activeDocument: DocumentSnapshot
  readonly autosave: AutosaveState
  readonly error: ActionableOperationFailure | null
  readonly manualDirty: boolean
  readonly modalActivity: string | null
  readonly mode: EditorMode
  readonly synchronization: SynchronizationState
}

export interface ApplicationCompositionRootOptions {
  readonly adapters: Readonly<Record<EditorMode, ModeAdapter>>
  readonly checkpoints: CheckpointRepository
  readonly flushRecoveryPersistence: () => void | Promise<void>
  readonly flushSynchronization: () => void | Promise<void>
  readonly initialDocument: { readonly documentId: string; readonly markdown: string; readonly revision?: number }
  readonly initialMode: EditorMode
}

export type WorkspaceSubscriber = (state: WorkspaceState) => void

function freezeAutosave(state: AutosaveState): AutosaveState {
  return Object.freeze({ ...state })
}

function sameAutosaveState(left: AutosaveState, right: AutosaveState): boolean {
  return left.failure === right.failure
    && left.revision === right.revision
    && left.status === right.status
}

export class ApplicationCompositionRoot {
  readonly modeCoordinator: ModeCoordinator
  readonly session: DocumentSession
  readonly synchronization: SynchronizationStateStore
  readonly #subscribers = new Set<WorkspaceSubscriber>()
  readonly #unsubscribe: readonly (() => void)[]
  #autosaveFailure: ActionableOperationFailure | null = null
  #state: WorkspaceState

  constructor(options: ApplicationCompositionRootOptions) {
    this.session = new DocumentSession(options.initialDocument)
    this.synchronization = new SynchronizationStateStore(this.session.snapshot())
    this.modeCoordinator = new ModeCoordinator({
      adapters: options.adapters,
      checkpoints: options.checkpoints,
      flushRecoveryPersistence: options.flushRecoveryPersistence,
      flushSynchronization: options.flushSynchronization,
      initialMode: options.initialMode,
      session: this.session,
      state: this.synchronization,
    })
    this.#state = Object.freeze({
      activeDocument: this.session.snapshot(),
      autosave: freezeAutosave({ failure: null, revision: null, status: 'idle' }),
      error: null,
      manualDirty: false,
      modalActivity: null,
      mode: options.initialMode,
      synchronization: this.synchronization.snapshot(),
    })
    this.#unsubscribe = Object.freeze([
      this.session.subscribe((change) => {
        this.#autosaveFailure = null
        this.#replace({
          activeDocument: change.current,
          autosave: freezeAutosave({ failure: null, revision: change.current.revision, status: 'pending' }),
          manualDirty: true,
        })
      }),
      this.modeCoordinator.subscribe((mode) => this.#replace({ mode: mode.mode })),
      this.synchronization.subscribe((synchronization) => this.#replace({
        error: synchronization.failure ?? this.#autosaveFailure,
        synchronization,
      })),
    ])
  }

  snapshot(): WorkspaceState {
    return this.#state
  }

  subscribe(subscriber: WorkspaceSubscriber): () => void {
    this.#subscribers.add(subscriber)
    return () => {
      this.#subscribers.delete(subscriber)
    }
  }

  setAutosave(autosave: AutosaveState): void {
    this.#autosaveFailure = autosave.failure
    const nextAutosave = freezeAutosave(autosave)
    const nextError = this.#state.synchronization.failure ?? autosave.failure
    if (sameAutosaveState(this.#state.autosave, nextAutosave) && this.#state.error === nextError) return
    this.#replace({
      autosave: nextAutosave,
      error: nextError,
    })
  }

  markManualCheckpointSaved(): void {
    this.#replace({ manualDirty: false })
  }

  setManualDirty(manualDirty: boolean): void {
    this.#replace({ manualDirty })
  }

  setModalActivity(modalActivity: string | null): void {
    this.#replace({ modalActivity })
  }

  clearError(): void {
    this.#autosaveFailure = null
    this.#replace({ error: null })
  }

  destroy(): void {
    for (const unsubscribe of this.#unsubscribe) unsubscribe()
    this.#subscribers.clear()
  }

  #replace(update: Partial<WorkspaceState>): void {
    this.#state = Object.freeze({ ...this.#state, ...update })
    for (const subscriber of this.#subscribers) subscriber(this.#state)
  }
}

export function createApplicationCompositionRoot(
  options: ApplicationCompositionRootOptions,
): ApplicationCompositionRoot {
  return new ApplicationCompositionRoot(options)
}
