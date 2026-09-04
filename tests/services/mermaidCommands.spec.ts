import { describe, expect, it } from 'vitest'

import { MERMAID_DESCRIPTORS, mermaidStarterSource } from '../../src/codecs'
import { DocumentSession } from '../../src/core'
import { createMermaidCommandPlan } from '../../src/services'

describe('Mermaid command plans', () => {
  it.each(MERMAID_DESCRIPTORS)('inserts the $diagramType starter as one checked source patch', (descriptor) => {
    const session = new DocumentSession({ documentId: descriptor.diagramType, markdown: 'Alpha' })
    const result = createMermaidCommandPlan(
      session.snapshot(),
      { from: 5, to: 5 },
      descriptor.commandId,
      `mermaid:${descriptor.diagramType}`,
    )
    expect(result.plan.patches).toHaveLength(1)
    expect(result.plan.patches[0]?.codecId).toBe(`mermaid-${descriptor.diagramType}`)
    expect(session.previewPatchPlan(result.plan)).toBe(`Alpha\n\n${mermaidStarterSource(descriptor.commandId)}`)
  })
})
