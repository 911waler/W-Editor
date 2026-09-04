import { describe, expect, it } from 'vitest'

import { DocumentSession } from '../../src/core'
import { createListCommandPlan, sourceListCommandAt, type ListCommandId } from '../../src/services'

const CASES: readonly Readonly<{ commandId: ListCommandId; expected: string }>[] = [
  { commandId: 'list.ordered', expected: 'Keep\n1. Alpha\n2. Bravo\nTail' },
  { commandId: 'list.unordered', expected: 'Keep\n- Alpha\n- Bravo\nTail' },
  { commandId: 'list.task', expected: 'Keep\n- [ ] Alpha\n- [ ] Bravo\nTail' },
]

describe('source list commands', () => {
  it.each(CASES)('applies $commandId as one checked block replacement', ({ commandId, expected }) => {
    const session = new DocumentSession({ documentId: commandId, markdown: 'Keep\nAlpha\nBravo\nTail' })
    const result = createListCommandPlan(session.snapshot(), { from: 5, to: 16 }, commandId, `${commandId}:apply`)
    expect(session.previewPatchPlan(result.plan)).toBe(expected)
    expect(result.plan.patches).toHaveLength(1)
    session.commitPatchPlan(result.plan)
    expect(sourceListCommandAt(session.snapshot().markdown, result.selection.from)).toBe(commandId)
  })
})
