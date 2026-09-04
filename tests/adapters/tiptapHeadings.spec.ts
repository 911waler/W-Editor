import { describe, expect, it } from 'vitest'

import {
  TiptapTransactionPatchPlanner,
  TiptapVisualAdapter,
  serializeOrdinaryTiptapPatch,
} from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'
import type { HeadingCommandId } from '../../src/services'

const HEADING_COMMANDS: readonly HeadingCommandId[] = ['block.h1', 'block.h2', 'block.h3', 'block.h4', 'block.h5']

describe('direct visual headings', () => {
  it.each(HEADING_COMMANDS)('applies and reports the active state for %s', (commandId) => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: commandId, markdown: 'Alpha' })
    const plans: PatchPlan[] = []
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `${commandId}:apply`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    try {
      adapter.setSelection({ anchor: 1, head: 6 })
      expect(adapter.applyHeading(commandId)).toEqual({ active: true, changed: true })
      expect(adapter.isHeadingActive(commandId)).toBe(true)
      expect(plans).toHaveLength(1)
      expect(plans[0]?.patches[0]?.replacement).toBe(`${'#'.repeat(Number(commandId.at(-1)))} Alpha`)

      const applied = plans[0]
      if (applied === undefined) throw new Error('Expected the heading application patch plan.')
      session.commitPatchPlan(applied)
      const acknowledged = projectOrdinaryMarkdown(session.snapshot())
      adapter.acknowledgeSynchronization({ map: acknowledged.map, snapshot: session.snapshot() })

      expect(adapter.applyHeading(commandId)).toEqual({ active: false, changed: true })
      expect(adapter.isHeadingActive(commandId)).toBe(false)
      expect(plans).toHaveLength(2)
      expect(plans[1]?.patches[0]?.replacement).toBe('Alpha')
    } finally {
      adapter.destroy()
      host.remove()
    }
  })
})
