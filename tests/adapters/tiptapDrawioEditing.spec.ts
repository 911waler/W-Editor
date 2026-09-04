import { afterEach, describe, expect, it, vi } from 'vitest'

import { TiptapTransactionPatchPlanner, TiptapVisualAdapter, serializeOrdinaryTiptapPatch } from '../../src/adapters'
import { drawioSource, projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

const adapters: TiptapVisualAdapter[] = []

afterEach(() => {
  while (adapters.length > 0) adapters.pop()?.destroy()
  document.body.replaceChildren()
})

describe('draw.io semantic-node editing', () => {
  it('previews, edits in one transaction, and undoes to the original source', () => {
    const png = 'data:image/png;base64,AAAA'
    const original = drawioSource('Architecture', png, '<mxfile><diagram id="old"/></mxfile>')
    const replacement = drawioSource('Architecture', png, '<mxfile><diagram id="new"/></mxfile>')
    const host = document.createElement('div')
    document.body.append(host)
    const plans: PatchPlan[] = []
    const onSemanticEdit = vi.fn()
    const session = new DocumentSession({ documentId: 'drawio-edit', markdown: original })
    const adapter = new TiptapVisualAdapter({
      host,
      onSemanticEdit,
      onTransaction: ({ patchPlan }) => { if (patchPlan !== null) plans.push(patchPlan) },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `drawio-edit:${plans.length + 1}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    adapters.push(adapter)

    const node = host.querySelector<HTMLElement>('[data-semantic-kind="drawio"]')
    expect(node?.querySelector('img')?.getAttribute('src')).toBe(png)
    node?.querySelector<HTMLButtonElement>('[data-semantic-edit="drawio-editor"]')?.click()
    expect(onSemanticEdit).toHaveBeenCalledWith(expect.objectContaining({
      editorId: 'drawio-editor',
      kind: 'drawio',
      name: 'Architecture',
      source: original,
      xml: '<mxfile><diagram id="old"/></mxfile>',
    }))

    expect(adapter.applySemanticBlock({
      editorId: 'drawio-editor',
      identity: 'draw.io · Architecture',
      kind: 'drawio',
      name: 'Architecture',
      png,
      source: replacement,
      xml: '<mxfile><diagram id="new"/></mxfile>',
    })).toEqual({ active: true, changed: true })
    expect(plans).toHaveLength(1)
    expect(plans[0]?.patches).toEqual([{
      codecId: 'drawio',
      expected: original,
      from: 0,
      replacement,
      to: original.length,
    }])

    session.commitPatchPlan(plans[0]!)
    const snapshot = session.snapshot()
    adapter.acknowledgeSynchronization({ map: projectOrdinaryMarkdown(snapshot).map, snapshot })
    expect(snapshot.markdown).toBe(replacement)
    expect(adapter.undo()).toBe(true)
    expect(plans[1]?.patches[0]?.replacement).toBe(original)
  })
})
