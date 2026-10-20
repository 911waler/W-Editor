import { flushPromises, mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import PlaygroundApp from '../../apps/playground/src/PlaygroundApp.vue'

it('freezes Unicode source and body counts until successful explicit save or publish', async () => {
  const saveManual = vi.fn(async () => {})
  const savePublish = vi.fn(async () => {})
  const initial = '# 中文 hello 👋\n\n`code` $formula$'
  const app = mount(PlaygroundApp, { attachTo: document.body, props: {
    articleCatalog: [{ documentId: 'snapshot-counts', title: 'Counts', initialMarkdown: initial }],
    persistence: { saveManual, savePublish },
  } })
  const characters = () => app.get('[data-testid="source-character-count"]').text()
  const words = () => app.get('[data-testid="body-word-count"]').text()
  try {
    await flushPromises()
    expect(characters()).toBe(`${[...initial].length} 个源码字符`)
    expect(words()).toBe('正文 3 词')
    await app.get('[data-command-id="mode.source"]').trigger('click')
    await flushPromises()
    await app.get('#markdown-source').setValue('one two three four')
    await app.vm.flushForLifecycle()
    expect(characters()).toBe(`${[...initial].length} 个源码字符`)
    expect(words()).toBe('正文 3 词')
    saveManual.mockRejectedValueOnce(new Error('offline'))
    await expect(app.vm.saveForLifecycle()).rejects.toThrow('offline')
    expect(words()).toBe('正文 3 词')
    await app.vm.saveForLifecycle()
    await flushPromises()
    expect(characters()).toBe('18 个源码字符')
    expect(words()).toBe('正文 4 词')
    await app.get('#markdown-source').setValue('one two')
    savePublish.mockRejectedValueOnce(new Error('offline'))
    await expect(app.vm.publishForLifecycle()).rejects.toThrow('offline')
    expect(words()).toBe('正文 4 词')
    await app.vm.publishForLifecycle()
    await flushPromises()
    expect(words()).toBe('正文 2 词')
    await app.get('#markdown-source').setValue('one')
    app.get('#markdown-source').element.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }))
    await flushPromises()
    expect(words()).toBe('正文 1 词')
  } finally { app.unmount() }
})

it('counts the persisted snapshot while typing continues during a manual save', async () => {
  let resolveSave: (() => void) | undefined
  const saveManual = vi.fn(() => new Promise<void>(resolve => { resolveSave = resolve }))
  const app = mount(PlaygroundApp, { attachTo: document.body, props: {
    articleCatalog: [{ documentId: 'racing-counts', title: 'Counts', initialMarkdown: 'old' }], persistence: { saveManual },
  } })
  try {
    await app.get('[data-command-id="mode.source"]').trigger('click')
    await flushPromises()
    await app.get('#markdown-source').setValue('saved words')
    const pending = app.vm.saveForLifecycle()
    await flushPromises()
    expect(saveManual).toHaveBeenCalledOnce()
    await app.get('#markdown-source').setValue('newer unsaved three words')
    resolveSave!()
    await pending
    await flushPromises()
    expect(app.get('[data-testid="source-character-count"]').text()).toBe('11 个源码字符')
    expect(app.get('[data-testid="body-word-count"]').text()).toBe('正文 2 词')
  } finally { app.unmount() }
})

it('keeps separate saved counters when switching documents', async () => {
  const app = mount(PlaygroundApp, { attachTo: document.body, props: { articleCatalog: [
    { documentId: 'counter-a', title: 'A', initialMarkdown: 'one' },
    { documentId: 'counter-b', title: 'B', initialMarkdown: 'one two' },
  ] } })
  const words = () => app.get('[data-testid="body-word-count"]').text()
  try {
    await app.get('[data-command-id="mode.source"]').trigger('click')
    await flushPromises()
    await app.get('#markdown-source').setValue('one two three')
    await app.get('[data-command-id="document.manual-save"]').trigger('click')
    await flushPromises()
    expect(words()).toBe('正文 3 词')
    await app.get('.article-card[data-document-id="counter-b"]').trigger('click')
    await flushPromises()
    expect(words()).toBe('正文 2 词')
    await app.get('.article-card[data-document-id="counter-a"]').trigger('click')
    await flushPromises()
    expect(words()).toBe('正文 3 词')
  } finally { app.unmount() }
})
