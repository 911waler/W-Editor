import { flushPromises, mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import NwuReader from '../../src/ui/NwuReader.vue'

const nestedOutlineMarkdown = '# 起点\n\n## 分支\n\n### 叶子\n\n## 同级\n\n# 末章\n\n## 尾叶'

function outlineReader(markdown = nestedOutlineMarkdown) {
  return mount(NwuReader, { attachTo: document.body, props: { config: {
    userId: 1, csrfToken: 'test', initialDocumentId: 'blog:2', readonly: true,
    apiBase: '/api/blog-editor', blogListUrl: '/blogs',
    readerDocument: {documentId: 'blog:2', title: '目录测试', markdown},
  } } })
}

it('indents skipped heading levels consistently while preserving numbering, folding and navigation', async () => {
  const app = outlineReader('# 起点\n\n#### 先遇深层\n\n##### 深层子项\n\n## 后续分支\n\n#### 后遇深层')
  try {
    await flushPromises()
    const rows = app.findAll<HTMLElement>('.article-outline__row')
    expect(rows.map(row => row.element.style.getPropertyValue('--outline-depth'))).toEqual(['0', '3', '4', '1', '3'])
    expect(rows.map(row => row.attributes('data-outline-level'))).toEqual(['1', '4', '5', '2', '4'])
    expect(rows.map(row => row.attributes('data-outline-indent'))).toEqual(['0', '3', '4', '1', '3'])
    expect(rows.map(row => row.attributes('data-outline-depth'))).toEqual(['0', '1', '2', '1', '2'])
    expect(rows.map(row => row.findAll('.article-outline__guide').length)).toEqual([0, 3, 4, 1, 3])
    expect(rows[2]!.findAll('.article-outline__guide').map(guide => guide.classes().includes('article-outline__guide--end'))).toEqual([false, true, true, true])
    expect(app.findAll('.article-outline__number').map(item => item.text())).toEqual(['1', '1.1', '1.1.1', '1.2', '1.2.1'])
    await app.get('.article-outline__toggle[aria-label="折叠“先遇深层”的子目录"]').trigger('click')
    expect(app.findAll('.article-outline__text').map(item => item.text())).toEqual(['起点', '先遇深层', '后续分支', '后遇深层'])
    await app.get('.article-outline__toggle[aria-label="折叠“后续分支”的子目录"]').trigger('click')
    expect(app.findAll('.article-outline__text').map(item => item.text())).toEqual(['起点', '先遇深层', '后续分支'])
    const branch = app.findAll('.article-outline__item')[2]!
    await branch.trigger('click')
    expect(branch.attributes('aria-current')).toBe('location')
    expect(document.activeElement).toBe(app.get('.ProseMirror h2').element)
    expect(app.findAll('.article-outline__number').map(item => item.text())).toEqual(['1', '1.1', '1.2'])
  } finally { app.unmount() }
})

it('uses the shallowest heading as the indent baseline even when a deeper heading comes first', async () => {
  const app = outlineReader('#### 前置深层\n\n## 后续分支\n\n#### 后置深层')
  try {
    await flushPromises()
    const rows = app.findAll<HTMLElement>('.article-outline__row')
    expect(rows.map(row => row.element.style.getPropertyValue('--outline-depth'))).toEqual(['2', '0', '2'])
    expect(rows.map(row => row.attributes('data-outline-indent'))).toEqual(['2', '0', '2'])
    expect(rows.map(row => row.attributes('data-outline-depth'))).toEqual(['0', '0', '1'])
    expect(rows.map(row => row.findAll('.article-outline__guide').length)).toEqual([2, 0, 2])
    expect(rows[0]!.find('.article-outline__toggle').exists()).toBe(false)
    expect(app.findAll('.article-outline__number').map(item => item.text())).toEqual(['1', '2', '2.1'])
    await app.get('.article-outline__toggle[aria-label="折叠“后续分支”的子目录"]').trigger('click')
    expect(app.findAll('.article-outline__text').map(item => item.text())).toEqual(['前置深层', '后续分支'])
    expect(app.findAll('.article-outline__number').map(item => item.text())).toEqual(['1', '2'])
  } finally { app.unmount() }
})

it('collapses descendants while preserving nested choices and the original outline numbering', async () => {
  const app = outlineReader()
  try {
    await flushPromises()
    const numbers = () => app.findAll('.article-outline__number').map(item => item.text())
    const toggle = (title: string) => app.get(`.article-outline__toggle[aria-label="折叠“${title}”的子目录"]`)
    expect(app.findAll('.article-outline__toggle')).toHaveLength(3)
    expect(numbers()).toEqual(['1', '1.1', '1.1.1', '1.2', '2', '2.1'])
    await toggle('分支').trigger('click')
    expect(numbers()).toEqual(['1', '1.1', '1.2', '2', '2.1'])
    await toggle('起点').trigger('click')
    expect(numbers()).toEqual(['1', '2', '2.1'])
    await app.get('.article-outline__toggle[aria-label="展开“起点”的子目录"]').trigger('click')
    expect(numbers()).toEqual(['1', '1.1', '1.2', '2', '2.1'])
    expect(app.get('.article-outline__toggle[aria-label="展开“分支”的子目录"]').attributes('aria-expanded')).toBe('false')
    const leaf = app.findAll('.article-outline__row').find(row => row.get('.article-outline__text').text() === '同级')!
    expect(leaf.find('.article-outline__toggle').exists()).toBe(false)
    expect(leaf.get('.article-outline__toggle-spacer').attributes('aria-hidden')).toBe('true')
  } finally { app.unmount() }
})

it('keeps heading navigation separate from outline toggles after earlier descendants are hidden', async () => {
  const app = outlineReader()
  try {
    await flushPromises()
    await app.get('.article-outline__toggle[aria-label="折叠“起点”的子目录"]').trigger('click')
    const lastChapter = app.findAll('.article-outline__item').find(item => item.text().includes('末章'))!
    await lastChapter.trigger('click')
    expect(lastChapter.attributes('aria-current')).toBe('location')
    expect(document.activeElement?.textContent).toBe('末章')
    expect(app.findAll('.article-outline__number').map(item => item.text())).toEqual(['1', '2', '2.1'])
    const focusedHeading = document.activeElement
    const pane = app.get<HTMLElement>('.nwu-reader-content')
    const scrollTop = pane.element.scrollTop
    await app.get('.article-outline__toggle[aria-label="展开“起点”的子目录"]').trigger('click')
    expect(document.activeElement).toBe(focusedHeading)
    expect(pane.element.scrollTop).toBe(scrollTop)
    expect(app.get('.article-outline__item[aria-current="location"]').text()).toContain('末章')
  } finally { app.unmount() }
})

it('resets collapsed headings when the document or its heading structure changes', async () => {
  const app = outlineReader()
  try {
    await flushPromises()
    await app.get('.article-outline__toggle[aria-label="折叠“起点”的子目录"]').trigger('click')
    await app.setProps({ config: {
      ...app.props('config'),
      readerDocument: {documentId: 'blog:3', title: '另一篇', markdown: nestedOutlineMarkdown},
    } })
    await flushPromises()
    expect(app.get('.article-outline__toggle[aria-label="折叠“起点”的子目录"]').attributes('aria-expanded')).toBe('true')
    await app.get('.article-outline__toggle[aria-label="折叠“起点”的子目录"]').trigger('click')
    await app.setProps({ config: {
      ...app.props('config'),
      readerDocument: {documentId: 'blog:3', title: '另一篇', markdown: '# 新起点\n\n## 新分支'},
    } })
    await flushPromises()
    expect(app.findAll('.article-outline__text').map(item => item.text())).toEqual(['新起点', '新分支'])
    expect(app.get('.article-outline__toggle[aria-label="折叠“新起点”的子目录"]').attributes('aria-expanded')).toBe('true')
  } finally { app.unmount() }
})

it('keeps a collapsed branch when only the body text changes', async () => {
  const app = outlineReader()
  try {
    await flushPromises()
    await app.get('.article-outline__toggle[aria-label="折叠“起点”的子目录"]').trigger('click')
    await app.setProps({ config: {
      ...app.props('config'),
      readerDocument: {documentId: 'blog:2', title: '目录测试', markdown: `${nestedOutlineMarkdown}\n\n新正文`},
    } })
    await flushPromises()
    expect(app.findAll('.article-outline__number').map(item => item.text())).toEqual(['1', '2', '2.1'])
    expect(app.get('.article-outline__toggle[aria-label="展开“起点”的子目录"]').attributes('aria-expanded')).toBe('false')
    const lastChapter = app.findAll('.article-outline__item').find(item => item.text().includes('末章'))!
    await lastChapter.trigger('click')
    expect(document.activeElement).toBe(app.findAll('.ProseMirror h1')[1]!.element)
  } finally { app.unmount() }
})

it('ignores an earlier presentation settling failure after the latest document is ready', async () => {
  const app = outlineReader()
  const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
  try {
    await flushPromises()
    let failEarlier!: (error: Error) => void
    const fonts = { ready: new Promise<void>((_resolve, reject) => { failEarlier = reject }) }
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
    await app.setProps({ config: {
      ...app.props('config'),
      readerDocument: {documentId: 'blog:3', title: '较早版本', markdown: '# 较早标题\n\n## 较早子标题'},
    } })
    await flushPromises()
    fonts.ready = Promise.resolve()
    await app.setProps({ config: {
      ...app.props('config'),
      readerDocument: {documentId: 'blog:4', title: '最新版本', markdown: '# 最新标题\n\n## 最新子标题'},
    } })
    await flushPromises()
    failEarlier(new Error('Earlier fonts failed to load'))
    await flushPromises()
    expect(app.findAll('.article-outline__text').map(item => item.text())).toEqual(['最新标题', '最新子标题'])
    expect(app.find('.nwu-reader-message').exists()).toBe(false)
  } finally {
    if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
    else Reflect.deleteProperty(document, 'fonts')
    app.unmount()
  }
})

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
