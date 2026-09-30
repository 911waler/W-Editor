import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PlaygroundApp from '../../apps/playground/src/PlaygroundApp.vue'

describe('host article categories', () => {
  it('defaults to outline and expands only the current category, including after switching', async () => {
    const app = mount(PlaygroundApp, { props: {
      articleCatalog: [
        { documentId: 'a', title: 'A', initialMarkdown: '# A', group: '教程' },
        { documentId: 'b', title: 'B', initialMarkdown: '# B', group: '笔记' },
      ], articleGroupLabels: ['教程', '笔记'],
    } })
    try {
      await flushPromises()
      expect(app.get('[data-article-panel-tab="outline"]').attributes('aria-selected')).toBe('true')
      await app.get('[data-article-panel-tab="articles"]').trigger('click')
      const toggles = () => app.findAll('[data-testid="article-category-toggle"]')
      expect(toggles().map(t => t.attributes('aria-expanded'))).toEqual(['true', 'false'])
      await toggles()[1]!.trigger('click')
      expect(toggles()[1]!.attributes('aria-expanded')).toBe('true')
      await app.setProps({ articleGroupOverrides: { a: '教程' } })
      expect(toggles()[1]!.attributes('aria-expanded')).toBe('true')
      await app.get('button[data-document-id="b"]').trigger('click')
      await flushPromises()
      expect(app.get('[data-article-panel-tab="outline"]').attributes('aria-selected')).toBe('true')
      await app.get('[data-article-panel-tab="articles"]').trigger('click')
      expect(toggles().map(t => t.attributes('aria-expanded'))).toEqual(['false', 'true'])
    } finally { app.unmount() }
  })
  it('regroups an unopened article using loaded metadata immediately', async () => {
    const app = mount(PlaygroundApp, { props: {
      articleCatalog: [
        { documentId: 'first', title: 'First', initialMarkdown: '', group: '软件教程' },
        { documentId: 'second', title: 'Second', initialMarkdown: '', group: '软件教程' },
      ],
      articleGroupLabels: ['软件教程', '学习笔记', '其他'],
      loadArticle: async () => ({ documentId: 'second', title: 'Second', initialMarkdown: '', group: '学习笔记' }),
    } })
    try {
      await flushPromises()
      await app.get('[data-article-panel-tab="articles"]').trigger('click')
      await app.get('button[data-document-id="second"]').trigger('click')
      await flushPromises()
      await app.get('[data-article-panel-tab="articles"]').trigger('click')
      expect(app.findAll('[data-testid="article-category-heading"]').map(heading => heading.text())).toEqual(['软件教程', '学习笔记'])
      expect(app.get('button[data-document-id="second"]').attributes('aria-current')).toBe('page')
    } finally { app.unmount() }
  })
  it('groups all articles by host category and moves a reclassified article without losing selection', async () => {
    const app = mount(PlaygroundApp, { props: {
      articleCatalog: [
        { documentId: 'a', title: '教程A', initialMarkdown: '', group: '软件教程' },
        { documentId: 'b', title: '笔记B', initialMarkdown: '', group: '学习笔记' },
        { documentId: 'c', title: '草稿C', initialMarkdown: '' },
        { documentId: 'd', title: '教程D', initialMarkdown: '', group: '软件教程' },
      ],
      articleGroupLabels: ['软件教程', '学习笔记', '其他'],
    } })
    try {
      await flushPromises()
      await app.get('[data-article-panel-tab="articles"]').trigger('click')
      await app.get('button[data-document-id="a"]').trigger('click')
      await flushPromises()
      await app.get('[data-article-panel-tab="articles"]').trigger('click')
      const groups = () => app.findAll('[data-testid="article-category-group"]')
      expect(groups().map(g => g.get('[data-testid="article-category-heading"]').text())).toEqual(['软件教程', '学习笔记', '其他'])
      expect(groups()[0]?.findAll('button[data-document-id]').map(row => row.attributes('data-document-id'))).toEqual(['a', 'd'])
      expect(app.find('[data-testid="article-date-heading"]').exists()).toBe(false)
      const toggle = groups()[0]!.get('[data-testid="article-category-toggle"]')
      expect(toggle.attributes('aria-expanded')).toBe('true')
      expect(groups()[0]!.get('.article-category-count').text()).toBe('2')
      await toggle.trigger('click')
      expect(toggle.attributes('aria-expanded')).toBe('false')
      expect(groups()[0]!.get('.article-group-items').attributes('hidden')).toBeDefined()
      expect(groups()[1]!.get('.article-group-items').attributes('hidden')).toBeDefined()
      await toggle.trigger('click')
      expect(toggle.attributes('aria-expanded')).toBe('true')
      await app.setProps({ articleGroupOverrides: { a: '学习笔记' } })
      expect(groups()[1]?.findAll('button[data-document-id]').map(row => row.attributes('data-document-id'))).toEqual(['a', 'b'])
      expect(app.get('button[data-document-id="a"]').attributes('aria-current')).toBe('page')
      expect(app.findAll('button[data-document-id]')).toHaveLength(4)
    } finally { app.unmount() }
  })
})
