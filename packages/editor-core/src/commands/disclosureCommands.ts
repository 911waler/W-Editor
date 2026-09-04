import {
  disclosureStarterSource,
  parseDisclosureAt,
  validateDisclosureSource,
  type DisclosureCommandId,
  type DisclosureModel,
  type ValidationResult,
} from '../codecs'
import type { CommitAcknowledgement, DocumentSession, DocumentSnapshot, PatchPlan } from '../core'

export interface DisclosureCommandPlan {
  readonly plan: PatchPlan
  readonly selection: Readonly<{ from: number; to: number }>
  readonly source: string
}

function containingDisclosure(
  markdown: string,
  selection: Readonly<{ from: number; to: number }>,
): DisclosureModel | null {
  let offset = 0
  while (offset < markdown.length) {
    const model = parseDisclosureAt(markdown, offset)
    if (model !== null) {
      if (selection.from >= model.sourceSpan.from && selection.to <= model.sourceSpan.to) return model
      offset = model.sourceSpan.to
      continue
    }
    const next = markdown.indexOf('\n', offset)
    if (next === -1) break
    offset = next + 1
  }
  return null
}

export function disclosureAtSelection(
  markdown: string,
  selection: Readonly<{ from: number; to: number }>,
): DisclosureModel | null {
  return containingDisclosure(markdown, {
    from: Math.min(selection.from, selection.to),
    to: Math.max(selection.from, selection.to),
  })
}

export function createDisclosureCommandPlan(
  snapshot: DocumentSnapshot,
  selection: Readonly<{ from: number; to: number }>,
  commandId: DisclosureCommandId,
  draftSource: string,
  transactionId: string,
): DisclosureCommandPlan {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  if (from < 0 || to > snapshot.markdown.length) throw new RangeError('Disclosure selection is outside the current Markdown snapshot.')
  const validation = validateDisclosureSource(commandId, draftSource)
  if (!validation.valid) throw new RangeError(validation.message)
  const existing = containingDisclosure(snapshot.markdown, { from, to })
  const expectedKind = commandId === 'layout.tabs' ? 'tabs' : 'accordion'
  const replaceExisting = existing?.kind === expectedKind
  const lineEndCandidate = snapshot.markdown.indexOf('\n', from)
  const insertionPoint = lineEndCandidate === -1 ? snapshot.markdown.length : lineEndCandidate
  const patchFrom = replaceExisting ? existing.sourceSpan.from : insertionPoint
  const patchTo = replaceExisting ? existing.sourceSpan.to : insertionPoint
  const replacement = replaceExisting || snapshot.markdown.length === 0 ? draftSource : `\n\n${draftSource}`
  return Object.freeze({
    plan: Object.freeze({
      baseRevision: snapshot.revision,
      patches: Object.freeze([Object.freeze({
        codecId: `layout-${expectedKind}`,
        expected: snapshot.markdown.slice(patchFrom, patchTo),
        from: patchFrom,
        replacement,
        to: patchTo,
      })]),
      transactionId,
    }),
    selection: Object.freeze({ from: patchFrom, to: patchFrom + replacement.length }),
    source: draftSource,
  })
}

export type DisclosureDraftApplyResult =
  | Readonly<{ acknowledgement: CommitAcknowledgement; kind: 'applied' }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'invalid'; validation: Exclude<ValidationResult, { readonly valid: true }> }>

export interface DisclosureDraft {
  readonly apply: () => DisclosureDraftApplyResult
  readonly cancel: () => DisclosureDraftApplyResult
  readonly source: () => string
  readonly update: (source: string) => ValidationResult
  readonly validation: () => ValidationResult
}

export function createDisclosureDraft(input: {
  readonly commandId: DisclosureCommandId
  readonly selection: Readonly<{ from: number; to: number }>
  readonly session: DocumentSession
  readonly transactionId: string
}): DisclosureDraft {
  const initial = disclosureAtSelection(input.session.snapshot().markdown, input.selection)
  let source = initial === null ? disclosureStarterSource(input.commandId) : initial.source
  let currentValidation = validateDisclosureSource(input.commandId, source)
  return Object.freeze({
    apply: () => {
      if (!currentValidation.valid) return Object.freeze({ kind: 'invalid' as const, validation: currentValidation })
      const plan = createDisclosureCommandPlan(
        input.session.snapshot(),
        input.selection,
        input.commandId,
        source,
        input.transactionId,
      )
      return Object.freeze({
        acknowledgement: input.session.commitPatchPlan(plan.plan, 'toolbar-command'),
        kind: 'applied' as const,
      })
    },
    cancel: () => Object.freeze({ kind: 'cancelled' as const }),
    source: () => source,
    update: (nextSource: string) => {
      source = nextSource
      currentValidation = validateDisclosureSource(input.commandId, source)
      return currentValidation
    },
    validation: () => currentValidation,
  })
}
