import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PlaygroundApp from '../../apps/playground/src/PlaygroundApp.vue'
import { referenceMarkdown, scanReferences } from '../../packages/editor-core/src'

function setup(markdown: string) {
  localStorage.clear()
  return mount(PlaygroundApp, { attachTo: document.body, props: {
    articleCatalog: [{ documentId: 'refs:manage', title: 'References', initialMarkdown: markdown }],
    articleModes: { 'refs:manage': 'source' },
  } })
}
async function open(wrapper: ReturnType<typeof setup>) {
  await flushPromises()
  await wrapper.get('[data-testid="insert-reference"]').trigger('click')
  await flushPromises()
}
describe('reference management', () => {
  const reference = referenceMarkdown({ id: 'book', number: 7, text: 'Original book' })
  it('updates an open sidebar after deleting the last body occurrence', async () => {
    const wrapper = setup(`Body ${reference}`)
    try {
      await open(wrapper)
      await wrapper.get('#markdown-source').setValue('Body ')
      await vi.waitFor(() => expect(wrapper.findAll('[data-reference-entry]')).toHaveLength(0))
    } finally { wrapper.unmount() }
  })
  it('edits all occurrences without changing their number or a code example', async () => {
    const wrapper = setup(`First ${reference}\n\nAgain ${reference}\n\n\`${reference}\``)
    try {
      await open(wrapper)
      await wrapper.get('[data-reference-edit="book"]').trigger('click')
      await wrapper.get('#reference-input').setValue('Updated book')
      await wrapper.get('[data-testid="reference-form"]').trigger('submit')
      await flushPromises()
      const markdown = (wrapper.get('#markdown-source').element as HTMLTextAreaElement).value
      expect(scanReferences(markdown).map(item => [item.number, item.text])).toEqual([[7, 'Updated book'], [7, 'Updated book']])
      expect(markdown).toContain(`\`${reference}\``)
    } finally { wrapper.unmount() }
  })
  it('removes all body occurrences after explicit confirmation and clears the sidebar', async () => {
    const wrapper = setup(`First ${reference}\n\nAgain ${reference}`)
    try {
      await open(wrapper)
      await wrapper.get('[data-reference-delete="book"]').trigger('click')
      expect(scanReferences((wrapper.get('#markdown-source').element as HTMLTextAreaElement).value)).toHaveLength(2)
      await wrapper.get('[data-testid="reference-delete-confirm"]').trigger('click')
      await flushPromises()
      expect(scanReferences((wrapper.get('#markdown-source').element as HTMLTextAreaElement).value)).toHaveLength(0)
      expect(wrapper.findAll('[data-reference-entry]')).toHaveLength(0)
    } finally { wrapper.unmount() }
  })
  it('clears metadata and keeps an edited form usable after a document style change', async () => {
    const wrapper = setup(referenceMarkdown({ id: 'book', number: 7, text: 'Book', metadata: { title: 'Old title' }, style: 'apa' }))
    try {
      await open(wrapper)
      await wrapper.get('[data-reference-edit="book"]').trigger('click')
      await wrapper.get('[data-testid="reference-details"]').trigger('click')
      await wrapper.get('[data-reference-field="title"]').setValue('')
      await wrapper.get('[aria-label="关闭详细信息"]').trigger('click')
      await wrapper.get('[data-testid="reference-form"]').trigger('submit')
      await flushPromises()
      expect(scanReferences((wrapper.get('#markdown-source').element as HTMLTextAreaElement).value)[0]?.metadata).toBeUndefined()
      await wrapper.get('[data-reference-edit="book"]').trigger('click')
      await wrapper.get('[data-testid="reference-details"]').trigger('click')
      await wrapper.get('[data-testid="reference-style"]').setValue('mla')
      await wrapper.get('[aria-label="关闭详细信息"]').trigger('click')
      await wrapper.findAll('button').find(button => button.text() === '将此格式用于本文全部文献')!.trigger('click')
      await flushPromises()
      await wrapper.get('#reference-input').setValue('Changed book')
      await wrapper.get('[data-testid="reference-form"]').trigger('submit')
      await flushPromises()
      expect(scanReferences((wrapper.get('#markdown-source').element as HTMLTextAreaElement).value)[0]).toMatchObject({ text: 'Changed book', style: 'mla', number: 7 })
    } finally { wrapper.unmount() }
  })

})
