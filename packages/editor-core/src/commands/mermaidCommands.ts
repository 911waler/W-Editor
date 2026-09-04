import {
  mermaidDescriptor,
  mermaidStarterSource,
  parseMermaidAt,
  validateMermaidSource,
  type MermaidCommandId,
  type MermaidModel,
} from '../codecs'
import type { DocumentSnapshot, PatchPlan } from '../core'

export interface MermaidCommandPlan {
  readonly plan: PatchPlan
  readonly selection: Readonly<{ from: number; to: number }>
  readonly source: string
}

export function mermaidAtSelection(
  markdown: string,
  selection: Readonly<{ from: number; to: number }>,
): MermaidModel | null {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  let offset = 0
  while (offset < markdown.length) {
    const mermaid = parseMermaidAt(markdown, offset)
    if (mermaid !== null) {
      if (from >= mermaid.sourceSpan.from && to <= mermaid.sourceSpan.to) return mermaid
      offset = mermaid.sourceSpan.to
      continue
    }
    const newline = markdown.indexOf('\n', offset)
    if (newline === -1) break
    offset = newline + 1
  }
  return null
}

export function createMermaidCommandPlan(
  snapshot: DocumentSnapshot,
  selection: Readonly<{ from: number; to: number }>,
  commandId: MermaidCommandId,
  transactionId: string,
  draftSource = mermaidStarterSource(commandId),
): MermaidCommandPlan {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  if (from < 0 || to > snapshot.markdown.length) throw new RangeError('Mermaid selection is outside the current Markdown snapshot.')
  const descriptor = mermaidDescriptor(commandId)
  if (descriptor === null) throw new RangeError(`Unknown Mermaid command: ${commandId}.`)
  const validation = validateMermaidSource(commandId, draftSource)
  if (!validation.valid) throw new RangeError(validation.message)
  const selected = mermaidAtSelection(snapshot.markdown, { from, to })
  const replacesSelected = selected?.diagramType === descriptor.diagramType
  const lineEnd = snapshot.markdown.indexOf('\n', from)
  const range = replacesSelected
    ? selected.sourceSpan
    : Object.freeze({ from: lineEnd === -1 ? snapshot.markdown.length : lineEnd, to: lineEnd === -1 ? snapshot.markdown.length : lineEnd })
  const replacement = replacesSelected || snapshot.markdown.length === 0 ? draftSource : `\n\n${draftSource}`
  return Object.freeze({
    plan: Object.freeze({
      baseRevision: snapshot.revision,
      patches: Object.freeze([Object.freeze({
        codecId: `mermaid-${descriptor.diagramType}`,
        expected: snapshot.markdown.slice(range.from, range.to),
        from: range.from,
        replacement,
        to: range.to,
      })]),
      transactionId,
    }),
    selection: Object.freeze({ from: range.from + replacement.length, to: range.from + replacement.length }),
    source: draftSource,
  })
}
