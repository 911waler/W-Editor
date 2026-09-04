import { parseTimelineAt, timelineStarterSource, validateTimelineSource, type TimelineModel, type ValidationResult } from '../codecs'
import type { CommitAcknowledgement, DocumentSession, DocumentSnapshot, PatchPlan } from '../core'

export interface TimelineCommandPlan {
  readonly plan: PatchPlan
  readonly selection: Readonly<{ from: number; to: number }>
  readonly source: string
}

function containingTimeline(markdown: string, selection: Readonly<{ from: number; to: number }>): TimelineModel | null {
  let offset = 0
  while (offset < markdown.length) {
    const model = parseTimelineAt(markdown, offset)
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

export function timelineAtSelection(
  markdown: string,
  selection: Readonly<{ from: number; to: number }>,
): TimelineModel | null {
  return containingTimeline(markdown, {
    from: Math.min(selection.from, selection.to),
    to: Math.max(selection.from, selection.to),
  })
}

export function createTimelineCommandPlan(
  snapshot: DocumentSnapshot,
  selection: Readonly<{ from: number; to: number }>,
  draftSource: string,
  transactionId: string,
): TimelineCommandPlan {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  if (from < 0 || to > snapshot.markdown.length) throw new RangeError('Timeline selection is outside the current Markdown snapshot.')
  const validation = validateTimelineSource(draftSource)
  if (!validation.valid) throw new RangeError(validation.message)
  const existing = containingTimeline(snapshot.markdown, { from, to })
  const lineEndCandidate = snapshot.markdown.indexOf('\n', from)
  const insertionPoint = lineEndCandidate === -1 ? snapshot.markdown.length : lineEndCandidate
  const patchFrom = existing?.sourceSpan.from ?? insertionPoint
  const patchTo = existing?.sourceSpan.to ?? insertionPoint
  const replacement = existing !== null || snapshot.markdown.length === 0 ? draftSource : `\n\n${draftSource}`
  return Object.freeze({
    plan: Object.freeze({
      baseRevision: snapshot.revision,
      patches: Object.freeze([Object.freeze({
        codecId: 'layout-timeline',
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

export type TimelineDraftResult =
  | Readonly<{ acknowledgement: CommitAcknowledgement; kind: 'applied' }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'invalid'; validation: Exclude<ValidationResult, { readonly valid: true }> }>

export interface TimelineDraft {
  readonly apply: () => TimelineDraftResult
  readonly cancel: () => TimelineDraftResult
  readonly source: () => string
  readonly update: (source: string) => ValidationResult
}

export function createTimelineDraft(input: {
  readonly selection: Readonly<{ from: number; to: number }>
  readonly session: DocumentSession
  readonly transactionId: string
}): TimelineDraft {
  const existing = timelineAtSelection(input.session.snapshot().markdown, input.selection)
  let source = existing?.source ?? timelineStarterSource()
  let validation = validateTimelineSource(source)
  return Object.freeze({
    apply: () => {
      if (!validation.valid) return Object.freeze({ kind: 'invalid' as const, validation })
      const plan = createTimelineCommandPlan(input.session.snapshot(), input.selection, source, input.transactionId)
      return Object.freeze({
        acknowledgement: input.session.commitPatchPlan(plan.plan, 'toolbar-command'),
        kind: 'applied' as const,
      })
    },
    cancel: () => Object.freeze({ kind: 'cancelled' as const }),
    source: () => source,
    update: (nextSource: string) => {
      source = nextSource
      validation = validateTimelineSource(source)
      return validation
    },
  })
}
