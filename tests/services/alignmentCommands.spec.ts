import { describe, expect, it } from 'vitest'

import { DocumentSession } from '../../src/core'
import type { AlignmentCommandId } from '../../src/codecs'
import {
  createAlignmentCommandPlan,
  sourceAlignmentAt,
  sourceAlignmentCompatible,
} from '../../src/services'

const COMMANDS: readonly AlignmentCommandId[] = ['align.left', 'align.center', 'align.right', 'align.justify']

describe('source alignment commands', () => {
  it.each(COMMANDS)('wraps only a compatible block range for %s', (commandId) => {
    const session = new DocumentSession({ documentId: commandId, markdown: 'Keep\n\n# Heading\n\nParagraph\n\nTail' })
    const result = createAlignmentCommandPlan(session.snapshot(), { from: 6, to: 26 }, commandId, `${commandId}:apply`)
    const value = commandId.slice('align.'.length)
    expect(session.previewPatchPlan(result.plan)).toBe(`Keep\n\n::: ${value}\n# Heading\n\nParagraph\n:::\n\nTail`)
    session.commitPatchPlan(result.plan)
    expect(sourceAlignmentAt(session.snapshot().markdown, result.selection)).toBe(commandId)
  })

  it('rejects incompatible list, table, semantic, and fenced selections', () => {
    for (const markdown of ['- list', '| a | b |', '::: info Title\nBody\n:::', '```js\nx\n```']) {
      expect(sourceAlignmentCompatible(markdown, { from: 0, to: markdown.length })).toBe(false)
      expect(() => createAlignmentCommandPlan(
        { documentId: 'bad', markdown, revision: 0 },
        { from: 0, to: markdown.length },
        'align.center',
        'bad',
      )).toThrow(RangeError)
    }
  })

  it('changes an existing alignment by replacing only its declared container', () => {
    const markdown = 'Before\n\n::: left\nAlpha\n:::\n\nAfter'
    const session = new DocumentSession({ documentId: 'replace', markdown })
    const from = markdown.indexOf('Alpha')
    const result = createAlignmentCommandPlan(session.snapshot(), { from, to: from + 5 }, 'align.right', 'align:replace')
    expect(result.plan.patches).toEqual([expect.objectContaining({
      expected: '::: left\nAlpha\n:::',
      replacement: '::: right\nAlpha\n:::',
    })])
  })
})
