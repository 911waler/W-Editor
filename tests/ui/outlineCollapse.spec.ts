import { flushPromises, mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import PlaygroundApp from '../../apps/playground/src/PlaygroundApp.vue'

const markdown = '# Parent\n\n## Child\n\n#### Grandchild\n\n## Sibling\n\n# Next\n\nEnd'

it('separates heading navigation from nested disclosure and retains state across body edits', async () => {
  const app = mount(PlaygroundApp, { attachTo: document.body, props: {
    articleCatalog: [{documentId: 'outline-a', title: 'Outline', initialMarkdown: markdown}],
    articleGroupLabels: ['Notes'],
  } })
  try {
    await flushPromises()
    await app.get('[data-command-id="mode.source"]').trigger('click')
    await flushPromises()
    const titles = () => app.findAll('.article-outline__text').map(item => item.text())
    const row = (title: string) => app.findAll('.article-outline__list li').find(item => item.get('.article-outline__text').text() === title)!
    const source = app.get<HTMLTextAreaElement>('#markdown-source')
    source.element.setSelectionRange(markdown.length, markdown.length)
    expect(titles()).toEqual(['Parent', 'Child', 'Grandchild', 'Sibling', 'Next'])
    expect(app.findAll('.article-outline__toggle')).toHaveLength(2)
    await row('Child').get('.article-outline__toggle').trigger('click')
    expect(titles()).toEqual(['Parent', 'Child', 'Sibling', 'Next'])
    expect(source.element.selectionStart).toBe(markdown.length)
    await row('Parent').get('.article-outline__toggle').trigger('click')
    expect(titles()).toEqual(['Parent', 'Next'])
    await row('Parent').get('.article-outline__item').trigger('click')
    expect(source.element.selectionStart).toBe(0)
    expect(titles()).toEqual(['Parent', 'Next'])
    expect(row('Parent').get('.article-outline__toggle').attributes('aria-expanded')).toBe('false')
    await row('Parent').get('.article-outline__toggle').trigger('click')
    expect(titles()).toEqual(['Parent', 'Child', 'Sibling', 'Next'])
    expect(app.findAll('.article-outline__number').map(item => item.text())).toEqual(['1', '1.1', '1.2', '2'])
    await source.setValue(markdown + '\n\nMore body text')
    await flushPromises()
    expect(row('Child').get('.article-outline__toggle').attributes('aria-expanded')).toBe('false')
    expect(titles()).toEqual(['Parent', 'Child', 'Sibling', 'Next'])
    await source.setValue('# Inserted\n\n' + markdown)
    await flushPromises()
    expect(titles()).toEqual(['Inserted', 'Parent', 'Child', 'Grandchild', 'Sibling', 'Next'])
  } finally { app.unmount() }
})

it('does not carry collapsed branches into a different document', async () => {
  const app = mount(PlaygroundApp, { props: {
    articleCatalog: [
      {documentId: 'outline-a', title: 'A', initialMarkdown: markdown},
      {documentId: 'outline-b', title: 'B', initialMarkdown: markdown},
    ], articleGroupLabels: ['Notes'],
  } })
  try {
    await flushPromises()
    await app.get('.article-outline__toggle').trigger('click')
    expect(app.findAll('.article-outline__text')).toHaveLength(2)
    await app.get('[data-article-panel-tab="articles"]').trigger('click')
    await app.get('button[data-document-id="outline-b"]').trigger('click')
    await flushPromises()
    expect(app.findAll('.article-outline__text')).toHaveLength(5)
  } finally { app.unmount() }
})

it('keeps different heading levels visually distinct after skipped levels', async () => {
  const app = mount(PlaygroundApp, { props: {
    articleCatalog: [{ documentId: 'outline-levels', title: 'Levels', initialMarkdown: '# Parent\n\n#### Deep\n\n## Child' }],
    articleGroupLabels: ['Notes'],
  } })
  try {
    await flushPromises()
    const rows = app.findAll<HTMLElement>('.article-outline__list li')
    expect(rows.map(row => row.attributes('data-outline-level'))).toEqual(['1', '4', '2'])
    expect(rows.map(row => row.element.style.getPropertyValue('--outline-depth'))).toEqual(['0', '3', '1'])
  } finally { app.unmount() }
})
