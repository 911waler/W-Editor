import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MockUploadAdapter, type UploadAdapter } from '../../src/adapters'
import MediaEditorHost from '../../src/ui/MediaEditorHost.vue'

enableAutoUnmount(afterEach)

interface InitialImageSettings {
  readonly initialName?: string
  readonly initialUrl?: string
  readonly initialWidth?: number | null
  readonly initialHeight?: number | null
  readonly initialAlignment?: 'left' | 'center' | 'right' | null
  readonly imageAlignmentAvailable?: boolean
}

function mountEditor(
  kind: 'audio' | 'image' | 'video' = 'image',
  uploadAdapter: UploadAdapter = new MockUploadAdapter(),
  locale: 'en' | 'ru' | 'zh' = 'en',
  imageSettings: InitialImageSettings = {},
) {
  return mount(MediaEditorHost, {
    attachTo: document.body,
    props: { kind, locale, uploadAdapter, ...imageSettings },
  })
}

function mountImage(settings: InitialImageSettings = {}, uploadAdapter: UploadAdapter = new MockUploadAdapter()) {
  return mountEditor('image', uploadAdapter, 'en', {
    initialName: 'Hero',
    initialUrl: 'https://assets.example.test/hero.png',
    ...settings,
  })
}

async function loadImage(wrapper: ReturnType<typeof mountImage>, width: number, height: number) {
  const image = wrapper.get<HTMLImageElement>('[data-image-preview]')
  Object.defineProperties(image.element, {
    naturalWidth: { configurable: true, value: width },
    naturalHeight: { configurable: true, value: height },
  })
  await image.trigger('load')
}

async function chooseImage(wrapper: ReturnType<typeof mountImage>) {
  const input = wrapper.get<HTMLInputElement>('#media-file-image')
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: [new File(['image'], 'replacement.png', { type: 'image/png' })],
  })
  await input.trigger('change')
  await vi.waitFor(() => expect(wrapper.find('[data-upload-result="ready"]').exists()).toBe(true))
}

describe('MediaEditorHost', () => {
  it('completes only the missing locked dimension when the preview loads after a width edit', async () => {
    const wrapper = mountImage()
    await wrapper.get('#media-width-image').setValue('400')
    await loadImage(wrapper, 1200, 600)
    expect(wrapper.get<HTMLInputElement>('#media-width-image').element.value).toBe('400')
    expect(wrapper.get<HTMLInputElement>('#media-height-image').element.value).toBe('200')
    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.emitted('apply')?.[0]?.[0]).toMatchObject({ imageLayout: { width: 400, height: 200 } })
  })

  it('uses a complete custom ratio entered before the preview loads', async () => {
    const wrapper = mountImage()
    await wrapper.get('#media-width-image').setValue('400')
    await wrapper.get('#media-height-image').setValue('300')
    await loadImage(wrapper, 1200, 600)
    await wrapper.get('#media-width-image').setValue('800')
    expect(wrapper.get<HTMLInputElement>('#media-height-image').element.value).toBe('600')
  })

  it('does not fill a missing dimension after unlocking before a late preview load', async () => {
    const wrapper = mountImage()
    await wrapper.get('#media-width-image').setValue('400')
    await wrapper.get('#media-aspect-lock-image').setValue(false)
    await loadImage(wrapper, 1200, 600)
    expect(wrapper.get<HTMLInputElement>('#media-width-image').element.value).toBe('400')
    expect(wrapper.get<HTMLInputElement>('#media-height-image').element.value).toBe('')
  })
  it('replaces media labels and an existing validation error when the locale changes', async () => {
    const wrapper = mountEditor('image', new MockUploadAdapter(), 'zh')
    expect(wrapper.get('[role="dialog"]').text()).toContain('图片资源')
    expect(wrapper.text()).toContain('名称')
    expect(wrapper.text()).toContain('选择图片')
    expect(wrapper.text()).toContain('取消')
    expect(wrapper.text()).toContain('应用')

    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('资源名称为必填项')

    await wrapper.setProps({ locale: 'ru' })

    expect(wrapper.get('[role="dialog"]').text()).toContain('Изображение')
    expect(wrapper.text()).toContain('Название')
    expect(wrapper.text()).toContain('Выбрать изображение')
    expect(wrapper.text()).toContain('Отмена')
    expect(wrapper.text()).toContain('Применить')
    expect(wrapper.get('[role="alert"]').text()).toContain('Название ресурса обязательно')
    wrapper.unmount()
  })

  it.each(['audio', 'video'] as const)('retains the URL input and draft contract for %s', async (kind) => {
    const wrapper = mountEditor(kind)
    await wrapper.get(`#media-name-${kind}`).setValue('Clip')
    await wrapper.get(`#media-url-${kind}`).setValue(`https://assets.example.test/clip.${kind}`)
    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.emitted('apply')).toEqual([[{
      kind,
      mediaType: `${kind}/*`,
      name: 'Clip',
      size: 0,
      url: `https://assets.example.test/clip.${kind}`,
    }]])
    expect(JSON.stringify(wrapper.emitted('apply'))).not.toMatch(/Blob|data:/u)
    wrapper.unmount()
  })

  it('edits existing image properties without displaying its source URL', async () => {
    const wrapper = mountImage({
      initialWidth: 640, initialHeight: 320, initialAlignment: 'center', imageAlignmentAvailable: true,
    })
    expect(wrapper.find('#media-url-image').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('URL')
    expect(wrapper.get<HTMLInputElement>('#media-width-image').element.value).toBe('640')
    expect(wrapper.get<HTMLInputElement>('#media-height-image').element.value).toBe('320')
    expect(wrapper.get<HTMLInputElement>('#media-aspect-lock-image').element.checked).toBe(true)
    expect(wrapper.get('[data-image-align="center"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.text()).toContain('paragraph')
    await wrapper.get('[data-image-align="right"]').trigger('click')
    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.emitted('apply')?.[0]?.[0]).toMatchObject({
      name: 'Hero', url: 'https://assets.example.test/hero.png',
      imageLayout: { width: 640, height: 320, alignment: 'right' },
    })
  })

  it('scales dimensions while locked and captures the edited ratio when relocked', async () => {
    const wrapper = mountImage({ initialWidth: 800, initialHeight: 400 })
    await wrapper.get('#media-width-image').setValue('600')
    expect(wrapper.get<HTMLInputElement>('#media-height-image').element.value).toBe('300')
    await wrapper.get('#media-aspect-lock-image').setValue(false)
    await wrapper.get('#media-height-image').setValue('240')
    expect(wrapper.get<HTMLInputElement>('#media-width-image').element.value).toBe('600')
    await wrapper.get('#media-aspect-lock-image').setValue(true)
    await wrapper.get('#media-width-image').setValue('300')
    expect(wrapper.get<HTMLInputElement>('#media-height-image').element.value).toBe('120')
    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.emitted('apply')?.[0]?.[0]).toMatchObject({ imageLayout: { width: 300, height: 120 } })
  })

  it('discovers natural dimensions while retaining untouched nullable dimensions', async () => {
    const wrapper = mountImage()
    await loadImage(wrapper, 1200, 600)
    expect(wrapper.get<HTMLInputElement>('#media-width-image').element.value).toBe('1200')
    expect(wrapper.get<HTMLInputElement>('#media-height-image').element.value).toBe('600')
    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.emitted('apply')?.[0]?.[0]).toMatchObject({ imageLayout: { width: null, height: null } })
    expect(wrapper.emitted('apply')?.[0]?.[0]).not.toHaveProperty('imageLayout.alignment')
  })

  it('uses natural aspect ratio for an image with only one explicit dimension', async () => {
    const wrapper = mountImage({ initialWidth: 400, initialHeight: null })
    await loadImage(wrapper, 1200, 600)
    expect(wrapper.get<HTMLInputElement>('#media-height-image').element.value).toBe('200')
    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.emitted('apply')?.[0]?.[0]).toMatchObject({ imageLayout: { width: 400, height: null } })
    await wrapper.get('#media-height-image').setValue('300')
    expect(wrapper.get<HTMLInputElement>('#media-width-image').element.value).toBe('600')
  })

  it('clears explicit dimensions when original size is selected', async () => {
    const wrapper = mountImage({ initialWidth: 640, initialHeight: 320 })
    await loadImage(wrapper, 1200, 600)
    await wrapper.get('#media-width-image').setValue('320')
    await wrapper.get('[data-image-reset]').trigger('click')
    expect(wrapper.get<HTMLInputElement>('#media-width-image').element.value).toBe('1200')
    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.emitted('apply')?.[0]?.[0]).toMatchObject({ imageLayout: { width: null, height: null } })
  })

  it.each(['0', '15', '4097', '17.5', ''])('rejects changed invalid pixel dimension %j before applying', async (value) => {
    const wrapper = mountImage({ initialWidth: 640, initialHeight: 320 })
    await wrapper.get('#media-width-image').setValue(value)
    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.emitted('apply')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toContain('16')
    expect(wrapper.get('[role="alert"]').text()).not.toContain('URL')
  })

  it('preserves untouched legacy sizes outside the new input range', async () => {
    const wrapper = mountImage({ initialWidth: 8, initialHeight: 8192 })
    await wrapper.get('#media-name-image').setValue('Renamed')
    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.emitted('apply')?.[0]?.[0]).toMatchObject({
      name: 'Renamed', imageLayout: { width: 8, height: 8192 },
    })
  })

  it('retains size edits if the preview loads after typing', async () => {
    const wrapper = mountImage({ initialWidth: 640, initialHeight: 320 })
    await wrapper.get('#media-width-image').setValue('480')
    await loadImage(wrapper, 900, 900)
    expect(wrapper.get<HTMLInputElement>('#media-width-image').element.value).toBe('480')
    expect(wrapper.get<HTMLInputElement>('#media-height-image').element.value).toBe('240')
    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.emitted('apply')?.[0]?.[0]).toMatchObject({ imageLayout: { width: 480, height: 240 } })
  })

  it('allows metadata changes when the image preview cannot load', async () => {
    const wrapper = mountImage({ initialWidth: 640, initialHeight: 320 })
    await wrapper.get('[data-image-preview]').trigger('error')
    await wrapper.get('#media-name-image').setValue('Renamed')
    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.emitted('apply')?.[0]?.[0]).toMatchObject({ name: 'Renamed', imageLayout: { width: 640, height: 320 } })
  })

  it('explains unavailable paragraph alignment and omits it from the draft', async () => {
    const wrapper = mountImage({ initialAlignment: 'center' })
    expect(wrapper.get('[data-image-align="center"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('unavailable')
    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.emitted('apply')?.[0]?.[0]).not.toHaveProperty('imageLayout.alignment')
  })

  it('preserves an existing alignment outside the available choices until a choice is made', async () => {
    const wrapper = mountImage({ initialAlignment: null, imageAlignmentAvailable: true })
    expect(wrapper.findAll('[data-image-align][aria-pressed="true"]')).toHaveLength(0)
    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.emitted('apply')?.[0]?.[0]).not.toHaveProperty('imageLayout.alignment')
    await wrapper.get('[data-image-align="left"]').trigger('click')
    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.emitted('apply')?.[1]?.[0]).toHaveProperty('imageLayout.alignment', 'left')
  })

  it('cancels image property edits without applying a draft', async () => {
    const wrapper = mountImage({ initialWidth: 640, initialHeight: 320, imageAlignmentAvailable: true })
    await wrapper.get('#media-width-image').setValue('320')
    await wrapper.get('[data-image-align="right"]').trigger('click')
    await wrapper.get('.dialog-panel__actions button:not(.primary-action)').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('apply')).toBeUndefined()
  })

  it('replaces a local image while preserving its custom size and paragraph alignment', async () => {
    const wrapper = mountImage({
      initialWidth: 640, initialHeight: 320, initialAlignment: 'right', imageAlignmentAvailable: true,
    })
    await chooseImage(wrapper)
    await loadImage(wrapper, 900, 900)
    expect(wrapper.text()).not.toContain('URL')
    expect(wrapper.text()).toContain('Replace image')
    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.emitted('apply')?.[0]?.[0]).toMatchObject({
      url: 'https://fixtures.w-editor.test/uploads/image/asset-001',
      imageLayout: { width: 640, height: 320, alignment: 'right' },
    })
  })

  it('keeps a replacement image at natural size when no custom size was set', async () => {
    const wrapper = mountImage()
    await loadImage(wrapper, 1200, 600)
    await chooseImage(wrapper)
    await loadImage(wrapper, 900, 900)
    expect(wrapper.get<HTMLInputElement>('#media-height-image').element.value).toBe('900')
    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.emitted('apply')?.[0]?.[0]).toMatchObject({ imageLayout: { width: null, height: null } })
  })

  it('uses image-specific source validation and upload errors without URL copy or adapter details', async () => {
    const wrapper = mountImage({ initialUrl: '' }, {
      upload: async () => { throw new Error('Bad URL https://private.example.test/image') },
    })
    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.get('[role="alert"]').text()).toContain('image')
    expect(wrapper.get('[role="alert"]').text()).not.toContain('URL')
    const input = wrapper.get<HTMLInputElement>('#media-file-image')
    Object.defineProperty(input.element, 'files', { configurable: true, value: [new File(['image'], 'bad.png')] })
    await input.trigger('change')
    await vi.waitFor(() => expect(wrapper.get('[role="alert"]').text()).toContain('Upload failed'))
    expect(wrapper.get('[role="alert"]').text()).not.toMatch(/URL|private\.example/u)
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
