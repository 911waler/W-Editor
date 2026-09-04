import { afterEach, describe, expect, it } from 'vitest'

import {
  TiptapTransactionPatchPlanner,
  TiptapVisualAdapter,
  serializeOrdinaryTiptapPatch,
} from '../../src/adapters'
import { parseTimelineAt, projectOrdinaryMarkdown, timelineStarterSource } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

const adapters: TiptapVisualAdapter[] = []

afterEach(() => {
  while (adapters.length > 0) adapters.pop()?.destroy()
  document.body.replaceChildren()
})

describe('typed timeline preview and selection', () => {
  it('renders timeline data and exposes its dedicated edit strategy', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'timeline-preview', markdown: timelineStarterSource() })
    const adapter = new TiptapVisualAdapter({ host, project: projectOrdinaryMarkdown, session })
    adapters.push(adapter)
    const timeline = host.querySelector('[data-semantic-kind="timeline"] .cherry-markdown .cherry-timeline')
    expect(timeline?.querySelector('.cherry-timeline--header')?.textContent).toBe('Timeline')
    expect(timeline?.querySelector('.cherry-timeline--body')?.getAttribute('role')).toBe('list')
    expect(timeline?.querySelectorAll('.cherry-timeline--item')).toHaveLength(3)
    expect(timeline?.querySelector('[data-timeline-status="doing"] .cherry-timeline--title')?.textContent).toBe('Alpha release')
    expect(adapter.projection().map.entries[0]?.safePatchUnit.strategy).toEqual({
      editorId: 'timeline-editor',
      kind: 'semantic-editor',
    })
  })

  it('inserts timeline as the selected atom and exposes exact edit source', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'timeline-insert', markdown: 'Alpha' })
    const plans: PatchPlan[] = []
    const adapter = new TiptapVisualAdapter({
      host,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `timeline:${plans.length + 1}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    adapters.push(adapter)
    const source = timelineStarterSource()
    const parsed = parseTimelineAt(source, 0)
    if (parsed === null) throw new Error('Timeline starter must parse.')
    expect(adapter.applySemanticBlock({
      items: parsed.items,
      kind: 'timeline',
      source,
      title: parsed.title,
    })).toEqual({ active: true, changed: true })
    expect(adapter.selection().kind).toBe('node')
    expect(adapter.selectedSemanticBlock()).toEqual({ kind: 'timeline', layoutKind: null, source })
    expect(plans.at(-1)?.patches[0]?.replacement).toBe(`Alpha\n\n${source}`)
  })
})
