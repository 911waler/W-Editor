import type { DocumentSnapshot, EditorMode } from '../publicContracts'

export type { EditorMode } from '../publicContracts'

export interface PreparedModeActivation {
  readonly mode: EditorMode
  readonly revision: number
  readonly activate: () => void
  readonly discard: () => void
}

export interface ModeAdapter {
  readonly mode: EditorMode
  readonly deactivate: () => void
  readonly prepare: (snapshot: DocumentSnapshot) => PreparedModeActivation | Promise<PreparedModeActivation>
}

export type CheckpointKind = 'manual-save' | 'pre-destructive-replace' | 'pre-mode-switch'

export interface CheckpointWrite {
  readonly kind: CheckpointKind
  readonly snapshot: DocumentSnapshot
}

export interface CheckpointRepository {
  readonly writeLatest: (checkpoint: CheckpointWrite) => void | Promise<void>
}

export function activatePreparedMode(current: ModeAdapter, prepared: PreparedModeActivation): void {
  current.deactivate()
  prepared.activate()
}
