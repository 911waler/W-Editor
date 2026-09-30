import { flushPromises, mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import PlaygroundApp from '../../apps/playground/src/PlaygroundApp.vue'

it('keeps the menu attached to its original paragraph while the pointer crosses another row', async () => {
  const app = mount(PlaygroundApp, { attachTo: document.body, props: {
    articleCatalog: [{ documentId: 'menu-target', title: 'Menu', initialMarkdown: 'Alpha\n\nOmega' }],
  } })
  try {
    await flushPromises()
    const rows = app.findAll('.ProseMirror > p')
    await rows[0]!.trigger('pointermove')
    await app.get('.visual-block-handle').trigger('click')
    await flushPromises()
    await rows[1]!.trigger('pointermove')
    const duplicate = app.findAll('[role="menuitem"]').find(item => /复制节点|Duplicate node/u.test(item.text()))!
    await duplicate.trigger('click')
    await flushPromises()
    expect(app.findAll('.ProseMirror > p').map(row => row.text())).toEqual(['Alpha', 'Alpha', 'Omega'])
    expect(app.text()).not.toContain('操作失败')
  } finally { app.unmount() }
})

it.each([{ action: 'copy', expected: 'Alpha', succeeds: true }, { action: 'copy-anchor', expected: '#alpha', succeeds: true }, { action: 'copy', expected: 'Alpha', succeeds: false }])('handles HTTP $action (success=$succeeds)', async ({ action, expected, succeeds }) => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const originalExec = Object.getOwnPropertyDescriptor(document, 'execCommand')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  let copied = ''
  Object.defineProperty(document, 'execCommand', { configurable: true, value: (command: string) => {
    if (command === 'copy') copied = (document.activeElement as HTMLTextAreaElement).value
    return command === 'copy' && succeeds
  } })
  const app = mount(PlaygroundApp, { attachTo: document.body, props: {
    articleCatalog: [{ documentId: 'http-copy', title: 'Copy', initialMarkdown: 'Alpha' }],
  } })
  try {
    await flushPromises()
    await app.get('.ProseMirror > p').trigger('pointermove')
    await app.get('.visual-block-handle').trigger('click')
    await app.get(`[data-block-action="${action}"]`).trigger('click')
    await flushPromises()
    expect(copied).toBe(expected)
    if (!succeeds) expect(app.get('[role="alert"]').text()).toContain('复制失败')
    expect(app.text()).not.toContain('文档生命周期操作失败')
  } finally {
    app.unmount()
    if (original) Object.defineProperty(navigator, 'clipboard', original)
    else Reflect.deleteProperty(navigator, 'clipboard')
    if (originalExec) Object.defineProperty(document, 'execCommand', originalExec)
    else Reflect.deleteProperty(document, 'execCommand')
  }
})
