import { describe, expect, it, vi } from 'vitest'

import { mountWEditor } from '../../packages/editor-web/src/index'

describe('unconfigured Web UploadAdapter contract', () => {
  it('disables local file upload without creating mock/data URLs, nodes, or revisions', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const onError = vi.fn()
    const instance = mountWEditor(container, {
      document: { documentId: 'article-1', markdown: '# Initial', serverRevision: 'server-1' },
      onError,
    })
    const file = {
      arrayBuffer: async () => new ArrayBuffer(0),
      name: 'local.png',
      size: 0,
      type: 'image/png',
    }

    expect(instance.uploadState()).toMatchObject({ status: 'unavailable', error: { code: 'UPLOAD_UNAVAILABLE' } })
    expect(container.querySelector('input[type="file"]')).toBeNull()
    const result = await instance.uploadLocalFile(file)
    expect(result).toMatchObject({ status: 'unavailable', error: { code: 'UPLOAD_UNAVAILABLE' } })
    expect(instance.snapshot()).toMatchObject({ markdown: '# Initial', revision: 0, serverRevision: 'server-1' })
    expect(instance.exportMarkdown()).not.toMatch(/data:|mock|local\.png/iu)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: 'UPLOAD_UNAVAILABLE' }) }))

    await instance.destroy()
    container.remove()
  })

  it('keeps URL image insertion available without requiring a file adapter', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const instance = mountWEditor(container, { document: { documentId: 'article-1', markdown: '# Initial' } })

    const result = instance.insertImageUrl('https://cdn.example.test/image.png', 'Logo')
    expect(result).toMatchObject({ status: 'inserted', asset: { url: 'https://cdn.example.test/image.png' } })
    expect(instance.exportMarkdown()).toContain('![Logo](https://cdn.example.test/image.png)')
    expect(instance.snapshot()).toMatchObject({ dirty: true, revision: 1 })

    await instance.destroy({ confirm: () => true })
    container.remove()
  })
})
