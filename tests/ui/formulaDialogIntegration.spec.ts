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
  await app.get('[data-command-id="insert.formula"]').trigger('click')
  await settle()
  return app.get('[data-picker-command="insert.formula"]')
}

describe('formula dialog integration', () => {
  it('keeps multiline layout drafts detached, reopens on Recently used, and applies with one visual history step', async () => {
    const app = mount(App, { attachTo: document.body })
    const original = 'Before\n\nAfter'
    const content = '\\begin{aligned}\nx+y\n\\end{aligned}'
    try {
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      await app.get('#markdown-source').setValue(original)
      await app.get('[data-command-id="mode.visual"]').trigger('click')
      await settle()
      let picker = await openPicker(app)
      expect(picker.get('[data-formula-section="special-symbols"]').attributes('aria-current')).toBe('page')
      expect(picker.get('[data-formula-symbol-category="recent"]').attributes('aria-selected')).toBe('true')
      await picker.get('#formula-source').setValue('x+y')
      await picker.get('[data-formula-symbol-category="layout"]').trigger('click')
      await picker.get('[data-formula-layout-tool="aligned"]').trigger('click')
      expect(picker.get<HTMLTextAreaElement>('#formula-source').element.value).toBe(content)
      await picker.get('.dialog-panel__actions button').trigger('click')
      await settle()
      expect(app.findAll('.ProseMirror [data-formula-mode]')).toHaveLength(0)
      picker = await openPicker(app)
      expect(picker.get('[data-formula-symbol-category="recent"]').attributes('aria-selected')).toBe('true')
      expect(picker.get<HTMLInputElement>('input[value="inline"]').element.checked).toBe(true)
      await picker.get('#formula-source').setValue('x+y')
      await picker.get('[data-formula-symbol-category="layout"]').trigger('click')
      await picker.get('[data-formula-layout-tool="aligned"]').trigger('click')
      await picker.get('.primary-action').trigger('click')
      await settle()
      expect(app.find('[data-picker-command="insert.formula"]').exists()).toBe(false)
      expect(app.findAll('.ProseMirror [data-formula-mode="block"]')).toHaveLength(1)
      await app.get('[data-command-id="history.undo"]').trigger('click')
      await settle()
      expect(app.findAll('.ProseMirror [data-formula-mode]')).toHaveLength(0)
      await app.get('[data-command-id="history.redo"]').trigger('click')
      await settle()
      expect(app.findAll('.ProseMirror [data-formula-mode="block"]')).toHaveLength(1)
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      const applied = app.get<HTMLTextAreaElement>('#markdown-source').element.value
      expect(applied).toContain(`$$\n${content}\n$$`)
      expect(applied).toContain('Before')
      expect(applied).toContain('After')
    } finally { app.unmount() }
  })

  it.each([
    { clipboard: String.raw`\(x+1\)`, mode: 'inline', canonical: '$x+1$' },
    { clipboard: String.raw`\[x+1\]`, mode: 'block', canonical: '$$\nx+1\n$$' },
  ] as const)('pastes external $mode delimiters into a detached draft and applies canonical formula source', async ({ clipboard, mode, canonical }) => {
    const app = mount(App, { attachTo: document.body })
    const original = 'Before\n\nAfter'
    const paste = async (picker: Awaited<ReturnType<typeof openPicker>>) => {
      const input = picker.get<HTMLTextAreaElement>('#formula-source')
      input.element.focus()
      input.element.select()
      await input.trigger('select')
      const event = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: { getData: (format: string) => format === 'text/plain' ? clipboard : '' } })
      input.element.dispatchEvent(event)
      await settle()
      expect(event.defaultPrevented).toBe(true)
      expect(input.element.value).toBe('x+1')
      expect(picker.get<HTMLInputElement>(`input[value="${mode}"]`).element.checked).toBe(true)
    }
    try {
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      await app.get('#markdown-source').setValue(original)
      await app.get('[data-command-id="mode.visual"]').trigger('click')
      await settle()
      let picker = await openPicker(app)
      await paste(picker)
      await picker.get('.dialog-panel__actions button').trigger('click')
      await settle()
      expect(app.findAll('.ProseMirror [data-formula-mode]')).toHaveLength(0)
      picker = await openPicker(app)
      await paste(picker)
      await picker.get('.primary-action').trigger('click')
      await settle()
      expect(app.find('[data-picker-command="insert.formula"]').exists()).toBe(false)
      expect(app.findAll(`.ProseMirror [data-formula-mode="${mode}"]`)).toHaveLength(1)
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      const markdown = app.get<HTMLTextAreaElement>('#markdown-source').element.value
      expect(markdown).toContain(canonical)
      expect(markdown).toContain('Before')
      expect(markdown).toContain('After')
      expect(markdown).not.toContain('\\(')
      expect(markdown).not.toContain('\\[')
    } finally { app.unmount() }
  })

  it.each([
    { editorMode: 'visual', formulaMode: 'inline' },
    { editorMode: 'source', formulaMode: 'block' },
  ] as const)('uses injected symbol recents while applying and cancelling in $editorMode with $formulaMode formulas', async ({ editorMode, formulaMode }) => {
    const recentKey = 'w-editor:formula-recent-symbols:v1'
    const data = new Map<string, string>([[recentKey, '["beta"]']])
    const storage: Storage = {
      get length() { return data.size },
      clear: () => data.clear(),
      getItem: key => data.get(key) ?? null,
      key: index => [...data.keys()][index] ?? null,
      removeItem: key => { data.delete(key) },
      setItem: (key, value) => { data.set(key, value) },
    }
    const original = 'Before\n\nAfter'
    const app = mount(App, { props: { storage }, attachTo: document.body })
    try {
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      await app.get('#markdown-source').setValue(original)
      if (editorMode === 'visual') {
        await app.get('[data-command-id="mode.visual"]').trigger('click')
        await settle()
      }
      let picker = await openPicker(app)
      await picker.get('#formula-source').setValue('x+y')
      const input = picker.get<HTMLTextAreaElement>('#formula-source')
      input.element.setSelectionRange(1, 2)
      await input.trigger('select')
      await picker.get('[data-formula-section="special-symbols"]').trigger('click')
      await picker.get('[data-formula-symbol-category="recent"]').trigger('click')
      expect(picker.findAll('[data-formula-symbol]').map(button => button.attributes('data-formula-symbol'))).toEqual(['beta'])
      await picker.get('[data-formula-symbol="beta"]').trigger('click')
      expect(input.element.value).toBe('x\\beta y')
      await picker.get(`input[value="${formulaMode}"]`).setValue(true)
      await picker.get('.primary-action').trigger('click')
      await settle()
      expect(app.find('[data-picker-command="insert.formula"]').exists()).toBe(false)
      // The source test seam has no CodeMirror history adapter; CUA covers native source history.
      if (editorMode === 'visual') {
        await app.get('[data-command-id="history.undo"]').trigger('click')
        await settle()
        expect(app.findAll('.ProseMirror [data-formula-mode]')).toHaveLength(0)
        await app.get('[data-command-id="history.redo"]').trigger('click')
        await settle()
      }
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      const applied = app.get<HTMLTextAreaElement>('#markdown-source').element.value
      expect(applied).toContain(formulaMode === 'inline' ? '$x\\beta y$' : '$$\nx\\beta y\n$$')
      expect(applied).toContain('Before')
      expect(applied).toContain('After')

      picker = await openPicker(app)
      await picker.get('[data-formula-section="special-symbols"]').trigger('click')
      await picker.get('[data-formula-symbol-category="greek"]').trigger('click')
      await picker.get('[data-formula-symbol="alpha"]').trigger('click')
      await picker.get('.dialog-panel__actions button').trigger('click')
      await settle()
      expect(app.get<HTMLTextAreaElement>('#markdown-source').element.value).toBe(applied)
      expect(JSON.parse(data.get(recentKey)!)).toEqual(['alpha', 'beta'])
      picker = await openPicker(app)
      await picker.get('[data-formula-section="special-symbols"]').trigger('click')
      await picker.get('[data-formula-symbol-category="recent"]').trigger('click')
      expect(picker.findAll('[data-formula-symbol]').map(button => button.attributes('data-formula-symbol'))).toEqual(['alpha', 'beta'])
    } finally { app.unmount() }
  })

  it.each(['visual', 'source'] as const)('defaults a new formula in %s mode to inline and keeps cancel detached', async (mode) => {
    const app = mount(App, { attachTo: document.body })
    try {
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      const source = app.get<HTMLTextAreaElement>('#markdown-source')
      await source.setValue('Before after')
      source.element.setSelectionRange(6, 6)
      await source.trigger('select')
      if (mode === 'visual') {
        await app.get('[data-command-id="mode.visual"]').trigger('click')
        await settle()
      }
      const picker = await openPicker(app)
      expect(picker.get<HTMLInputElement>('input[value="inline"]').element.checked).toBe(true)
      await picker.get('.dialog-panel__actions button').trigger('click')
      await settle()
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      expect(app.get<HTMLTextAreaElement>('#markdown-source').element.value).toBe('Before after')
    } finally { app.unmount() }
  })

  it.each(['visual', 'source'] as const)('inserts a new inline formula in %s mode after cancelling a block draft', async (mode) => {
    const app = mount(App, { attachTo: document.body })
    try {
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      await app.get('#markdown-source').setValue('Before\n\nAfter')
      if (mode === 'visual') {
        await app.get('[data-command-id="mode.visual"]').trigger('click')
        await settle()
      }
      let picker = await openPicker(app)
      await picker.get('input[value="block"]').setValue(true)
      await picker.get('.dialog-panel__actions button').trigger('click')
      await settle()
      picker = await openPicker(app)
      expect(picker.get<HTMLInputElement>('input[value="inline"]').element.checked).toBe(true)
      await picker.get('#formula-source').setValue('a+b')
      await picker.get('.primary-action').trigger('click')
      await settle()
      expect(app.find('[data-picker-command="insert.formula"]').exists()).toBe(false)
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      const markdown = app.get<HTMLTextAreaElement>('#markdown-source').element.value
      expect(markdown).toContain('$a+b$')
      expect(markdown).not.toContain('$$')
      expect(markdown).toContain('Before')
      expect(markdown).toContain('After')
    } finally { app.unmount() }
  })

  it('accepts unchanged existing formulas without showing a failure or changing the source', async () => {
    const app = mount(App, { attachTo: document.body })
    const original = 'Before\n\n$$\nx+y\n$$\n\nAfter'
    try {
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      await app.get('#markdown-source').setValue(original)
      await app.get('[data-command-id="mode.visual"]').trigger('click')
      await settle()
      for (let index = 0; index < 2; index++) {
        await app.get('.ProseMirror [data-formula-mode="block"]').trigger('dblclick')
        await settle()
        const picker = app.get('[data-picker-command="insert.formula"]')
        expect(picker.get<HTMLInputElement>('input[value="block"]').element.checked).toBe(true)
        await picker.get('.primary-action').trigger('click')
        await settle()
        expect(app.find('[data-picker-command="insert.formula"]').exists()).toBe(false)
      }
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      expect(app.get<HTMLTextAreaElement>('#markdown-source').element.value).toBe(original)
    } finally { app.unmount() }
  })

  it('converts a block formula to inline, closes without a false error, and synchronizes one history step', async () => {
    const app = mount(App, { attachTo: document.body })
    const original = 'Before\n\n$$\nx^2+y^2=z^2\n$$\n\nAfter'
    try {
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      await app.get('#markdown-source').setValue(original)
      await app.get('[data-command-id="mode.visual"]').trigger('click')
      await settle()
      await app.get('.ProseMirror [data-formula-mode="block"]').trigger('dblclick')
      await settle()
      const picker = app.get('[data-picker-command="insert.formula"]')
      expect(picker.get<HTMLInputElement>('input[value="block"]').element.checked).toBe(true)
      await picker.get('input[value="inline"]').setValue(true)
      await picker.get('.primary-action').trigger('click')
      await settle()
      expect(app.find('[data-picker-command="insert.formula"]').exists()).toBe(false)
      expect(app.findAll('.ProseMirror [data-formula-mode="inline"]')).toHaveLength(1)
      expect(app.findAll('.ProseMirror [data-formula-mode="block"]')).toHaveLength(0)
      await app.get('[data-command-id="history.undo"]').trigger('click')
      await settle()
      expect(app.findAll('.ProseMirror [data-formula-mode="block"]')).toHaveLength(1)
      await app.get('[data-command-id="history.redo"]').trigger('click')
      await settle()
      expect(app.findAll('.ProseMirror [data-formula-mode="inline"]')).toHaveLength(1)
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await settle()
      expect(app.get<HTMLTextAreaElement>('#markdown-source').element.value).toBe('Before\n\n$x^2+y^2=z^2$\n\nAfter')
    } finally { app.unmount() }
  })
})
