import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import FormulaPicker from '../../src/ui/FormulaPicker.vue'

describe('FormulaPicker localization', () => {
  it('replaces every formula-picker label when an open picker changes locale', async () => {
    const wrapper = mount(FormulaPicker, {
      props: { error: null, locale: 'zh', mode: 'inline', modelValue: 'E=mc^2' },
    })

    expect(wrapper.get('[role="dialog"]').text()).toContain('公式')
    expect(wrapper.text()).toContain('行内公式')
    expect(wrapper.text()).toContain('快捷工具')
    expect(wrapper.text()).toContain('公式模板')
    expect(wrapper.text()).toContain('文本样式')
    expect(wrapper.text()).toContain('分数')
    expect(wrapper.text()).toContain('勾股定理')
    expect(wrapper.text()).toContain('求和')
    expect(wrapper.text()).toContain('公式源码')
    expect(wrapper.text()).not.toContain('Quick tools')

    await wrapper.setProps({ locale: 'ru' })

    expect(wrapper.text()).toContain('Формула')
    expect(wrapper.text()).toContain('Встроенная формула')
    expect(wrapper.text()).toContain('Быстрые инструменты')
    expect(wrapper.text()).toContain('Шаблоны формул')
    expect(wrapper.text()).toContain('Стили текста')
    expect(wrapper.text()).toContain('Дробь')
    expect(wrapper.text()).toContain('Теорема Пифагора')
    expect(wrapper.text()).toContain('Суммирование')
    expect(wrapper.text()).toContain('Исходный код формулы')
    expect(wrapper.text()).not.toContain('快捷工具')
  })

  it('renders a safe live preview that follows source and mode updates', async () => {
    const wrapper = mount(FormulaPicker, {
      props: { error: null, locale: 'zh', mode: 'inline', modelValue: String.raw`\frac{x}{y}` },
    })

    const preview = wrapper.get('[data-formula-live-preview]')
    expect(preview.find('.katex .mfrac').exists()).toBe(true)
    expect(preview.text()).toContain('x')
    expect(preview.text()).toContain('y')

    await wrapper.setProps({ mode: 'block', modelValue: String.raw`\sqrt{a^2+b^2}` })
    expect(preview.find('.katex-display').exists()).toBe(true)
    expect(preview.find('.katex .sqrt').exists()).toBe(true)
  })
})
