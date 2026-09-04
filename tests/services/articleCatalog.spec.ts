import { describe, expect, it, vi } from 'vitest'

import {
  ArticleCatalogAdapter,
  ArticleSwitchCoordinator,
  openDefaultArticle,
} from '../../src/services/articleCatalog'

describe('fixed article catalog and switching', () => {
  it('exposes a deterministic initial catalog through read-only list and lookup operations', () => {
    const catalog = new ArticleCatalogAdapter()

    expect(catalog.list().map(({ documentId, title }) => ({ documentId, title }))).toEqual([
      { documentId: 'welcome', title: 'Welcome to W-Editor' },
      { documentId: 'product-notes', title: 'Product notes' },
      { documentId: 'formatting-gallery', title: 'Formatting gallery' },
    ])
    expect(catalog.initial()).toBe(catalog.lookup('welcome'))
    expect(catalog.lookup('missing')).toBeNull()
    expect(Object.keys(catalog)).not.toEqual(expect.arrayContaining(['create', 'delete', 'rename']))
  })

  it('loads the three shared showcase bodies without the old fixture-host image URL', () => {
    const catalog = new ArticleCatalogAdapter()

    expect(catalog.lookup('welcome')?.initialMarkdown).toContain('# 一级标题')
    expect(catalog.lookup('welcome')?.initialMarkdown).not.toContain('fixtures.w-editor.test')
    expect(catalog.lookup('product-notes')?.initialMarkdown).toContain('4H-SiC MOSFET')
    expect(catalog.lookup('formatting-gallery')?.initialMarkdown).toContain('DFT生成标签')
  })

  it('flushes before switching and preserves each opened document session', async () => {
    const catalog = new ArticleCatalogAdapter()
    const events: string[] = []
    const coordinator = new ArticleSwitchCoordinator({
      catalog,
      flushCurrent: async (article) => { events.push(`flush:${article.definition.documentId}`) },
      initialArticle: openDefaultArticle(catalog.initial()),
      openArticle: async (definition) => {
        events.push(`open:${definition.documentId}`)
        return openDefaultArticle(definition)
      },
    })
    const published = vi.fn()
    coordinator.subscribe(published)

    await coordinator.request('product-notes')
    coordinator.active().session.commitSource({ markdown: '# Edited product', origin: 'cherry-source' })
    await coordinator.request('welcome')
    await coordinator.request('product-notes')

    expect(events).toEqual([
      'flush:welcome',
      'open:product-notes',
      'flush:product-notes',
      'flush:welcome',
    ])
    expect(coordinator.active().session.snapshot().markdown).toBe('# Edited product')
    expect(published).toHaveBeenCalledTimes(3)
  })

  it('keeps the current article active when its flush fails', async () => {
    const catalog = new ArticleCatalogAdapter()
    const initialArticle = openDefaultArticle(catalog.initial())
    const coordinator = new ArticleSwitchCoordinator({
      catalog,
      flushCurrent: () => { throw new Error('persistence failed') },
      initialArticle,
      openArticle: openDefaultArticle,
    })

    await expect(coordinator.request('product-notes')).rejects.toThrow('persistence failed')
    expect(coordinator.active()).toBe(initialArticle)
  })
})
