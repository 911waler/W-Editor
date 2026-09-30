import { describe, expect, it } from 'vitest'

import {
  TiptapTransactionPatchPlanner,
  TiptapVisualAdapter,
  serializeOrdinaryTiptapPatch,
} from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

const UNICODE_ANCHOR = '%E7%AB%A0%E8%8A%82-%E4%B8%80'
const POPULATED = '# Alpha\n\n## 章节 一\n\n# Alpha\n\n### Custom {#chosen}\n\n[[toc]]'

function mount(markdown: string) {
  const host = document.createElement('div')
  document.body.append(host)
  const session = new DocumentSession({ documentId: 'toc', markdown })
  const plans: PatchPlan[] = []
  const adapter = new TiptapVisualAdapter({
    host,
    onTransaction: ({ patchPlan }) => {
      if (patchPlan !== null) plans.push(patchPlan)
    },
    patchPlanner: new TiptapTransactionPatchPlanner({
      createTransactionId: () => `toc:${plans.length + 1}`,
      serialize: serializeOrdinaryTiptapPatch,
    }),
    project: projectOrdinaryMarkdown,
    session,
  })
  return { adapter, host, plans }
}

describe('heading-derived visual table of contents', () => {
  it('projects a dedicated empty state without changing the exact marker', () => {
    const projection = projectOrdinaryMarkdown({ documentId: 'empty-toc', markdown: '[[toc]]', revision: 0 })
    expect(projection.content.content).toEqual([
      expect.objectContaining({ attrs: expect.objectContaining({ source: '[[toc]]' }), type: 'tocBlock' }),
    ])

    const { adapter, host } = mount('[[toc]]')
    try {
      const toc = host.querySelector<HTMLElement>('[data-w-editor-node="toc"]')
      expect(toc?.getAttribute('aria-label')).toBe('Table of contents')
      expect(toc?.querySelector('[data-toc-empty]')?.textContent).toContain('No headings')
      expect(toc?.querySelectorAll('a')).toHaveLength(0)
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('uses unique Cherry-compatible anchors, explicit anchors, keyboard navigation, and live heading text', () => {
    const projection = projectOrdinaryMarkdown({ documentId: 'populated-toc', markdown: POPULATED, revision: 0 })
    expect(projection.content.content?.map((node) => node.type)).toEqual([
      'heading',
      'heading',
      'heading',
      'heading',
      'tocBlock',
    ])
    expect(projection.content.content?.[3]).toEqual(expect.objectContaining({
      attrs: expect.objectContaining({ tocAnchor: 'chosen' }),
      content: [expect.objectContaining({ text: 'Custom', type: 'text' })],
    }))

    const { adapter, host, plans } = mount(POPULATED)
    try {
      const headings = [...host.querySelectorAll<HTMLElement>('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3')]
      expect(headings.map((heading) => heading.id)).toEqual(['alpha', UNICODE_ANCHOR, 'alpha-2', 'chosen'])
      expect(headings[3]?.textContent).toBe('Custom')

      const toc = host.querySelector<HTMLElement>('[data-w-editor-node="toc"]')
      const links = [...(toc?.querySelectorAll<HTMLAnchorElement>('a') ?? [])]
      expect(links.map((link) => [link.textContent, link.getAttribute('href'), link.dataset['tocLevel']])).toEqual([
        ['Alpha', '#alpha', '1'],
        ['章节 一', `#${UNICODE_ANCHOR}`, '2'],
        ['Alpha', '#alpha-2', '1'],
        ['Custom', '#chosen', '3'],
      ])

      links[0]?.focus()
      links[0]?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }))
      expect(document.activeElement).toBe(links[1])

      expect(adapter.navigateHeading('chosen')).toBe(true)
      expect(window.location.hash).toBe('#chosen')
      expect(adapter.selection().anchor).toBeGreaterThan(1)
      expect(adapter.navigateHeading('missing')).toBe(false)

      adapter.setSelection({ anchor: 1, head: 6 })
      adapter.insertText('Renamed')
      expect(toc?.querySelector<HTMLAnchorElement>('a')?.textContent).toBe('Renamed')
      expect(toc?.querySelector<HTMLAnchorElement>('a')?.getAttribute('href')).toBe('#renamed')
      expect(host.querySelector('h1')?.id).toBe('renamed')
      expect(plans.at(-1)?.patches[0]?.replacement).toBe('# Renamed')
    } finally {
      adapter.destroy()
      host.remove()
    }
  })

  it('inserts one TOC and makes the immediate second invocation a selected no-op', () => {
    const { adapter, host, plans } = mount('# Alpha')
    try {
      const first = adapter.insertSimpleBlock('insert.toc')
      const second = adapter.insertSimpleBlock('insert.toc')

      expect(first).toEqual({ active: true, changed: true })
      expect(second).toEqual({ active: true, changed: false })
      expect(adapter.documentJSON().content?.filter((node) => node.type === 'tocBlock')).toHaveLength(1)
      expect(plans).toHaveLength(1)
      expect(plans[0]?.patches.filter((patch) => patch.replacement.includes('[[toc]]'))).toHaveLength(1)
      expect(adapter.selection().kind).toBe('node')
    } finally {
      adapter.destroy()
      host.remove()
    }
  })
})
