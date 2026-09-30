import { describe, expect, it, vi } from 'vitest'
import { TiptapVisualAdapter } from '../../src/adapters/tiptapVisualAdapter'
import { projectOrdinaryMarkdown } from '../../src/codecs/ordinaryBlocks'
import { serializeOrdinaryTiptapDocument } from '../../packages/editor-vue/src/adapters/ordinaryBlockSerialization'
import { DocumentSession } from '../../src/core'

function mount() {
  const host = document.createElement('div'); document.body.append(host)
  const session = new DocumentSession({ documentId: 'resize', markdown: '![a](/static/a){width=200 height=100}' })
  let markdown = session.snapshot().markdown
  const adapter = new TiptapVisualAdapter({ host, session, project: projectOrdinaryMarkdown, onTransaction: ({ transaction }) => { if (transaction.docChanged) markdown = serializeOrdinaryTiptapDocument(transaction.doc) } })
  return { host, adapter, markdown: () => markdown }
}
function pointer(target: Element, type: string, x: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 0, button: 0 })
  Object.defineProperty(event, 'pointerId', { value: 1 }); target.dispatchEvent(event)
}
describe('inline image resize interaction', () => {
  it('maps responsive screen movement to the saved dimensions without shrinking the model', () => {
    const { host, adapter, markdown } = mount()
    try {
      const img = host.querySelector('img')!; img.click()
      vi.spyOn(img, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 50))
      const handle = host.querySelector('[data-image-resize-handle="e"]')!
      pointer(handle, 'pointerdown', 0); pointer(handle, 'pointermove', 20)
      expect(markdown()).toContain('width=200 height=100')
      pointer(handle, 'pointerup', 20)
      expect(markdown()).toContain('width=240 height=120')
    } finally { adapter.destroy(); host.remove() }
  })
  it('removes selected controls and cancels active dragging when switching to read-only', () => {
    const { host, adapter, markdown } = mount()
    try {
      host.querySelector('img')!.click()
      const handle = host.querySelector('[data-image-resize-handle="e"]')!
      pointer(handle, 'pointerdown', 0); pointer(handle, 'pointermove', 40)
      adapter.setPresentationMode(true)
      expect(host.querySelector('[data-image-resize-handle], .inline-image__toolbar')).toBeNull()
      pointer(handle, 'pointerup', 40)
      expect(markdown()).toContain('width=200 height=100')
      adapter.setPresentationMode(false)
      host.querySelector('img')!.click()
      expect(host.querySelectorAll('[data-image-resize-handle]')).toHaveLength(8)
    } finally { adapter.destroy(); host.remove() }
  })
  it('clamps the selected toolbar inside the viewport at the right edge', () => {
    const { host, adapter } = mount()
    try {
      const wrapper = host.querySelector<HTMLElement>('[data-inline-image]')!
      vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(new DOMRect(window.innerWidth - 50, 100, 50, 25))
      const toolbar = host.querySelector<HTMLElement>('.inline-image__toolbar')!
      vi.spyOn(toolbar, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 60))
      host.querySelector('img')!.click()
      expect(Number.parseFloat(toolbar.style.left)).toBeLessThanOrEqual(window.innerWidth - 308)
      expect(toolbar.style.position).toBe('fixed')
    } finally { adapter.destroy(); host.remove() }
  })

  it('restores natural size and keeps edit available on failed loads', () => {
    const { host, adapter, markdown } = mount()
    try {
      const img = host.querySelector('img')!; img.click()
      Object.defineProperties(img, { naturalWidth: { value: 600 }, naturalHeight: { value: 300 } })
      img.dispatchEvent(new Event('load'))
      const reset = host.querySelector<HTMLButtonElement>('[data-image-reset]')!
      expect(reset.disabled).toBe(false); reset.click()
      expect(markdown()).toBe('![a](/static/a)')
      img.dispatchEvent(new Event('error'))
      expect(reset.disabled).toBe(true)
      expect(host.querySelector<HTMLInputElement>('[data-image-aspect-lock]')!.disabled).toBe(true)
      expect(host.querySelector<HTMLButtonElement>('[data-semantic-edit="media-editor"]')!.disabled).toBe(false)
    } finally { adapter.destroy(); host.remove() }
  })

  it('previews eight-handle resizing and commits only on release with one undo', () => {
    const { host, adapter, markdown } = mount()
    try {
      const img = host.querySelector('img')!; img.click()
      const handles = host.querySelectorAll('[data-image-resize-handle]'); expect(handles).toHaveLength(8)
      const handle = host.querySelector('[data-image-resize-handle="e"]')!
      const capture = vi.fn(); const release = vi.fn()
      Object.assign(handle, { setPointerCapture: capture, hasPointerCapture: () => true, releasePointerCapture: release })
      pointer(handle, 'pointerdown', 0); pointer(handle, 'pointermove', 40)
      expect(capture).toHaveBeenCalledWith(1)
      expect(markdown()).toContain('width=200 height=100')
      pointer(handle, 'pointerup', 40)
      expect(release).toHaveBeenCalledWith(1)
      expect(markdown()).toContain('width=240 height=120')
      expect(adapter.undo()).toBe(true)
      expect(markdown()).toContain('width=200 height=100')
      expect(adapter.undo()).toBe(false)
    } finally { adapter.destroy(); host.remove() }
  })
  it.each(['pointercancel', 'Escape'])('cancels %s and supports exact unlocked sizes', cancel => {
    const { host, adapter, markdown } = mount()
    try {
      host.querySelector('img')!.click()
      const handle = host.querySelector('[data-image-resize-handle="e"]')!
      expect(handle).not.toBeNull()
      pointer(handle, 'pointerdown', 0); pointer(handle, 'pointermove', 40)
      if (cancel === 'Escape') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      else pointer(handle, 'pointercancel', 40)
      pointer(handle, 'pointerup', 40)
      expect(markdown()).toContain('width=200 height=100')
      const lock = host.querySelector<HTMLInputElement>('[data-image-aspect-lock]')!; lock.click()
      const width = host.querySelector<HTMLInputElement>('[data-image-dimension="width"]')!
      width.value = '300'; width.dispatchEvent(new Event('change', { bubbles: true }))
      expect(markdown()).toContain('width=300 height=100')
    } finally { adapter.destroy(); host.remove() }
  })
})
