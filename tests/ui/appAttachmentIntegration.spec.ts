import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { MockUploadAdapter } from '../../src/adapters'
import { attachmentSource, type AttachmentKind } from '../../src/codecs'
import App from '../../src/ui/App.vue'

describe('application attachment integration', () => {
  it.each([
    ['pdf', 'Guide.pdf', 'application/pdf', 'https://assets.example.test/guide.pdf'],
    ['word', 'Brief.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'https://assets.example.test/brief.docx'],
    ['file', 'Notes.txt', 'application/octet-stream', 'https://assets.example.test/notes.txt'],
  ] as const)('routes insert.%s through URL input, typed card editing, and read-only Preview', async (kind, name, mediaType, url) => {
    const wrapper = mount(App, { attachTo: document.body })
    await wrapper.get('[data-command-id="mode.source"]').trigger('click')
    await flushPromises()
    const source = wrapper.get('#markdown-source')
    await source.setValue('')
    await wrapper.get('[data-toolbar-menu="insert"] .toolbar-menu__trigger').trigger('click')
    await wrapper.get(`[data-command-id="insert.${kind}"]`).trigger('click')
    await flushPromises()
    const dialog = wrapper.get(`[data-editor-command="insert.${kind}"]`)
    await dialog.get(`#media-name-${kind}`).setValue(name)
    await dialog.get(`#media-url-${kind}`).setValue(url)
    await dialog.get('.primary-action').trigger('click')
    await flushPromises()

    const expected = attachmentSource({ kind, mediaType, name, size: 0, url })
    expect(source.element).toHaveProperty('value', expected)
    await wrapper.get('[data-command-id="mode.visual"]').trigger('click')
    await flushPromises()
    const card = wrapper.get('[data-semantic-kind="attachment"]')
    expect(card.attributes('data-attachment-kind')).toBe(kind)
    expect(card.get('[data-semantic-attachment-link]').attributes('href')).toBe(url)
    await card.get('[data-semantic-edit="attachment-editor"]').trigger('click')
    await flushPromises()
    expect(wrapper.get<HTMLInputElement>(`#media-name-${kind}`).element.value).toBe(name)
    await wrapper.get(`[data-editor-command="insert.${kind}"] button:not(.primary-action)`).trigger('click')

    await wrapper.get('[data-command-id="mode.preview"]').trigger('click')
    await flushPromises()
    const exported = wrapper.get('.preview-rendered-content a')
    expect(exported.attributes('href')).toBe(url)
    expect(exported.text()).toBe(`打开 ${name}`)
    wrapper.unmount()
  })

  it('commits deterministic local upload metadata as URL-only source and reloads it', async () => {
    const first = mount(App, { attachTo: document.body, props: { uploadAdapter: new MockUploadAdapter() } })
    await first.get('[data-command-id="mode.source"]').trigger('click')
    await flushPromises()
    await first.get('#markdown-source').setValue('')
    await first.get('[data-toolbar-menu="insert"] .toolbar-menu__trigger').trigger('click')
    await first.get('[data-command-id="insert.pdf"]').trigger('click')
    await flushPromises()
    const input = first.get<HTMLInputElement>('#media-file-pdf')
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['pdf'], 'local.pdf', { type: 'application/pdf' })],
    })
    await input.trigger('change')
    await vi.waitFor(() => expect(first.find('[data-upload-result="ready"]').exists()).toBe(true))
    await first.get('[data-editor-command="insert.pdf"] .primary-action').trigger('click')
    await flushPromises()
    const expected = attachmentSource({
      kind: 'pdf' as AttachmentKind,
      mediaType: 'application/pdf',
      name: 'sample-pdf',
      size: 128,
      url: 'https://fixtures.w-editor.test/uploads/pdf/asset-001',
    })
    expect(first.get('#markdown-source').element).toHaveProperty('value', expected)
    await vi.advanceTimersByTimeAsync(1_000)
    await flushPromises()
    const stored = JSON.parse(window.localStorage.getItem('w-editor:v1:document:welcome') ?? 'null') as {
      readonly autosave?: { readonly markdown?: string }
    }
    expect(stored.autosave?.markdown).toBe(expected)
    expect(stored.autosave?.markdown).not.toMatch(/blob:|data:/u)
    first.unmount()

    const restored = mount(App, { attachTo: document.body })
    await restored.get('[data-command-id="mode.source"]').trigger('click')
    await flushPromises()
    expect(restored.get('#markdown-source').element).toHaveProperty('value', expected)
    restored.unmount()
  })
})
