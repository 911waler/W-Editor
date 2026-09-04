import { describe, expect, it } from 'vitest'

import { createPanelCommandPlan as sharedCreatePanelCommandPlan } from '../../packages/editor-core/src/commands/panelCommands'
import { calculateDocumentStatistics as sharedCalculateDocumentStatistics } from '../../packages/editor-core/src/commands/documentStatistics'
import { createPanelCommandPlan as rootCreatePanelCommandPlan } from '../../src/services/panelCommands'
import { calculateDocumentStatistics as rootCalculateDocumentStatistics } from '../../src/services/documentStatistics'
import { panelSource as sharedPanelSource } from '../../packages/editor-core/src/codecs'
import { panelSource as rootPanelSource } from '../../src/codecs'

describe('editor-core codec and content-command boundary', () => {
  it('owns codecs, commands, and statistics while root exports remain compatible', () => {
    const snapshot = Object.freeze({ documentId: 'article', markdown: 'body', revision: 2 })
    const selection = Object.freeze({ from: 0, to: 0 })

    expect(rootPanelSource).toBe(sharedPanelSource)
    expect(rootCreatePanelCommandPlan).toBe(sharedCreatePanelCommandPlan)
    expect(rootCalculateDocumentStatistics).toBe(sharedCalculateDocumentStatistics)
    expect(sharedCreatePanelCommandPlan(snapshot, selection, 'panel.info', 'tx').plan.baseRevision).toBe(2)
    expect(sharedCalculateDocumentStatistics(snapshot)).toEqual(rootCalculateDocumentStatistics(snapshot))
  })
})
