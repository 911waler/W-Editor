import { describe, expect, it } from 'vitest'
import { editorDocumentUrl } from '../../src/nwu/navigation'

describe('document navigation identity', () => {
  it('routes a recovered draft from an existing edit page to the durable new-page entry', () => {
    const draft='draft:a21a45d6-6299-4b85-9e4b-687a37f76231'
    const url=editorDocumentUrl(draft,'http://localhost/blogs/2/edit?old=1#section')
    expect(url.pathname).toBe('/blogs/new')
    expect(url.searchParams.get('document')).toBe(draft)
    expect([...url.searchParams.keys()]).toEqual(['document'])
    expect(url.hash).toBe('')
  })
  it('routes a promoted draft to its canonical edit page', () => {
    const url=editorDocumentUrl('blog:3','http://localhost/blogs/new?document=draft%3Aold')
    expect(url.href).toBe('http://localhost/blogs/3/edit')
  })
})
