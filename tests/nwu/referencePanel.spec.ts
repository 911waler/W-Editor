import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import ReferenceInsertDialog from '../../apps/playground/src/ReferenceInsertDialog.vue'
import ReferencePanel from '../../apps/playground/src/ReferencePanel.vue'
import type { ReferenceMetadata } from '../../packages/editor-core/src'

const base = { entries: [{ id: 'book', number: 7, text: '10.1234/book' }], selected: null, error: '', busy: false, counts: { book: 2 }, notes: { book: { text: 'Private editorial reason', revision: 1 } }, notesError: '', notesBusy: false, notesLoading: false, savedVersion: 0 }
describe('reference panel form', () => {
  it('starts compact and edits notes only on demand', async () => {
    const wrapper = mount(ReferencePanel, { props: base })
    try {
      expect(wrapper.find('textarea').exists()).toBe(false)
      expect(wrapper.get('[data-reference-note-text="book"]').text()).toBe('Private editorial reason')
      await wrapper.get('[data-testid="reference-add"]').trigger('click')
      expect(wrapper.emitted('requestInsert')).toEqual([[]])
      await wrapper.get('[data-reference-note-open="book"]').trigger('click')
      await wrapper.get('[data-reference-note="book"]').setValue('Unsaved')
      await wrapper.get('[data-reference-note-cancel="book"]').trigger('click')
      expect(wrapper.find('textarea').exists()).toBe(false)
      expect(wrapper.emitted('saveNote')).toBeUndefined()
      await wrapper.get('[data-reference-note-open="book"]').trigger('click')
      expect(wrapper.get('[data-reference-note="book"]').element).toHaveProperty('value', 'Private editorial reason')
      await wrapper.get('[data-reference-note-delete="book"]').trigger('click')
      expect(wrapper.emitted('saveNote')).toEqual([['book', '']])
    } finally { wrapper.unmount() }
  })
  it('keeps shared notes separate from public citation updates', async () => {
    const wrapper = mount(ReferencePanel, { props: base })
    try {
      await wrapper.get('[data-reference-edit="book"]').trigger('click')
      await wrapper.get('#reference-input').setValue('Public citation')
      await wrapper.get('[data-testid="reference-form"]').trigger('submit')
      expect(JSON.stringify(wrapper.emitted('update'))).not.toContain('Private editorial reason')
      await wrapper.get('[data-reference-note-open="book"]').trigger('click')
      await wrapper.get('[data-reference-note="book"]').setValue('New private reason')
      await wrapper.get('[data-reference-note-save="book"]').trigger('click')
      expect(wrapper.emitted('saveNote')).toEqual([['book', 'New private reason']])
    } finally { wrapper.unmount() }
  })
  it('confines keyboard focus to details and restores the triggering button', async () => {
    const wrapper = mount(ReferenceInsertDialog, { attachTo: document.body, props: { busy: false, error: '' } })
    try {
      const details = wrapper.get('[data-testid="reference-details"]')
      ;(details.element as HTMLElement).focus()
      await details.trigger('click')
      const dialog = wrapper.get('[aria-label="文献详细信息"]')
      expect(dialog.element.contains(document.activeElement)).toBe(true)
      const buttons = dialog.findAll('button')
      const last = buttons.at(-1)!
      ;(last.element as HTMLElement).focus()
      await last.trigger('keydown', { key: 'Tab' })
      expect(document.activeElement).toBe(buttons[0]!.element)
      await dialog.trigger('keydown', { key: 'Escape' })
      expect(wrapper.find('[aria-label="文献详细信息"]').exists()).toBe(false)
      expect(document.activeElement).toBe(details.element)
      expect(wrapper.emitted('close')).toBeUndefined()
    } finally { wrapper.unmount() }
  })
  it('aborts DOI lookup when the insertion dialog closes', async () => {
    const lookupDoi = vi.fn<(doi: string, signal: AbortSignal) => Promise<ReferenceMetadata>>(() => new Promise(() => {}))
    const wrapper = mount(ReferenceInsertDialog, { props: { busy: false, error: '', lookupDoi } })
    await wrapper.get('#reference-input').setValue('10.1234/old')
    await wrapper.get('[data-testid="reference-doi-lookup"]').trigger('click')
    wrapper.unmount()
    expect(lookupDoi.mock.calls[0]?.[1].aborted).toBe(true)
  })
  it('ignores a pending DOI lookup after the input changes', async () => {
    let resolve!: (value: ReferenceMetadata) => void
    const lookupDoi = vi.fn(() => new Promise<ReferenceMetadata>(done => { resolve = done }))
    const wrapper = mount(ReferenceInsertDialog, { props: { busy: false, error: '', lookupDoi } })
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
  it('updates the style baseline without losing local text or metadata edits', async () => {
    const wrapper = mount(ReferencePanel, { props: base })
    try {
      await wrapper.get('[data-reference-edit="book"]').trigger('click')
      await wrapper.get('#reference-input').setValue('Edited citation')
      await wrapper.get('[data-testid="reference-details"]').trigger('click')
      await wrapper.get('[data-reference-field="title"]').setValue('Local title')
      const current = { ...base.entries[0]!, style: 'apa' as const }
      await wrapper.setProps({ entries: [current] })
      expect(wrapper.get('#reference-input').element).toHaveProperty('value', 'Edited citation')
      expect(wrapper.get('[data-reference-field="title"]').element).toHaveProperty('value', 'Local title')
      await wrapper.get('[data-testid="reference-form"]').trigger('submit')
      expect(wrapper.emitted('update')?.[0]).toEqual([current, { text: 'Edited citation', metadata: { title: 'Local title' }, style: 'apa' }])
    } finally { wrapper.unmount() }
  })
  it('keeps note input open after a failed save', async () => {
    const wrapper = mount(ReferencePanel, { props: base })
    try {
      await wrapper.get('[data-reference-note-open="book"]').trigger('click')
      await wrapper.get('[data-reference-note="book"]').setValue('Retain after failure')
      await wrapper.get('[data-reference-note-save="book"]').trigger('click')
      await wrapper.setProps({ notesBusy: true })
      await wrapper.setProps({ notesBusy: false, notesError: 'Could not save' })
      expect(wrapper.get('[data-reference-note="book"]').element).toHaveProperty('value', 'Retain after failure')
    } finally { wrapper.unmount() }
  })
  it('loads metadata on request and keeps numeric reference identity when changing style', async () => {
    const lookupDoi = vi.fn(async () => ({ title: 'A test paper', year: '2025', authors: [{ family: 'Li', given: 'C' }], doi: '10.1234/book' }))
    const wrapper = mount(ReferencePanel, { props: { ...base, lookupDoi } })
    try {
      await wrapper.get('[data-reference-edit="book"]').trigger('click')
      await wrapper.get('[data-testid="reference-doi-lookup"]').trigger('click')
      await flushPromises()
      expect(wrapper.find('[data-reference-field="title"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="reference-doi-success"]').text()).toContain('✓')
      await wrapper.get('[data-testid="reference-details"]').trigger('click')
      expect(wrapper.get('[data-reference-field="title"]').element).toHaveProperty('value', 'A test paper')
      await wrapper.get('[data-testid="reference-style"]').setValue('apa')
      await wrapper.get('[data-testid="reference-form"]').trigger('submit')
      expect(wrapper.emitted('update')?.[0]?.[0]).toEqual(base.entries[0])
      expect(wrapper.emitted('update')?.[0]?.[1]).toMatchObject({ style: 'apa', metadata: { title: 'A test paper' } })
    } finally { wrapper.unmount() }
  })
})
