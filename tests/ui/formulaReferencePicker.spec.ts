import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import FormulaReferencePicker from '../../packages/editor-vue/src/ui/FormulaReferencePicker.vue'

const candidates = [
  { from: 10, to: 22, content: 'x^2', number: 1, formulaId: null },
  { from: 30, to: 44, content: String.raw`\frac{a}{b}`, number: 2, formulaId: 'existing' },
]

describe('FormulaReferencePicker', () => {
  it('lists numbered safe previews and emits the selected source position', async () => {
    const wrapper = mount(FormulaReferencePicker, { props: { candidates, locale: 'zh' } })
    expect(wrapper.text()).toContain('公式 1')
    expect(wrapper.findAll('.katex')).toHaveLength(2)
    await wrapper.get('input[value="30"]').setValue(true)
    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.emitted('apply')).toEqual([[30]])
    expect(candidates[0]?.formulaId).toBeNull()
  })

  it('explains an empty inventory and prevents submission', async () => {
    const wrapper = mount(FormulaReferencePicker, { props: { candidates: [], locale: 'en' } })
    expect(wrapper.text()).toContain('Insert a block equation first')
    expect(wrapper.get('.primary-action').attributes('disabled')).toBeDefined()
    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.emitted('apply')).toBeUndefined()
  })

  it('localizes an open picker, shows readable failures, and rejects removed candidates', async () => {
    const wrapper = mount(FormulaReferencePicker, { props: { candidates, locale: 'zh' } })
    await wrapper.get('input[value="30"]').setValue(true)
    await wrapper.setProps({ locale: 'ru', error: 'Target changed', candidates: [candidates[0]!] })
    expect(wrapper.text()).toContain('Формула 1')
    expect(wrapper.get('[role="alert"]').text()).toBe('Target changed')
    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.emitted('apply')).toBeUndefined()
  })

  it('contains keyboard focus and lets Escape cancel', async () => {
    const wrapper = mount(FormulaReferencePicker, { props: { candidates, locale: 'en' }, attachTo: document.body })
    try {
      const first = wrapper.get('input').element as HTMLInputElement
      const last = wrapper.get('.primary-action').element as HTMLButtonElement
      expect(document.activeElement).toBe(first)
      last.focus()
      await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Tab' })
      expect(document.activeElement).toBe(first)
      await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(last)
      await wrapper.get('input[value="30"]').setValue(true)
      const selected = wrapper.get('input[value="30"]').element as HTMLInputElement
      selected.focus()
      await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(last)
      await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
      expect(wrapper.emitted('cancel')).toHaveLength(1)
    } finally { wrapper.unmount() }
  })
})
