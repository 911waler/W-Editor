import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import App from '../../src/ui/App.vue'

async function settle() {
  await flushPromises()
  await vi.advanceTimersByTimeAsync(250)
  await flushPromises()
}

describe('image properties dialog integration', () => {
  it('offers alignment when inserting an image on a blank top-level source line', async () => {
    const app = mount(App, { attachTo: document.body })
    try {
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      const source = app.get<HTMLTextAreaElement>('#markdown-source')
      await source.setValue('Before\n\nAfter')
      source.element.setSelectionRange(7, 7)
      await source.trigger('select')
      await app.get('[data-toolbar-menu="insert"] .toolbar-menu__trigger').trigger('click')
      await app.get('[data-command-id="insert.image"]').trigger('click')
      await settle()
      expect(app.get<HTMLButtonElement>('[data-image-align="center"]').element.disabled).toBe(false)
    } finally { app.unmount() }
  })
  it('applies name, exact size and paragraph alignment together, preserving the neighbouring image and metadata', async () => {
    const app = mount(App, { attachTo: document.body })
    const original = 'Before ![Photo](/photo.png "Caption"){width=320 height=160 data-note=keep} ![Other](/other.png)\n\nUntouched'
    try {
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      await app.get('#markdown-source').setValue(original)
      await app.get('[data-command-id="mode.visual"]').trigger('click')
      await settle()
      const image = app.findAll('[data-inline-image]')[0]!
      await image.get('img').trigger('click')
      await image.get('[data-semantic-edit="media-editor"]').trigger('click')
      await settle()
      const dialog = app.get('[data-editor-command="insert.image"]')
      expect(dialog.find('#media-url-image').exists()).toBe(false)
      expect(dialog.get<HTMLInputElement>('#media-width-image').element.value).toBe('320')
      expect(dialog.get<HTMLInputElement>('#media-height-image').element.value).toBe('160')
      await dialog.get('#media-name-image').setValue('Edited')
      await dialog.get('#media-width-image').setValue('400')
      expect(dialog.get<HTMLInputElement>('#media-height-image').element.value).toBe('200')
      await dialog.get('[data-image-align="center"]').trigger('click')
      await dialog.get('.primary-action').trigger('click')
      await settle()
      expect(app.findAll('.ProseMirror [data-alignment="center"]')).toHaveLength(1)
      expect(app.findAll('[data-inline-image]')[0]!.get('img').attributes('width')).toBe('400')
      await app.get('[data-command-id="history.undo"]').trigger('click')
      await settle()
      expect(app.findAll('.ProseMirror [data-alignment="center"]')).toHaveLength(0)
      expect(app.findAll('[data-inline-image]')[0]!.get('img').attributes('width')).toBe('320')
      await app.get('[data-command-id="history.redo"]').trigger('click')
      await settle()
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      const expected = '::: center\nBefore ![Edited](/photo.png "Caption"){width=400 height=200 data-note=keep} ![Other](/other.png)\n:::\n\nUntouched'
      expect(app.get<HTMLTextAreaElement>('#markdown-source').element.value).toBe(expected)
      await vi.advanceTimersByTimeAsync(1000)
      await flushPromises()
      const stored = JSON.parse(localStorage.getItem('w-editor:v1:document:welcome') ?? 'null') as {
        autosave?: { markdown?: string }
      }
      expect(stored.autosave?.markdown).toBe(expected)
    } finally { app.unmount() }
  })

  it('edits an existing source image and clears explicit dimensions without toggling its existing alignment', async () => {
    const app = mount(App, { attachTo: document.body })
    try {
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      const source = app.get<HTMLTextAreaElement>('#markdown-source')
      const original = '::: right\n![Photo](/photo.png "Caption"){width=320 height=160 data-note=keep}\n:::'
      await source.setValue(original)
      source.element.setSelectionRange(original.indexOf('Photo'), original.indexOf('Photo'))
      await source.trigger('select')
      await app.get('[data-toolbar-menu="insert"] .toolbar-menu__trigger').trigger('click')
      await app.get('[data-command-id="insert.image"]').trigger('click')
      await settle()
      const dialog = app.get('[data-editor-command="insert.image"]')
      expect(dialog.get('[data-image-align="right"]').attributes('aria-pressed')).toBe('true')
      await dialog.get('[data-image-reset]').trigger('click')
      await dialog.get('.primary-action').trigger('click')
      await settle()
      expect(source.element.value).toBe('::: right\n![Photo](/photo.png "Caption"){ data-note=keep}\n:::')
    } finally { app.unmount() }
  })

  it('keeps the source and nested structure unchanged when image edits are cancelled', async () => {
    const app = mount(App, { attachTo: document.body })
    const original = '- ![Photo](/photo.png){width=320 height=160}'
    try {
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      await app.get('#markdown-source').setValue(original)
      await app.get('[data-command-id="mode.visual"]').trigger('click')
      await settle()
      const image = app.get('[data-inline-image]')
      await image.get('img').trigger('click')
      await image.get('[data-semantic-edit="media-editor"]').trigger('click')
      await settle()
      const dialog = app.get('[data-editor-command="insert.image"]')
      expect(dialog.get<HTMLButtonElement>('[data-image-align="center"]').element.disabled).toBe(true)
      await dialog.get('#media-width-image').setValue('480')
      await dialog.get('.dialog-panel__actions button').trigger('click')
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      expect(app.get<HTMLTextAreaElement>('#markdown-source').element.value).toBe(original)
    } finally { app.unmount() }
  })
})
