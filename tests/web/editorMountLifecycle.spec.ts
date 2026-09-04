import { describe, expect, it, vi } from 'vitest'

import { mountWEditor, WEditorContractError } from '../../packages/editor-web/src/index'

describe('mountWEditor lifecycle', () => {
  it('mounts a complete editor surface, emits ready, focuses, flushes, and destroys idempotently', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const onReady = vi.fn()
    const instance = mountWEditor(container, {
      document: { documentId: 'article-1', markdown: '# Article' },
      onReady,
    })

    expect(onReady).toHaveBeenCalledOnce()
    expect(onReady.mock.calls[0]?.[0]).toMatchObject({
      apiVersion: '1.0.0',
      schemaVersion: '1.0.0',
      type: 'ready',
    })
    expect(container.querySelector('[data-w-editor-instance]')).not.toBeNull()
    expect(container.querySelector('[data-w-editor-surface="source"]')).not.toBeNull()
    expect(container.querySelector('[data-w-editor-surface="visual"]')).not.toBeNull()
    expect(container.querySelector('[data-w-editor-surface="preview"]')).not.toBeNull()
    expect(instance.snapshot()).toMatchObject({
      dirty: false,
      documentId: 'article-1',
      markdown: '# Article',
      mode: 'source',
      saveState: 'clean',
    })

    instance.focus()
    expect(document.activeElement).toBe(container.querySelector('textarea'))
    await expect(instance.flush()).resolves.toBeUndefined()
    expect(typeof instance.save).toBe('function')

    const firstDestroy = await instance.destroy()
    expect(firstDestroy).toEqual({ status: 'destroyed' })
    expect(container.childElementCount).toBe(0)
    await expect(instance.destroy()).resolves.toEqual(firstDestroy)
    container.remove()
  })

  it('rejects invalid mount input before creating any instance residue', () => {
    const container = document.createElement('div')

    expect(() => mountWEditor(null as unknown as HTMLElement, {
      document: { documentId: 'article-1', markdown: '# Article' },
    })).toThrow(WEditorContractError)
    expect(() => mountWEditor(container, {
      document: { documentId: '', markdown: '# Article' },
    })).toThrow(WEditorContractError)
    expect(container.childElementCount).toBe(0)
    expect(document.querySelector('[data-w-editor-instance]')).toBeNull()
  })
})
