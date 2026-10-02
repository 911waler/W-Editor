import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NwuAdapter } from '../../src/nwu/adapter'
const bootstrap = { userId: 7, csrfToken: 'csrf', initialDocumentId: 'blog:1', readonly: false, apiBase: '/api/blog-editor', blogListUrl: '/blogs' }

describe('protected NWU reference services', () => {
  beforeEach(() => localStorage.clear())
  it.each(['/api/blog-editor', '/api/tutorial-editor', '/api/announcement-editor'])('uses %s and isolates notes from local document storage', async apiBase => {
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify(
      init?.method === 'PUT' ? { text: 'private', revision: 3 } : { notes: { ref: { text: 'private', revision: 2 } } },
    )))
    const adapter = new NwuAdapter({ ...bootstrap, apiBase }, request, localStorage)
    expect(await adapter.referenceServices.loadNotes('blog:1')).toEqual({ ref: { text: 'private', revision: 2 } })
    await expect(adapter.referenceServices.saveNote('blog:1', 'ref', { text: 'private', revision: 2 })).resolves.toEqual({ text: 'private', revision: 3 })
    const [url, init] = request.mock.calls[1]!
    expect(String(url)).toContain(`${apiBase}/documents/blog%3A1/reference-notes/ref`)
    expect(init).toMatchObject({ method: 'PUT', credentials: 'same-origin', headers: { 'X-CSRFToken': 'csrf' } })
    expect(JSON.parse(String(init?.body))).toEqual({ text: 'private', baseRevision: 2 })
    expect(localStorage.length).toBe(0)
  })
  it('passes DOI and cancellation without sending document text', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ metadata: { doi: '10.1234/a', title: 'Paper' } })))
    const adapter = new NwuAdapter(bootstrap, request, localStorage)
    const controller = new AbortController()
    await expect(adapter.referenceServices.lookupDoi!('blog:1', '10.1234/a&b', controller.signal)).resolves.toEqual({ doi: '10.1234/a', title: 'Paper' })
    expect(request).toHaveBeenCalledWith(expect.stringContaining('/reference-metadata?doi=10.1234%2Fa%26b'), expect.objectContaining({ signal: controller.signal, method: 'GET' }))
    expect(request).toHaveBeenCalledWith(expect.anything(), expect.not.objectContaining({ body: expect.anything() }))
  })
  it('preserves a revision conflict and never retries it', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'REVISION_CONFLICT', message: 'Conflict' } }), { status: 409 }))
    const adapter = new NwuAdapter(bootstrap, request, localStorage)
    await expect(adapter.referenceServices.saveNote('blog:1', 'ref', { text: '', revision: 2 })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('follows a draft promotion for subsequent note operations', async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify(
      init?.method === 'POST' ? { serverRevision: 'r1', identityChange: { fromDocumentId: 'draft:old', toDocumentId: 'blog:2' } }
        : { document: { documentId: 'draft:old', markdown: '', revision: 0, serverRevision: 'r0' }, metadata: { title: 'Draft', category: 'other', visibility: 'private', allowedUsernames: [] }, notes: {} },
    )))
    const adapter = new NwuAdapter(bootstrap, request, localStorage)
    await adapter.load('draft:old')
    await adapter.save({ documentId: 'draft:old', markdown: 'body', revision: 1 }, 'manual-save')
    await adapter.referenceServices.loadNotes('draft:old')
    expect(request.mock.calls.at(-1)?.[0]).toEqual(expect.stringContaining('/documents/blog%3A2/reference-notes'))
  })
})
