import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PlaygroundApp from '../../apps/playground/src/PlaygroundApp.vue'

const articles = [
  { documentId: 'policy:first', title: 'First article', initialMarkdown: 'Saved text' },
  { documentId: 'policy:second', title: 'Second article', initialMarkdown: 'Second text' },
] as const

async function selectArticle(wrapper: ReturnType<typeof mount>, documentId: string): Promise<void> {
  await wrapper.get(`[data-document-id="${documentId}"].article-card`).trigger('click')
  await flushPromises()
}

describe('article switch host policy', () => {
  it('preserves standalone draft and export choices by default', async () => {
    const wrapper = mount(PlaygroundApp, { attachTo: document.body, props: {
      articleCatalog: articles,
      articleModes: { 'policy:first': 'source', 'policy:second': 'source' },
    } })
    try {
      await flushPromises()
      await wrapper.get('#markdown-source').setValue('Uncheckpointed draft')
      await selectArticle(wrapper, 'policy:second')
      const dialog = wrapper.get('[data-testid="article-switch-decision"]')
      expect(dialog.findAll('button')).toHaveLength(4)
      expect(dialog.find('[data-testid="article-switch-export"]').exists()).toBe(true)
      expect(dialog.find('[data-testid="article-switch-discard"]').exists()).toBe(false)
      await dialog.get('[data-testid="article-switch-draft"]').trigger('click')
      await flushPromises()
      await selectArticle(wrapper, 'policy:first')
      expect(wrapper.get('#markdown-source').element).toHaveProperty('value', 'Uncheckpointed draft')
    } finally { wrapper.unmount() }
  })

  it('discards to the canonical host baseline only for the explicit save/discard policy', async () => {
    const saveAutosave = vi.fn()
    const saveManual = vi.fn()
    const wrapper = mount(PlaygroundApp, { attachTo: document.body, props: {
      articleCatalog: articles,
      articleModes: { 'policy:first': 'source', 'policy:second': 'source' },
      articleSwitchPolicy: 'save-discard',
      savedMarkdown: documentId => articles.find(article => article.documentId === documentId)?.initialMarkdown,
      persistence: { saveAutosave, saveManual },
    } })
    try {
      await flushPromises()
      await wrapper.get('#markdown-source').setValue('Changes to discard')
      await selectArticle(wrapper, 'policy:second')
      const dialog = wrapper.get('[data-testid="article-switch-decision"]')
      expect(dialog.findAll('button').map(button => button.text())).toEqual(['取消', '丢弃修改', '保存修改'])
      expect(dialog.find('[data-testid="article-switch-draft"]').exists()).toBe(false)
      expect(dialog.find('[data-testid="article-switch-export"]').exists()).toBe(false)
      await dialog.get('[data-testid="article-switch-discard"]').trigger('click')
      await flushPromises()
      expect(saveManual).not.toHaveBeenCalled()
      expect(saveAutosave).toHaveBeenCalledWith(expect.objectContaining({ documentId: 'policy:first', markdown: 'Saved text' }))
      await selectArticle(wrapper, 'policy:first')
      expect(wrapper.get('#markdown-source').element).toHaveProperty('value', 'Saved text')
    } finally { wrapper.unmount() }
  })
})
