import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useReferenceFormatting } from '../../apps/playground/src/useReferenceFormatting'
import type { DocumentReference, ReferenceStyle } from '../../packages/editor-core/src'

const service = vi.hoisted(() => ({
  ensure: vi.fn(),
  listeners: new Set<() => void>(),
  ready: new Set<string>(),
}))
vi.mock('../../packages/editor-vue/src/services', () => ({
  ensureReferenceStyles: service.ensure,
  areReferenceStylesReady: (styles: readonly string[]) => styles.every(style => service.ready.has(style)),
  onReferenceStylesLoaded: (listener: () => void) => {
    service.listeners.add(listener)
    return () => { service.listeners.delete(listener) }
  },
  formatReference: (reference: DocumentReference) => service.ready.has(reference.style ?? 'plain') ? `Formatted ${reference.text}` : reference.text,
}))

beforeEach(() => {
  service.listeners.clear()
  service.ready.clear()
  service.ensure.mockRejectedValueOnce(new Error('Journal style could not load'))
})

describe('reference formatting load recovery', () => {
  it('clears an earlier failure and refreshes text after an external retry loads all current styles', async () => {
    const entries: readonly DocumentReference[] = [
      { id: 'nature', number: 1, text: 'Nature reference', style: 'journal:nature@1' },
      { id: 'science', number: 2, text: 'Science reference', style: 'journal:science@1' },
    ]
    const Harness = defineComponent({
      setup() {
        const { error, format } = useReferenceFormatting(() => entries)
        return () => h('section', [h('p', { role: 'alert' }, error.value), ...entries.map(entry => h('span', format(entry)))])
      },
    })
    const wrapper = mount(Harness)
    const externalLoad = async (style: ReferenceStyle) => {
      service.ready.add(style)
      for (const listener of service.listeners) listener()
      await nextTick()
    }
    try {
      await flushPromises()
      expect(wrapper.get('[role="alert"]').text()).toBe('Journal style could not load')
      expect(wrapper.findAll('span').map(entry => entry.text())).toEqual(['Nature reference', 'Science reference'])

      // Another component retries a style. Keep the error until every style used here is ready.
      await externalLoad('journal:nature@1')
      expect(wrapper.get('[role="alert"]').text()).toBe('Journal style could not load')
      expect(wrapper.findAll('span')[0]!.text()).toBe('Formatted Nature reference')
      await externalLoad('journal:science@1')
      expect(wrapper.get('[role="alert"]').text()).toBe('')
      expect(wrapper.findAll('span').map(entry => entry.text())).toEqual(['Formatted Nature reference', 'Formatted Science reference'])
      expect(service.ensure).toHaveBeenCalledTimes(1)
    } finally { wrapper.unmount() }
    expect(service.listeners.size).toBe(0)
  })
})
