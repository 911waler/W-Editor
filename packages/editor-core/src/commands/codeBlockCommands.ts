import { fencedCodeAtSelection, serializeFencedCode } from '../codecs'
import type { DocumentSnapshot, PatchPlan } from '../core'

export interface CodeBlockCommandPlan {
  readonly plan: PatchPlan
  readonly selection: Readonly<{ from: number; to: number }>
  readonly source: string
}

export function createCodeBlockCommandPlan(
  snapshot: DocumentSnapshot,
  selection: Readonly<{ from: number; to: number }>,
  language: string,
  code: string,
  transactionId: string,
): CodeBlockCommandPlan {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  if (from < 0 || to > snapshot.markdown.length) throw new RangeError('Code-block selection is outside the Markdown snapshot.')
  const existing = fencedCodeAtSelection(snapshot.markdown, { from, to })
  const source = serializeFencedCode(language, code)
  const range = existing?.sourceSpan ?? (() => {
    const newline = snapshot.markdown.indexOf('\n', from)
    const lineEnd = newline === -1 ? snapshot.markdown.length : newline
    return Object.freeze({ from: lineEnd, to: lineEnd })
  })()
  const replacement = existing === null && snapshot.markdown.length > 0 ? `\n\n${source}` : source
  return Object.freeze({
    plan: Object.freeze({
      baseRevision: snapshot.revision,
      patches: Object.freeze([Object.freeze({
        codecId: 'fenced-code',
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
