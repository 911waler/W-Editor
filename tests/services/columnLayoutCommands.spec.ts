import { describe, expect, it } from 'vitest'

import { columnLayoutStarterSource, type ColumnLayoutCommandId } from '../../src/codecs'
import { DocumentSession } from '../../src/core'
import { createColumnLayoutCommandPlan } from '../../src/services'

describe('column-layout starter insertion', () => {
  it.each<ColumnLayoutCommandId>(['layout.two-column', 'layout.multi-column'])(
    'inserts %s through one checked source-range patch',
    (commandId) => {
      const session = new DocumentSession({ documentId: commandId, markdown: 'Alpha' })
      const result = createColumnLayoutCommandPlan(session.snapshot(), 2, commandId, `${commandId}:insert`)
      expect(session.previewPatchPlan(result.plan)).toBe(`Alpha\n\n${columnLayoutStarterSource(commandId)}`)
      expect(result.plan.patches).toEqual([expect.objectContaining({ expected: '', from: 5, to: 5 })])
    },
  )
})
