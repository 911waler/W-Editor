import { flushPromises, mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import NwuReader from '../../src/ui/NwuReader.vue'

it('opens outline and expands only the published document category, retaining manual toggles', async () => {
  const app = mount(NwuReader, { props: { config: {
    userId: 1, csrfToken: 'test', initialDocumentId: 'blog:2', readonly: true,
    apiBase: '/api/blog-editor', blogListUrl: '/blogs',
    categories: {one: '教程', two: '笔记'},
    readerDocument: {documentId: 'blog:2', title: 'B', markdown: '## 访问\n\n## 申请\n\n### 服务器\n\n### 网站'},
    readerArticles: [
      {documentId: 'blog:1', title: 'A', group: '教程', url: '/blogs/1'},
      {documentId: 'blog:2', title: 'B', group: '笔记', url: '/blogs/2'},
    ],
  } } })
  try {
    await flushPromises()
    expect(app.get('#reader-outline-tab').attributes('aria-selected')).toBe('true')
    expect(app.get('.article-outline__heading').text()).toContain('本文目录')
    expect(app.findAll('.article-outline__number').map(n => n.text())).toEqual(['1','2','2.1','2.2'])
    const guides = app.findAll('.article-outline__guide')
    expect(guides).toHaveLength(2)
    expect(guides[0]!.attributes('aria-hidden')).toBe('true')
    expect(guides[0]!.classes()).not.toContain('article-outline__guide--end')
    expect(guides[1]!.classes()).toContain('article-outline__guide--end')
    await app.get('#reader-articles-tab').trigger('click')
    const toggles = () => app.findAll('.article-category-toggle')
    expect(toggles().map(t => t.attributes('aria-expanded'))).toEqual(['false', 'true'])
    await toggles()[0]!.trigger('click')
    await app.get('#reader-outline-tab').trigger('click')
    await app.get('#reader-articles-tab').trigger('click')
    expect(toggles().map(t => t.attributes('aria-expanded'))).toEqual(['true', 'true'])
  } finally { app.unmount() }
})

it('renders escaped announcement metadata beside its title and uses announcement navigation', async () => {
  const app = mount(NwuReader, { props: { config: {
    userId: 1, csrfToken: 'test', initialDocumentId: 'announcement:1', readonly: true, documentKind: 'announcement',
    apiBase: '/api/announcement-editor', blogListUrl: '/announcements',
    readerDocument: {documentId: 'announcement:1', title: '公告', markdown: '# 内容'},
    readerMetadata: {level: '重要公告', author: '<img src=x>', publishedAt: '2026-09-19 10:00', updatedAt: '2026-09-19 11:00', reminderEnded: true, preview: false},
  } } })
  try {
    await flushPromises()
    expect(app.get('.nwu-reader-back').text()).toBe('公告中心')
    expect(app.get('#reader-articles-tab').text()).toBe('公告')
    const meta = app.get('[data-announcement-metadata]')
    expect(meta.text()).toContain('重要公告')
    expect(meta.text()).toContain('<img src=x>')
    expect(meta.text()).toContain('北京时间')
    expect(meta.text()).toContain('提醒已结束')
    expect(meta.find('img').exists()).toBe(false)
    expect(meta.element.closest('.nwu-reader-actions')).not.toBeNull()
  } finally { app.unmount() }
})
