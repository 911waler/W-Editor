import { describe, expect, it, vi } from 'vitest'

import { createNwuMockHost } from '../../examples/nwu-host/src/mockNwuHost'
import { createRecoveryDraft, createWorkspaceExchange, type WSaveRequest } from '../../packages/editor-web/src/index'

function saveRequest(overrides: Partial<WSaveRequest> = {}): WSaveRequest {
  return {
    baseServerRevision: 'server-1',
    documentId: 'article-1',
    localRevision: 1,
    markdown: '# Saved',
    metadata: {},
    origin: 'user',
    overwrite: false,
    saveKind: 'manual-save',
    ...overrides,
  }
}

describe('framework-free NWU reference host', () => {
  it('renders Jinja bootstrap and enforces same-origin session, transport, X-Requested-With, and CSRF', async () => {
    const host = createNwuMockHost({
      documentId: 'article-1',
      initialMarkdown: '# Jinja article',
      transport: 'form-data',
      userId: 'user-1',
      visibility: 'public',
    })
    expect(host.initialJinjaMarkup).toContain('data-nwu-host="reference"')
    expect(host.initialJinjaMarkup).toContain('data-nwu-user-id="user-1"')
    expect(host.initialJinjaMarkup).toContain('data-nwu-document-id="article-1"')
    expect(host.initialJinjaMarkup).toContain('data-nwu-visibility="public"')
    expect(host.initialJinjaMarkup).toContain('data-nwu-bootstrap')

    await expect(host.saveAdapter.save(saveRequest())).resolves.toMatchObject({ versionId: 'version-1' })
    expect(host.requests.at(-1)).toMatchObject({
      body: { visibility: 'public' },
      headers: { 'x-csrftoken': host.session.csrfToken, 'x-requested-with': 'XMLHttpRequest' },
      method: 'POST',
      path: '/api/nwu/documents/save',
      transport: 'form-data',
      credentials: 'same-origin',
    })
    expect(host.requests.at(-1)?.headers).not.toHaveProperty('content-type')

    host.setTransport('json')
    await expect(host.saveAdapter.save(saveRequest({ baseServerRevision: 'server-2', markdown: '# JSON saved' }))).resolves.toMatchObject({ versionId: 'version-2' })
    expect(host.requests.at(-1)?.transport).toBe('json')
    expect(host.requests.at(-1)?.headers).toMatchObject({ 'content-type': 'application/json' })

    await expect(host.request('/api/nwu/documents/save', {
      body: JSON.stringify({ _csrf: host.session.csrfToken }),
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': host.session.csrfToken },
      method: 'POST',
    })).rejects.toMatchObject({ code: 'INCOMPATIBLE_HOST' })

    host.session.expireAuth()
    await expect(host.saveAdapter.save(saveRequest())).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    host.session.restoreAuth()
    host.session.rotateCsrf()
    await expect(host.saveAdapter.save(saveRequest({ baseServerRevision: 'server-3' }))).rejects.toMatchObject({ code: 'CSRF_REJECTED' })
    host.session.refreshCsrf()
    await expect(host.saveAdapter.save(saveRequest({ baseServerRevision: 'server-3' }))).resolves.toMatchObject({ versionId: 'version-3' })

    host.forceServerUpdate('# Server changed')
    await expect(host.saveAdapter.save(saveRequest({ baseServerRevision: 'server-3' }))).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
  })

  it('isolates draft/workspace adapters by user and document and exposes live SettingsStore', async () => {
    const host = createNwuMockHost({ documentId: 'article-1', userId: 'user-1' })
    const recovery = createRecoveryDraft({
      baseServerRevision: 'server-1',
      documentId: 'article-1',
      localRevision: 2,
      markdown: '# Draft',
      mode: 'visual',
      scroll: { left: 0, top: 10 },
      selection: { anchor: 0, head: 2 },
      sidebar: { collapsed: false, width: 252 },
      sourceAnchor: null,
      updatedAt: '2026-08-27T00:00:00.000Z',
      userId: 'user-1',
    })
    const exchange = createWorkspaceExchange({
      documentId: 'article-1',
      draft: recovery,
      mode: 'visual',
      scroll: { left: 0, top: 10 },
      selection: { anchor: 0, head: 2 },
      sidebar: { collapsed: false, width: 252 },
      sourceAnchor: null,
      userId: 'user-1',
    })
    await host.draftAdapter.save(recovery)
    await host.workspaceAdapter.save(exchange)
    expect(await host.draftAdapter.load({ documentId: 'article-1', userId: 'user-1' })).toEqual(recovery)
    expect(await host.draftAdapter.load({ documentId: 'article-1', userId: 'user-2' })).toBeNull()
    expect(await host.workspaceAdapter.load({ documentId: 'article-2', userId: 'user-1' })).toBeNull()

    const changes = vi.fn()
    const unsubscribe = host.settingsStore.subscribe(changes)
    host.settingsStore.setUserOverride('appearanceTheme', 'dark')
    expect(host.settingsStore.getSiteDefaults()).toMatchObject({ appearanceTheme: 'blue' })
    expect(host.settingsStore.getUserOverrides()).toMatchObject({ appearanceTheme: 'dark' })
    expect(changes).toHaveBeenCalledWith({ key: 'appearanceTheme', value: 'dark' })
    unsubscribe()
    host.settingsStore.clearUserOverride('appearanceTheme')
    expect(host.settingsStore.getUserOverrides()).not.toHaveProperty('appearanceTheme')
  })

  it('mounts the real public Reader through the host without a framework dependency', async () => {
    const host = createNwuMockHost({ initialMarkdown: '# Reader article' })
    const container = document.createElement('div')
    document.body.append(container)
    const reader = host.mountReader(container)
    await vi.waitFor(() => expect(container.querySelector('[data-w-editor-profile="reader"]')).not.toBeNull())
    expect(reader.snapshot()).toMatchObject({ markdown: '# Reader article', profile: 'reader' })
    expect(container.querySelector('[contenteditable="true"]')).toBeNull()
    await reader.destroy()
    expect(container.childElementCount).toBe(0)
    container.remove()
  })

  it('maps authorized NWU script comments through the sanitized Renderer extension without changing Markdown', async () => {
    const markdown = '# Script article\n\n<!-- script: inspect_gpu.py -->\n\n```bash\npython inspect_gpu.py\n```'
    const host = createNwuMockHost({
      initialMarkdown: markdown,
      publicScriptNames: ['inspect_gpu.py'],
      scriptDownloadsAuthorized: true,
    })
    const container = document.createElement('div')
    document.body.append(container)
    const reader = host.mountReader(container)

    await vi.waitFor(() => expect(container.querySelector('[data-w-editor-extension="nwu-script-downloads"]')).not.toBeNull())
    const link = container.querySelector<HTMLAnchorElement>('[data-w-editor-extension="nwu-script-downloads"] a')
    expect(link?.getAttribute('href')).toBe('/resources/scripts/inspect_gpu.py/download')
    expect(link?.textContent).toContain('inspect_gpu.py')
    expect(container.querySelector('script')).toBeNull()
    expect(reader.snapshot().markdown).toBe(markdown)

    await reader.destroy()
    container.remove()

    const deniedContainer = document.createElement('div')
    const deniedHost = createNwuMockHost({
      initialMarkdown: markdown,
      publicScriptNames: ['inspect_gpu.py'],
      scriptDownloadsAuthorized: false,
    })
    const deniedReader = deniedHost.mountReader(deniedContainer)
    expect(deniedContainer.querySelector('[data-w-editor-extension="nwu-script-downloads"]')).toBeNull()
    expect(deniedReader.snapshot().markdown).toBe(markdown)
    await deniedReader.destroy()
  })

  it('injects one transient save failure and allows the same request to be retried', async () => {
    const host = createNwuMockHost({ documentId: 'article-failure', userId: 'user-failure' })
    host.failNextSave('temporary network failure')
    await expect(host.saveAdapter.save(saveRequest({ documentId: 'article-failure' }))).rejects.toMatchObject({
      code: 'SAVE_FAILED',
      message: 'temporary network failure',
    })
    await expect(host.saveAdapter.save(saveRequest({ documentId: 'article-failure' }))).resolves.toMatchObject({ versionId: 'version-1' })
  })

  it('enforces authenticated visibility and author/admin edit permission at the host and save boundaries', async () => {
    const publicViewer = createNwuMockHost({
      authorUserId: 'author-1',
      documentId: 'article-1',
      userId: 'viewer-1',
      visibility: 'public',
    })
    const readerContainer = document.createElement('div')
    const reader = publicViewer.mountReader(readerContainer)
    await vi.waitFor(() => expect(readerContainer.querySelector('[data-w-editor-profile="reader"]')).not.toBeNull())
    expect(readerContainer.querySelector('[contenteditable="true"]')).toBeNull()
    const deniedEditorContainer = document.createElement('div')
    expect(() => publicViewer.mountEditor(deniedEditorContainer)).toThrow(expect.objectContaining({ code: 'AUTHORIZATION_DENIED' }))
    expect(deniedEditorContainer.childElementCount).toBe(0)
    publicViewer.session.rotateCsrf()
    await expect(publicViewer.saveAdapter.save(saveRequest())).rejects.toMatchObject({ code: 'CSRF_REJECTED' })
    publicViewer.session.refreshCsrf()
    await expect(publicViewer.saveAdapter.save(saveRequest())).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' })
    await reader.destroy()

    const author = createNwuMockHost({ authorUserId: 'author-1', documentId: 'article-1', userId: 'author-1', visibility: 'private' })
    const authorEditor = author.mountEditor(document.createElement('div'))
    await authorEditor.destroy({ confirm: () => true })

    const admin = createNwuMockHost({ authorUserId: 'author-1', documentId: 'article-1', isAdmin: true, userId: 'admin-1', visibility: 'private' })
    const adminEditor = admin.mountEditor(document.createElement('div'))
    await adminEditor.destroy({ confirm: () => true })

    const selectedViewer = createNwuMockHost({
      authorUserId: 'author-1',
      selectedUserIds: ['selected-1'],
      userId: 'selected-1',
      visibility: 'selected',
    })
    const selectedReader = selectedViewer.mountReader(document.createElement('div'))
    await selectedReader.destroy()

    const denied = createNwuMockHost({ authorUserId: 'author-1', userId: 'viewer-1', visibility: 'private' })
    expect(() => denied.mountReader(document.createElement('div'))).toThrow(expect.objectContaining({ code: 'AUTHORIZATION_DENIED' }))
    denied.session.expireAuth()
    expect(() => denied.mountReader(document.createElement('div'))).toThrow(expect.objectContaining({ code: 'AUTH_REQUIRED' }))
  })
})
