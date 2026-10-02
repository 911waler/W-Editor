import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PlaygroundApp from '../../apps/playground/src/PlaygroundApp.vue'
import { referenceMarkdown, scanReferences } from '../../packages/editor-core/src'

describe('reference user flow', () => {
  it('restores the current draft through host persistence after a partial publication failure', async () => {
    localStorage.clear()
    const original = referenceMarkdown({ id: 'original', number: 9, text: 'Book' })
    let durable = original
    const wrapper = mount(PlaygroundApp, { attachTo: document.body, props: {
      articleCatalog: [{ documentId: 'refs:failure', title: 'Failure', initialMarkdown: original }],
      articleModes: { 'refs:failure': 'source' },
      persistence: { saveAutosave: input => { durable = input.markdown } },
    } })
    try {
      await flushPromises()
      await expect(wrapper.vm.publishForLifecycle(async input => {
        durable = input.markdown
        expect(scanReferences(durable)[0]?.number).toBe(1)
        throw new Error('Publication endpoint failed')
      })).rejects.toThrow('Publication endpoint failed')
      expect(durable).toBe(original)
      expect(wrapper.get('#markdown-source').element).toHaveProperty('value', original)
    } finally { wrapper.unmount() }
  })
  it('inserts in source, saves provisional numbering, publishes ordered numbering', async () => {
    localStorage.clear()
    const old = referenceMarkdown({ id: 'existing', number: 8, text: 'Existing book' })
    let saved = '', published = ''
    const wrapper = mount(PlaygroundApp, { attachTo: document.body, props: {
      articleCatalog: [{ documentId: 'refs:test', title: 'References', initialMarkdown: `Start ${old}` }],
      articleModes: { 'refs:test': 'source' },
      persistence: { saveManual: input => { saved = input.markdown }, savePublish: input => { published = input.markdown } },
    } })
    try {
      await flushPromises()
      const source = wrapper.get<HTMLTextAreaElement>('#markdown-source').element
      source.setSelectionRange(0, 0)
      source.dispatchEvent(new Event('select', { bubbles: true }))
      await wrapper.get('[data-toolbar-menu="insert"] .toolbar-menu__trigger').trigger('click')
      await wrapper.get('[data-command-id="insert.reference"]').trigger('click')
      await flushPromises()
      await wrapper.get('#reference-input').setValue('10.1234/new')
      await wrapper.get('[data-testid="reference-insert-dialog"] form').trigger('submit')
      await flushPromises()
      expect(wrapper.find('[data-testid="reference-insert-dialog"]').exists()).toBe(false)
      await wrapper.vm.saveForLifecycle()
      expect(scanReferences(saved).map(item => item.number)).toEqual([9, 8])
      await wrapper.vm.publishForLifecycle()
      expect(scanReferences(published).map(item => item.number)).toEqual([1, 2])
      expect(wrapper.get('#markdown-source').element).toHaveProperty('value', published)
    } finally { wrapper.unmount() }
  })
})
