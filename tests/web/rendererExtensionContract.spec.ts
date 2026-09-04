import { describe, expect, it } from 'vitest'

import { mountWRenderer } from '../../packages/editor-web/src/index'

describe('public Renderer extension contract', () => {
  it('sanitizes extension output and keeps Markdown authority unchanged', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const instance = mountWRenderer(container, {
      markdown: '# Authority',
      profile: 'reader',
      rendererExtensions: [{
        id: 'download-script',
        permissions: ['safe-fragment'],
        render: ({ snapshot }) => `<a href="/download/${snapshot.documentId}">Download</a><script>alert(1)</script>`,
      }],
    })

    expect(container.querySelector('[data-w-editor-extension="download-script"] a')).not.toBeNull()
    expect(container.querySelector('[data-w-editor-extension="download-script"] script')).toBeNull()
    expect(instance.snapshot()).toMatchObject({ markdown: '# Authority', revision: 0 })

    await instance.destroy()
    container.remove()
  })

  it('rejects an extension permission outside the declared safety boundary before leaving residue', () => {
    const container = document.createElement('div')
    expect(() => mountWRenderer(container, {
      markdown: '# Authority',
      profile: 'reader',
      rendererExtensions: [{
        id: 'unsafe',
        permissions: ['authority-write'] as never,
        render: () => '<p>unsafe</p>',
      }],
    })).toThrow()
    expect(container.childElementCount).toBe(0)
  })
})
