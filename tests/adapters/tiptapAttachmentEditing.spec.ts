import { afterEach, describe, expect, it, vi } from 'vitest'

import { TiptapTransactionPatchPlanner, TiptapVisualAdapter, serializeOrdinaryTiptapPatch } from '../../src/adapters'
import { attachmentSource, projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

const adapters: TiptapVisualAdapter[] = []

afterEach(() => {
  while (adapters.length > 0) adapters.pop()?.destroy()
  document.body.replaceChildren()
})

describe('attachment semantic-node editing', () => {
  it.each([
    ['pdf', 'application/pdf'],
    ['word', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['file', 'text/plain'],
  ] as const)('renders and edits one typed %s card transaction', (kind, mediaType) => {
    const original = attachmentSource({ kind, mediaType, name: `Original ${kind}`, size: 128, url: `https://assets.example.test/original-${kind}` })
    const replacement = attachmentSource({ kind, mediaType, name: `Updated ${kind}`, size: 256, url: `https://assets.example.test/updated-${kind}` })
    const host = document.createElement('div')
    document.body.append(host)
    const plans: PatchPlan[] = []
    const onSemanticEdit = vi.fn()
    const session = new DocumentSession({ documentId: `attachment-${kind}`, markdown: original })
    const adapter = new TiptapVisualAdapter({
      host,
      onSemanticEdit,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `attachment-${kind}:${plans.length + 1}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    adapters.push(adapter)

    const node = host.querySelector<HTMLElement>('[data-semantic-kind="attachment"]')
    expect(node?.getAttribute('data-attachment-kind')).toBe(kind)
    expect(node?.querySelector('.semantic-preview__attachment-type')?.textContent).toContain(kind === 'pdf' ? 'PDF' : kind === 'word' ? 'Word' : 'File')
    expect(node?.querySelector<HTMLAnchorElement>('[data-semantic-attachment-link]')?.href).toBe(`https://assets.example.test/original-${kind}`)
    node?.querySelector<HTMLButtonElement>('[data-semantic-edit="attachment-editor"]')?.click()
    expect(onSemanticEdit).toHaveBeenCalledWith(expect.objectContaining({
      attachmentKind: kind,
      editorId: 'attachment-editor',
      mediaType,
      name: `Original ${kind}`,
      size: 128,
      url: `https://assets.example.test/original-${kind}`,
    }))

    expect(adapter.applySemanticBlock({
      attachmentKind: kind,
      editorId: 'attachment-editor',
      identity: `${kind} attachment`,
      kind: 'attachment',
      mediaType,
      name: `Updated ${kind}`,
      size: 256,
      source: replacement,
      url: `https://assets.example.test/updated-${kind}`,
    })).toEqual({ active: true, changed: true })
    expect(plans).toHaveLength(1)
    expect(plans[0]?.patches[0]).toEqual({
      codecId: `attachment-${kind}`,
      expected: original,
      from: 0,
      replacement,
      to: original.length,
    })
  })
})
