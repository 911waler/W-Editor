import { describe, expect, it } from 'vitest'

import { DocumentSession } from '../../src/core'
import { createFormulaCommandPlan, formulaSource } from '../../src/services'

describe('formula source command', () => {
  it('inserts and edits one validated semantic formula unit', () => {
    const session = new DocumentSession({ documentId: 'formula', markdown: 'Alpha' })
    const inserted = createFormulaCommandPlan(session.snapshot(), { from: 2, to: 2 }, 'E = mc^2', 'formula:insert')
    expect(session.previewPatchPlan(inserted.plan)).toBe('Alpha\n\n$$\nE = mc^2\n$$')
    session.commitPatchPlan(inserted.plan)

    const formulaFrom = session.snapshot().markdown.indexOf('$$')
    const edited = createFormulaCommandPlan(
      session.snapshot(),
      { from: formulaFrom, to: session.snapshot().markdown.length },
      'a^2 + b^2 = c^2',
      'formula:edit',
    )
    expect(session.previewPatchPlan(edited.plan)).toBe(`Alpha\n\n${formulaSource('a^2 + b^2 = c^2')}`)
    expect(() => formulaSource('bad $$ close')).toThrow(RangeError)
  })

  it('replaces the exact Source selection with one validated inline formula', () => {
    const session = new DocumentSession({ documentId: 'inline-formula', markdown: 'Alpha beta' })
    const result = createFormulaCommandPlan(
      session.snapshot(),
      { from: 6, to: 10 },
      String.raw`\frac{a}{b}`,
      'formula:inline',
      'inline',
    )
    expect(session.previewPatchPlan(result.plan)).toBe(String.raw`Alpha $\frac{a}{b}$`)
    expect(result.selection).toEqual({ from: 6, to: 19 })
    expect(() => formulaSource('bad $ close', 'inline')).toThrow('unescaped $ delimiter')
  })
})
