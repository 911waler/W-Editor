import { describe, expect, it, vi } from 'vitest'

import { mountWEditor } from '../../packages/editor-web/src/index'
import type { WReplaceConfirmation } from '../../packages/editor-web/src/index'

function mount() {
  const container = document.createElement('div')
  document.body.append(container)
  const instance = mountWEditor(container, {
    document: { documentId: 'first', markdown: '# First', serverRevision: 'server-1' },
  })
  return { container, instance }
}

describe('protected public document replacement', () => {
  it('atomically replaces a clean document and starts a new history boundary', async () => {
    const { container, instance } = mount()

    await expect(instance.setDocument({
      documentId: 'second',
      markdown: '# Second',
      serverRevision: 'server-2',
    })).resolves.toMatchObject({ status: 'replaced' })
    expect(instance.snapshot()).toMatchObject({
      dirty: false,
      documentId: 'second',
      historyDepth: 0,
      markdown: '# Second',
      serverRevision: 'server-2',
      revision: 0,
    })

    await instance.destroy({ confirm: () => true })
    container.remove()
  })

  it('blocks a dirty replacement without confirmation and keeps the local content', async () => {
    const { container, instance } = mount()
    const source = container.querySelector<HTMLTextAreaElement>('textarea')!
    source.value = '# Local draft'
    source.dispatchEvent(new Event('input', { bubbles: true }))

    await expect(instance.replaceDocument({ documentId: 'second', markdown: '# Server' }))
      .resolves.toMatchObject({ actions: ['save', 'export', 'cancel'], status: 'blocked' })
    expect(instance.snapshot()).toMatchObject({ documentId: 'first', markdown: '# Local draft', dirty: true })

    await instance.destroy({ confirm: () => true })
    container.remove()
  })

  it('requires explicit confirmation, keeps confirmation immutable, and supports cancellation', async () => {
    const { container, instance } = mount()
    const source = container.querySelector<HTMLTextAreaElement>('textarea')!
    source.value = '# Local draft'
    source.dispatchEvent(new Event('input', { bubbles: true }))
    const confirm = vi.fn((_confirmation: WReplaceConfirmation) => {
      void _confirmation
      return false
    })

    await expect(instance.replaceDocument({ documentId: 'second', markdown: '# Server' }, { confirm }))
      .resolves.toMatchObject({ status: 'cancelled' })
    expect(confirm).toHaveBeenCalledOnce()
    expect(Object.isFrozen(confirm.mock.calls[0]?.[0])).toBe(true)
    expect(instance.snapshot()).toMatchObject({ documentId: 'first', markdown: '# Local draft', dirty: true })

    await expect(instance.replaceDocument({ documentId: 'second', markdown: '# Server' }, { confirm: () => true }))
      .resolves.toMatchObject({ status: 'replaced' })
    expect(instance.snapshot()).toMatchObject({ documentId: 'second', markdown: '# Server', dirty: false, historyDepth: 0 })

    await instance.destroy({ confirm: () => true })
    container.remove()
  })

  it('waits for an active composition before evaluating replacement safety', async () => {
    const { container, instance } = mount()
    const source = container.querySelector<HTMLTextAreaElement>('textarea')!
    source.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    source.value = '# Composing draft'
    source.dispatchEvent(new Event('input', { bubbles: true }))

    let replacementSettled = false
    const replacement = instance.replaceDocument({ documentId: 'second', markdown: '# Server' }).then((result) => {
      replacementSettled = true
      return result
    })
    await Promise.resolve()
    expect(replacementSettled).toBe(false)
    source.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    await expect(replacement).resolves.toMatchObject({ status: 'blocked' })
    expect(instance.snapshot()).toMatchObject({ markdown: '# Composing draft', dirty: true })

    await instance.destroy({ confirm: () => true })
    container.remove()
  })
})
