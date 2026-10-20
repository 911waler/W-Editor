import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import App from '../../src/ui/App.vue'

async function settle() {
  await flushPromises()
  await vi.advanceTimersByTimeAsync(250)
  await flushPromises()
}
async function openPicker(app: ReturnType<typeof mount>) {
  await app.get('[data-toolbar-menu="insert"] .toolbar-menu__trigger').trigger('click')
  await app.get('[data-command-id="insert.formula-reference"]').trigger('click')
  await settle()
  return app.get('[data-picker-command="insert.formula-reference"]')
}
const original = 'Before after\n\n$$\nx^2\n$$\n\nInline $y$\n\n$$\nz^2\n$$'

describe('formula reference dialog integration', () => {
  it.each(['source', 'visual'] as const)('keeps opening/cancelling detached and inserts an identified reference in %s mode', async mode => {
    const app = mount(App, { attachTo: document.body })
    try {
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      const source = app.get<HTMLTextAreaElement>('#markdown-source')
      await source.setValue(original)
      source.element.setSelectionRange(7, 7)
      await source.trigger('select')
      if (mode === 'visual') {
        await app.get('[data-command-id="mode.visual"]').trigger('click')
        await settle()
      }
      let picker = await openPicker(app)
      expect(picker.findAll('input[type="radio"]')).toHaveLength(2)
      await picker.get('.dialog-panel__actions button').trigger('click')
      await settle()
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      expect(app.get<HTMLTextAreaElement>('#markdown-source').element.value).toBe(original)
      if (mode === 'visual') {
        await app.get('[data-command-id="mode.visual"]').trigger('click')
        await settle()
      }
      picker = await openPicker(app)
      await picker.findAll('input[type="radio"]')[1]!.setValue(true)
      await picker.get('.primary-action').trigger('click')
      await settle()
      const error = app.find('[data-picker-command="insert.formula-reference"] [role="alert"]')
      expect(app.find('[data-picker-command="insert.formula-reference"]').exists(), error.exists() ? error.text() : '').toBe(false)
      if (mode === 'visual') {
        expect(app.get('.ProseMirror').text()).toContain('公式 2')
        await app.get('[data-command-id="history.undo"]').trigger('click')
        await settle()
        expect(app.find('.ProseMirror [data-formula-reference]').exists()).toBe(false)
        await app.get('[data-command-id="history.redo"]').trigger('click')
        await settle()
      }
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      const markdown = app.get<HTMLTextAreaElement>('#markdown-source').element.value
      expect(markdown).toMatch(/\[公式\]\(#wformula-([A-Za-z0-9_-]+)\)/u)
      const targetId = markdown.match(/\[公式\]\(#wformula-([A-Za-z0-9_-]+)\)/u)?.[1]
      expect(markdown).toContain(`z^2\n$$\n<!-- w-editor-formula-id: ${targetId} -->`)
      expect(markdown).not.toMatch(/x\^2\n\$\$\n<!--/u)
    } finally { app.unmount() }
  })

  it('inserts at the captured source range and restores the Insert trigger after cancel', async () => {
    const app = mount(App, { attachTo: document.body })
    try {
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      const source = app.get<HTMLTextAreaElement>('#markdown-source')
      await source.setValue(original)
      source.element.setSelectionRange(7, 12)
      await source.trigger('select')
      let picker = await openPicker(app)
      await picker.trigger('keydown', { key: 'Escape' })
      await settle()
      expect(document.activeElement).toBe(app.get('[data-toolbar-menu="insert"] .toolbar-menu__trigger').element)
      expect(source.element.value).toBe(original)
      picker = await openPicker(app)
      await picker.get('.primary-action').trigger('click')
      await settle()
      expect(source.element.value).toMatch(/^Before \[公式\]\(#wformula-/u)
      expect(source.element.value).not.toContain('Before after')
    } finally { app.unmount() }
  })

  it('rejects a changed source selection without inserting into the new range', async () => {
    const app = mount(App, { attachTo: document.body })
    try {
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      const source = app.get<HTMLTextAreaElement>('#markdown-source')
      await source.setValue(original)
      source.element.setSelectionRange(0, 0)
      await source.trigger('select')
      const picker = await openPicker(app)
      source.element.setSelectionRange(7, 7)
      await source.trigger('select')
      await picker.get('.primary-action').trigger('click')
      await settle()
      expect(picker.get('[role="alert"]').text().length).toBeGreaterThan(0)
      expect(source.element.value).toBe(original)
    } finally { app.unmount() }
  })

  it('rejects stale revisions without adding a target identity or reference', async () => {
    const app = mount(App, { attachTo: document.body })
    try {
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      const source = app.get<HTMLTextAreaElement>('#markdown-source')
      await source.setValue(original)
      const picker = await openPicker(app)
      await source.setValue(`${original}\nChanged`)
      await picker.get('.primary-action').trigger('click')
      await settle()
      expect(picker.get('[role="alert"]').text().length).toBeGreaterThan(0)
      expect(source.element.value).toBe(`${original}\nChanged`)
      expect(source.element.value).not.toContain('w-editor-formula-id')
    } finally { app.unmount() }
  })
})
