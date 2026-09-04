import { describe, expect, it } from 'vitest'

import { RICH_INLINE_MARK_SPECS, formatRichInlineMark } from '../../src/codecs'
import { DocumentSession } from '../../src/core'
import { createRichInlineMarkPlan } from '../../src/services'

const VALUES = {
  'text.background': '#fde68a',
  'text.color': '#c2410c',
  'text.ruby': 'annotation',
  'text.size': '18',
} as const

describe('source attributed inline mark commands', () => {
  it.each(RICH_INLINE_MARK_SPECS)('applies $commandId through one checked source patch', (spec) => {
    const session = new DocumentSession({ documentId: spec.commandId, markdown: 'Keep alpha tail' })
    const result = createRichInlineMarkPlan(
      session.snapshot(),
      { from: 5, to: 10 },
      spec.commandId,
      VALUES[spec.commandId],
      `${spec.commandId}:apply`,
    )

    expect(session.previewPatchPlan(result.plan)).toBe(
      `Keep ${formatRichInlineMark(spec.commandId, 'alpha', VALUES[spec.commandId])} tail`,
    )
    expect(result.plan.patches).toHaveLength(1)
    session.commitPatchPlan(result.plan, 'toolbar-command')
    expect(session.snapshot().revision).toBe(1)
  })

  it('uses the explicit ruby base text and selects that base inside the exact Markdown replacement', () => {
    const session = new DocumentSession({ documentId: 'ruby-base', markdown: 'Keep Alpha tail' })
    const result = createRichInlineMarkPlan(
      session.snapshot(),
      { from: 5, to: 10 },
      'text.ruby',
      'han4',
      'text.ruby:apply',
      '汉',
    )

    expect(session.previewPatchPlan(result.plan)).toBe('Keep { 汉 | han4 } tail')
    expect(result.selection).toEqual({ from: 7, to: 8 })
  })

  it('rejects unsafe rich content before producing a patch plan', () => {
    const snapshot = new DocumentSession({ documentId: 'invalid-rich', markdown: 'Alpha' }).snapshot()

    expect(() => createRichInlineMarkPlan(
      snapshot,
      { from: 0, to: 5 },
      'text.ruby',
      'han4',
      'text.ruby:invalid',
      'two\nlines',
    )).toThrow('Rich inline content must be non-empty and cannot contain NUL or line breaks.')
  })
})
