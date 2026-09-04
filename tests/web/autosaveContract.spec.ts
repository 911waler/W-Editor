import { describe, expect, it, vi } from 'vitest'

import { mountWEditor } from '../../packages/editor-web/src/index'
import type { WSaveRequest, WSaveResponse } from '../../packages/editor-web/src/index'

function edit(container: HTMLElement, markdown: string): void {
  const source = container.querySelector<HTMLTextAreaElement>('textarea')!
  source.value = markdown
  source.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('bounded Web autosave contract', () => {
  it('coalesces changes into an autosave-draft and keeps session history', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const save = vi.fn(async (_request: WSaveRequest): Promise<WSaveResponse> => {
      void _request
      return {
        draftState: { baseServerRevision: 'server-draft-1', status: 'saved' as const },
        savedAt: '2026-08-26T15:00:00.000Z',
        serverRevision: 'server-draft-1',
      }
    })
    const instance = mountWEditor(container, {
      autosave: { enabled: true, maxWaitMs: 5_000, trailingDelayMs: 1_000 },
      document: { documentId: 'article-1', markdown: '# Initial', serverRevision: 'server-1' },
      saveAdapter: { save },
    })

    edit(container, '# Draft one')
    await vi.advanceTimersByTimeAsync(800)
    edit(container, '# Draft two')
    await vi.advanceTimersByTimeAsync(999)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      baseServerRevision: 'server-1',
      markdown: '# Draft two',
      origin: 'autosave',
      overwrite: false,
      saveKind: 'autosave-draft',
    })
    expect(save.mock.calls[0]?.[0]).not.toHaveProperty('versionId')
    expect(instance.snapshot()).toMatchObject({ dirty: true, historyDepth: 2, markdown: '# Draft two' })

    await instance.destroy({ confirm: () => true })
    container.remove()
  })

  it('reports autosave failure and retries the same in-memory draft', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const failure = Object.assign(new Error('session expired'), { code: 'AUTH_REQUIRED' })
    const save = vi.fn(async (_request: WSaveRequest): Promise<WSaveResponse> => {
      void _request
      return {
        draftState: { baseServerRevision: 'server-draft-2', status: 'saved' as const },
        savedAt: '2026-08-26T15:00:00.000Z',
        serverRevision: 'server-draft-2',
      }
    })
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({
        draftState: { baseServerRevision: 'server-draft-2', status: 'saved' as const },
        savedAt: '2026-08-26T15:00:00.000Z',
        serverRevision: 'server-draft-2',
      })
    const instance = mountWEditor(container, {
      autosave: { enabled: true, maxWaitMs: 5_000, trailingDelayMs: 1_000 },
      document: { documentId: 'article-1', markdown: '# Initial' },
      saveAdapter: { save },
    })
    edit(container, '# Retained draft')

    await expect(instance.flush()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(instance.snapshot()).toMatchObject({ dirty: true, markdown: '# Retained draft', saveState: 'autosave-failed' })
    await expect(instance.retry()).resolves.toMatchObject({ status: 'saved' })
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]?.[0]).toMatchObject({ markdown: '# Retained draft', saveKind: 'autosave-draft' })
    expect(instance.snapshot().historyDepth).toBe(1)

    await instance.destroy({ confirm: () => true })
    container.remove()
  })

  it('rejects an autosave response that attempts to create a permanent version', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const onError = vi.fn()
    const save = vi.fn(async (_request: WSaveRequest): Promise<WSaveResponse> => {
      void _request
      return {
        draftState: { baseServerRevision: 'server-draft-3', status: 'saved' as const },
        savedAt: '2026-08-26T15:00:00.000Z',
        serverRevision: 'server-draft-3',
        versionId: 'forbidden-autosave-version',
      }
    })
    const instance = mountWEditor(container, {
      autosave: { enabled: true, maxWaitMs: 5_000, trailingDelayMs: 1_000 },
      document: { documentId: 'article-1', markdown: '# Initial', serverRevision: 'server-1' },
      onError,
      saveAdapter: { save },
    })
    edit(container, '# Draft must remain local')

    await expect(instance.flush()).rejects.toMatchObject({ code: 'SAVE_FAILED' })
    expect(save).toHaveBeenCalledOnce()
    expect(instance.snapshot()).toMatchObject({
      dirty: true,
      historyDepth: 1,
      markdown: '# Draft must remain local',
      saveState: 'autosave-failed',
      serverRevision: 'server-1',
    })
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'SAVE_FAILED' }),
    }))

    await instance.destroy({ confirm: () => true })
    container.remove()
  })
})
