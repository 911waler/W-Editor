import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  TiptapTransactionPatchPlanner,
  TiptapVisualAdapter,
  serializeOrdinaryTiptapPatch,
} from '../../src/adapters'
import { panelStarterSource, projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

const adapters: TiptapVisualAdapter[] = []

afterEach(() => {
  while (adapters.length > 0) adapters.pop()?.destroy()
  document.body.replaceChildren()
})

function mountRaw(markdown: string, onRawEdit = vi.fn()) {
  const host = document.createElement('div')
  document.body.append(host)
  const session = new DocumentSession({ documentId: 'raw-visual', markdown })
  const plans: PatchPlan[] = []
  let sequence = 0
  const adapter = new TiptapVisualAdapter({
    host,
    onRawEdit,
    onTransaction: ({ patchPlan }) => {
      if (patchPlan !== null) plans.push(patchPlan)
    },
    patchPlanner: new TiptapTransactionPatchPlanner({
      createTransactionId: () => `raw-visual:${++sequence}`,
      serialize: serializeOrdinaryTiptapPatch,
    }),
    project: projectOrdinaryMarkdown,
    session,
  })
  adapters.push(adapter)
  return { adapter, host, onRawEdit, plans, session }
}

describe('production raw-node visual editing', () => {
  it('projects unknown block and inline syntax as exact visible typed raw nodes', () => {
    const block = '::: mystery\r\nbody  \r\n:::'
    const markdown = `Before @@mystery(x)@@ after\r\n\r\n${block}`
    const projection = projectOrdinaryMarkdown({ documentId: 'raw-projection', markdown, revision: 4 })
    expect(projection.content.content?.[0]?.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ attrs: { source: '@@mystery(x)@@' }, type: 'rawInline' }),
    ]))
    expect(projection.content.content?.[1]).toMatchObject({ attrs: { source: block }, type: 'rawBlock' })
    expect(projection.map.entries[1]).toMatchObject({
      codecId: 'raw-block',
      originalSource: block,
      safePatchUnit: { expectedSource: block, strategy: { kind: 'direct', scope: 'block' } },
    })
  })

  it('opens the raw NodeView editor with the exact selected source', () => {
    const source = '::: mystery\nbody\n:::'
    const { adapter, host, onRawEdit, session } = mountRaw(source)
    const raw = host.querySelector<HTMLElement>('[data-w-editor-node="raw-block"]')
    expect(raw?.querySelector('.raw-node__source')?.textContent).toBe(source)
    raw?.querySelector<HTMLButtonElement>('[data-raw-edit="rawBlock"]')?.click()
    expect(adapter.selection().kind).toBe('node')
    expect(onRawEdit).toHaveBeenCalledOnce()
    expect(onRawEdit).toHaveBeenCalledWith({ kind: 'rawBlock', source })
    expect(session.snapshot().revision).toBe(0)
  })

  it('promotes a recognized replacement in one transaction and keeps one-step undo', () => {
    const original = '::: mystery\nbody\n:::'
    const replacement = panelStarterSource('panel.info')
    const { adapter, host, plans, session } = mountRaw(original)
    host.querySelector<HTMLButtonElement>('[data-raw-edit="rawBlock"]')?.click()

    expect(adapter.applyRawSource(replacement)).toEqual({ active: true, changed: true })
    expect(plans).toHaveLength(1)
    expect(plans[0]?.patches).toEqual([
      expect.objectContaining({ expected: original, from: 0, replacement, to: original.length }),
    ])
    expect(adapter.documentJSON().content?.[0]).toMatchObject({
      attrs: { kind: 'panel', source: replacement, variant: 'info' },
      type: 'semanticBlock',
    })

    session.commitPatchPlan(plans[0]!)
    adapter.acknowledgeSynchronization({ map: projectOrdinaryMarkdown(session.snapshot()).map, snapshot: session.snapshot() })
    expect(session.snapshot()).toEqual({ documentId: 'raw-visual', markdown: replacement, revision: 1 })

    expect(adapter.undo()).toBe(true)
    expect(plans).toHaveLength(2)
    expect(plans[1]?.patches[0]?.replacement).toBe(original)
    expect(adapter.documentJSON().content?.[0]).toMatchObject({ attrs: { source: original }, type: 'rawBlock' })
  })

  it('retains a still-unknown replacement as an exact raw node', () => {
    const original = '::: mystery\nbody\n:::'
    const replacement = '::: another-unknown\r\nbody  \r\n:::'
    const { adapter, host, plans } = mountRaw(original)
    host.querySelector<HTMLButtonElement>('[data-raw-edit="rawBlock"]')?.click()

    adapter.applyRawSource(replacement)
    expect(plans).toHaveLength(1)
    expect(plans[0]?.patches[0]?.replacement).toBe(replacement)
    expect(adapter.documentJSON().content?.[0]).toMatchObject({
      attrs: { source: replacement },
      type: 'rawBlock',
    })
    expect(host.querySelector('.raw-node__source')?.textContent).toBe(replacement)
  })

  it('promotes a recognized inline replacement without changing surrounding text', () => {
    const original = 'Before @@mystery@@ after'
    const { adapter, host, plans } = mountRaw(original)
    host.querySelector<HTMLButtonElement>('[data-raw-edit="rawInline"]')?.click()

    adapter.applyRawSource('**known**')
    expect(plans).toHaveLength(1)
    expect(plans[0]?.patches[0]?.replacement).toBe('Before **known** after')
    expect(adapter.documentJSON().content?.[0]?.content).toEqual([
      expect.objectContaining({ text: 'Before ', type: 'text' }),
      expect.objectContaining({ marks: [{ type: 'bold' }], text: 'known', type: 'text' }),
      expect.objectContaining({ text: ' after', type: 'text' }),
    ])
  })
})
