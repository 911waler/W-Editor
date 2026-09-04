import {
  columnLayoutStarterSource,
  parseColumnLayoutAt,
  validateColumnLayoutSource,
  type ColumnLayoutCommandId,
  type ColumnLayoutModel,
} from '../codecs'
import type { DocumentSnapshot, PatchPlan } from '../core'

export interface ColumnLayoutCommandPlan {
  readonly plan: PatchPlan
  readonly selection: Readonly<{ from: number; to: number }>
  readonly source: string
}

export function columnLayoutAtSelection(
  markdown: string,
  selection: Readonly<{ from: number; to: number }>,
): ColumnLayoutModel | null {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  let offset = 0
  while (offset < markdown.length) {
    const layout = parseColumnLayoutAt(markdown, offset)
    if (layout !== null) {
      if (from >= layout.sourceSpan.from && to <= layout.sourceSpan.to) return layout
      offset = layout.sourceSpan.to
      continue
    }
    const next = markdown.indexOf('\n', offset)
    if (next === -1) break
    offset = next + 1
  }
  return null
}

export function createColumnLayoutCommandPlan(
  snapshot: DocumentSnapshot,
  selectionOrPosition: number | Readonly<{ from: number; to: number }>,
  commandId: ColumnLayoutCommandId,
  transactionId: string,
  draftSource = columnLayoutStarterSource(commandId),
): ColumnLayoutCommandPlan {
  const selection = typeof selectionOrPosition === 'number'
    ? { from: selectionOrPosition, to: selectionOrPosition }
    : {
        from: Math.min(selectionOrPosition.from, selectionOrPosition.to),
        to: Math.max(selectionOrPosition.from, selectionOrPosition.to),
      }
  if (!Number.isInteger(selection.from) || !Number.isInteger(selection.to) || selection.from < 0 || selection.to > snapshot.markdown.length) {
    throw new RangeError('Column-layout insertion position is outside the current Markdown snapshot.')
  }
  const validation = validateColumnLayoutSource(commandId, draftSource)
  if (!validation.valid) throw new RangeError(validation.message)
  const existing = columnLayoutAtSelection(snapshot.markdown, selection)
  const lineEndCandidate = snapshot.markdown.indexOf('\n', selection.from)
  const lineEnd = lineEndCandidate === -1 ? snapshot.markdown.length : lineEndCandidate
  const source = draftSource
  const patchFrom = existing?.sourceSpan.from ?? lineEnd
  const patchTo = existing?.sourceSpan.to ?? lineEnd
  const replacement = existing !== null || snapshot.markdown.length === 0 ? source : `\n\n${source}`
  return Object.freeze({
    plan: Object.freeze({
      baseRevision: snapshot.revision,
      patches: Object.freeze([Object.freeze({
        codecId: commandId === 'layout.two-column' ? 'layout-two-column' : 'layout-multi-column',
        expected: snapshot.markdown.slice(patchFrom, patchTo),
        from: patchFrom,
        replacement,
        to: patchTo,
      })]),
      transactionId,
    }),
    selection: Object.freeze({ from: patchFrom, to: patchFrom + replacement.length }),
    source,
  })
}
