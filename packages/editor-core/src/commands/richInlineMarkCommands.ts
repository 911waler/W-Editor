import {
  formatRichInlineMark,
  richInlineMarkSpec,
  type RichInlineMarkCommandId,
} from '../codecs'
import type { DocumentSnapshot, PatchPlan } from '../core'
import type { InlineMarkSelection } from './inlineMarkCommands'

export interface RichInlineMarkPlan {
  readonly plan: PatchPlan
  readonly selection: InlineMarkSelection
}

function normalizeSelection(snapshot: DocumentSnapshot, selection: InlineMarkSelection): InlineMarkSelection {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > snapshot.markdown.length || from === to) {
    throw new RangeError('Rich inline commands require a non-empty selection inside the current Markdown snapshot.')
  }
  return Object.freeze({ from, to })
}

export function validateRichInlineMarkValue(commandId: RichInlineMarkCommandId, value: string): string {
  const normalized = value.trim()
  if (commandId === 'text.size' && !/^[0-9]{1,2}$/u.test(normalized)) {
    throw new RangeError('Font size must be an integer from 0 to 99 pixels.')
  }
  if ((commandId === 'text.color' || commandId === 'text.background')
    && !/^(?:#[0-9a-zA-Z]{3,6}|[a-z]{3,20})$/u.test(normalized)) {
    throw new RangeError('Color must be a Cherry-compatible name or hexadecimal value.')
  }
  if (commandId === 'text.ruby' && (normalized.length === 0 || /[|{}\n]/u.test(normalized))) {
    throw new RangeError('Ruby annotation must be non-empty and cannot contain braces, pipes, or line breaks.')
  }
  return normalized
}

export function createRichInlineMarkPlan(
  snapshot: DocumentSnapshot,
  selection: InlineMarkSelection,
  commandId: RichInlineMarkCommandId,
  value: string,
  transactionId: string,
  bodyOverride?: string,
): RichInlineMarkPlan {
  const spec = richInlineMarkSpec(commandId)
  if (spec === null) throw new RangeError(`Unknown rich inline command: ${commandId}.`)
  const selected = normalizeSelection(snapshot, selection)
  const selectedSource = snapshot.markdown.slice(selected.from, selected.to)
  const body = bodyOverride?.trim() ?? selectedSource
  if (body.length === 0 || body.includes('\0') || body.includes('\n')) {
    throw new RangeError('Rich inline content must be non-empty and cannot contain NUL or line breaks.')
  }
  const normalizedValue = validateRichInlineMarkValue(commandId, value)
  const replacement = formatRichInlineMark(commandId, body, normalizedValue)
  const bodyFrom = replacement.indexOf(body)
  return Object.freeze({
    plan: Object.freeze({
      baseRevision: snapshot.revision,
      patches: Object.freeze([Object.freeze({
        codecId: spec.codecId,
        expected: selectedSource,
        from: selected.from,
        replacement,
        to: selected.to,
      })]),
      transactionId,
    }),
    selection: Object.freeze({
      from: selected.from + bodyFrom,
      to: selected.from + bodyFrom + body.length,
    }),
  })
}
