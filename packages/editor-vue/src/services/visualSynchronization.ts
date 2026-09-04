import {
  BoundedScheduler,
  type CommitAcknowledgement,
  type DocumentSession,
  type OperationMetadata,
  type PatchPlan,
  type SourcePatch,
  type SynchronizationStateStore,
} from '@w-editor/editor-core'
import type { ProjectionMap } from '@w-editor/editor-core'

export interface VisualPatchBatch {
  readonly plan: PatchPlan
  readonly baseMarkdown?: string
  readonly sourceAfter?: string
  readonly sourceBefore?: string
  readonly transactionIds: readonly string[]
}

export interface VisualSynchronizationAcknowledgement {
  readonly acknowledgement: CommitAcknowledgement
  readonly projectionMap?: ProjectionMap
  readonly snapshot: ReturnType<DocumentSession['snapshot']>
  readonly transactionIds: readonly string[]
}

export interface VisualPatchCommitResult {
  readonly acknowledgement: CommitAcknowledgement
  readonly map?: ProjectionMap
}

export interface VisualSynchronizationServiceOptions {
  readonly commit?: (plan: PatchPlan) => CommitAcknowledgement | VisualPatchCommitResult
  readonly onAcknowledgement?: (acknowledgement: VisualSynchronizationAcknowledgement) => void
  readonly session: DocumentSession
  readonly state: SynchronizationStateStore
}

export interface VisualTransactionRejection {
  readonly failure: unknown
  readonly operationId: string
  readonly recover: () => void | Promise<void>
}

export class UnsafeVisualPatchCoalescenceError extends Error {
  readonly code = 'UNSAFE_VISUAL_PATCH_COALESCENCE'

  constructor(message: string) {
    super(message)
    this.name = 'UnsafeVisualPatchCoalescenceError'
  }
}

function freezesPatch(patch: SourcePatch): SourcePatch {
  return Object.freeze({ ...patch })
}

function overlaps(left: SourcePatch, right: SourcePatch): boolean {
  if (left.from === left.to) return left.from >= right.from && left.from <= right.to
  if (right.from === right.to) return right.from >= left.from && right.from <= left.to
  return left.from < right.to && right.from < left.to
}

function contains(outer: SourcePatch, inner: SourcePatch): boolean {
  return outer.from <= inner.from && outer.to >= inner.to
}

function sameRange(left: SourcePatch, right: SourcePatch): boolean {
  return left.from === right.from && left.to === right.to
}

interface SourcePiece {
  readonly baseFrom: number
  readonly baseTo: number
  readonly changed: boolean
  readonly codecId?: string
  readonly text: string
}

function sourceFromPieces(pieces: readonly SourcePiece[]): string {
  return pieces.map((piece) => piece.text).join('')
}

function pieceCodecId(left: SourcePiece, right: SourcePiece): string | undefined {
  if (left.codecId === undefined) return right.codecId
  if (right.codecId === undefined || left.codecId === right.codecId) return left.codecId
  return 'tiptap-visual-batch'
}

function mergePieces(pieces: readonly SourcePiece[]): SourcePiece[] {
  const merged: SourcePiece[] = []
  for (const piece of pieces) {
    const previous = merged.at(-1)
    if (previous === undefined) {
      merged.push(piece)
      continue
    }
    const canMergeUnchanged = !previous.changed
      && !piece.changed
      && previous.baseTo === piece.baseFrom
    const canMergeChanged = previous.changed && piece.changed
      && piece.baseFrom <= previous.baseTo
    if (!canMergeUnchanged && !canMergeChanged) {
      merged.push(piece)
      continue
    }
    const codecId = pieceCodecId(previous, piece)
    merged[merged.length - 1] = Object.freeze({
      baseFrom: Math.min(previous.baseFrom, piece.baseFrom),
      baseTo: Math.max(previous.baseTo, piece.baseTo),
      changed: previous.changed || piece.changed,
      ...(codecId === undefined ? {} : { codecId }),
      text: `${previous.text}${piece.text}`,
    })
  }
  return merged
}

function splitPiecesAt(pieces: SourcePiece[], position: number): void {
  if (position <= 0 || position >= sourceFromPieces(pieces).length) return
  let cursor = 0
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index]
    if (piece === undefined) continue
    const next = cursor + piece.text.length
    if (position <= cursor || position >= next) {
      cursor = next
      continue
    }
    const offset = position - cursor
    const leftBaseTo = piece.changed
      ? piece.baseTo
      : piece.baseFrom + offset
    const rightBaseFrom = piece.changed
      ? piece.baseFrom
      : leftBaseTo
    const left = {
      baseFrom: piece.baseFrom,
      baseTo: leftBaseTo,
      changed: piece.changed,
      text: piece.text.slice(0, offset),
    }
    const right = {
      baseFrom: rightBaseFrom,
      baseTo: piece.baseTo,
      changed: piece.changed,
      text: piece.text.slice(offset),
    }
    pieces.splice(index, 1,
      Object.freeze(piece.codecId === undefined ? left : { ...left, codecId: piece.codecId }),
      Object.freeze(piece.codecId === undefined ? right : { ...right, codecId: piece.codecId }),
    )
    return
  }
}

function baseBoundaryAt(pieces: readonly SourcePiece[], position: number): number {
  let cursor = 0
  for (const piece of pieces) {
    const next = cursor + piece.text.length
    if (position < next) {
      return piece.changed
        ? piece.baseFrom
        : piece.baseFrom + Math.max(0, position - cursor)
    }
    if (position === next) return piece.baseTo
    cursor = next
  }
  return pieces.at(-1)?.baseTo ?? 0
}

function applySourcePatch(pieces: SourcePiece[], patch: SourcePatch): void {
  const current = sourceFromPieces(pieces)
  if (current.slice(patch.from, patch.to) !== patch.expected) {
    throw new UnsafeVisualPatchCoalescenceError('A visual patch does not match the pending optimistic source.')
  }
  splitPiecesAt(pieces, patch.to)
  splitPiecesAt(pieces, patch.from)
  let cursor = 0
  let fromIndex = pieces.length
  let toIndex = pieces.length
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index]
    if (piece === undefined) continue
    const next = cursor + piece.text.length
    if (patch.from === cursor) fromIndex = index
    if (patch.to === cursor) {
      toIndex = index
      break
    }
    cursor = next
  }
  if (patch.from === patch.to) {
    fromIndex = pieces.length
    toIndex = pieces.length
    cursor = 0
    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index]
      if (piece === undefined) continue
      if (patch.from <= cursor + piece.text.length) {
        fromIndex = index + (patch.from === cursor + piece.text.length ? 1 : 0)
        toIndex = fromIndex
        break
      }
      cursor += piece.text.length
    }
  }
  if (fromIndex > pieces.length || toIndex > pieces.length || toIndex < fromIndex) {
    throw new UnsafeVisualPatchCoalescenceError('A visual patch range could not be mapped to the pending optimistic source.')
  }
  const removed = pieces.slice(fromIndex, toIndex)
  const baseFrom = removed.length === 0
    ? baseBoundaryAt(pieces, patch.from)
    : Math.min(...removed.map((piece) => piece.baseFrom))
  const baseTo = removed.length === 0
    ? baseFrom
    : Math.max(...removed.map((piece) => piece.baseTo))
  const replacement: SourcePiece = Object.freeze({
    baseFrom,
    baseTo,
    changed: true,
    codecId: patch.codecId,
    text: patch.replacement,
  })
  pieces.splice(fromIndex, toIndex - fromIndex, replacement)
  pieces.splice(0, pieces.length, ...mergePieces(pieces))
}

function applySourcePatches(source: string, patches: readonly SourcePatch[]): string | null {
  let result = source
  for (const patch of [...patches].sort((left, right) => right.from - left.from || right.to - left.to)) {
    if (result.slice(patch.from, patch.to) !== patch.expected) return null
    result = `${result.slice(0, patch.from)}${patch.replacement}${result.slice(patch.to)}`
  }
  return result
}

function rebaseVisualRecoveryPlan(plan: PatchPlan, sourceBefore: string): PatchPlan {
  const patch = plan.patches.length === 1 ? plan.patches[0] : undefined
  if (patch?.codecId !== 'tiptap-visual-recovery') return plan
  return Object.freeze({
    ...plan,
    patches: Object.freeze([Object.freeze({
      ...patch,
      expected: sourceBefore,
      from: 0,
      to: sourceBefore.length,
    })]),
  })
}

function composedSourcePatches(
  baseMarkdown: string,
  sourceBefore: string,
  sourceAfter: string,
  pendingPatches: readonly SourcePatch[],
  nextPatches: readonly SourcePatch[],
): readonly SourcePatch[] {
  const pieces: SourcePiece[] = [Object.freeze({
    baseFrom: 0,
    baseTo: baseMarkdown.length,
    changed: false,
    text: baseMarkdown,
  })]
  for (const patch of [...pendingPatches].sort((left, right) => right.from - left.from || right.to - left.to)) {
    applySourcePatch(pieces, patch)
  }
  if (sourceFromPieces(pieces) !== sourceBefore) {
    throw new UnsafeVisualPatchCoalescenceError('The pending visual patches did not produce the expected optimistic source.')
  }
  for (const patch of [...nextPatches].sort((left, right) => right.from - left.from || right.to - left.to)) {
    applySourcePatch(pieces, patch)
  }
  if (sourceFromPieces(pieces) !== sourceAfter) {
    throw new UnsafeVisualPatchCoalescenceError('The composed visual patches did not produce the pending optimistic source.')
  }

  const result: SourcePatch[] = []
  let baseCursor = 0
  let hunk: { codecId: string; from: number; replacement: string; to: number } | null = null
  const flush = (): void => {
    if (hunk === null) return
    result.push(Object.freeze({
      codecId: hunk.codecId,
      expected: baseMarkdown.slice(hunk.from, hunk.to),
      from: hunk.from,
      replacement: hunk.replacement,
      to: hunk.to,
    }))
    hunk = null
  }
  for (const piece of pieces) {
    if (piece.changed) {
      const from = Math.min(baseCursor, piece.baseFrom)
      const to = Math.max(baseCursor, piece.baseTo)
      if (hunk === null) {
        hunk = { codecId: piece.codecId ?? 'tiptap-visual-batch', from, replacement: piece.text, to }
      } else {
        hunk.to = Math.max(hunk.to, to)
        hunk.replacement += piece.text
        if (piece.codecId !== undefined && hunk.codecId !== piece.codecId) hunk.codecId = 'tiptap-visual-batch'
      }
      baseCursor = Math.max(baseCursor, piece.baseTo)
      continue
    }
    if (piece.baseFrom > baseCursor) {
      if (hunk === null) {
        hunk = { codecId: 'tiptap-visual-batch', from: baseCursor, replacement: '', to: piece.baseFrom }
      } else {
        hunk.to = piece.baseFrom
      }
    }
    if (hunk !== null) flush()
    baseCursor = Math.max(baseCursor, piece.baseTo)
  }
  if (baseCursor < baseMarkdown.length) {
    if (hunk === null) hunk = { codecId: 'tiptap-visual-batch', from: baseCursor, replacement: '', to: baseMarkdown.length }
    else hunk.to = baseMarkdown.length
  }
  flush()
  return Object.freeze(result)
}

function mergePatches(pending: readonly SourcePatch[], next: readonly SourcePatch[]): readonly SourcePatch[] {
  let merged = pending.map(freezesPatch)
  for (const nextPatchValue of next) {
    const nextPatch = freezesPatch(nextPatchValue)
    const intersecting = merged.filter((candidate) => overlaps(candidate, nextPatch))
    for (const candidate of intersecting) {
      if (sameRange(candidate, nextPatch)) {
        if (candidate.codecId !== nextPatch.codecId || candidate.expected !== nextPatch.expected) {
          throw new UnsafeVisualPatchCoalescenceError('Equal visual patch ranges disagree about their codec or expected source.')
        }
        merged = merged.filter((value) => value !== candidate)
        merged.push(nextPatch)
        continue
      }
      if (!contains(nextPatch, candidate)) {
        throw new UnsafeVisualPatchCoalescenceError('A later visual patch does not safely supersede an overlapping pending range.')
      }
    }
    merged = merged.filter((candidate) => !overlaps(candidate, nextPatch))
    merged.push(nextPatch)
  }
  merged.sort((left, right) => left.from - right.from || left.to - right.to)
  return Object.freeze(merged)
}

function freezeBatch(batch: VisualPatchBatch): VisualPatchBatch {
  return Object.freeze({
    ...(batch.baseMarkdown === undefined ? {} : { baseMarkdown: batch.baseMarkdown }),
    plan: Object.freeze({
      ...batch.plan,
      patches: Object.freeze(batch.plan.patches.map(freezesPatch)),
    }),
    ...(batch.sourceAfter === undefined ? {} : { sourceAfter: batch.sourceAfter }),
    ...(batch.sourceBefore === undefined ? {} : { sourceBefore: batch.sourceBefore }),
    transactionIds: Object.freeze([...batch.transactionIds]),
  })
}

export function coalesceVisualPatchBatches(pending: VisualPatchBatch, next: VisualPatchBatch): VisualPatchBatch {
  if (pending.plan.baseRevision !== next.plan.baseRevision) {
    throw new UnsafeVisualPatchCoalescenceError('Visual patch plans from different base revisions cannot be coalesced.')
  }
  if (
    pending.baseMarkdown !== undefined
    && pending.sourceAfter !== undefined
    && next.sourceBefore !== undefined
    && next.sourceAfter !== undefined
    && pending.baseMarkdown === next.baseMarkdown
    && pending.sourceAfter === next.sourceBefore
  ) {
    const sourceBefore = pending.sourceAfter ?? next.sourceBefore ?? pending.baseMarkdown
    return freezeBatch({
      baseMarkdown: pending.baseMarkdown,
      plan: {
        baseRevision: pending.plan.baseRevision,
        patches: composedSourcePatches(
          pending.baseMarkdown,
          sourceBefore,
          next.sourceAfter,
          pending.plan.patches,
          next.plan.patches,
        ),
        transactionId: next.plan.transactionId,
      },
      sourceAfter: next.sourceAfter,
      sourceBefore,
      transactionIds: [...pending.transactionIds, ...next.transactionIds],
    })
  }
  return freezeBatch({
    plan: {
      baseRevision: pending.plan.baseRevision,
      patches: mergePatches(pending.plan.patches, next.plan.patches),
      transactionId: next.plan.transactionId,
    },
    transactionIds: [...pending.transactionIds, ...next.transactionIds],
  })
}

function operationFor(batch: VisualPatchBatch): OperationMetadata {
  return Object.freeze({
    kind: 'synchronize-visual-patch',
    operationId: batch.transactionIds.at(-1) ?? batch.plan.transactionId,
    requestedRevision: batch.plan.baseRevision,
  })
}

type FailedSynchronizationAttempt =
  | Readonly<{
      batch: VisualPatchBatch
      kind: 'commit'
    }>
  | Readonly<{
      acknowledgement: VisualSynchronizationAcknowledgement
      kind: 'acknowledgement'
      operation: OperationMetadata
    }>
  | Readonly<{
      kind: 'recovery'
      operation: OperationMetadata
      recover: () => void | Promise<void>
    }>

function failureCode(failure: unknown): string {
  if (typeof failure === 'object' && failure !== null && 'code' in failure && typeof failure.code === 'string') {
    return failure.code
  }
  return 'VISUAL_SYNCHRONIZATION_FAILED'
}

function failureMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : 'Visual synchronization failed.'
}

export class VisualSynchronizationService {
  readonly #commit: (plan: PatchPlan) => CommitAcknowledgement | VisualPatchCommitResult
  readonly #onAcknowledgement: ((acknowledgement: VisualSynchronizationAcknowledgement) => void) | undefined
  readonly #scheduler: BoundedScheduler<VisualPatchBatch>
  readonly #session: DocumentSession
  readonly #state: SynchronizationStateStore
  #composing = false
  // The scheduler is the single source-patch queue; this only tracks lifecycle state for the active composition.
  #compositionOperation: OperationMetadata | null = null
  #pendingBaseMarkdown: string | null = null
  #pendingMarkdown: string | null = null
  #failedAttempt: FailedSynchronizationAttempt | null = null
  #compositionFlush: {
    readonly promise: Promise<void>
    readonly reject: (failure: unknown) => void
    readonly resolve: () => void
  } | null = null

  constructor(options: VisualSynchronizationServiceOptions) {
    this.#session = options.session
    this.#state = options.state
    this.#commit = options.commit ?? ((plan) => this.#session.commitPatchPlan(plan))
    this.#onAcknowledgement = options.onAcknowledgement
    this.#scheduler = new BoundedScheduler({
      coalesce: coalesceVisualPatchBatches,
      maxWaitMs: 1_000,
      run: (batch) => this.#synchronize(batch),
      trailingDelayMs: 250,
    })
  }

  request(plan: PatchPlan): void {
    const authorityMarkdown = this.#session.snapshot().markdown
    const sourceBefore = this.#pendingMarkdown ?? authorityMarkdown
    const effectivePlan = rebaseVisualRecoveryPlan(plan, sourceBefore)
    const sourceAfter = applySourcePatches(sourceBefore, effectivePlan.patches)
    const authorityAfter = applySourcePatches(authorityMarkdown, effectivePlan.patches)
    const optimistic = sourceAfter !== null
    const baseMarkdown = this.#pendingBaseMarkdown ?? authorityMarkdown
    if (
      sourceAfter === null
      && authorityAfter === null
      && plan.baseRevision === this.#session.snapshot().revision
    ) {
      const unsafeBatch = freezeBatch({ plan: effectivePlan, transactionIds: [plan.transactionId] })
      const operation = operationFor(unsafeBatch)
      const failure = new UnsafeVisualPatchCoalescenceError('A visual patch does not match the pending optimistic source.')
      this.#fail(operation, failure)
      throw failure
    }
    if (
      optimistic
      && sourceAfter === baseMarkdown
      && this.#pendingMarkdown !== null
      && this.#scheduler.snapshot().status !== 'running'
    ) {
      this.#scheduler.cancel()
      this.#scheduler.clearFailure()
      this.#compositionOperation = null
      this.#failedAttempt = null
      this.#pendingBaseMarkdown = null
      this.#pendingMarkdown = null
      this.#state.succeed(this.#session.snapshot())
      return
    }
    const batch = optimistic
      ? freezeBatch({
          baseMarkdown,
          plan: effectivePlan,
          sourceAfter,
          sourceBefore,
          transactionIds: [plan.transactionId],
        })
      : freezeBatch({ plan: effectivePlan, transactionIds: [plan.transactionId] })
    if (optimistic) {
      this.#pendingBaseMarkdown = baseMarkdown
      this.#pendingMarkdown = sourceAfter
    }
    const operation = operationFor(batch)
    try {
      this.#scheduler.request(batch)
      if (this.#composing) {
        this.#compositionOperation = operation
        this.#state.waitForComposition(operation)
        return
      }
      this.#state.queue(operation)
    } catch (failure) {
      this.#state.fail(operation, {
        actions: ['retry', 'locate-source', 'raw-export'],
        code: failureCode(failure),
        message: failureMessage(failure),
        sourceLocation: null,
      })
      throw failure
    }
  }

  cancel(): boolean {
    const hadCompositionOperation = this.#compositionOperation !== null
    const hadFailedAttempt = this.#failedAttempt !== null
    this.#compositionOperation = null
    this.#failedAttempt = null
    const cancelled = this.#scheduler.cancel()
    const clearedFailure = this.#scheduler.clearFailure()
    this.#pendingBaseMarkdown = null
    this.#pendingMarkdown = null
    return cancelled || clearedFailure || hadCompositionOperation || hadFailedAttempt
  }

  flush(): Promise<void> {
    if (this.#composing) {
      if (this.#compositionFlush === null) {
        let resolve!: () => void
        let reject!: (failure: unknown) => void
        const promise = new Promise<void>((resolvePromise, rejectPromise) => {
          resolve = resolvePromise
          reject = rejectPromise
        })
        this.#compositionFlush = { promise, reject, resolve }
      }
      const operation = this.#compositionOperation === null
        ? Object.freeze({
            kind: 'synchronize-visual-patch' as const,
            operationId: `composition:${this.#session.snapshot().revision}`,
            requestedRevision: this.#session.snapshot().revision,
          })
        : this.#compositionOperation
      this.#state.waitForComposition(operation)
      return this.#compositionFlush.promise
    }
    return this.#scheduler.flush()
  }

  beginComposition(): void {
    if (this.#composing) return
    this.#composing = true
    this.#scheduler.pause()
  }

  endComposition(): void {
    if (!this.#composing) return
    this.#composing = false
    const operation = this.#compositionOperation
    this.#compositionOperation = null
    this.#scheduler.resume()
    if (operation !== null) this.#state.queue(operation)
    const waiting = this.#compositionFlush
    if (waiting !== null) {
      queueMicrotask(() => {
        void this.#scheduler.flush().then(waiting.resolve, waiting.reject).finally(() => {
          if (this.#compositionFlush === waiting) this.#compositionFlush = null
        })
      })
    }
  }

  composing(): boolean {
    return this.#composing
  }

  pending(): boolean {
    return this.#scheduler.snapshot().pending
  }

  retryable(): boolean {
    return this.#failedAttempt !== null
  }

  rejectTransaction(rejection: VisualTransactionRejection): void {
    this.#compositionOperation = null
    this.#scheduler.cancel()
    this.#scheduler.clearFailure()
    const operation = Object.freeze({
      kind: 'synchronize-visual-patch' as const,
      operationId: rejection.operationId,
      requestedRevision: this.#session.snapshot().revision,
    })
    this.#failedAttempt = Object.freeze({
      kind: 'recovery',
      operation,
      recover: rejection.recover,
    })
    this.#pendingBaseMarkdown = null
    this.#pendingMarkdown = null
    this.#fail(operation, rejection.failure)
  }

  async retry(): Promise<void> {
    const failedAttempt = this.#failedAttempt
    if (failedAttempt === null) return
    if (failedAttempt.kind === 'commit') {
      this.#scheduler.request(failedAttempt.batch)
      this.#state.queue(operationFor(failedAttempt.batch))
      await this.#scheduler.flush()
      return
    }

    this.#state.start(failedAttempt.operation)
    try {
      if (failedAttempt.kind === 'acknowledgement') {
        this.#onAcknowledgement?.(failedAttempt.acknowledgement)
        if (this.#failedAttempt === failedAttempt) this.#failedAttempt = null
        this.#scheduler.clearFailure()
        if (!this.#scheduler.snapshot().pending) {
          this.#pendingBaseMarkdown = null
          this.#pendingMarkdown = null
        }
        this.#state.succeed(failedAttempt.acknowledgement.snapshot)
        return
      }
      await failedAttempt.recover()
      if (this.#failedAttempt === failedAttempt) this.#failedAttempt = null
      this.#scheduler.clearFailure()
      this.#state.succeed(this.#session.snapshot())
    } catch (failure) {
      this.#failedAttempt = failedAttempt
      this.#fail(failedAttempt.operation, failure)
      throw failure
    }
  }

  discard(): void {
    this.#scheduler.cancel()
    this.#compositionOperation = null
    this.#failedAttempt = null
    this.#scheduler.clearFailure()
    this.#pendingBaseMarkdown = null
    this.#pendingMarkdown = null
    this.#state.succeed(this.#session.snapshot())
  }

  async #synchronize(batch: VisualPatchBatch): Promise<void> {
    const operation = operationFor(batch)
    this.#state.start(operation)
    let committed: CommitAcknowledgement | VisualPatchCommitResult
    try {
      committed = this.#commit(batch.plan)
    } catch (failure) {
      this.#failedAttempt = Object.freeze({ batch, kind: 'commit' })
      this.#fail(operation, failure)
      throw failure
    }

    const acknowledgement = 'acknowledgement' in committed ? committed.acknowledgement : committed
    const projectionMap = 'acknowledgement' in committed ? committed.map : undefined
    const snapshot = this.#session.snapshot()
    const accepted = Object.freeze({
      acknowledgement,
      ...(projectionMap === undefined ? {} : { projectionMap }),
      snapshot,
      transactionIds: Object.freeze([...batch.transactionIds]),
    })
    try {
      this.#onAcknowledgement?.(accepted)
    } catch (failure) {
      this.#failedAttempt = Object.freeze({
        acknowledgement: accepted,
        kind: 'acknowledgement',
        operation,
      })
      this.#fail(operation, failure)
      throw failure
    }
    this.#failedAttempt = null
    if (!this.#scheduler.snapshot().pending) {
      this.#pendingBaseMarkdown = null
      this.#pendingMarkdown = null
    }
    this.#state.succeed(snapshot)
  }

  #fail(operation: OperationMetadata, failure: unknown): void {
    this.#state.fail(operation, {
      actions: ['retry', 'locate-source', 'raw-export'],
      code: failureCode(failure),
      message: failureMessage(failure),
      sourceLocation: null,
    })
  }
}
