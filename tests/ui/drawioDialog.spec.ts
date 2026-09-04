import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import type { DrawioRequest } from '../../src/adapters'
import DrawioDialog from '../../src/ui/DrawioDialog.vue'

describe('DrawioDialog', () => {
  it('uses the same strict adapter contract for iframe load, save, and cancel', async () => {
    const notifyLoaded = vi.fn(() => true)
    const requestSave = vi.fn(() => true)
    const adapter = {
      begin: vi.fn((request: DrawioRequest) => {
        return { cancel: vi.fn(() => true), editorUrl: adapter.editorUrl, notifyLoaded, requestId: request.requestId, requestSave }
      }),
      editorUrl: `${window.location.origin}/drawio-bridge.html`,
    }
    const wrapper = mount(DrawioDialog, {
      attachTo: document.body,
      props: { adapter, initialXml: '<mxfile/>', locale: 'zh', requestId: 'request-001' },
    })
    await flushPromises()
    const iframe = wrapper.get<HTMLIFrameElement>('[data-testid="drawio-bridge-frame"]')
    expect(iframe.element.contentWindow).not.toBeNull()
    await iframe.trigger('load')
    expect(notifyLoaded).toHaveBeenCalled()
    const request = adapter.begin.mock.calls[0]?.[0]
    if (request === undefined) throw new Error('DrawioDialog did not begin an adapter request.')
    request.handlers.onReady()
    await flushPromises()
    const apply = wrapper.get('[data-testid="drawio-apply"]')
    expect(apply.attributes('disabled')).toBeUndefined()
    await apply.trigger('click')
    expect(requestSave).toHaveBeenCalledOnce()
    request.handlers.onSave({ png: 'data:image/png;base64,AAAA', xml: '<mxfile/>' })
    expect(wrapper.emitted('apply')).toEqual([[
      { png: 'data:image/png;base64,AAAA', xml: '<mxfile/>' },
    ]])
    wrapper.unmount()
  })

  it('replaces draw.io chrome and the current semantic status when the locale changes', async () => {
    const adapter = {
      begin: vi.fn((request: DrawioRequest) => {
        return { cancel: vi.fn(() => true), editorUrl: adapter.editorUrl, notifyLoaded: vi.fn(() => true), requestId: request.requestId, requestSave: vi.fn(() => true) }
      }),
      editorUrl: `${window.location.origin}/drawio-bridge.html`,
    }
    const wrapper = mount(DrawioDialog, {
      attachTo: document.body,
      props: { adapter, initialXml: '<mxfile/>', locale: 'zh', requestId: 'localized-drawio' },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('受控集成')
    expect(wrapper.text()).toContain('draw.io 图表')
    expect(wrapper.get('[role="status"]').text()).toContain('正在加载安全的 draw.io 桥接器')
    expect(wrapper.get('iframe').attributes('title')).toBe('W-Editor draw.io 桥接器')

    const request = adapter.begin.mock.calls[0]?.[0]
    if (request === undefined) throw new Error('DrawioDialog did not register request handlers.')
    request.handlers.onReady()
    await flushPromises()
    expect(wrapper.get('[role="status"]').text()).toContain('图表编辑器已就绪')

    await wrapper.setProps({ locale: 'ru' })

    expect(wrapper.text()).toContain('Управляемая интеграция')
    expect(wrapper.text()).toContain('Диаграмма draw.io')
    expect(wrapper.get('[role="status"]').text()).toContain('Редактор диаграмм готов')
    expect(wrapper.get('iframe').attributes('title')).toBe('Мост draw.io W-Editor')
    wrapper.unmount()
  })
})
