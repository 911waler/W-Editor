import {
  attachmentSource,
  parseAttachmentAt,
  type AttachmentDraft,
  type AttachmentModel,
} from '../codecs'
import type { DocumentSnapshot, PatchPlan } from '../core'

export interface AttachmentCommandPlan {
  readonly plan: PatchPlan
  readonly selection: Readonly<{ from: number; to: number }>
  readonly source: string
}

export function attachmentAtSelection(
  markdown: string,
  selection: Readonly<{ from: number; to: number }>,
): AttachmentModel | null {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  let offset = 0
  while (offset <= markdown.length) {
    const attachment = parseAttachmentAt(markdown, offset)
    if (attachment !== null && from >= attachment.sourceSpan.from && to <= attachment.sourceSpan.to) return attachment
    const newline = markdown.indexOf('\n', offset)
    if (newline === -1) break
    offset = newline + 1
  }
  return null
}

export function createAttachmentCommandPlan(
  snapshot: DocumentSnapshot,
  selection: Readonly<{ from: number; to: number }>,
  draft: AttachmentDraft,
  transactionId: string,
): AttachmentCommandPlan {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  if (from < 0 || to > snapshot.markdown.length) throw new RangeError('Attachment selection is outside the current Markdown snapshot.')
  const source = attachmentSource(draft)
  const selected = attachmentAtSelection(snapshot.markdown, { from, to })
  const replacesSelected = selected?.kind === draft.kind
  const lineEnd = snapshot.markdown.indexOf('\n', from)
  const range = replacesSelected
    ? selected.sourceSpan
    : Object.freeze({ from: lineEnd === -1 ? snapshot.markdown.length : lineEnd, to: lineEnd === -1 ? snapshot.markdown.length : lineEnd })
  const replacement = replacesSelected || snapshot.markdown.length === 0 ? source : `\n\n${source}`
  return Object.freeze({
    plan: Object.freeze({
      baseRevision: snapshot.revision,
      patches: Object.freeze([Object.freeze({
        codecId: `attachment-${draft.kind}`,
        expected: snapshot.markdown.slice(range.from, range.to),
        from: range.from,
        replacement,
        to: range.to,
      })]),
      transactionId,
    }),
    selection: Object.freeze({ from: range.from + replacement.length, to: range.from + replacement.length }),
    source,
  })
}
