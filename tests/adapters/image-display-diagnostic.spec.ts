import { describe, expect, it } from 'vitest'
import { TiptapVisualAdapter } from '../../src/adapters/tiptapVisualAdapter'
import { projectOrdinaryMarkdown } from '../../src/codecs/ordinaryBlocks'
import { DocumentSession } from '../../src/core'

describe('User image display diagnostic', () => {
  it.each([
    ['legacy image in text', '在VPN界面点击“信息门户”![图片说明](/static/blog-images/1/png-4)，进入新的网页。', 1],
    ['absolute image in text', '说明![图片说明](https://example.test/image.png)后文', 1],
    ['legacy image on own line', '![图片说明](/static/blog-images/1/png-4)', 1],
    ['two images in one paragraph', '![一](https://example.test/a.png) ![二](https://example.test/b.png)', 2],
    ['absolute image on own line (control)', '![图片说明](https://example.test/a.png)', 1],
  ])('%s', (_label, markdown, count) => {
    const host = document.createElement('div')
    document.body.append(host)
    const session = new DocumentSession({ documentId: 'image-diagnostic', markdown: String(markdown) })
    const adapter = new TiptapVisualAdapter({ host, project: projectOrdinaryMarkdown, session })
    try {
      expect(host.querySelectorAll('img[src]').length, host.textContent ?? '').toBe(count)
    } finally { adapter.destroy(); host.remove() }
  })
})
