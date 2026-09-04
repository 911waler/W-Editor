import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

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
