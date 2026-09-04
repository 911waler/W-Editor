import { describe, expect, it, vi } from 'vitest'

import { mountWEditor } from '../../packages/editor-web/src/index'
import type { WSaveRequest } from '../../packages/editor-web/src/index'

describe('opaque save revision conflicts', () => {
  it('keeps local Markdown and exposes explicit recovery paths without merging', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const onError = vi.fn()
    const save = vi.fn(async (_request: WSaveRequest): Promise<never> => {
      void _request
      throw Object.assign(new Error('The document changed on the server.'), { code: 'REVISION_CONFLICT' })
    })
    const instance = mountWEditor(container, {
      document: { documentId: 'article-1', markdown: '# Local draft', serverRevision: 'server-1' },
      onError,
      saveAdapter: { save },
    })

    const source = container.querySelector<HTMLTextAreaElement>('textarea')!
    source.value = '# Local draft with edits'
    source.dispatchEvent(new Event('input', { bubbles: true }))
    const result = await instance.save()

    expect(result).toMatchObject({
      error: {
        actionHints: ['reload', 'export', 'save-as', 'authorized-overwrite'],
        code: 'REVISION_CONFLICT',
      },
      status: 'conflict',
    })
    expect(instance.snapshot()).toMatchObject({
      dirty: true,
      historyDepth: 1,
      markdown: '# Local draft with edits',
      saveState: 'conflict',
      serverRevision: 'server-1',
    })
    expect(instance.exportMarkdown()).toBe('# Local draft with edits')
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: 'REVISION_CONFLICT' }) }))
    expect(save.mock.calls[0]?.[0]).toMatchObject({ markdown: '# Local draft with edits', overwrite: false })

    await instance.destroy({ confirm: () => true })
    container.remove()
  })

  it('only uses the authorized overwrite path when the host explicitly requests it', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const save = vi.fn(async (request: { readonly overwrite: boolean }) => {
      if (!request.overwrite) throw Object.assign(new Error('stale'), { code: 'REVISION_CONFLICT' })
      return {
        draftState: { baseServerRevision: 'server-3', status: 'merged' as const },
        savedAt: '2026-08-26T15:00:00.000Z',
        serverRevision: 'server-3',
        versionId: 'version-3',
      }
    })
    const instance = mountWEditor(container, {
      document: { documentId: 'article-1', markdown: '# Local', serverRevision: 'server-2' },
      saveAdapter: { save },
    })
    const source = container.querySelector<HTMLTextAreaElement>('textarea')!
    source.value = '# Authorized local'
    source.dispatchEvent(new Event('input', { bubbles: true }))

    await expect(instance.save()).resolves.toMatchObject({ status: 'conflict' })
    await expect(instance.save({ overwrite: true })).resolves.toMatchObject({ status: 'saved' })
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]?.[0]).toMatchObject({ markdown: '# Authorized local', overwrite: true })
    expect(instance.snapshot()).toMatchObject({ dirty: false, serverRevision: 'server-3' })

    await instance.destroy({ confirm: () => true })
    container.remove()
  })

  it('reloads from an explicit host provider when the user chooses the reload path', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const instance = mountWEditor(container, {
      document: { documentId: 'article-1', markdown: '# Local', serverRevision: 'server-1' },
      reloadDocument: async () => ({ documentId: 'article-1', markdown: '# Server', serverRevision: 'server-2' }),
    })
    const source = container.querySelector<HTMLTextAreaElement>('textarea')!
    source.value = '# Local edits'
    source.dispatchEvent(new Event('input', { bubbles: true }))

    await expect(instance.reload()).resolves.toMatchObject({ status: 'replaced' })
    expect(instance.snapshot()).toMatchObject({ dirty: false, markdown: '# Server', serverRevision: 'server-2', historyDepth: 0 })
    await instance.destroy()
    container.remove()
  })
})
