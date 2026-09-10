import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import App from '../../src/ui/App.vue'

describe('image paragraph alignment from shared toolbar', () => {
  it('enables alignment for a selected image and persists its paragraph wrapper', async () => {
    const app = mount(App, { attachTo: document.body })
    try {
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await flushPromises()
      await app.get('#markdown-source').setValue('![A](/a.png) ![B](/b.png)')
      await app.get('[data-command-id="mode.visual"]').trigger('click')
      await flushPromises()
      await app.findAll('[data-inline-image]')[0]?.trigger('click')
      await app.get('[data-toolbar-menu="alignment"] .toolbar-menu__trigger').trigger('click')
      const center = app.get<HTMLButtonElement>('[data-command-id="align.center"]')
      expect(center.element.disabled).toBe(false)
      expect(app.get<HTMLButtonElement>('[data-command-id="align.justify"]').element.disabled).toBe(true)
      await center.trigger('click')
      await flushPromises()
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await flushPromises()
      expect(app.get<HTMLTextAreaElement>('#markdown-source').element.value)
        .toBe('::: center\n![A](/a.png) ![B](/b.png)\n:::')
    } finally { app.unmount() }
  })
})
