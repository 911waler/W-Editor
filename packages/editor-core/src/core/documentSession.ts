import type {
  CommitAcknowledgement,
  CommitSourceInput,
  DocumentSnapshot,
  DocumentSubscriber,
  MutationOrigin,
  PatchPlan,
  PatchPlanRejectionCode,
} from '../publicContracts'

export type {
  CommitAcknowledgement,
  CommitSourceInput,
  DocumentChange,
  DocumentSnapshot,
  DocumentSubscriber,
  MutationOrigin,
  PatchPlan,
  PatchPlanRejectionCode,
  SourcePatch,
  WholeSourceMutationOrigin,
} from '../publicContracts'

export class PatchPlanRejectedError extends Error {
  readonly code: PatchPlanRejectionCode
  readonly patchIndex?: number

  constructor(code: PatchPlanRejectionCode, message: string, patchIndex?: number) {
    super(message)
    this.name = 'PatchPlanRejectedError'
    this.code = code
    if (patchIndex !== undefined) {
      this.patchIndex = patchIndex
    }
  }
}

function snapshot(documentId: string, markdown: string, revision: number): DocumentSnapshot {
  return Object.freeze({ documentId, markdown, revision })
}

export class DocumentSession {
  readonly #subscribers = new Set<DocumentSubscriber>()
  #current: DocumentSnapshot

  constructor(initial: { readonly documentId: string; readonly markdown: string; readonly revision?: number }) {
    const revision = initial.revision ?? 0
    if (!Number.isInteger(revision) || revision < 0) throw new TypeError('Initial document revision must be a non-negative integer.')
    this.#current = snapshot(initial.documentId, initial.markdown, revision)
  }

  snapshot(): DocumentSnapshot {
    return this.#current
  }

  subscribe(subscriber: DocumentSubscriber): () => void {
    this.#subscribers.add(subscriber)
    return () => {
      this.#subscribers.delete(subscriber)
    }
  }

  commitSource(input: CommitSourceInput): CommitAcknowledgement {
    return this.#commit(input.markdown, input.origin, input.transactionId)
  }

  #commit(markdown: string, origin: MutationOrigin, transactionId?: string): CommitAcknowledgement {
    const previous = this.#current
    const changed = markdown !== previous.markdown
    const acknowledgement = Object.freeze({
      changed,
      documentId: previous.documentId,
      origin,
      previousRevision: previous.revision,
      revision: changed ? previous.revision + 1 : previous.revision,
      ...(transactionId === undefined ? {} : { transactionId }),
    })

    if (!changed) {
      return acknowledgement
    }

    const current = snapshot(previous.documentId, markdown, acknowledgement.revision)
    this.#current = current
    const change = Object.freeze({ acknowledgement, current, previous })
    for (const subscriber of this.#subscribers) {
      subscriber(change)
    }
    return acknowledgement
  }

  commitPatchPlan(
    plan: PatchPlan,
    origin: Extract<MutationOrigin, 'search-replace' | 'tiptap-visual' | 'toolbar-command'> = 'tiptap-visual',
  ): CommitAcknowledgement {
    const markdown = this.#applyPatchPlan(plan)
    return this.#commit(markdown, origin, plan.transactionId)
  }

  previewPatchPlan(plan: PatchPlan): string {
    return this.#applyPatchPlan(plan)
  }

  #applyPatchPlan(plan: PatchPlan): string {
    const current = this.#current
    if (plan.baseRevision !== current.revision) {
      throw new PatchPlanRejectedError(
        'STALE_REVISION',
        `Patch plan revision ${plan.baseRevision} does not match current revision ${current.revision}.`,
      )
    }
    if (typeof plan.transactionId !== 'string' || plan.transactionId.length === 0) {
      throw new PatchPlanRejectedError('INVALID_TRANSACTION_ID', 'Patch plans require a transaction identity.')
    }
    if (!Array.isArray(plan.patches) || plan.patches.length === 0) {
      throw new PatchPlanRejectedError('EMPTY_PATCH_PLAN', 'Patch plans require at least one source patch.')
    }

    const indexedPatches = plan.patches.map((patch, patchIndex) => {
      if (!Number.isInteger(patch.from) || !Number.isInteger(patch.to) || patch.from < 0 || patch.to < patch.from || patch.to > current.markdown.length) {
        throw new PatchPlanRejectedError('INVALID_RANGE', `Patch ${patchIndex} has an invalid source range.`, patchIndex)
      }
      if (typeof patch.expected !== 'string') {
        throw new PatchPlanRejectedError('INVALID_EXPECTED_SOURCE', `Patch ${patchIndex} has an invalid expected source value.`, patchIndex)
      }
      if (typeof patch.replacement !== 'string') {
        throw new PatchPlanRejectedError('INVALID_REPLACEMENT', `Patch ${patchIndex} has an invalid replacement value.`, patchIndex)
      }
      if (typeof patch.codecId !== 'string' || patch.codecId.length === 0) {
        throw new PatchPlanRejectedError('INVALID_CODEC_ID', `Patch ${patchIndex} requires a responsible codec.`, patchIndex)
      }
      if (current.markdown.slice(patch.from, patch.to) !== patch.expected) {
        throw new PatchPlanRejectedError(
          'EXPECTED_SOURCE_MISMATCH',
          `Patch ${patchIndex} does not match the current source substring.`,
          patchIndex,
        )
      }
      return { patch, patchIndex }
    })

    const ascending = [...indexedPatches].sort((left, right) => left.patch.from - right.patch.from || left.patch.to - right.patch.to)
    for (let index = 1; index < ascending.length; index += 1) {
      const previous = ascending[index - 1]
      const candidate = ascending[index]
      if (previous !== undefined && candidate !== undefined && (candidate.patch.from < previous.patch.to || candidate.patch.from === previous.patch.from)) {
        throw new PatchPlanRejectedError('OVERLAPPING_RANGES', 'Patch plan source ranges overlap.', candidate.patchIndex)
      }
    }

    let markdown = current.markdown
    const descending = [...indexedPatches].sort((left, right) => right.patch.from - left.patch.from || right.patch.to - left.patch.to)
    for (const { patch } of descending) {
      markdown = `${markdown.slice(0, patch.from)}${patch.replacement}${markdown.slice(patch.to)}`
    }

    return markdown
  }
}
