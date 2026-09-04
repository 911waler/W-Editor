import { describe, expect, it, vi } from 'vitest'

import { createNwuMockHost } from '../../examples/nwu-host/src/mockNwuHost'
import {
  createRecoveryDraft,
  createWorkspaceExchange,
  mountWEditor,
  mountWRenderer,
  type WRecoveryDraft,
  type WRecoveryDraftKey,
  type WSaveRequest,
  type WSaveResponse,
  type WWorkspaceState,
} from '../../packages/editor-web/src/index'

function workspaceState(): WWorkspaceState {
  return {
    mode: 'visual',
    scroll: { left: 0, top: 240 },
    selection: { anchor: 2, head: 6 },
    sidebar: { collapsed: true, width: 280 },
    sourceAnchor: { from: 0, to: 12 },
  }
}

function draft(key: WRecoveryDraftKey, markdown = '# Recovered draft'): WRecoveryDraft {
  return createRecoveryDraft({
    ...workspaceState(),
    baseServerRevision: 'server-1',
    documentId: key.documentId,
    localRevision: 3,
    markdown,
    updatedAt: '2026-08-27T00:00:00.000Z',
    userId: key.userId,
  })
}

function adapters(key: WRecoveryDraftKey, pending: WRecoveryDraft | null = draft(key)) {
  const loadedWorkspace = createWorkspaceExchange({
    ...workspaceState(),
    documentId: key.documentId,
    draft: pending,
    userId: key.userId,
  })
  return {
    draft: {
      clear: vi.fn(),
      load: vi.fn(() => pending),
      save: vi.fn(),
    },
    workspace: {
      load: vi.fn(() => loadedWorkspace),
      save: vi.fn(),
    },
  }
}

function saveResponse(request: WSaveRequest): WSaveResponse {
  return {
    draftState: {
      baseServerRevision: request.baseServerRevision,
      status: 'saved',
      updatedAt: '2026-08-27T00:01:00.000Z',
    },
    savedAt: '2026-08-27T00:01:00.000Z',
    serverRevision: request.saveKind === 'autosave-draft' ? 'server-draft-1' : 'server-2',
    ...(request.saveKind === 'autosave-draft' ? {} : { versionId: 'version-2' }),
  }
}

describe('Web recovery adapter runtime', () => {
  it('loads adapters by user/document key without silently applying a newer draft', async () => {
    const key = { documentId: 'article-1', userId: 'user-1' }
    const persistence = adapters(key)
    const onReady = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const instance = mountWEditor(container, {
      document: { documentId: key.documentId, markdown: '# Server', serverRevision: 'server-1' },
      draftAdapter: persistence.draft,
      onReady,
      userId: key.userId,
      workspaceAdapter: persistence.workspace,
    })

    await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce())
    expect(persistence.draft.load).toHaveBeenCalledWith(key)
    expect(persistence.workspace.load).toHaveBeenCalledWith(key)
    expect(instance.recoveryState()).toMatchObject({ status: 'available', draft: { markdown: '# Recovered draft' } })
    expect(instance.snapshot()).toMatchObject({ markdown: '# Server', mode: 'visual', serverRevision: 'server-1', dirty: false })

    await expect(instance.recoverDraft()).resolves.toMatchObject({ status: 'recovered' })
    expect(instance.snapshot()).toMatchObject({
      documentId: key.documentId,
      markdown: '# Recovered draft',
      serverRevision: 'server-1',
      dirty: true,
    })
    expect(persistence.draft.clear).toHaveBeenCalledWith(key)

    await instance.destroy({ confirm: () => true })
    container.remove()
  })

  it('persists autosave drafts, creates a manual version, and saves stable workspace state', async () => {
    const key = { documentId: 'article-2', userId: 'user-2' }
    const persistence = adapters(key, null)
    const save = vi.fn(async (request: WSaveRequest) => saveResponse(request))
    const container = document.createElement('div')
    document.body.append(container)
    const instance = mountWEditor(container, {
      autosave: { enabled: true, maxWaitMs: 5_000, trailingDelayMs: 1_000 },
      document: { documentId: key.documentId, markdown: '# Server', serverRevision: 'server-1' },
      draftAdapter: persistence.draft,
      saveAdapter: { save },
      userId: key.userId,
      workspaceAdapter: persistence.workspace,
    })
    const source = container.querySelector<HTMLTextAreaElement>('textarea')!
    source.value = '# Autosaved draft'
    source.dispatchEvent(new Event('input', { bubbles: true }))

    await instance.flush()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      baseServerRevision: 'server-1',
      documentId: key.documentId,
      markdown: '# Autosaved draft',
      saveKind: 'autosave-draft',
    }))
    expect(persistence.draft.save).toHaveBeenCalledWith(expect.objectContaining({
      baseServerRevision: 'server-1',
      documentId: key.documentId,
      markdown: '# Autosaved draft',
      userId: key.userId,
    }))
    expect(instance.snapshot()).toMatchObject({ dirty: true, serverRevision: 'server-1' })

    await expect(instance.save()).resolves.toMatchObject({ status: 'saved', response: { versionId: 'version-2' } })
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ saveKind: 'manual-save' }))
    expect(persistence.draft.clear).toHaveBeenCalledWith(key)
    expect(instance.snapshot()).toMatchObject({ dirty: false, serverRevision: 'server-2' })

    await expect(instance.saveWorkspace()).resolves.toMatchObject({
      documentId: key.documentId,
      userId: key.userId,
    })
    expect(persistence.workspace.save).toHaveBeenCalledWith(expect.objectContaining({
      documentId: key.documentId,
      userId: key.userId,
      draft: null,
    }))

    await instance.destroy()
    container.remove()
  })

  it('supports explicit export and discard choices for a newer draft', async () => {
    const key = { documentId: 'article-3', userId: 'user-3' }
    const persistence = adapters(key)
    const container = document.createElement('div')
    document.body.append(container)
    const instance = mountWEditor(container, {
      document: { documentId: key.documentId, markdown: '# Server', serverRevision: 'server-1' },
      draftAdapter: persistence.draft,
      userId: key.userId,
      workspaceAdapter: persistence.workspace,
    })
    await vi.waitFor(() => expect(instance.recoveryState().status).toBe('available'))

    expect(instance.exportDraft()).toBe('# Recovered draft')
    expect(instance.recoveryState().status).toBe('exported')
    await expect(instance.discardDraft()).resolves.toMatchObject({ status: 'discarded' })
    expect(instance.recoveryState()).toMatchObject({ draft: null, status: 'discarded' })
    expect(persistence.draft.clear).toHaveBeenCalledWith(key)

    await instance.destroy({ confirm: () => true })
    container.remove()
  })

  it('reports synchronous adapter load failures and still completes ready', async () => {
    const onReady = vi.fn()
    const onError = vi.fn()
    const container = document.createElement('div')
    document.body.append(container)
    const instance = mountWEditor(container, {
      document: { documentId: 'article-load-failure', markdown: '# Server', serverRevision: 'server-1' },
      draftAdapter: {
        clear: () => undefined,
        load: () => { throw new Error('draft load failed') },
        save: () => undefined,
      },
      onError,
      onReady,
      userId: 'user-load-failure',
      workspaceAdapter: {
        load: () => null,
        save: () => undefined,
      },
    })
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce())
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'SAVE_FAILED' }),
    }))
    expect(instance.recoveryState().status).toBe('failed')
    await instance.destroy()
    container.remove()
  })

  it('keeps two runtime instances isolated by user and document identity', async () => {
    const firstHost = createNwuMockHost({
      documentId: 'shared-document',
      userId: 'user-a',
    })
    const secondHost = createNwuMockHost({
      documentId: 'shared-document',
      userId: 'user-b',
    })
    const firstContainer = document.createElement('div')
    const secondContainer = document.createElement('div')
    document.body.append(firstContainer, secondContainer)
    const first = firstHost.mountEditor(firstContainer)
    const second = secondHost.mountEditor(secondContainer)
    await vi.waitFor(() => expect(first.recoveryState().status).not.toBe('loading'))
    await vi.waitFor(() => expect(second.recoveryState().status).not.toBe('loading'))

    const source = firstContainer.querySelector<HTMLTextAreaElement>('[data-w-editor-source]')!
    source.value = '# User A draft'
    source.dispatchEvent(new Event('input', { bubbles: true }))
    await first.flush()
    expect(firstHost.requests.some(({ path }) => path === '/api/nwu/documents/save')).toBe(true)
    expect(second.recoveryState().draft).toBeNull()
    expect(second.snapshot().markdown).toBe('# Jinja initial Markdown\n\nServer content.')

    await first.destroy({ confirm: () => true })
    await second.destroy({ confirm: () => true })
    firstContainer.remove()
    secondContainer.remove()
  })

  it('keeps the Editor Final preview and the public Reader semantically aligned', async () => {
    const editorContainer = document.createElement('div')
    const readerContainer = document.createElement('div')
    document.body.append(editorContainer, readerContainer)
    const markdown = '# Shared reader\n\n```js\nconst value = 42\n```'
    const editor = mountWEditor(editorContainer, {
      document: { documentId: 'parity-document', markdown },
      initialMode: 'preview',
    })
    const reader = mountWRenderer(readerContainer, {
      markdown,
      profile: 'reader',
    })
    const editorContent = editorContainer.querySelector<HTMLElement>('[data-w-editor-preview]')!
    const readerContent = readerContainer.querySelector<HTMLElement>('[data-w-editor-renderer-content]')!
    expect(editorContent.querySelector('h1')?.textContent).toBe(readerContent.querySelector('h1')?.textContent)
    expect(editorContent.querySelector('pre > code')?.textContent).toBe(readerContent.querySelector('pre > code')?.textContent)
    const contentText = (root: HTMLElement): string => {
      const clone = root.cloneNode(true) as HTMLElement
      clone.querySelectorAll('[data-semantic-edit], [data-raw-edit], .visual-code-block__language').forEach((node) => node.remove())
      return clone.textContent?.replace(/\s+/gu, ' ').trim() ?? ''
    }
    expect(contentText(editorContent)).toBe(contentText(readerContent))
    await editor.destroy()
    await reader.destroy()
    editorContainer.remove()
    readerContainer.remove()
  })
})
