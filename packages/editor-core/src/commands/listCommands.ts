import type { DocumentSnapshot, PatchPlan } from '../core'

export type ListCommandId = 'list.ordered' | 'list.task' | 'list.unordered'

export interface ListCommandPlan {
  readonly plan: PatchPlan
  readonly selection: Readonly<{ from: number; to: number }>
}

export function listCommandKind(commandId: string): ListCommandId | null {
  return commandId === 'list.ordered' || commandId === 'list.task' || commandId === 'list.unordered'
    ? commandId
    : null
}

function stripListPrefix(line: string): string {
  return line.replace(/^(?:[0-9]+\.|-)(?:[ \t]+\[[ xX]\])?[ \t]+/u, '')
}

function prefixLine(commandId: ListCommandId, line: string, index: number): string {
  const body = stripListPrefix(line)
  if (commandId === 'list.ordered') return `${index + 1}. ${body}`
  if (commandId === 'list.task') return `- [ ] ${body}`
  return `- ${body}`
}

export function sourceListCommandAt(markdown: string, position: number): ListCommandId | null {
  const safePosition = Math.max(0, Math.min(position, markdown.length))
  const from = markdown.lastIndexOf('\n', Math.max(0, safePosition - 1)) + 1
  const end = markdown.indexOf('\n', safePosition)
  const line = markdown.slice(from, end === -1 ? markdown.length : end)
  if (/^-[ \t]+\[[ xX]\][ \t]+/u.test(line)) return 'list.task'
  if (/^[0-9]+\.[ \t]+/u.test(line)) return 'list.ordered'
  if (/^-[ \t]+/u.test(line)) return 'list.unordered'
  return null
}

export function createListCommandPlan(
  snapshot: DocumentSnapshot,
  selection: Readonly<{ from: number; to: number }>,
  commandId: ListCommandId,
  transactionId: string,
): ListCommandPlan {
  const selectionFrom = Math.min(selection.from, selection.to)
  const selectionTo = Math.max(selection.from, selection.to)
  if (selectionFrom < 0 || selectionTo > snapshot.markdown.length) {
    throw new RangeError('List selection must be inside the current Markdown snapshot.')
  }
  const from = snapshot.markdown.lastIndexOf('\n', Math.max(0, selectionFrom - 1)) + 1
  const end = snapshot.markdown.indexOf('\n', selectionTo)
  const to = end === -1 ? snapshot.markdown.length : end
  const expected = snapshot.markdown.slice(from, to)
  const replacement = expected.split('\n').map((line, index) => prefixLine(commandId, line, index)).join('\n')
  const firstBodyOffset = replacement.indexOf(stripListPrefix(expected.split('\n')[0] ?? ''))
  const codecId = commandId === 'list.ordered'
    ? 'ordered-list'
    : commandId === 'list.task' ? 'task-list' : 'bullet-list'
  return Object.freeze({
    plan: Object.freeze({
      baseRevision: snapshot.revision,
      patches: Object.freeze([Object.freeze({
        codecId,
        expected,
        from,
        replacement,
        to,
      })]),
      transactionId,
    }),
    selection: Object.freeze({
      from: from + Math.max(0, firstBodyOffset),
      to: from + replacement.length,
    }),
  })
}
