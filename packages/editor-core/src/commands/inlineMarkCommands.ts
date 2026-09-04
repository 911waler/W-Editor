import { inlineMarkSpec, type InlineMarkCommandId } from '../codecs'
import type { DocumentSnapshot, PatchPlan } from '../core'

export interface InlineMarkSelection {
  readonly from: number
  readonly to: number
}

export interface InlineMarkTogglePlan {
  readonly active: boolean
  readonly plan: PatchPlan
  readonly selection: InlineMarkSelection
}

function normalizedSelection(snapshot: DocumentSnapshot, selection: InlineMarkSelection): InlineMarkSelection {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > snapshot.markdown.length || from === to) {
    throw new RangeError('Inline mark commands require a non-empty selection inside the current Markdown snapshot.')
  }
  return Object.freeze({ from, to })
}

export function createInlineMarkTogglePlan(
  snapshot: DocumentSnapshot,
  selection: InlineMarkSelection,
  commandId: InlineMarkCommandId,
  transactionId: string,
): InlineMarkTogglePlan {
  const spec = inlineMarkSpec(commandId)
  if (spec === null) throw new RangeError(`Unknown inline mark command: ${commandId}.`)
  const selected = normalizedSelection(snapshot, selection)
  const selectedSource = snapshot.markdown.slice(selected.from, selected.to)
  const wrappedSelection = selectedSource.startsWith(spec.open)
    && selectedSource.endsWith(spec.close)
    && selectedSource.length > spec.open.length + spec.close.length
  const surroundedSelection = snapshot.markdown.slice(selected.from - spec.open.length, selected.from) === spec.open
    && snapshot.markdown.slice(selected.to, selected.to + spec.close.length) === spec.close

  let from = selected.from
  let to = selected.to
  let replacement: string
  let nextSelection: InlineMarkSelection
  let active: boolean
  if (wrappedSelection) {
    replacement = selectedSource.slice(spec.open.length, selectedSource.length - spec.close.length)
    nextSelection = Object.freeze({ from, to: from + replacement.length })
    active = false
  } else if (surroundedSelection) {
    from -= spec.open.length
    to += spec.close.length
    replacement = selectedSource
    nextSelection = Object.freeze({ from, to: from + replacement.length })
    active = false
  } else {
    replacement = `${spec.open}${selectedSource}${spec.close}`
    nextSelection = Object.freeze({
      from: from + spec.open.length,
      to: from + spec.open.length + selectedSource.length,
    })
    active = true
  }
  return Object.freeze({
    active,
    plan: Object.freeze({
      baseRevision: snapshot.revision,
      patches: Object.freeze([Object.freeze({
        codecId: spec.codecId,
        expected: snapshot.markdown.slice(from, to),
        from,
        replacement,
        to,
      })]),
      transactionId,
    }),
    selection: nextSelection,
  })
}
