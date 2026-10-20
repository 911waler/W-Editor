import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NwuAdapter, type NwuBootstrap } from '../../src/nwu/adapter'
import { editorDocumentUrl, saveBeforeAnnouncementSettings } from '../../src/nwu/navigation'

const announcementConfig: NwuBootstrap = {
  userId: 7,
  csrfToken: 'csrf',
  initialDocumentId: 'announcement:42',
  readonly: false,
  apiBase: '/api/announcement-editor',
  documentKind: 'announcement',
  blogListUrl: '/blogs',
}

const publishedEnvelope = {
  document: {
    documentId: 'announcement:42',
    markdown: '# Maintenance',
    revision: 3,
    serverRevision: '3',
  },
  metadata: {
    title: 'Maintenance',
    category: 'other',
    visibility: 'private',
    allowedUsernames: [],
    state: 'published',
  },
}

afterEach(() => {
  document.querySelector('#nwu-editor-bootstrap')?.remove()
  document.body.replaceChildren()
  vi.resetModules()
})

describe('announcement document identity', () => {
  it('keeps announcement identity in its own numeric editor route', () => {
    const target = editorDocumentUrl(
      'announcement:42',
      'http://example.test/admin/announcements/new?document=old#editor',
    )

    expect(target.pathname).toBe('/admin/announcements/42/edit')
    expect(target.search).toBe('')
    expect(target.hash).toBe('')
  })

  it('keeps existing blog and tutorial routes unchanged', () => {
    expect(editorDocumentUrl('blog:3', 'http://example.test/blogs/new').pathname).toBe('/blogs/3/edit')
    expect(editorDocumentUrl('tutorial:usage-guide', 'http://example.test/blogs/new').pathname).toBe('/admin/usage-guide/edit')
    expect(editorDocumentUrl('tutorial:qe', 'http://example.test/blogs/new').pathname).toBe('/admin/software-tutorials/qe/edit')
  })

  it('saves before navigating to the announcement publication settings', async () => {
    const events: string[] = []

    await saveBeforeAnnouncementSettings(
      'announcement:42',
      'http://example.test/admin/announcements/42/edit',
      async () => { events.push('saved') },
      target => { events.push(target.pathname) },
    )

    expect(events).toEqual(['saved', '/admin/announcements/42/settings'])
  })
})

describe('announcement adapter contract', () => {
  it('keeps autosave private and preserves explicit save kinds for the announcement API', async () => {
    const requests: Array<{ path: string; body: Record<string, unknown> }> = []
    const request: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {}
      requests.push({ path, body })
      if (path.endsWith('/publication')) return new Response(JSON.stringify({serverRevision:'3', state:'published',title:'Maintenance',level:'normal',sendEmail:false,scheduledFor:'',reminderEndsAt:'',recipientCount:0,missingCount:0,mailLabel:'停用'}))
      if (path.includes('/state/')) return new Response(JSON.stringify({}))
      if (path.endsWith('/save')) return new Response(JSON.stringify({ serverRevision: '4' }))
      return new Response(JSON.stringify(publishedEnvelope))
    }
    const adapter = new NwuAdapter(announcementConfig, request, localStorage)
    await adapter.load('announcement:42')

    await adapter.save({ documentId: 'announcement:42', markdown: 'private work', revision: 4 }, 'autosave-draft')
    await adapter.save({ documentId: 'announcement:42', markdown: 'published correction', revision: 5 }, 'manual-save')
    await adapter.save({ documentId: 'announcement:42', markdown: 'shortcut attempt', revision: 6 }, 'publish')

    const saves = requests.filter(item => item.path.endsWith('/save')).map(item => item.body)
    expect(saves.map(body => body['saveKind'])).toEqual(['autosave-draft', 'manual-save', 'publish'])
    expect(saves.map(body => body['origin'])).toEqual(['autosave', 'user', 'publish'])
    expect(saves.every(body => body['documentId'] === 'announcement:42')).toBe(true)
  })

  it('creates recovery copies through the announcement endpoint', async () => {
    const requests: Array<{ path: string; method: string; body: Record<string, unknown> }> = []
    const request: typeof fetch = async (input, init) => {
      const path = new URL(String(input)).pathname
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {}
      requests.push({ path, method: init?.method ?? 'GET', body })
      return new Response(JSON.stringify({
        ...publishedEnvelope,
        document: { ...publishedEnvelope.document, documentId: 'announcement:43', markdown: String(body['markdown'] ?? '') },
        metadata: { ...publishedEnvelope.metadata, state: 'draft' },
      }))
    }
    const adapter = new NwuAdapter(announcementConfig, request, localStorage)

    const copy = await adapter.create({ title: 'Maintenance（恢复副本）', markdown: 'recovered body' })

    expect(copy.documentId).toBe('announcement:43')
    expect(requests[0]).toMatchObject({
      path: '/api/announcement-editor/documents',
      method: 'POST',
      body: { title: 'Maintenance（恢复副本）', markdown: 'recovered body' },
    })
    expect(editorDocumentUrl(copy.documentId, 'http://example.test/admin/announcements/42/edit').pathname)
      .toBe('/admin/announcements/43/edit')
  })
})

describe('announcement editor mode', () => {
  it('shows announcement actions and restores a selected recovery draft as an unpublished copy without changing the original', async () => {
    const paths: string[] = []
    const requests: Array<{ path: string; method: string; body: Record<string, unknown> }> = []
    const recoveryMarkdown = '# Recovered maintenance'
    const restoredEnvelope = {
      document: { documentId: 'announcement:43', markdown: recoveryMarkdown, revision: 1, serverRevision: '1' },
      metadata: { ...publishedEnvelope.metadata, title: 'Maintenance（恢复草稿副本）', state: 'draft' },
    }
    window.history.replaceState(null, '', '/admin/announcements/42/edit')
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = decodeURIComponent(new URL(String(input)).pathname)
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {}
      paths.push(path)
      requests.push({ path, method, body })
      if (path.endsWith('/reference-library')) return new Response(JSON.stringify({ revision: 0, entries: [], deletedIds: [], highWater: 0 }))
      if (path.endsWith('/reference-notes')) return new Response(JSON.stringify({ notes: {} }))
      if (path.endsWith('/history')) return new Response(JSON.stringify({ versions: [], nextCursor: null }))
      if (path.endsWith('/publication')) return new Response(JSON.stringify({serverRevision:path.includes('announcement:43')?'1':'3', state:path.includes('announcement:43')?'draft':'published',title:'Maintenance',level:'normal',sendEmail:false,scheduledFor:'',reminderEndsAt:'',recipientCount:0,missingCount:0,mailLabel:'停用'}))
      if (path.includes('/state/announcement:43')) return new Response(JSON.stringify({}))
      if (path.includes('/state/')) return new Response(JSON.stringify({ draft: {
        documentId: 'announcement:42',
        userId: '7',
        markdown: recoveryMarkdown,
        baseServerRevision: '2',
        localRevision: 4,
        updatedAt: '2026-09-30T03:04:05Z',
        metadata: publishedEnvelope.metadata,
      } }))
      if ((path === '/api/announcement-editor/documents' && method === 'POST') || path.endsWith('/documents/announcement:43')) {
        return new Response(JSON.stringify(restoredEnvelope))
      }
      return new Response(JSON.stringify(publishedEnvelope))
    })
    const bootstrap = document.createElement('script')
    bootstrap.id = 'nwu-editor-bootstrap'
    bootstrap.type = 'application/json'
    bootstrap.textContent = JSON.stringify(announcementConfig)
    document.body.append(bootstrap)
    const { default: App } = await import('../../src/ui/App.vue')

    const wrapper = mount(App, { attachTo: document.body })
    await flushPromises()

    expect(wrapper.get('a[href="/admin/announcements"]').text()).toBe('公告管理')
    expect(wrapper.get('[data-testid="announcement-settings"]').text()).toBe('发布设置')
    expect(wrapper.get('[data-testid="announcement-manual-save"]').text()).toBe('保存修改')
    expect(wrapper.find('[data-command-id="document.manual-save"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('笔记属性')
    expect(wrapper.text()).not.toContain('仅自己')
    expect(wrapper.text()).not.toContain('指定用户')
    expect(wrapper.find('[data-testid="announcement-direct-publish"]').exists()).toBe(false)
    expect(wrapper.get('main').classes()).toContain('announcement-editor')
    expect(wrapper.get('.editor-workspace [data-testid="import-markdown"]').text()).toContain('选择文件')
    expect(wrapper.findAll('[data-testid="import-markdown-input"]')).toHaveLength(1)
    expect(paths).not.toContain('/api/announcement-editor/documents')

    await wrapper.get('[data-testid="open-history-restore"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="history-restore-dialog"]').exists()).toBe(true)
    expect(wrapper.get('main').attributes('data-document-id')).toBe('announcement:42')
    expect(wrapper.get('[data-testid="history-restore-confirm"]').attributes('disabled')).toBeDefined()
    expect(requests.filter(request => request.method === 'POST')).toEqual([])
    await wrapper.get('[data-testid="history-recovery"]').trigger('click')
    expect(wrapper.get('[data-testid="history-preview"]').text()).toBe(recoveryMarkdown)
    expect(requests.filter(request => request.method === 'POST')).toEqual([])
    await wrapper.get('[data-testid="history-restore-confirm"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('main').attributes('data-document-id')).toBe('announcement:43')
    expect(wrapper.get('[data-testid="announcement-manual-save"]').text()).toBe('保存草稿')
    expect(wrapper.find('[data-testid="history-restore-dialog"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Recovered maintenance')
    expect(requests.filter(request => request.method === 'POST')).toEqual([{
      path: '/api/announcement-editor/documents',
      method: 'POST',
      body: { title: 'Maintenance（恢复草稿副本）', markdown: recoveryMarkdown },
    }])
    expect(requests.filter(request => request.method !== 'GET' && request.path.startsWith('/api/announcement-editor/documents/announcement:42'))).toEqual([])

    wrapper.unmount()
  }, 20_000)
})
