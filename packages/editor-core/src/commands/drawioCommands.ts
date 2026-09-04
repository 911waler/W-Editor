import { drawioSource, parseDrawioAt, type DrawioModel } from '../codecs'
import type { DocumentSnapshot, PatchPlan } from '../core'

export interface DrawioCommandPlan {
  readonly plan: PatchPlan
  readonly selection: Readonly<{ from: number; to: number }>
  readonly source: string
}

export function drawioAtSelection(
  markdown: string,
  selection: Readonly<{ from: number; to: number }>,
): DrawioModel | null {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  let offset = 0
  while (offset <= markdown.length) {
    const drawio = parseDrawioAt(markdown, offset)
    if (drawio !== null && from >= drawio.sourceSpan.from && to <= drawio.sourceSpan.to) return drawio
    const newline = markdown.indexOf('\n', offset)
    if (newline === -1) break
    offset = newline + 1
  }
  return null
}

export function createDrawioCommandPlan(
  snapshot: DocumentSnapshot,
  selection: Readonly<{ from: number; to: number }>,
  name: string,
  png: string,
  xml: string,
  transactionId: string,
): DrawioCommandPlan {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  if (from < 0 || to > snapshot.markdown.length) throw new RangeError('draw.io selection is outside the current Markdown snapshot.')
  const source = drawioSource(name, png, xml)
  const selected = drawioAtSelection(snapshot.markdown, { from, to })
  const lineEnd = snapshot.markdown.indexOf('\n', from)
  const range = selected?.sourceSpan
    ?? Object.freeze({ from: lineEnd === -1 ? snapshot.markdown.length : lineEnd, to: lineEnd === -1 ? snapshot.markdown.length : lineEnd })
  const replacement = selected !== null || snapshot.markdown.length === 0 ? source : `\n\n${source}`
  return Object.freeze({
    plan: Object.freeze({
      baseRevision: snapshot.revision,
      patches: Object.freeze([Object.freeze({
        codecId: 'drawio',
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
