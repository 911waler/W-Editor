import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import App from '../../src/ui/App.vue'

describe('application media integration', () => {
  it('inserts, persists, reloads, previews, falls back, and edits URL-only media through visible UI', async () => {
    const first = mount(App, { attachTo: document.body })
    await first.get('[data-command-id="mode.source"]').trigger('click')
    await flushPromises()
    const source = first.get('#markdown-source')
    await source.setValue('')

    const openImage = async () => {
      await first.get('[data-toolbar-menu="insert"] .toolbar-menu__trigger').trigger('click')
      await first.get('[data-command-id="insert.image"]').trigger('click')
      await flushPromises()
      return first.get('[data-editor-command="insert.image"]')
    }

    let dialog = await openImage()
    await dialog.get('button:not(.primary-action)').trigger('click')
    await flushPromises()
    expect(source.element).toHaveProperty('value', '')

    dialog = await openImage()
    await dialog.get('#media-name-image').setValue('Hero image')
    await dialog.get('#media-url-image').setValue('https://assets.example.test/hero.png')
    await dialog.get('.primary-action').trigger('click')
    await flushPromises()
    const inserted = '![Hero image](https://assets.example.test/hero.png)'
    expect(source.element).toHaveProperty('value', inserted)

    await vi.advanceTimersByTimeAsync(1_000)
    await flushPromises()
    const storedValue = JSON.parse(window.localStorage.getItem('w-editor:v1:document:welcome') ?? 'null') as {
      readonly autosave?: { readonly markdown?: string }
    }
    expect(storedValue.autosave?.markdown).toBe(inserted)
    expect(storedValue.autosave?.markdown).not.toMatch(/blob:|data:image|"file"|Blob/u)

    await first.get('[data-command-id="mode.visual"]').trigger('click')
    await flushPromises()
    const node = first.get('[data-semantic-kind="media"]')
    expect(node.attributes('data-media-kind')).toBe('image')
    await node.get('.semantic-preview__media-element').trigger('error')
    expect(node.attributes('data-preview-state')).toBe('error')
    expect(node.get('[data-media-fallback="image"]').text()).toContain('https://assets.example.test/hero.png')

    await node.get('img[src]').trigger('click')
    await node.get('[data-semantic-edit="media-editor"]').trigger('click')
    await flushPromises()
    dialog = first.get('[data-editor-command="insert.image"]')
    expect(dialog.get<HTMLInputElement>('#media-name-image').element.value).toBe('Hero image')
    await dialog.get('#media-name-image').setValue('Updated hero')
    await dialog.get('#media-url-image').setValue('https://assets.example.test/updated.png')
    await dialog.get('.primary-action').trigger('click')
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()

    await first.get('[data-command-id="mode.preview"]').trigger('click')
    await flushPromises()
    expect(first.get('.preview-rendered-content img').attributes('src')).toBe('https://assets.example.test/updated.png')
    await vi.advanceTimersByTimeAsync(1_000)
    await flushPromises()
    first.unmount()

    const restored = mount(App, { attachTo: document.body })
    await restored.get('[data-command-id="mode.source"]').trigger('click')
    await flushPromises()
    expect(restored.get('#markdown-source').element).toHaveProperty(
      'value',
      '![Updated hero](https://assets.example.test/updated.png)',
    )
    restored.unmount()
  })
})
