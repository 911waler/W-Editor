import { describe, expect, it } from 'vitest'
import * as core from '../../packages/editor-core/src/index'
import { parseBlockFormulaAt, serializeFormula } from '../../packages/editor-core/src/codecs/formulas'

describe('formula reference persistence', () => {
  it('owns the adjacent identity marker without exposing it as TeX', () => {
    const source = '$$\na=b\n$$\n<!-- w-editor-formula-id: target-a -->'
    expect(parseBlockFormulaAt(source, 0)).toMatchObject({ content: 'a=b', formulaId: 'target-a', source, to: source.length })
    expect(Reflect.apply(serializeFormula, null, ['block', 'a=b', 'target-a'])).toBe(source)
    const projected = core.projectOrdinaryMarkdown({ documentId: 'refs', revision: 0, markdown: `${source}\n\nSee [公式](#wformula-target-a).` })
    expect(projected.content.content?.[0]?.attrs?.['formulaId']).toBe('target-a')
    expect(projected.content.content?.[1]?.content?.[1]).toMatchObject({ type: 'formulaReference', attrs: { targetId: 'target-a' } })
  })
  it('exports the candidate inventory and atomic command', () => {
    expect(core).toHaveProperty('formulaReferenceCandidates')
    expect(core).toHaveProperty('createFormulaReferenceCommandPlan')
  })
})

it('creates one revision-checked plan and preserves target identity on source edit', () => {
  const markdown = 'See here\n\n$$\na=b\n$$\n\n```\n$$\nexample\n$$\n```\n\n$inline$'
  const session = new core.DocumentSession({ documentId: 'refs', markdown })
  const candidates = core.formulaReferenceCandidates(markdown)
  expect(candidates).toEqual([{ from: 10, to: 19, content: 'a=b', number: 1, formulaId: null }])
  const result = core.createFormulaReferenceCommandPlan(session.snapshot(), { from: 4, to: 8 }, 10, 'stable-a', 'insert-ref')
  expect(result.plan.patches).toHaveLength(2)
  session.commitPatchPlan(result.plan)
  expect(session.snapshot().markdown).toContain('[公式](#wformula-stable-a)')
  const target = core.formulaReferenceCandidates(session.snapshot().markdown)[0]!
  const edit = core.createFormulaCommandPlan(session.snapshot(), target, 'changed', 'edit-target')
  session.commitPatchPlan(edit.plan)
  expect(core.formulaReferenceCandidates(session.snapshot().markdown)[0]).toMatchObject({ content: 'changed', formulaId: 'stable-a' })
  expect(() => core.createFormulaReferenceCommandPlan(session.snapshot(), { from: target.from + 1, to: target.from + 1 }, target.from, 'other', 'unsafe')).toThrow('enter a formula')
})

it('merges insertion at the closing fence with first identity assignment', () => {
  const session = new core.DocumentSession({ documentId: 'refs', markdown: '$$\na\n$$' })
  const result = core.createFormulaReferenceCommandPlan(session.snapshot(), { from: 7, to: 7 }, 0, 'stable', 'same-position')
  expect(result.plan.patches).toHaveLength(1)
  session.commitPatchPlan(result.plan)
  expect(session.snapshot().markdown).toBe('$$\na\n$$\n<!-- w-editor-formula-id: stable -->\n\n[公式](#wformula-stable)')
})

it.each(['<!--\n\n$$\nfake\n$$\n\n-->', '<script>\n\n$$\nfake\n$$\n\n</script>', '<pre>\n\n$$\nfake\n$$\n\n</pre>'])('does not offer formulas in opaque HTML: %s', prefix => {
  expect(core.formulaReferenceCandidates(prefix)).toEqual([])
})

it('keeps block boundaries valid when inserting before a target or after an existing marker', () => {
  for (const atEnd of [false, true]) {
    const original = '$$\na\n$$\n<!-- w-editor-formula-id: stable -->'
    const session = new core.DocumentSession({ documentId: 'boundaries', markdown: original })
    const offset = atEnd ? original.length : 0
    const result = core.createFormulaReferenceCommandPlan(session.snapshot(), { from: offset, to: offset }, 0, 'unused', `boundary-${atEnd}`)
    session.commitPatchPlan(result.plan)
    expect(core.formulaReferenceCandidates(session.snapshot().markdown)).toHaveLength(1)
    expect(session.snapshot().markdown).toBe(atEnd ? `${original}\n\n[公式](#wformula-stable)` : `[公式](#wformula-stable)\n\n${original}`)
  }
})

it.each([
  '```html\n<pre>\n```',
  '~~~html\n<!--\n~~~',
  '`<!--`',
  '``<pre>``',
  '    <pre>',
  ' \t<pre>',
  '  \t<!--',
  '   \t<textarea>',
  '\\<!--',
  '$x<pre>y$',
  '$$\nx<pre>y\n$$',
])('does not let literal HTML openers hide later formulas: %s', prefix => {
  const markdown = `${prefix}\n\n$$\na=b\n$$\n<!-- w-editor-formula-id: stable -->`
  expect(core.formulaReferenceCandidates(markdown).at(-1)).toMatchObject({ content: 'a=b', formulaId: 'stable' })
})

it('still excludes real opaque HTML after a code example', () => {
  expect(core.formulaReferenceCandidates('`<!--`\n\n<pre>\n\n$$\nfake\n$$\n\n</pre>')).toEqual([])
})

it.each(['<!--\n\n$$\nfake\n$$\n\n-->', '<script>\n\n$$\nfake\n$$\n\n</script>', '<pre>\n\n$$\nfake\n$$\n\n</pre>'])('numbers visible formulas consecutively after opaque HTML: %s', hidden => {
  const markdown = `${hidden}\n\n$$\na=b\n$$\n\n${hidden}\n\n$$\nc=d\n$$`
  expect(core.formulaReferenceCandidates(markdown).map(({ content, number }) => ({ content, number }))).toEqual([
    { content: 'a=b', number: 1 },
    { content: 'c=d', number: 2 },
  ])
})
