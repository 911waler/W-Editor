import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/ui/App.vue'

const themeScript = readFileSync(resolve(process.cwd(), 'examples/nwu-host/site-assets/theme.js'), 'utf8')

function siteShell(readonly: boolean, theme: 'light' | 'dark' = 'light') {
  document.documentElement.dataset['theme'] = theme
  localStorage.setItem('nwu911-theme', theme)
  const bootstrap = document.createElement('script')
  bootstrap.id = 'nwu-editor-bootstrap'
  bootstrap.type = 'application/json'
  bootstrap.textContent = JSON.stringify({
    userId: 7, csrfToken: 'synthetic', initialDocumentId: 'blog:1', readonly,
    apiBase: '/api/blog-editor', blogListUrl: '/blogs',
    readerDocument: {documentId: 'blog:1', title: 'Synthetic note', markdown: '# Synthetic body'},
  })
  const toggle = document.createElement('button')
  toggle.setAttribute('data-theme-toggle', '')
  document.body.append(bootstrap, toggle)
  window.eval(themeScript)
  return toggle
}

function editorApi() {
  vi.spyOn(window, 'fetch').mockImplementation(async input => {
    const path = new URL(String(input)).pathname
    const payload = path.endsWith('/reference-library') ? {revision: 0, entries: [], deletedIds: [], highWater: 0}
      : path.endsWith('/reference-notes') ? {notes: {}}
      : path.includes('/state/') ? {workspace: null, draft: null}
      : path.endsWith('/documents') ? {items: [], nextCursor: null}
      : {document: {documentId: 'blog:1', markdown: '# Synthetic body', revision: 1, serverRevision: 'r1'},
        metadata: {title: 'Synthetic note', category: 'other', visibility: 'private', allowedUsernames: []}}
    return new Response(JSON.stringify(payload))
  })
}

afterEach(() => {
  document.body.replaceChildren()
  delete document.documentElement.dataset['theme']
})

describe('NWU site theme integration', () => {
  it('toggles the live editor in source, visual and preview modes without replacing its draft or selection', async () => {
    const toggle = siteShell(false)
    editorApi()
    const app = mount(App, {attachTo: document.body})
    try {
      await flushPromises()
      const shell = app.get('.workspace-shell')
      await app.get('[data-command-id="mode.source"]').trigger('click')
      await flushPromises()
      const source = app.get<HTMLTextAreaElement>('#markdown-source')
      await source.setValue('Unsaved synthetic draft')
      source.element.setSelectionRange(4, 9)
      toggle.click()
      await flushPromises()
      expect(document.documentElement.dataset['theme']).toBe('dark')
      expect(shell.attributes('data-theme')).toBe('dark')
      expect(app.get('#markdown-source').element).toBe(source.element)
      expect(source.element.value).toBe('Unsaved synthetic draft')
      expect([source.element.selectionStart, source.element.selectionEnd]).toEqual([4, 9])
      toggle.click()
      await flushPromises()
      expect(shell.attributes('data-theme')).toBe('default')
      for (const mode of ['visual', 'preview']) {
        await app.get(`[data-command-id="mode.${mode}"]`).trigger('click')
        await flushPromises()
        toggle.click()
        await flushPromises()
        expect(shell.attributes('data-theme')).toBe('dark')
        expect(app.get('.ProseMirror').text()).toContain('Unsaved synthetic draft')
        toggle.click()
        await flushPromises()
        expect(shell.attributes('data-theme')).toBe('default')
      }
      expect(localStorage.getItem('nwu911-theme')).toBe('light')
      expect(localStorage.getItem('nwu-editor:%2Fapi%2Fblog-editor:7:w-editor:appearance-theme')).toBeNull()
    } finally { app.unmount() }
  })

  it.each([false, true])('uses the site preference on entry and follows cross-tab changes (readonly=%s)', async readonly => {
    siteShell(readonly, 'dark')
    localStorage.setItem('nwu-reader:theme', 'blue')
    editorApi()
    const app = mount(App, {attachTo: document.body})
    try {
      await flushPromises()
      expect(app.get('.workspace-shell').attributes('data-theme')).toBe('dark')
      window.dispatchEvent(new StorageEvent('storage', {key: 'nwu911-theme', newValue: 'light'}))
      await flushPromises()
      expect(app.get('.workspace-shell').attributes('data-theme')).toBe('default')
      if (readonly) {
        expect(app.get('.tiptap-reader-presentation').classes()).toContain('theme__default')
        window.dispatchEvent(new StorageEvent('storage', {key: 'nwu911-theme', newValue: 'dark'}))
        await flushPromises()
        expect(app.get('.tiptap-reader-presentation').classes()).toContain('theme__dark')
        expect(localStorage.getItem('nwu-reader:theme')).toBe('blue')
        await app.get('select[aria-label="皮肤"]').setValue('green')
        expect(app.get('.workspace-shell').attributes('data-theme')).toBe('green')
        expect(localStorage.getItem('nwu-reader:theme')).toBe('green')
      }
    } finally { app.unmount() }
  })

  it('keeps standalone editor appearance preferences independent of a surrounding page', async () => {
    document.documentElement.dataset['theme'] = 'dark'
    localStorage.setItem('w-editor:appearance-theme', 'blue')
    const app = mount(App, {props: {articleCatalog: [{documentId: 'standalone:1', title: 'Standalone', initialMarkdown: 'Body'}]}})
    try {
      await flushPromises()
      expect(app.get('.workspace-shell').attributes('data-theme')).toBe('blue')
      document.documentElement.dataset['theme'] = 'light'
      await flushPromises()
      expect(app.get('.workspace-shell').attributes('data-theme')).toBe('blue')
    } finally { app.unmount() }
  })
})
