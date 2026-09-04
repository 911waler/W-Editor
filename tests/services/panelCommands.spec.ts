import { describe, expect, it } from 'vitest'

import { PANEL_DESCRIPTORS, panelStarterSource } from '../../src/codecs'
import { DocumentSession } from '../../src/core'
import { createPanelCommandPlan } from '../../src/services'

describe('panel command plans', () => {
  it.each(PANEL_DESCRIPTORS)('inserts the $variant starter as one checked source patch', (descriptor) => {
    const session = new DocumentSession({ documentId: descriptor.variant, markdown: 'Alpha' })
    const result = createPanelCommandPlan(
      session.snapshot(),
      { from: 2, to: 2 },
      descriptor.commandId,
      `panel:${descriptor.variant}`,
    )
    expect(session.previewPatchPlan(result.plan)).toBe(`Alpha\n\n${panelStarterSource(descriptor.commandId)}`)
    const acknowledgement = session.commitPatchPlan(result.plan)
    expect(acknowledgement.revision).toBe(1)
    expect(result.selection).toEqual({ from: 5, to: session.snapshot().markdown.length })
  })
})
