import { describe, expect, it } from 'vitest'

import { INLINE_MARK_SPECS } from '../../src/codecs'
import { DocumentSession } from '../../src/core'
import { createInlineMarkTogglePlan } from '../../src/services'

describe('source inline mark commands', () => {
  it.each(INLINE_MARK_SPECS)('toggles $commandId through one checked source patch', (spec) => {
    const session = new DocumentSession({ documentId: spec.commandId, markdown: 'Keep alpha tail' })
    const applied = createInlineMarkTogglePlan(
      session.snapshot(),
      { from: 5, to: 10 },
      spec.commandId,
      `${spec.commandId}:apply`,
    )

    expect(applied.active).toBe(true)
    expect(session.previewPatchPlan(applied.plan)).toBe(`Keep ${spec.open}alpha${spec.close} tail`)
    session.commitPatchPlan(applied.plan, 'toolbar-command')
    const removed = createInlineMarkTogglePlan(
      session.snapshot(),
      applied.selection,
      spec.commandId,
      `${spec.commandId}:remove`,
    )
    expect(removed.active).toBe(false)
    expect(session.previewPatchPlan(removed.plan)).toBe('Keep alpha tail')
    expect(removed.plan.patches).toHaveLength(1)
  })
})
