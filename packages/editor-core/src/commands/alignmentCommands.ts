import {
  alignmentSource,
  alignmentValue,
  isCompatibleAlignmentBody,
  parseAlignmentAt,
  type AlignmentCommandId,
  type AlignmentModel,
} from '../codecs'
import type { DocumentSnapshot, PatchPlan } from '../core'

export interface AlignmentCommandPlan {
  readonly plan: PatchPlan
  readonly selection: Readonly<{ from: number; to: number }>
}

function containingAlignment(markdown: string, selection: Readonly<{ from: number; to: number }>): AlignmentModel | null {
  let offset = 0
  while (offset < markdown.length) {
    const model = parseAlignmentAt(markdown, offset)
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

function selectedBlockRange(markdown: string, selection: Readonly<{ from: number; to: number }>): Readonly<{ from: number; to: number }> {
  const from = markdown.lastIndexOf('\n', Math.max(0, selection.from - 1)) + 1
  const lineEnd = markdown.indexOf('\n', selection.to)
  return Object.freeze({ from, to: lineEnd === -1 ? markdown.length : lineEnd })
}

export function sourceAlignmentAt(markdown: string, selection: Readonly<{ from: number; to: number }>): AlignmentCommandId | null {
  const model = containingAlignment(markdown, selection)
  return model === null ? null : `align.${model.alignment}`
}

export function sourceAlignmentCompatible(markdown: string, selection: Readonly<{ from: number; to: number }>): boolean {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  if (from < 0 || to > markdown.length) return false
  const existing = containingAlignment(markdown, { from, to })
  if (existing !== null) return isCompatibleAlignmentBody(existing.body)
  const range = selectedBlockRange(markdown, { from, to })
  return isCompatibleAlignmentBody(markdown.slice(range.from, range.to))
}

export function createAlignmentCommandPlan(
  snapshot: DocumentSnapshot,
  selection: Readonly<{ from: number; to: number }>,
  commandId: AlignmentCommandId,
  transactionId: string,
): AlignmentCommandPlan {
  const alignment = alignmentValue(commandId)
  if (alignment === null) throw new RangeError(`Unknown alignment command: ${commandId}.`)
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  if (from < 0 || to > snapshot.markdown.length) throw new RangeError('Alignment selection is outside the current Markdown snapshot.')
  const existing = containingAlignment(snapshot.markdown, { from, to })
  const range = existing?.sourceSpan ?? selectedBlockRange(snapshot.markdown, { from, to })
  const body = existing?.body ?? snapshot.markdown.slice(range.from, range.to)
  const replacement = alignmentSource(alignment, body)
  const bodyOffset = replacement.indexOf('\n') + 1
  return Object.freeze({
    plan: Object.freeze({
      baseRevision: snapshot.revision,
      patches: Object.freeze([Object.freeze({
        codecId: `alignment-${alignment}`,
        expected: snapshot.markdown.slice(range.from, range.to),
        from: range.from,
        replacement,
        to: range.to,
      })]),
      transactionId,
    }),
    selection: Object.freeze({
      from: range.from + bodyOffset,
      to: range.from + bodyOffset + body.length,
    }),
  })
}
