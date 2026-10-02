import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import PlaygroundApp from '../../apps/playground/src/PlaygroundApp.vue'
import HistoryRestoreDialog from '../../apps/playground/src/HistoryRestoreDialog.vue'
import { referenceMarkdown } from '../../packages/editor-core/src'

afterEach(() => { document.body.replaceChildren() })

describe('modal keyboard isolation', () => {
  it('leaves field shortcuts in reference edit and nested metadata dialogs without mutating or saving the document', async () => {
    const original = `Body ${referenceMarkdown({ id: 'book', number: 1, text: 'Book' })}`
    const saved: string[] = []
    const wrapper = mount(PlaygroundApp, { attachTo: document.body, props: {
      articleCatalog: [{ documentId: 'modal:ref', title: 'Reference', initialMarkdown: original }],
      articleModes: { 'modal:ref': 'source' },
      persistence: { saveManual: input => { saved.push(input.markdown) } },
    } })
    try {
      await flushPromises()
      const source = wrapper.get<HTMLTextAreaElement>('#markdown-source').element
      source.setSelectionRange(0, 4)
      source.dispatchEvent(new Event('select', { bubbles: true }))
      await wrapper.get('[data-testid="insert-reference"]').trigger('click')
      await flushPromises()
      await wrapper.get('[data-reference-edit="book"]').trigger('click')
      for (const key of ['z', 'b', 's']) {
        const event = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true })
        wrapper.get('#reference-input').element.dispatchEvent(event)
        await flushPromises()
        expect(event.defaultPrevented).toBe(false)
        expect(source.value).toBe(original)
        expect(saved).toEqual([])
      }
      await wrapper.get('[data-testid="reference-details"]').trigger('click')
      const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
      wrapper.get('[data-reference-field="title"]').element.dispatchEvent(event)
      await flushPromises()
      expect(event.defaultPrevented).toBe(false)
      expect(source.value).toBe(original)
    } finally { wrapper.unmount() }
  })

  it('does not undo preview task changes behind an external history dialog', async () => {
    const wrapper = mount(PlaygroundApp, { attachTo: document.body, props: {
      articleCatalog: [{ documentId: 'modal:history', title: 'History', initialMarkdown: '- [ ] Keep checked' }],
      articleModes: { 'modal:history': 'preview' },
    } })
    let history: ReturnType<typeof mount> | undefined
    try {
      await flushPromises()
      const checkbox = wrapper.get<HTMLInputElement>('.visual-surface[data-mode="preview"] input[type="checkbox"]')
      await checkbox.setValue(true)
      await flushPromises()
      expect(checkbox.element.checked).toBe(true)
      history = mount(HistoryRestoreDialog, { attachTo: document.body, props: {
        documentId: 'modal:history', services: { list: async () => ({ versions: [], nextCursor: null }), get: async () => { throw new Error('Nothing selected') } }, recovery: null, busy: false, error: '',
      } })
      await flushPromises()
      const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
      history.get('[aria-label="关闭历史版本"]').element.dispatchEvent(event)
      await flushPromises()
      expect(event.defaultPrevented).toBe(false)
      expect(wrapper.get<HTMLInputElement>('.visual-surface[data-mode="preview"] input[type="checkbox"]').element.checked).toBe(true)
    } finally { history?.unmount(); wrapper.unmount() }
  })
})
