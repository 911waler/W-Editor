import { mediaSource, parseMediaAt, type MediaKind, type MediaModel } from '../codecs'
import type { DocumentSnapshot, PatchPlan } from '../core'

export interface MediaCommandPlan {
  readonly plan: PatchPlan
  readonly selection: Readonly<{ from: number; to: number }>
  readonly source: string
}

export function mediaAtSelection(
  markdown: string,
  selection: Readonly<{ from: number; to: number }>,
): MediaModel | null {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  let offset = 0
  while (offset <= markdown.length) {
    const media = parseMediaAt(markdown, offset)
    if (media !== null && from >= media.sourceSpan.from && to <= media.sourceSpan.to) return media
    const newline = markdown.indexOf('\n', offset)
    if (newline === -1) break
    offset = newline + 1
  }
  return null
}

export function createMediaCommandPlan(
  snapshot: DocumentSnapshot,
  selection: Readonly<{ from: number; to: number }>,
  kind: MediaKind,
  name: string,
  url: string,
  transactionId: string,
): MediaCommandPlan {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  if (from < 0 || to > snapshot.markdown.length) throw new RangeError('Media selection is outside the current Markdown snapshot.')
  const source = mediaSource(kind, name, url)
  const selected = mediaAtSelection(snapshot.markdown, { from, to })
  const replacesSelected = selected?.kind === kind
  const lineEnd = snapshot.markdown.indexOf('\n', from)
  const range = replacesSelected
    ? selected.sourceSpan
    : Object.freeze({ from: lineEnd === -1 ? snapshot.markdown.length : lineEnd, to: lineEnd === -1 ? snapshot.markdown.length : lineEnd })
  const replacement = replacesSelected || snapshot.markdown.length === 0 ? source : `\n\n${source}`
  return Object.freeze({
    plan: Object.freeze({
      baseRevision: snapshot.revision,
      patches: Object.freeze([Object.freeze({
        codecId: `media-${kind}`,
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
