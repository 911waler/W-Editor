import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  TiptapTransactionPatchPlanner,
  TiptapVisualAdapter,
  serializeOrdinaryTiptapPatch,
} from '../../src/adapters'
import { mediaSource, projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

const adapters: TiptapVisualAdapter[] = []

afterEach(() => {
  while (adapters.length > 0) adapters.pop()?.destroy()
  document.body.replaceChildren()
})

describe('media semantic-node editing', () => {
  it.each(['image', 'audio', 'video'] as const)('renders, falls back, edits, and undoes one %s transaction', (kind) => {
    const original = mediaSource(kind, `Original ${kind}`, `https://assets.example.test/original.${kind}`)
    const replacement = mediaSource(kind, `Updated ${kind}`, `https://assets.example.test/updated.${kind}`)
    const host = document.createElement('div')
    document.body.append(host)
    const plans: PatchPlan[] = []
    const onSemanticEdit = vi.fn()
    const session = new DocumentSession({ documentId: `media-${kind}`, markdown: original })
    const adapter = new TiptapVisualAdapter({
      host,
      onSemanticEdit,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `media-${kind}:${plans.length + 1}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    adapters.push(adapter)

    const node = host.querySelector<HTMLElement>('[data-semantic-kind="media"]')
    expect(node?.getAttribute('data-media-kind')).toBe(kind)
    expect(node?.querySelector(`.semantic-preview__media-element`)?.tagName.toLowerCase()).toBe(kind === 'image' ? 'img' : kind)
    node?.querySelector<HTMLElement>('.semantic-preview__media-element')?.dispatchEvent(new Event('error'))
    expect(node?.dataset['previewState']).toBe('error')
    expect(node?.querySelector<HTMLElement>(`[data-media-fallback="${kind}"]`)?.hidden).toBe(false)
    expect(node?.textContent).toContain(`https://assets.example.test/original.${kind}`)

    node?.querySelector<HTMLButtonElement>('[data-semantic-edit="media-editor"]')?.click()
    expect(onSemanticEdit).toHaveBeenCalledWith(expect.objectContaining({
      editorId: 'media-editor',
      kind: 'media',
      mediaKind: kind,
      name: `Original ${kind}`,
      source: original,
      url: `https://assets.example.test/original.${kind}`,
    }))

    expect(adapter.applySemanticBlock({
      editorId: 'media-editor',
      identity: `${kind} media`,
      kind: 'media',
      mediaKind: kind,
      name: `Updated ${kind}`,
      source: replacement,
      url: `https://assets.example.test/updated.${kind}`,
    })).toEqual({ active: true, changed: true })
    expect(plans).toHaveLength(1)
    expect(plans[0]?.patches).toEqual([{
      codecId: kind === 'image' ? 'paragraph' : `media-${kind}`,
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
