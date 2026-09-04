import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import type { DrawioRequest } from '../../src/adapters'
import App from '../../src/ui/App.vue'

async function activateSource(wrapper: ReturnType<typeof mount>): Promise<void> {
  await wrapper.get('[data-command-id="mode.source"]').trigger('click')
  await wrapper.get('[data-toolbar-menu="language"] .toolbar-menu__trigger').trigger('click')
  await wrapper.get('[data-command-id="language.en"]').trigger('click')
  await flushPromises()
}

function fakeAdapter() {
  let activeRequest: DrawioRequest | null = null
  const editorUrl = `${window.location.origin}/drawio-bridge.html?editor=%2Fvendor%2Fcherry-drawio%2Fdrawio_demo.html`
  return {
    adapter: {
      begin: vi.fn((request: DrawioRequest) => {
        activeRequest = request
        return {
          cancel: () => {
            if (activeRequest === null) return false
            activeRequest = null
            request.handlers.onCancel()
            return true
          },
          editorUrl,
          notifyLoaded: () => true,
          requestSave: () => true,
          requestId: request.requestId,
        }
      }),
      editorUrl,
    },
    request: () => activeRequest,
  }
}

describe('application draw.io dialog integration', () => {
  it('does not mount the draw.io bridge before the command is opened', () => {
    const wrapper = mount(App, { attachTo: document.body })
    expect(wrapper.find('[data-testid="drawio-bridge-frame"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows an actionable resource failure without changing Markdown', async () => {
    const { adapter } = fakeAdapter()
    const wrapper = mount(App, { attachTo: document.body, props: { drawioAdapter: adapter } })
    await activateSource(wrapper)
    await wrapper.get('#markdown-source').setValue('before')
    await wrapper.get('[data-toolbar-menu="insert"] .toolbar-menu__trigger').trigger('click')
    await wrapper.get('[data-command-id="insert.drawio"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="drawio-bridge-frame"]').trigger('error')
    await wrapper.get('[data-testid="drawio-bridge-frame"]').trigger('load')
    await flushPromises()

    expect(wrapper.get('[data-testid="drawio-resource-error"]').text()).toContain('resources')
    expect(wrapper.get('[data-testid="drawio-apply"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('#markdown-source').element).toHaveProperty('value', 'before')
    await wrapper.get('[aria-label="Cancel draw.io editing"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-editor-command="insert.drawio"]').exists()).toBe(false)
    expect(wrapper.get('#markdown-source').element).toHaveProperty('value', 'before')
    wrapper.unmount()
  })

  it('fails closed when the bridge never completes its handshake', async () => {
    const { adapter } = fakeAdapter()
    const wrapper = mount(App, { attachTo: document.body, props: { drawioAdapter: adapter } })
    await activateSource(wrapper)
    await wrapper.get('#markdown-source').setValue('before')
    await wrapper.get('[data-toolbar-menu="insert"] .toolbar-menu__trigger').trigger('click')
    await wrapper.get('[data-command-id="insert.drawio"]').trigger('click')
    await flushPromises()

    await vi.advanceTimersByTimeAsync(10_000)
    await flushPromises()

    expect(wrapper.get('[data-testid="drawio-resource-error"]').text()).toContain('resources')
    expect(wrapper.get('#markdown-source').element).toHaveProperty('value', 'before')
    wrapper.unmount()
  })

  it('uses the same-origin Cherry resource bridge by default without a diagrams.net URL', async () => {
    const wrapper = mount(App, { attachTo: document.body })
    await wrapper.get('[data-toolbar-menu="insert"] .toolbar-menu__trigger').trigger('click')
    await wrapper.get('[data-command-id="insert.drawio"]').trigger('click')
    await flushPromises()
    const src = wrapper.get<HTMLIFrameElement>('[data-testid="drawio-bridge-frame"]').attributes('src') ?? ''
    expect(src).toContain('/drawio-bridge.html')
    expect(decodeURIComponent(src)).toContain('/vendor/cherry-drawio/drawio_demo.html')
    expect(src).not.toContain('diagrams.net')
    wrapper.unmount()
  })

  it('opens the configurable bridge through visible UI and cancel does not revise Markdown', async () => {
    const { adapter } = fakeAdapter()
    const wrapper = mount(App, { attachTo: document.body, props: { drawioAdapter: adapter } })
    await activateSource(wrapper)
    await wrapper.get('#markdown-source').setValue('before')
    await wrapper.get('[data-toolbar-menu="insert"] .toolbar-menu__trigger').trigger('click')
    await wrapper.get('[data-command-id="insert.drawio"]').trigger('click')
    await flushPromises()

    const dialog = wrapper.get('[data-editor-command="insert.drawio"]')
    const frame = dialog.get<HTMLIFrameElement>('[data-testid="drawio-bridge-frame"]')
    expect(frame.attributes('src')).toBe(adapter.editorUrl)
    expect(frame.attributes('sandbox')).toBe('allow-scripts allow-same-origin allow-forms allow-modals allow-downloads')
    await dialog.get('[aria-label="Cancel draw.io editing"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-editor-command="insert.drawio"]').exists()).toBe(false)
    expect(wrapper.get('#markdown-source').element).toHaveProperty('value', 'before')
    wrapper.unmount()
  })

  it('commits validated output as exact Cherry source and exposes quota failure without losing in-memory Markdown', async () => {
    const { adapter, request } = fakeAdapter()
    const wrapper = mount(App, { attachTo: document.body, props: { drawioAdapter: adapter } })
    await activateSource(wrapper)
    await wrapper.get('#markdown-source').setValue('')
    await wrapper.get('[data-toolbar-menu="insert"] .toolbar-menu__trigger').trigger('click')
    await wrapper.get('[data-command-id="insert.drawio"]').trigger('click')
    await flushPromises()
    expect(request()).not.toBeNull()
    request()?.handlers.onSave({ png: 'data:image/png;base64,AAAA', xml: '<mxfile></mxfile>' })
    await flushPromises()
    const expected = '![draw.io diagram](data:image/png;base64,AAAA){data-type=drawio data-xml=%3Cmxfile%3E%3C/mxfile%3E}'
    expect(wrapper.find('[data-editor-command="insert.drawio"]').exists()).toBe(false)
    expect(wrapper.get('#markdown-source').element).toHaveProperty('value', expected)
    expect(wrapper.get('[role="status"]').text()).toContain('draw.io diagram applied.')

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })
    await vi.advanceTimersByTimeAsync(1_000)
    await flushPromises()
    expect(wrapper.get('.workspace-error').text()).toContain('LOCAL_PERSISTENCE_QUOTA_EXCEEDED')
    expect(wrapper.get('.workspace-error').text()).toContain('remains in memory')
    expect(wrapper.get('.workspace-error').text()).toContain('Export raw Markdown')
    expect(wrapper.get('#markdown-source').element).toHaveProperty('value', expected)
    setItem.mockRestore()
    wrapper.unmount()
  })
})
