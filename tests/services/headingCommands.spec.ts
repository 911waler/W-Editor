import { describe, expect, it } from 'vitest'

import { DocumentSession } from '../../src/core'
import {
  createHeadingCommandPlan,
  createToolbarCommandDescriptors,
  sourceHeadingLevel,
  type HeadingCommandId,
} from '../../src/services'

const HEADING_COMMANDS: readonly HeadingCommandId[] = ['block.h1', 'block.h2', 'block.h3', 'block.h4', 'block.h5']

describe('H1-H5 source commands', () => {
  it.each(HEADING_COMMANDS)('replaces exactly one line for %s and reports its source active state', (commandId) => {
    const session = new DocumentSession({ documentId: commandId, markdown: 'Keep\nAlpha\nTail' })
    const level = Number(commandId.at(-1))
    const result = createHeadingCommandPlan(session.snapshot(), { from: 5, to: 10 }, commandId, `${commandId}:apply`)

    expect(result.active).toBe(true)
    expect(session.previewPatchPlan(result.plan)).toBe(`Keep\n${'#'.repeat(level)} Alpha\nTail`)
    expect(result.plan.patches).toEqual([{
      codecId: 'heading',
      expected: 'Alpha',
      from: 5,
      replacement: `${'#'.repeat(level)} Alpha`,
      to: 10,
    }])
    session.commitPatchPlan(result.plan)
    expect(sourceHeadingLevel(session.snapshot().markdown, result.selection.from)).toBe(level)

    const removal = createHeadingCommandPlan(session.snapshot(), result.selection, commandId, `${commandId}:remove`)
    expect(removal.active).toBe(false)
    expect(session.previewPatchPlan(removal.plan)).toBe('Keep\nAlpha\nTail')
    session.commitPatchPlan(removal.plan)
    expect(sourceHeadingLevel(session.snapshot().markdown, removal.selection.from)).toBeNull()
  })

  it('keeps H6 absent from the agreed toolbar descriptors', () => {
    const ids = createToolbarCommandDescriptors().map((descriptor) => descriptor.id)
    expect(ids).toEqual(expect.arrayContaining([...HEADING_COMMANDS]))
    expect(ids).not.toContain('block.h6')
  })
})
