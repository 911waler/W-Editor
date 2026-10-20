import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import { referenceMarkdown } from '../../packages/editor-core/src/codecs/references'
import { emptyReferenceLibrary, type ReferenceLibrary, type ReferenceNote } from '../../packages/editor-vue/src/services/referenceEditorServices'

afterEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.unstubAllGlobals(); vi.resetModules() })

async function mountHistoryHost(options: {
  markdown?: string
  library?: ReferenceLibrary
  notes?: Record<string, ReferenceNote>
  failCopy?: 'library' | 'notes'
} = {}) {
  const markdown = options.markdown ?? '# Historical body'
  const script = document.createElement('script'); script.id = 'nwu-editor-bootstrap'; script.type = 'application/json'
  script.textContent = JSON.stringify({ userId: 7, csrfToken: 'csrf', initialDocumentId: 'blog:1', readonly: false, apiBase: '/api/blog-editor', blogListUrl: '/blogs' })
  document.body.append(script)
  const calls: Array<{ path: string; method: string; body: Record<string, unknown> }> = []
  const libraries = new Map<string, ReferenceLibrary>([['blog:1', options.library ?? emptyReferenceLibrary()]])
  const notes = new Map<string, Record<string, ReferenceNote>>([['blog:1', options.notes ?? {}]])
  const envelope = (id: string, body: string, title: string) => ({ document: { documentId: id, markdown: body, revision: 1, serverRevision: 'r1' }, metadata: { title, category: 'other', visibility: 'private', allowedUsernames: [] } })
  const version = { id: '4', savedAt: '2026-10-01T01:00:00Z', kind: 'manual-save', title: 'Old title' }
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = decodeURIComponent(new URL(String(input)).pathname), method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {}
    calls.push({ path, method, body })
    const id = path.includes('/documents/draft:restored') ? 'draft:restored' : 'blog:1'
    let data: unknown
    if (path.endsWith('/reference-library')) {
      if (method === 'PUT') {
        if (id === 'draft:restored' && options.failCopy === 'library') return new Response(JSON.stringify({ error: { message: 'Library write failed' } }), { status: 503 })
        libraries.set(id, { revision: Number(body['baseRevision']) + 1, entries: body['entries'] as ReferenceLibrary['entries'], deletedIds: body['deletedIds'] as string[], highWater: Number(body['highWater']) })
      }
      data = libraries.get(id) ?? emptyReferenceLibrary()
    } else if (path.endsWith('/reference-notes')) data = { notes: notes.get(id) ?? {} }
    else if (path.includes('/reference-notes/') && method === 'PUT') {
      if (id === 'draft:restored' && options.failCopy === 'notes') return new Response(JSON.stringify({ error: { message: 'Note write failed' } }), { status: 503 })
      const referenceId = path.split('/').at(-1)!
      const note = { revision: Number(body['baseRevision']) + 1, text: String(body['text']) }
      notes.set(id, { ...notes.get(id), [referenceId]: note })
      data = note
    } else if (path.includes('/state/')) data = {}
    else if (path.endsWith('/history/4')) data = { ...version, markdown }
    else if (path.endsWith('/history')) data = { versions: [version], nextCursor: null }
    else if (path.endsWith('/documents') && method === 'GET') data = { items: [], nextCursor: null }
    else if (path.endsWith('/documents') && method === 'POST') data = envelope('draft:restored', String(body['markdown']), String(body['title']))
    else if (path.endsWith('/save')) data = { serverRevision: 'r2' }
    else data = envelope(id, id === 'draft:restored' ? markdown : '# Current body', 'Current title')
    return new Response(JSON.stringify(data))
  })
  const { default: App } = await import('../../src/ui/App.vue')
  const wrapper = mount(App, { attachTo: document.body })
  await flushPromises()
  const selectVersion = async () => {
    await wrapper.get('[data-testid="open-history-restore"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-history-version="4"]').trigger('click')
    await flushPromises()
  }
  const restore = async () => {
    await selectVersion()
    await wrapper.get('[data-testid="history-restore-confirm"]').trigger('click')
    await flushPromises()
  }
  return { wrapper, calls, libraries, notes, selectVersion, restore }
}

it('opens history first and creates a private copy only after selecting and confirming', async () => {
  const { wrapper, calls, selectVersion } = await mountHistoryHost()
  try {
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(0)
    await selectVersion()
    expect(wrapper.get('[data-testid="history-preview"]').text()).toContain('Historical body')
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(0)
    await wrapper.get('[data-testid="history-restore-confirm"]').trigger('click')
    await flushPromises()
    expect(calls.filter(call => call.method === 'POST' && call.path.endsWith('/documents'))).toEqual([expect.objectContaining({ body: { title: 'Old title（私有恢复副本）', markdown: '# Historical body' } })])
    expect(calls.some(call => call.method === 'POST' && call.path.includes('/documents/blog:1/save'))).toBe(false)
    expect(calls.filter(call => call.path.endsWith('/history/4'))).toHaveLength(2)
    expect(wrapper.find('[data-testid="history-restore-dialog"]').exists()).toBe(false)
  } finally { wrapper.unmount() }
}, 15000)

it('copies the current collection and shared notes while retaining the restored citations and stable IDs', async () => {
  const historical = { id: 'historical', number: 11, text: 'Historical payload', style: 'apa' as const }
  const library: ReferenceLibrary = { revision: 5, entries: [{ id: 'collected', text: 'Collected only' }, { id: 'historical', text: 'Current payload' }], deletedIds: ['recovered', 'deleted'], highWater: 20 }
  const restored = { id: 'recovered', number: 23, text: 'Previously removed reference' }
  const sourceNotes = { collected: { text: 'Keep for discussion', revision: 3 }, historical: { text: 'Supports argument', revision: 2 }, recovered: { text: 'Old reference note', revision: 4 }, orphaned: { text: 'Do not copy', revision: 1 } }
  const { wrapper, calls, libraries, notes, restore } = await mountHistoryHost({ markdown: `${referenceMarkdown(historical)} ${referenceMarkdown(restored)}`, library, notes: sourceNotes })
  try {
    await restore()
    expect(wrapper.get('main').attributes('data-document-id')).toBe('draft:restored')
    expect(libraries.get('draft:restored')).toEqual({ revision: 1, entries: [{ id: 'collected', text: 'Collected only' }, { id: 'historical', text: 'Historical payload', style: 'apa' }, { id: 'recovered', text: 'Previously removed reference' }], deletedIds: ['deleted'], highWater: 23 })
    expect(notes.get('draft:restored')).toEqual({ collected: { text: 'Keep for discussion', revision: 1 }, historical: { text: 'Supports argument', revision: 1 }, recovered: { text: 'Old reference note', revision: 1 } })
    expect(libraries.get('blog:1')).toEqual(library)
    expect(notes.get('blog:1')).toEqual(sourceNotes)
    expect(calls.filter(call => call.method === 'POST' && call.path.endsWith('/documents'))).toHaveLength(1)
    expect(calls.filter(call => call.method === 'PUT' && call.path.includes('/documents/blog:1/reference-'))).toHaveLength(0)
  } finally { wrapper.unmount() }
}, 15000)

it.each(['library', 'notes'] as const)('opens the created copy and reports %s copy failure without creating another document', async failCopy => {
  const { wrapper, calls, restore } = await mountHistoryHost({
    library: { revision: 2, entries: [{ id: 'collected', text: 'Collected only' }], deletedIds: [], highWater: 2 },
    notes: { collected: { text: 'Shared note', revision: 1 } }, failCopy,
  })
  try {
    await restore()
    expect(wrapper.get('main').attributes('data-document-id')).toBe('draft:restored')
    expect(wrapper.find('[data-testid="history-restore-dialog"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('参考文献或备注未能完整复制')
    expect(wrapper.text()).toContain('源文档资料保留')
    expect(calls.filter(call => call.method === 'POST' && call.path.endsWith('/documents'))).toHaveLength(1)
    expect(calls.filter(call => call.method === 'PUT' && call.path.includes('/documents/blog:1/reference-'))).toHaveLength(0)
  } finally { wrapper.unmount() }
}, 15000)
