import type { DocumentSnapshot, PatchPlan } from '../core'

export type HeadingCommandId = 'block.h1' | 'block.h2' | 'block.h3' | 'block.h4' | 'block.h5'

export interface HeadingCommandPlan {
  readonly active: boolean
  readonly plan: PatchPlan
  readonly selection: Readonly<{ from: number; to: number }>
}

export function headingLevel(commandId: string): 1 | 2 | 3 | 4 | 5 | null {
  const match = /^block\.h([1-5])$/u.exec(commandId)
  return match === null ? null : Number(match[1]) as 1 | 2 | 3 | 4 | 5
}

export function sourceHeadingLevel(markdown: string, position: number): 1 | 2 | 3 | 4 | 5 | null {
  const safePosition = Math.max(0, Math.min(position, markdown.length))
  const from = markdown.lastIndexOf('\n', Math.max(0, safePosition - 1)) + 1
  const toCandidate = markdown.indexOf('\n', safePosition)
  const to = toCandidate === -1 ? markdown.length : toCandidate
  const match = /^(#{1,5})[ \t]+/u.exec(markdown.slice(from, to))
  return match === null ? null : match[1]?.length as 1 | 2 | 3 | 4 | 5
}

export function createHeadingCommandPlan(
  snapshot: DocumentSnapshot,
  selection: Readonly<{ from: number; to: number }>,
  commandId: HeadingCommandId,
  transactionId: string,
): HeadingCommandPlan {
  const level = headingLevel(commandId)
  if (level === null) throw new RangeError(`Unknown heading command: ${commandId}.`)
  const selectionFrom = Math.min(selection.from, selection.to)
  const selectionTo = Math.max(selection.from, selection.to)
  if (selectionFrom < 0 || selectionTo > snapshot.markdown.length) {
    throw new RangeError('Heading selection must be inside the current Markdown snapshot.')
  }
  const from = snapshot.markdown.lastIndexOf('\n', Math.max(0, selectionFrom - 1)) + 1
  const nextNewline = snapshot.markdown.indexOf('\n', selectionTo)
  const to = nextNewline === -1 ? snapshot.markdown.length : nextNewline
  if (snapshot.markdown.slice(selectionFrom, selectionTo).includes('\n')) {
    throw new RangeError('Heading commands require a selection within one source line.')
  }
  const expected = snapshot.markdown.slice(from, to)
  const existingPrefix = /^(#{1,5})[ \t]+/u.exec(expected)
  const existingPrefixLength = existingPrefix?.[0].length ?? 0
  const active = existingPrefix?.[1]?.length !== level
  const body = expected.slice(existingPrefixLength)
  const prefix = active ? `${'#'.repeat(level)} ` : ''
  const replacement = `${prefix}${body}`
  return Object.freeze({
    active,
    plan: Object.freeze({
      baseRevision: snapshot.revision,
      patches: Object.freeze([Object.freeze({
        codecId: 'heading',
        expected,
        from,
        replacement,
        to,
      })]),
      transactionId,
    }),
    selection: Object.freeze({
      from: Math.max(from + prefix.length, selectionFrom - (expected.length - body.length) + prefix.length),
      to: Math.max(from + prefix.length, selectionTo - (expected.length - body.length) + prefix.length),
    }),
  })
}
