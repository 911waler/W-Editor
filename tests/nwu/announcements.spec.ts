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
  it('shows announcement actions without blog metadata, public visibility, or the document sidebar', async () => {
    const paths: string[] = []
    window.history.replaceState(null, '', '/admin/announcements/42/edit')
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      paths.push(path)
      if (path.endsWith('/publication')) return new Response(JSON.stringify({serverRevision:'3', state:'published',title:'Maintenance',level:'normal',sendEmail:false,scheduledFor:'',reminderEndsAt:'',recipientCount:0,missingCount:0,mailLabel:'停用'}))
      if (path.includes('/state/')) return new Response(JSON.stringify({ draft: {
        documentId: 'announcement:42',
        userId: '7',
        markdown: '# Recovered maintenance',
        baseServerRevision: '2',
        localRevision: 4,
        metadata: publishedEnvelope.metadata,
      } }))
      if (path === '/api/announcement-editor/documents' && init?.method === 'POST') {
        return new Response(JSON.stringify({
          ...publishedEnvelope,
          document: { ...publishedEnvelope.document, documentId: 'announcement:43' },
          metadata: { ...publishedEnvelope.metadata, state: 'draft' },
        }))
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
    expect(wrapper.text()).not.toContain('笔记属性')
    expect(wrapper.text()).not.toContain('仅自己')
    expect(wrapper.text()).not.toContain('指定用户')
    expect(wrapper.find('[data-testid="announcement-direct-publish"]').exists()).toBe(false)
    expect(wrapper.get('main').classes()).toContain('announcement-editor')
    expect(wrapper.get('.editor-workspace [data-testid="import-markdown"]').text()).toContain('选择文件')
    expect(wrapper.findAll('[data-testid="import-markdown-input"]')).toHaveLength(1)
    expect(paths).not.toContain('/api/announcement-editor/documents')

    const recoveryButton = wrapper.findAll('button').find(button => button.text().includes('恢复为公告草稿'))
    if (!recoveryButton) throw new Error('Expected announcement recovery action')
    await recoveryButton.trigger('click')
    await flushPromises()

    expect(wrapper.get('main').attributes('data-document-id')).toBe('announcement:43')
    expect(wrapper.get('[data-testid="announcement-manual-save"]').text()).toBe('保存草稿')

    wrapper.unmount()
  }, 20_000)
})
