import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTiptapPresentation } from '../../packages/editor-vue/src/rendering/tiptapPresentation'

afterEach(() => {
  document.body.replaceChildren()
})

function mountFixture(path: string) {
  const container = document.createElement('div')
  document.body.append(container)
  const markdown = readFileSync(path, 'utf8')
  const instance = createTiptapPresentation(container, {
    locale: 'zh',
    profile: 'reader',
    snapshot: { documentId: path, markdown, revision: 0 },
  })
  return { container, instance, markdown }
}

describe('canonical Tiptap presentation coverage', () => {
  it.each(['id', 'name'])('navigates body TOC to a manual HTML anchor with %s', (attribute) => {
    const container = document.createElement('div'); document.body.append(container)
    const unrelated = document.createElement('a'); unrelated.id = 'g06'; document.body.prepend(unrelated)
    const outsideScroll = vi.fn(); unrelated.scrollIntoView = outsideScroll
    const markdown = `[目录项目](#g06)\n\n<a ${attribute}="g06"></a>\n\n## 手工锚点章节`
    const instance = createTiptapPresentation(container, { profile: 'reader', snapshot: {
      documentId: 'explicit-body-anchor', revision: 0, markdown,
    } })
    try {
      const target = container.querySelector<HTMLElement>(`a[${attribute}="g06"]`)
      expect(target).not.toBeNull()
      const scroll = vi.fn(); target!.scrollIntoView = scroll
      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      container.querySelector<HTMLAnchorElement>('a[href="#g06"]')!.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(scroll).toHaveBeenCalledWith({ block: 'start' })
      expect(outsideScroll).not.toHaveBeenCalled()
      expect(instance.snapshot().markdown).toBe(markdown)
    } finally { instance.destroy() }
  })

  it.each(['section', '%E7%AB%A0%E8%8A%82', '章节'])('keeps body TOC fragment %s in the current article', (anchor) => {
    const container = document.createElement('div'); document.body.append(container)
    const title = anchor === 'section' ? 'Section' : '章节'
    const markdown = `[目录](#${anchor})\n\n## ${title}`
    const instance = createTiptapPresentation(container, { profile: 'reader', snapshot: {
      documentId: 'body-toc', revision: 0, markdown,
    } })
    try {
      const heading = container.querySelector<HTMLElement>('h2')!
      const scroll = vi.fn(); heading.scrollIntoView = scroll
      const link = container.querySelector<HTMLAnchorElement>('a')!
      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      link.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(scroll).toHaveBeenCalledWith({ block: 'start' })
      expect(instance.snapshot().markdown).toBe(markdown)
    } finally { instance.destroy() }
  })

  it.each(['https://example.invalid/#section', '/other-article#section', '#missing', '#%broken', '#'])('leaves nonmatching link %s unchanged', (href) => {
    const container = document.createElement('div'); document.body.append(container)
    const instance = createTiptapPresentation(container, { profile: 'reader', snapshot: {
      documentId: 'other-links', revision: 0, markdown: `[链接](${href})\n\n## Section`,
    } })
    try {
      const heading = container.querySelector<HTMLElement>('h2')!
      const scroll = vi.fn(); heading.scrollIntoView = scroll
      const event = new MouseEvent('click', { bubbles: true, cancelable: true })
      container.querySelector<HTMLAnchorElement>('a')!.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
      expect(scroll).not.toHaveBeenCalled()
    } finally { instance.destroy() }
  })

  it('uses shared inline images with saved dimensions in read-only aligned paragraphs', () => {
    const container = document.createElement('div'); document.body.append(container)
    const instance = createTiptapPresentation(container, { profile: 'reader', snapshot: {
      documentId: 'sized-images', revision: 0,
      markdown: '::: center\n![A](/a.png){width=320 height=180} ![B](/b.png)\n:::',
    } })
    try {
      expect(container.querySelectorAll('[data-inline-image] img[src]')).toHaveLength(2)
      expect(container.querySelector('[data-inline-image] img')?.getAttribute('width')).toBe('320')
      expect(container.querySelector('[data-alignment="center"]')).not.toBeNull()
      expect(container.querySelector('[data-image-resize-handle], [data-image-toolbar]')).toBeNull()
    } finally { instance.destroy() }
  })

  it('maps the representative Cherry capability fixture into one read-only Tiptap tree', () => {
    const { container, instance, markdown } = mountFixture('tests/fixtures/cherry/representative.md')
    const root = container.querySelector<HTMLElement>('.ProseMirror')

    expect(root?.dataset['presentationEngine']).toBe('tiptap')
    expect(root?.dataset['rendererProfile']).toBe('reader')
    expect(root?.querySelectorAll('h1')).toHaveLength(1)
    expect(root?.querySelectorAll('[data-semantic-kind="panel"]')).toHaveLength(1)
    expect(root?.querySelectorAll('[data-semantic-kind="timeline"]')).toHaveLength(1)
    expect(root?.querySelectorAll('[data-semantic-kind="disclosure"]')).toHaveLength(1)
    expect(root?.querySelectorAll('[data-semantic-kind="mermaid"]')).toHaveLength(1)
    expect(root?.querySelectorAll('[data-w-editor-node="code-block"]')).toHaveLength(1)
    expect(root?.querySelectorAll('[data-w-editor-node="toc"]')).toHaveLength(1)
    expect(root?.querySelectorAll('table')).toHaveLength(1)
    expect(root?.querySelector('[data-semantic-edit], [data-raw-edit]')).toBeNull()
    expect(instance.snapshot().markdown).toBe(markdown)

    instance.destroy()
  })

  it('maps columns, disclosures, timelines, chart tables, Mermaid and formulas through registered NodeViews', () => {
    const fixtures = [
      'tests/fixtures/cherry/column-layouts.md',
      'tests/fixtures/cherry/panels.md',
      'tests/fixtures/cherry/chart-tables.md',
      'tests/fixtures/cherry/mermaid.md',
      'tests/fixtures/cherry/formula.md',
    ]
    const expectedSelectors = [
      '[data-semantic-kind="column-layout"]',
      '[data-semantic-kind="panel"]',
      '[data-semantic-kind="chart-table"]',
      '[data-semantic-kind="mermaid"]',
      '.formula-node',
    ]

    fixtures.forEach((fixture, index) => {
      const { container, instance } = mountFixture(fixture)
      expect(container.querySelector(expectedSelectors[index] ?? '__missing__'), fixture).not.toBeNull()
      expect(container.querySelectorAll('[data-w-editor-presentation-fallback]')).toHaveLength(0)
      instance.destroy()
      container.remove()
    })
  })

  it('uses one sanitized atomic fallback for an unsupported raw block without changing its source', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const markdown = '::: mystery\n<script>bad()</script>\nFallback body\n:::'
    const instance = createTiptapPresentation(container, {
      profile: 'reader',
      snapshot: { documentId: 'raw', markdown, revision: 0 },
    })
    const fallback = container.querySelector<HTMLElement>('[data-w-editor-presentation-fallback="cherry-raw"]')

    expect(fallback).not.toBeNull()
    expect(container.querySelectorAll('[data-w-editor-presentation-fallback="cherry-raw"]')).toHaveLength(1)
    expect(fallback?.querySelector('script')).toBeNull()
    expect(fallback?.textContent).toContain('Fallback body')
    expect(container.querySelector('[data-w-editor-node="raw-block"]')).toBeNull()
    expect(instance.snapshot().markdown).toBe(markdown)

    instance.destroy()
  })
})
