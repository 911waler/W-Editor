import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import HistoryRestoreDialog from '../../apps/playground/src/HistoryRestoreDialog.vue'
import { NwuAdapter } from '../../src/nwu/adapter'
const version = { id: '7', savedAt: '2026-10-01T01:00:00Z', kind: 'manual-save', title: 'Past title' }
describe('history restoration', () => {
  it('keeps initial reverse tab and programmatic focus inside the modal, then restores the trigger', async () => {
    const trigger = document.createElement('button')
    document.body.append(trigger); trigger.focus()
    const wrapper = mount(HistoryRestoreDialog, { attachTo: document.body, props: { documentId: 'blog:1', services: { list: async () => ({ versions: [], nextCursor: null }), get: vi.fn() }, recovery: null, busy: false, error: '' } })
    try {
      await flushPromises()
      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
      document.activeElement?.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(document.activeElement?.textContent?.trim()).toBe('取消')
      trigger.focus()
      expect(wrapper.get('[data-testid="history-restore-dialog"]').element.contains(document.activeElement)).toBe(true)
      await wrapper.setProps({ busy: true })
      trigger.focus()
      expect(document.activeElement).toBe(wrapper.get('[data-testid="history-restore-dialog"]').element)
    } finally { wrapper.unmount() }
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
  it('loads only summaries until selected and restores only after confirmation', async () => {
    const services = { list: vi.fn(async () => ({ versions: [version], nextCursor: null })), get: vi.fn(async () => ({ ...version, markdown: 'Past body' })) }
    const wrapper = mount(HistoryRestoreDialog, { props: { documentId: 'blog:1', services, recovery: null, busy: false, error: '' } })
    try {
      await flushPromises()
      expect(services.get).not.toHaveBeenCalled()
      expect(wrapper.get('[data-testid="history-restore-confirm"]').attributes('disabled')).toBeDefined()
      await wrapper.get('[data-history-version="7"]').trigger('click')
      await flushPromises()
      expect(wrapper.get('[data-testid="history-preview"]').text()).toBe('Past body')
      expect(wrapper.emitted('restore')).toBeUndefined()
      await wrapper.get('[data-testid="history-restore-confirm"]').trigger('click')
      expect(wrapper.emitted('restore')).toEqual([[{ ...version, markdown: 'Past body' }]])
    } finally { wrapper.unmount() }
  })
  it('keeps an undated personal recovery draft available when the history request fails', async () => {
    const recovery = { id: 'local-recovery', savedAt: null, kind: 'recovery', title: 'Unsaved', markdown: 'Personal body' }
    const wrapper = mount(HistoryRestoreDialog, { props: { documentId: 'blog:1', services: { list: vi.fn(async () => { throw new Error('Offline') }), get: vi.fn() }, recovery, busy: false, error: '' } })
    try {
      await flushPromises()
      expect(wrapper.text()).toContain('保存时间未知')
      await wrapper.get('[data-testid="history-recovery"]').trigger('click')
      await wrapper.get('[data-testid="history-restore-confirm"]').trigger('click')
      expect(wrapper.emitted('restore')).toEqual([[recovery]])
    } finally { wrapper.unmount() }
  })
  it('does not display a stale selection response', async () => {
    let resolve!: (value: typeof version & { markdown: string }) => void
    const services = { list: vi.fn(async () => ({ versions: [version, { ...version, id: '8' }], nextCursor: null })), get: vi.fn(async (_doc: string, id: string) => id === '7' ? new Promise<typeof version & { markdown: string }>(done => { resolve = done }) : { ...version, id, markdown: 'New selection' }) }
    const wrapper = mount(HistoryRestoreDialog, { props: { documentId: 'blog:1', services, recovery: null, busy: false, error: '' } })
    try {
      await flushPromises()
      await wrapper.get('[data-history-version="7"]').trigger('click')
      await wrapper.get('[data-history-version="8"]').trigger('click')
      await flushPromises()
      resolve({ ...version, markdown: 'Stale body' })
      await flushPromises()
      expect(wrapper.get('[data-testid="history-preview"]').text()).toBe('New selection')
    } finally { wrapper.unmount() }
  })
  it('uses protected history endpoints without writes', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ versions: [version], nextCursor: null })))
    const adapter = new NwuAdapter({ userId: 7, csrfToken: 'csrf', initialDocumentId: 'blog:1', readonly: false, apiBase: '/api/blog-editor', blogListUrl: '/blogs' }, request, localStorage)
    await adapter.historyServices.list('blog:1', 'cursor/value')
    expect(request).toHaveBeenCalledWith(expect.stringContaining('/documents/blog%3A1/history?cursor=cursor%2Fvalue'), expect.objectContaining({ method: 'GET', credentials: 'same-origin' }))
    await adapter.historyServices.get('blog:1', '7')
    expect(request).toHaveBeenLastCalledWith(expect.stringContaining('/documents/blog%3A1/history/7'), expect.objectContaining({ method: 'GET' }))
  })
})
