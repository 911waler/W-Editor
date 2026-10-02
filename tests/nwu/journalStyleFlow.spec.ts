import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PlaygroundApp from '../../apps/playground/src/PlaygroundApp.vue'
import { getDocumentReferenceStyle, referenceMarkdown, scanReferences } from '../../packages/editor-core/src'
const chosen = 'journal:nature@1'
function setup(markdown: string, save?: (markdown: string) => void) {
  localStorage.clear()
  return mount(PlaygroundApp, { attachTo: document.body, props: {
    articleCatalog: [{ documentId: 'journal:flow', title: 'Journal flow', initialMarkdown: markdown }],
    articleModes: { 'journal:flow': 'source' },
    persistence: { saveManual: input => { save?.(input.markdown) } },
  } })
}
async function apply(wrapper: ReturnType<typeof setup>) {
  await flushPromises()
  await wrapper.get('[data-testid="insert-reference"]').trigger('click')
  await flushPromises()
  await wrapper.get('[data-testid="reference-style-open"]').trigger('click')
  await wrapper.get(`[data-testid="reference-style-result-${chosen}"]`).trigger('click')
  await vi.waitFor(() => expect(wrapper.get('[data-testid="reference-style-apply"]').attributes('disabled')).toBeUndefined())
  await wrapper.get('[data-testid="reference-style-apply"]').trigger('click')
  await vi.waitFor(() => expect(wrapper.find('[data-testid="reference-style-picker"]').exists()).toBe(false))
}
function source(wrapper: ReturnType<typeof setup>): string { return wrapper.get<HTMLTextAreaElement>('#markdown-source').element.value }
describe('journal bibliography document flow', () => {
  it('applies all occurrences without renumbering, persists preference and inherits on reload', async () => {
    const ref = referenceMarkdown({ id: 'paper', number: 9, text: 'Original', metadata: { title: 'A paper', authors: [{ family: 'Li' }], year: '2025' } })
    let saved = ''
    const wrapper = setup(`${ref}\n\nAgain ${ref}`, markdown => { saved = markdown })
    try {
      await apply(wrapper)
      expect(getDocumentReferenceStyle(source(wrapper))).toBe(chosen)
      expect(scanReferences(source(wrapper)).map(entry => [entry.number, entry.style])).toEqual([[9, chosen], [9, chosen]])
      await wrapper.vm.saveForLifecycle()
    } finally { wrapper.unmount() }
    const restored = setup(saved)
    try {
      await flushPromises()
      await restored.get('[data-toolbar-menu="insert"] .toolbar-menu__trigger').trigger('click')
      await restored.get('[data-command-id="insert.reference"]').trigger('click')
      await flushPromises()
      await restored.get('#reference-input').setValue('Another source')
      await restored.get('[data-testid="reference-insert-dialog"] form').trigger('submit')
      await flushPromises()
      expect(scanReferences(source(restored)).find(entry => entry.text === 'Another source')?.style).toBe(chosen)
      expect(getDocumentReferenceStyle(source(restored))).toBe(chosen)
    } finally { restored.unmount() }
  })
  it('persists selection before the first reference exists', async () => {
    const wrapper = setup('')
    try {
      await apply(wrapper)
      expect(getDocumentReferenceStyle(source(wrapper))).toBe(chosen)
      expect(scanReferences(source(wrapper))).toEqual([])
      await wrapper.get('[data-testid="reference-add"]').trigger('click')
      await flushPromises()
      await wrapper.get('#reference-input').setValue('First source')
      await wrapper.get('[data-testid="reference-insert-dialog"] form').trigger('submit')
      await flushPromises()
      expect(getDocumentReferenceStyle(source(wrapper))).toBe(chosen)
      expect(scanReferences(source(wrapper))[0]).toMatchObject({ number: 1, style: chosen, text: 'First source' })
    } finally { wrapper.unmount() }
  })
})
