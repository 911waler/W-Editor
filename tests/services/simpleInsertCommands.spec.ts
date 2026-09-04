import { describe, expect, it } from 'vitest'

import { DocumentSession } from '../../src/core'
import {
  createBlockInsertionPlan,
  createHardBreakPlan,
  createInlineCodePlan,
  createLinkPlan,
  createTableInsertionPlan,
  createTocInsertionDecision,
} from '../../src/services'

describe('simple source insertion commands', () => {
  it('applies a validated link and inline code as exact checked selection replacements', () => {
    const linkSession = new DocumentSession({ documentId: 'link', markdown: 'Keep label tail' })
    const link = createLinkPlan(linkSession.snapshot(), { from: 5, to: 10 }, 'https://example.com', 'link:apply')
    expect(linkSession.previewPatchPlan(link.plan)).toBe('Keep [label](https://example.com) tail')
    linkSession.commitPatchPlan(link.plan)
    const editedLink = createLinkPlan(linkSession.snapshot(), link.selection, 'https://openai.com', 'link:edit')
    expect(linkSession.previewPatchPlan(editedLink.plan)).toBe('Keep [label](https://openai.com) tail')
    expect(() => createLinkPlan(linkSession.snapshot(), { from: 5, to: 10 }, 'javascript:alert(1)', 'link:bad')).toThrow(RangeError)

    const codeSession = new DocumentSession({ documentId: 'code', markdown: 'Keep label tail' })
    const code = createInlineCodePlan(codeSession.snapshot(), { from: 5, to: 10 }, 'code:apply')
    expect(codeSession.previewPatchPlan(code.plan)).toBe('Keep `label` tail')
    codeSession.commitPatchPlan(code.plan)
    expect(codeSession.previewPatchPlan(createInlineCodePlan(codeSession.snapshot(), code.selection, 'code:remove').plan))
      .toBe('Keep label tail')
  })

  it('inserts a hard break and horizontal rule at exact boundaries', () => {
    const session = new DocumentSession({ documentId: 'blocks', markdown: 'Alpha\nTail' })
    expect(session.previewPatchPlan(createHardBreakPlan(session.snapshot(), 2, 'break').plan)).toBe('Al  \npha\nTail')
    expect(session.previewPatchPlan(createBlockInsertionPlan(session.snapshot(), 2, 'insert.horizontal-rule', 'hr').plan))
      .toBe('Alpha\n\n---\nTail')
  })

  it('returns an insert decision for a new TOC at the requested block boundary', () => {
    const session = new DocumentSession({ documentId: 'new-toc', markdown: 'Alpha\nTail' })
    const decision = createTocInsertionDecision(session.snapshot(), 2, 'toc')
    expect(decision.kind).toBe('insert')
    if (decision.kind === 'insert') {
      expect(session.previewPatchPlan(decision.plan)).toBe('Alpha\n\n[[toc]]\nTail')
      expect(decision.selection).toEqual({ from: 14, to: 14 })
    }
  })

  it('returns the first real existing TOC without creating a patch', () => {
    const snapshot = new DocumentSession({
      documentId: 'existing-toc',
      markdown: '# Alpha\n\n[[toc]]\n\nTail',
    }).snapshot()
    expect(createTocInsertionDecision(snapshot, 0, 'toc')).toEqual({
      kind: 'existing',
      selection: { from: 9, to: 16 },
    })
  })

  it('ignores marker text inside fenced code and inserts one real TOC', () => {
    const snapshot = new DocumentSession({
      documentId: 'code-marker',
      markdown: '```text\n[[toc]]\n```',
    }).snapshot()
    const decision = createTocInsertionDecision(snapshot, snapshot.markdown.length, 'toc')
    expect(decision.kind).toBe('insert')
    if (decision.kind === 'insert') {
      expect(new DocumentSession({ documentId: 'candidate', markdown: snapshot.markdown })
        .previewPatchPlan(decision.plan)).toBe('```text\n[[toc]]\n```\n\n[[toc]]')
    }
  })

  it('inserts chosen ordinary-table dimensions as a checked source block', () => {
    const session = new DocumentSession({ documentId: 'table', markdown: 'Alpha' })
    expect(session.previewPatchPlan(createTableInsertionPlan(
      session.snapshot(),
      2,
      'table:insert',
      { columns: 3, dataRows: 2 },
    ).plan)).toBe(
      'Alpha\n\n| Header | Header | Header |\n| ------ | ------ | ------ |\n| Sample | Sample | Sample |\n| Sample | Sample | Sample |',
    )
  })
})
