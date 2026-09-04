import { describe, expect, it } from 'vitest'

import {
  TiptapTransactionPatchPlanner,
  TiptapVisualAdapter,
  serializeOrdinaryTiptapPatch,
} from '../../src/adapters'
import { disclosureStarterSource, parseDisclosureAt, projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

describe('tabs and accordion semantic selection', () => {
  it.each(['layout.tabs', 'layout.accordion'] as const)('inserts %s as the selected atom and exposes its edit source', (commandId) => {
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
        createTransactionId: () => `${commandId}:${plans.length + 1}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    try {
      const source = disclosureStarterSource(commandId)
      const parsed = parseDisclosureAt(source, 0)
      if (parsed === null) throw new Error('Starter must parse.')
      expect(adapter.applySemanticBlock({
        items: parsed.items,
        kind: 'disclosure',
        layoutKind: parsed.kind,
        source,
      })).toEqual({ active: true, changed: true })
      expect(adapter.selection().kind).toBe('node')
      expect(adapter.selectedSemanticBlock()).toEqual({
        kind: 'disclosure',
        layoutKind: parsed.kind,
        source,
      })
      expect(plans.at(-1)?.patches[0]?.replacement).toBe(`Alpha\n\n${source}`)
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('changes tabs and accordion presentation without changing authoritative Markdown', () => {
    const markdown = `${disclosureStarterSource('layout.tabs')}\n\n${disclosureStarterSource('layout.accordion')}`
    const host = document.createElement('div')
    document.body.append(host)
    const plans: PatchPlan[] = []
    const session = new DocumentSession({ documentId: 'disclosure-presentation', markdown })
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `disclosure-presentation:${plans.length + 1}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    try {
      const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      expect(tabs).toHaveLength(2)
      tabs[0]?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
      expect(tabs[1]?.getAttribute('aria-selected')).toBe('true')
      expect(document.activeElement).toBe(tabs[1])
      expect(host.querySelectorAll<HTMLElement>('[role="tabpanel"]')[0]?.hidden).toBe(true)

      const accordion = host.querySelector<HTMLButtonElement>('[data-semantic-presentation="accordion-toggle"]')
      accordion?.click()
      expect(accordion?.getAttribute('aria-expanded')).toBe('false')
      const accordionBody = host.querySelector<HTMLElement>('.semantic-preview__accordion-body')
      expect(accordionBody?.hidden).toBe(true)

      expect(plans).toHaveLength(0)
      expect(session.snapshot()).toMatchObject({ markdown, revision: 0 })
    } finally {
      adapter.destroy()
      host.remove()
    }
  })
})
