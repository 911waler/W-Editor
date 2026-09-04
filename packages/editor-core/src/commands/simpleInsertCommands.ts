import type { DocumentSnapshot, PatchPlan } from '../core'
import { projectOrdinaryMarkdown } from '../codecs/ordinaryBlocks'
import { ordinaryTableStarterSource, type OrdinaryTableDimensions } from '../codecs/ordinaryTables'

export type SimpleInsertCommandId =
  | 'insert.hard-break'
  | 'insert.horizontal-rule'
  | 'insert.inline-code'
  | 'insert.link'
  | 'insert.table'
  | 'insert.toc'

export interface SimpleInsertPlan {
  readonly plan: PatchPlan
  readonly selection: Readonly<{ from: number; to: number }>
}

export type TocInsertionDecision =
  | Readonly<{ kind: 'existing'; selection: Readonly<{ from: number; to: number }> }>
  | Readonly<{ kind: 'insert'; plan: PatchPlan; selection: Readonly<{ from: number; to: number }> }>

function checkedPlan(
  snapshot: DocumentSnapshot,
  range: Readonly<{ from: number; to: number }>,
  codecId: string,
  replacement: string,
  transactionId: string,
  selection: Readonly<{ from: number; to: number }>,
): SimpleInsertPlan {
  return Object.freeze({
    plan: Object.freeze({
      baseRevision: snapshot.revision,
      patches: Object.freeze([Object.freeze({
        codecId,
        expected: snapshot.markdown.slice(range.from, range.to),
        from: range.from,
        replacement,
        to: range.to,
      })]),
      transactionId,
    }),
    selection: Object.freeze(selection),
  })
}

function normalizedRange(snapshot: DocumentSnapshot, selection: Readonly<{ from: number; to: number }>): Readonly<{ from: number; to: number }> {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  if (from < 0 || to > snapshot.markdown.length) throw new RangeError('Insert selection is outside the current Markdown snapshot.')
  return Object.freeze({ from, to })
}

export function createLinkPlan(
  snapshot: DocumentSnapshot,
  selection: Readonly<{ from: number; to: number }>,
  href: string,
  transactionId: string,
): SimpleInsertPlan {
  const range = normalizedRange(snapshot, selection)
  if (range.from === range.to) throw new RangeError('Link insertion requires selected label text.')
  const normalizedHref = href.trim()
  if (!/^(?:https?:\/\/|mailto:)[^\s)]+$/u.test(normalizedHref)) {
    throw new RangeError('Link URL must use http, https, or mailto.')
  }
  let patchRange = range
  let label = snapshot.markdown.slice(range.from, range.to)
  const selectedLink = /^\[([^\]\n]+)\]\([^)\s\n]+\)$/u.exec(label)
  if (selectedLink !== null) {
    label = selectedLink[1] ?? ''
  } else if (snapshot.markdown[range.from - 1] === '[') {
    const closing = /^\]\([^)\s\n]+\)/u.exec(snapshot.markdown.slice(range.to))
    if (closing !== null) patchRange = Object.freeze({ from: range.from - 1, to: range.to + closing[0].length })
  }
  const replacement = `[${label}](${normalizedHref})`
  return checkedPlan(snapshot, patchRange, 'link', replacement, transactionId, {
    from: patchRange.from + 1,
    to: patchRange.from + 1 + label.length,
  })
}

export function createInlineCodePlan(
  snapshot: DocumentSnapshot,
  selection: Readonly<{ from: number; to: number }>,
  transactionId: string,
): SimpleInsertPlan {
  const range = normalizedRange(snapshot, selection)
  if (range.from === range.to) throw new RangeError('Inline-code insertion requires selected text.')
  const code = snapshot.markdown.slice(range.from, range.to)
  if (code.includes('`') || code.includes('\n')) throw new RangeError('Inline code cannot contain a backtick or line break.')
  const surrounded = snapshot.markdown[range.from - 1] === '`' && snapshot.markdown[range.to] === '`'
  if (surrounded) {
    return checkedPlan(snapshot, { from: range.from - 1, to: range.to + 1 }, 'inline-code', code, transactionId, {
      from: range.from - 1,
      to: range.to - 1,
    })
  }
  return checkedPlan(snapshot, range, 'inline-code', `\`${code}\``, transactionId, {
    from: range.from + 1,
    to: range.to + 1,
  })
}

export function createHardBreakPlan(
  snapshot: DocumentSnapshot,
  position: number,
  transactionId: string,
): SimpleInsertPlan {
  const range = normalizedRange(snapshot, { from: position, to: position })
  return checkedPlan(snapshot, range, 'hard-break', '  \n', transactionId, {
    from: position + 3,
    to: position + 3,
  })
}

export function createBlockInsertionPlan(
  snapshot: DocumentSnapshot,
  position: number,
  commandId: 'insert.horizontal-rule',
  transactionId: string,
): SimpleInsertPlan {
  const range = normalizedRange(snapshot, { from: position, to: position })
  const lineEndCandidate = snapshot.markdown.indexOf('\n', range.from)
  const lineEnd = lineEndCandidate === -1 ? snapshot.markdown.length : lineEndCandidate
  const block = '---'
  const replacement = snapshot.markdown.length === 0 ? block : `\n\n${block}`
  const caret = lineEnd + replacement.length
  return checkedPlan(snapshot, { from: lineEnd, to: lineEnd }, 'horizontal-rule', replacement, transactionId, {
    from: caret,
    to: caret,
  })
}

export function createTocInsertionDecision(
  snapshot: DocumentSnapshot,
  position: number,
  transactionId: string,
): TocInsertionDecision {
  const projection = projectOrdinaryMarkdown(snapshot)
  const existing = projection.map.entries.find((entry) => entry.codecId === 'table-of-contents')
  if (existing !== undefined) {
    return Object.freeze({ kind: 'existing', selection: existing.sourceSpan })
  }

  const range = normalizedRange(snapshot, { from: position, to: position })
  const lineEndCandidate = snapshot.markdown.indexOf('\n', range.from)
  const lineEnd = lineEndCandidate === -1 ? snapshot.markdown.length : lineEndCandidate
  const block = '[[toc]]'
  const replacement = snapshot.markdown.length === 0 ? block : `\n\n${block}`
  const caret = lineEnd + replacement.length
  const result = checkedPlan(snapshot, { from: lineEnd, to: lineEnd }, 'table-of-contents', replacement, transactionId, {
    from: caret,
    to: caret,
  })
  return Object.freeze({ kind: 'insert', plan: result.plan, selection: result.selection })
}

export function createTableInsertionPlan(
  snapshot: DocumentSnapshot,
  position: number,
  transactionId: string,
  dimensions: OrdinaryTableDimensions,
): SimpleInsertPlan {
  const range = normalizedRange(snapshot, { from: position, to: position })
  const lineEndCandidate = snapshot.markdown.indexOf('\n', range.from)
  const lineEnd = lineEndCandidate === -1 ? snapshot.markdown.length : lineEndCandidate
  const table = ordinaryTableStarterSource(dimensions)
  const replacement = snapshot.markdown.length === 0 ? table : `\n\n${table}`
  const caret = lineEnd + replacement.length
  return checkedPlan(snapshot, { from: lineEnd, to: lineEnd }, 'ordinary-table', replacement, transactionId, {
    from: caret,
    to: caret,
  })
}
