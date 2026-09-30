import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ReferencePanel from '../../apps/playground/src/ReferencePanel.vue'
import type { ReferenceMetadata } from '../../packages/editor-core/src'

const base = { entries: [{ id: 'book', number: 7, text: '10.1234/book' }], selected: null, error: '', busy: false, counts: { book: 2 }, notes: { book: { text: 'Private editorial reason', revision: 1 } }, notesError: '', notesBusy: false, notesLoading: false, savedVersion: 0 }
describe('reference panel form', () => {
  it('keeps shared notes separate from public citation updates', async () => {
    const wrapper = mount(ReferencePanel, { props: base })
    try {
      await wrapper.get('[data-reference-edit="book"]').trigger('click')
      await wrapper.get('#reference-input').setValue('Public citation')
      await wrapper.get('[data-testid="reference-form"]').trigger('submit')
      expect(JSON.stringify(wrapper.emitted('update'))).not.toContain('Private editorial reason')
      await wrapper.get('[data-reference-note="book"]').setValue('New private reason')
      await wrapper.get('[data-reference-note-save="book"]').trigger('click')
      expect(wrapper.emitted('saveNote')).toEqual([['book', 'New private reason']])
    } finally { wrapper.unmount() }
  })
  it('ignores a pending DOI lookup after the input changes', async () => {
    let resolve!: (value: ReferenceMetadata) => void
    const lookupDoi = vi.fn(() => new Promise<ReferenceMetadata>(done => { resolve = done }))
    const wrapper = mount(ReferencePanel, { props: { ...base, lookupDoi } })
    try {
      await wrapper.get('#reference-input').setValue('10.1234/old')
      await wrapper.get('[data-testid="reference-doi-lookup"]').trigger('click')
      const signal = lookupDoi.mock.calls[0] as unknown as [string, AbortSignal]
      await wrapper.get('#reference-input').setValue('10.1234/new')
      expect(signal[1].aborted).toBe(true)
      resolve({ title: 'Stale title' })
      await flushPromises()
      expect(wrapper.text()).not.toContain('Stale title')
      await wrapper.get('[data-testid="reference-form"]').trigger('submit')
      expect(wrapper.emitted('insert')).toEqual([[{ text: '10.1234/new', style: 'plain' }]])
    } finally { wrapper.unmount() }
  })
  it('loads metadata on request and keeps numeric reference identity when changing style', async () => {
    const lookupDoi = vi.fn(async () => ({ title: 'A test paper', year: '2025', authors: [{ family: 'Li', given: 'C' }], doi: '10.1234/book' }))
    const wrapper = mount(ReferencePanel, { props: { ...base, lookupDoi } })
    try {
      await wrapper.get('[data-reference-edit="book"]').trigger('click')
      await wrapper.get('[data-testid="reference-doi-lookup"]').trigger('click')
      await flushPromises()
      expect(wrapper.get('[data-reference-field="title"]').element).toHaveProperty('value', 'A test paper')
      await wrapper.get('[data-testid="reference-style"]').setValue('apa')
      await wrapper.get('[data-testid="reference-form"]').trigger('submit')
      expect(wrapper.emitted('update')?.[0]?.[0]).toEqual(base.entries[0])
      expect(wrapper.emitted('update')?.[0]?.[1]).toMatchObject({ style: 'apa', metadata: { title: 'A test paper' } })
    } finally { wrapper.unmount() }
  })
})
