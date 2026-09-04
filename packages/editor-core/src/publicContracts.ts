/** Framework-neutral contracts shared by the editor, renderers, and host shells. */
export const SHARED_CONTRACT_VERSION = '1.0.0' as const

export type EditorMode = 'preview' | 'source' | 'visual'

export type MutationOrigin =
  | 'cherry-source'
  | 'clear'
  | 'checkpoint-restore'
  | 'import'
  | 'reset'
  | 'search-replace'
  | 'tiptap-visual'
  | 'toolbar-command'

export type WholeSourceMutationOrigin = Extract<MutationOrigin, 'cherry-source' | 'checkpoint-restore' | 'clear' | 'import' | 'reset'>

export interface DocumentSnapshot {
  readonly documentId: string
  readonly markdown: string
  readonly revision: number
}

export interface CommitSourceInput {
  readonly markdown: string
  readonly origin: WholeSourceMutationOrigin
  readonly transactionId?: string
}

export interface SourcePatch {
  readonly codecId: string
  readonly expected: string
  readonly from: number
  readonly replacement: string
  readonly to: number
}

export interface PatchPlan {
  readonly baseRevision: number
  readonly patches: readonly SourcePatch[]
  readonly transactionId: string
}

export type PatchPlanRejectionCode =
  | 'EMPTY_PATCH_PLAN'
  | 'EXPECTED_SOURCE_MISMATCH'
  | 'INVALID_CODEC_ID'
  | 'INVALID_EXPECTED_SOURCE'
  | 'INVALID_RANGE'
  | 'INVALID_REPLACEMENT'
  | 'INVALID_TRANSACTION_ID'
  | 'OVERLAPPING_RANGES'
  | 'STALE_REVISION'

export interface CommitAcknowledgement {
  readonly changed: boolean
  readonly documentId: string
  readonly origin: MutationOrigin
  readonly previousRevision: number
  readonly revision: number
  readonly transactionId?: string
}

export interface DocumentChange {
  readonly acknowledgement: CommitAcknowledgement
  readonly current: DocumentSnapshot
  readonly previous: DocumentSnapshot
}

export type DocumentSubscriber = (change: DocumentChange) => void
