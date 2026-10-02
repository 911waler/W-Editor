import { describe, expect, it, vi } from 'vitest'
import { NwuAdapter } from '../../src/nwu/adapter'

describe('NWU private reference library transport', () => {
  it('uses protected library routes and base revision without citation numbers', async () => {
    const library = { revision: 4, entries: [{ id: 'r1', text: 'Collected' }], deletedIds: ['r2'], highWater: 12 }
    const request = vi.fn(async () => new Response(JSON.stringify(library)))
    const adapter = new NwuAdapter({ userId: 7, csrfToken: 'csrf', initialDocumentId: 'blog:1', readonly: false, apiBase: '/api/blog-editor', blogListUrl: '/blogs' }, request, localStorage)
    expect(await adapter.referenceServices.loadLibrary!('blog:1')).toEqual(library)
    await adapter.referenceServices.saveLibrary!('blog:1', library)
    const calls = request.mock.calls as unknown as [string, RequestInit][]
    expect(calls[0]?.[0]).toContain('/documents/blog%3A1/reference-library')
    expect(calls[1]?.[1]).toMatchObject({ method: 'PUT', credentials: 'same-origin', headers: { 'X-CSRFToken': 'csrf' } })
    expect(JSON.parse(String(calls[1]?.[1].body))).toEqual({ baseRevision: 4, entries: library.entries, deletedIds: ['r2'], highWater: 12 })
  })
})
