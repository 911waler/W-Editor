import { describe, expect, it, vi } from 'vitest'

import {
  BrowserFileExporter,
  createMarkdownExport,
  renderSafeTiptapExportDocument,
} from '../../src/services/browserFileExport'

describe('Markdown browser file export', () => {
  it('creates exact UTF-8 Markdown bytes with the authoritative revision and downloads them once', async () => {
    const markdown = '# Exact\r\n\r\nCafé 👋\n'
    const artifact = createMarkdownExport({ documentId: 'article', markdown, revision: 9 })
    expect(artifact).toMatchObject({ filename: 'article.md', mediaType: 'text/markdown;charset=utf-8', revision: 9 })
    await expect(artifact.blob.text()).resolves.toBe(markdown)
    expect([...new Uint8Array(await artifact.blob.arrayBuffer())]).toEqual([...new TextEncoder().encode(markdown)])

    const anchor = document.createElement('a')
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => undefined)
    const createObjectURL = vi.fn(() => 'blob:markdown-export')
    const revokeObjectURL = vi.fn()
    const exporter = new BrowserFileExporter({
      document: { createElement: vi.fn(() => anchor) } as unknown as Pick<Document, 'createElement'>,
      objectUrls: { createObjectURL, revokeObjectURL },
    })
    exporter.download(artifact)

    expect(createObjectURL).toHaveBeenCalledWith(artifact.blob)
    expect(anchor.download).toBe('article.md')
    expect(anchor.href).toBe('blob:markdown-export')
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:markdown-export')
  })

  it('revokes an allocated URL and exposes a typed failure when download setup fails', () => {
    const revokeObjectURL = vi.fn()
    const exporter = new BrowserFileExporter({
      document: { createElement: () => { throw new Error('Anchor unavailable.') } } as unknown as Pick<Document, 'createElement'>,
      objectUrls: { createObjectURL: () => 'blob:allocated', revokeObjectURL },
    })
    expect(() => exporter.download(createMarkdownExport({ documentId: 'failure', markdown: 'safe', revision: 0 })))
      .toThrow(expect.objectContaining({ code: 'BROWSER_FILE_EXPORT_FAILED', message: 'Anchor unavailable.' }))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:allocated')
  })
})

describe('Tiptap presentation export', () => {
  it('clones the hydrated content while removing editing chrome and executable attributes', () => {
    const root = document.createElement('div')
    root.className = 'tiptap ProseMirror preview-rendered-content'
    root.innerHTML = [
      '<h1 onclick="alert(1)">Exact</h1>',
      '<span class="formula-node formula-node--inline"><span class="katex">E=mc²</span></span>',
      '<button data-semantic-edit="formula-editor">Edit</button>',
      '<script>throw new Error("unsafe")</script>',
    ].join('')

    const rendered = renderSafeTiptapExportDocument(
      { documentId: 'article', markdown: '# Exact', revision: 3 },
      root,
      { lineHeight: 2, theme: 'abyss' },
    )

    expect(rendered).toMatchObject({
      documentId: 'article',
      lineHeight: 2,
      presentationEngine: 'tiptap',
      revision: 3,
      theme: 'abyss',
    })
    expect(rendered.bodyHtml).toContain('formula-node--inline')
    expect(rendered.bodyHtml).not.toContain('data-semantic-edit')
    expect(rendered.bodyHtml).not.toContain('onclick')
    expect(rendered.bodyHtml).not.toContain('<script')
  })
})
