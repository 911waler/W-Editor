import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JOURNAL_REFERENCE_STYLES } from '../../packages/editor-core/src'
import ReferenceStylePicker from '../../apps/playground/src/ReferenceStylePicker.vue'

const services = vi.hoisted(() => ({ ensure: vi.fn(), format: vi.fn() }))
vi.mock('../../packages/editor-vue/src/services', async importOriginal => ({
  ...await importOriginal<typeof import('../../packages/editor-vue/src/services')>(),
  ensureReferenceStyles: services.ensure,
  formatReference: services.format,
}))
const props = { entries: [{ id: 'one', number: 7, text: 'Actual first reference' }, { id: 'two', number: 9, text: 'Actual second reference' }, { id: 'three', number: 10, text: 'Not previewed' }], currentStyle: null, busy: false }
const wrappers: ReturnType<typeof mount>[] = []
function picker(overrides = {}) {
  const wrapper = mount(ReferenceStylePicker, { attachTo: document.body, props: { ...props, ...overrides } })
  wrappers.push(wrapper)
  return wrapper
}
beforeEach(() => {
  services.ensure.mockResolvedValue(undefined)
  services.format.mockImplementation(entry => `${entry.style}: ${entry.text}`)
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()) })

describe('reference style picker', () => {
  it('finds Applied Physics Letters by APL, full title and either ISSN', async () => {
    const wrapper = picker()
    for (const query of ['APL', 'Applied Physics Letters', '00036951', '1077-3118']) {
      await wrapper.get('[data-testid="reference-style-search"]').setValue(query)
      expect(wrapper.find('[data-testid="reference-style-result-journal:applied-physics-letters@1"]').exists()).toBe(true)
    }
    await wrapper.get('[data-testid="reference-style-result-journal:applied-physics-letters@1"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="reference-style-apply"]').trigger('click')
    expect(wrapper.emitted('apply')).toEqual([['journal:applied-physics-letters@1']])
  })

  it('searches journal names, aliases and ISSNs, previews real references and emits one full-document style choice', async () => {
    const wrapper = picker()
    const journal = JOURNAL_REFERENCE_STYLES.find(style => style.issns.length && style.aliases.length)!
    for (const query of [journal.label, journal.aliases[0]!, journal.issns[0]!.replaceAll('-', '')]) {
      await wrapper.get('[data-testid="reference-style-search"]').setValue(query)
      expect(wrapper.find(`[data-testid="reference-style-result-${journal.id}"]`).exists()).toBe(true)
    }
    await wrapper.get(`[data-testid="reference-style-result-${journal.id}"]`).trigger('click')
    await flushPromises()
    const preview = wrapper.get('[data-testid="reference-style-preview"]').text()
    expect(preview).toContain('[7]')
    expect(preview).toContain('Actual first reference')
    expect(preview).toContain('Actual second reference')
    expect(preview).not.toContain('Not previewed')
    expect(wrapper.text()).toContain('3 条文献缺少标题、作者或年份')
    await wrapper.get('[data-testid="reference-style-apply"]').trigger('click')
    expect(wrapper.emitted('apply')).toEqual([[journal.id]])
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('blocks apply on preload failure, ignores stale completion, and allows retry', async () => {
    let resolveOld!: () => void
    services.ensure.mockImplementationOnce(() => new Promise<void>(resolve => { resolveOld = resolve }))
    const wrapper = picker()
    services.ensure.mockRejectedValueOnce(new Error('Style unavailable'))
    await wrapper.get('[data-testid="reference-style-result-apa"]').trigger('click')
    await flushPromises()
    resolveOld()
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Style unavailable')
    expect(wrapper.get('[data-testid="reference-style-apply"]').attributes('disabled')).toBeDefined()
    const retry = wrapper.findAll('button').find(button => button.text() === '重新加载')!
    await retry.trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="reference-style-apply"]').attributes('disabled')).toBeUndefined()
  })

  it('labels an empty-document sample and preserves focus and busy Escape guard', async () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const wrapper = picker({ entries: [] })
    await flushPromises()
    expect(wrapper.text()).toContain('示例文献（本文尚无参考文献）')
    expect(wrapper.element.contains(document.activeElement)).toBe(true)
    await wrapper.setProps({ busy: true })
    await wrapper.trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toBeUndefined()
    await wrapper.setProps({ busy: false })
    await wrapper.trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toEqual([[]])
    wrapper.unmount()
    wrappers.pop()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
})
