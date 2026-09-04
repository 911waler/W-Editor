import { describe, expect, it, vi } from 'vitest'

import { mountWEditor } from '../../packages/editor-web/src/index'

describe('SaveAdapter public contract', () => {
  it('sends canonical Markdown and opaque revision metadata and applies a manual response', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const save = vi.fn(async () => ({
      draftState: { baseServerRevision: 'server-2', status: 'merged' as const, updatedAt: '2026-08-26T15:00:00.000Z' },
      savedAt: '2026-08-26T15:00:00.000Z',
      serverRevision: 'server-2',
      versionId: 'version-2',
    }))
    const instance = mountWEditor(container, {
      document: { documentId: 'article-1', markdown: '# Initial', serverRevision: 'server-1' },
      saveAdapter: { save },
    })
    const source = container.querySelector<HTMLTextAreaElement>('textarea')!
    source.value = '# Changed'
    source.dispatchEvent(new Event('input', { bubbles: true }))

    const result = await instance.save({
      kind: 'manual-save',
      metadata: { title: 'Contract article' },
      origin: 'user',
    })

    expect(save).toHaveBeenCalledWith({
      baseServerRevision: 'server-1',
      documentId: 'article-1',
      localRevision: 1,
      markdown: '# Changed',
      metadata: { title: 'Contract article' },
      origin: 'user',
      overwrite: false,
      saveKind: 'manual-save',
    })
    expect(result).toMatchObject({ status: 'saved', response: { serverRevision: 'server-2', versionId: 'version-2' } })
    expect(instance.snapshot()).toMatchObject({
      dirty: false,
      historyDepth: 1,
      markdown: '# Changed',
      saveState: 'saved',
      serverRevision: 'server-2',
    })

    await instance.destroy()
    container.remove()
  })

  it('requires a permanent version id for publish and does not accept malformed adapter responses', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const instance = mountWEditor(container, {
      document: { documentId: 'article-1', markdown: '# Initial' },
      saveAdapter: {
        save: async () => ({
          draftState: { baseServerRevision: null, status: 'none' as const },
          savedAt: '2026-08-26T15:00:00.000Z',
          serverRevision: 'server-1',
        }),
      },
    })

    const result = await instance.save({ kind: 'publish', origin: 'publish' })

    expect(result).toMatchObject({ status: 'failed', error: { code: 'SAVE_FAILED' } })
    expect(instance.snapshot()).toMatchObject({ dirty: false, markdown: '# Initial' })
    expect(instance.snapshot()).not.toHaveProperty('serverRevision')

    await instance.destroy()
    container.remove()
  })
})
