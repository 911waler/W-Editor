import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import { MockUploadAdapter, type UploadAdapter } from '../../src/adapters'
import MediaEditorHost from '../../src/ui/MediaEditorHost.vue'

function mountEditor(
  kind: 'audio' | 'image' | 'video' = 'image',
  uploadAdapter: UploadAdapter = new MockUploadAdapter(),
  locale: 'en' | 'ru' | 'zh' = 'en',
) {
  return mount(MediaEditorHost, {
    attachTo: document.body,
    props: { kind, locale, uploadAdapter },
  })
}

describe('MediaEditorHost', () => {
  it('replaces media labels and an existing validation error when the locale changes', async () => {
    const wrapper = mountEditor('image', new MockUploadAdapter(), 'zh')
    expect(wrapper.get('[role="dialog"]').text()).toContain('图片资源')
    expect(wrapper.text()).toContain('名称')
    expect(wrapper.text()).toContain('或选择本地图片文件')
    expect(wrapper.text()).toContain('取消')
    expect(wrapper.text()).toContain('应用')

    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('资源名称为必填项')

    await wrapper.setProps({ locale: 'ru' })

    expect(wrapper.get('[role="dialog"]').text()).toContain('Изображение')
    expect(wrapper.text()).toContain('Название')
    expect(wrapper.text()).toContain('Или выберите локальный файл: Изображение')
    expect(wrapper.text()).toContain('Отмена')
    expect(wrapper.text()).toContain('Применить')
    expect(wrapper.get('[role="alert"]').text()).toContain('Название ресурса обязательно')
    wrapper.unmount()
  })

  it('validates and applies URL input without retaining binary input', async () => {
    const wrapper = mountEditor('image')
    await wrapper.get('#media-name-image').setValue('Hero')
    await wrapper.get('#media-url-image').setValue('https://assets.example.test/hero.png')
    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.emitted('apply')).toEqual([[{
      kind: 'image',
      mediaType: 'image/*',
      name: 'Hero',
      size: 0,
      url: 'https://assets.example.test/hero.png',
    }]])
    expect(JSON.stringify(wrapper.emitted('apply'))).not.toMatch(/Blob|data:/u)
    wrapper.unmount()
  })

  it('routes a local file through the injected adapter and applies its URL metadata', async () => {
    const upload = vi.fn(new MockUploadAdapter().upload.bind(new MockUploadAdapter()))
    const wrapper = mountEditor('audio', { upload })
    const input = wrapper.get<HTMLInputElement>('#media-file-audio')
    const file = new File(['audio'], 'local.wav', { type: 'audio/wav' })
    Object.defineProperty(input.element, 'files', { configurable: true, value: [file] })
    await input.trigger('change')
    await vi.waitFor(() => expect(wrapper.find('[data-upload-result="ready"]').exists()).toBe(true))
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ file, kind: 'audio', signal: expect.any(AbortSignal) }))
    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.emitted('apply')?.[0]?.[0]).toEqual({
      kind: 'audio',
      mediaType: 'audio/wav',
      name: 'sample-audio',
      size: 128,
      url: 'https://fixtures.w-editor.test/uploads/audio/asset-001',
    })
    wrapper.unmount()
  })

  it('shows upload failure and cancel without emitting an asset', async () => {
    const wrapper = mountEditor('video', new MockUploadAdapter({ failureKinds: ['video'] }))
    const input = wrapper.get<HTMLInputElement>('#media-file-video')
    Object.defineProperty(input.element, 'files', {
      configurable: true,
      value: [new File(['video'], 'local.mp4', { type: 'video/mp4' })],
    })
    await input.trigger('change')
    await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('Deterministic video upload failure'))
    await wrapper.get('button:not(.primary-action)').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('apply')).toBeUndefined()
    wrapper.unmount()
  })
})
