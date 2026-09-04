import { describe, expect, it } from 'vitest'

import { CherryRenderAdapter } from '../../src/adapters'
import { attachmentSource, parseAttachmentAt, projectOrdinaryMarkdown } from '../../src/codecs'

describe('Cherry attachment codecs', () => {
  const fixtures = [
    ['pdf', 'Guide.pdf', 'application/pdf', 'https://assets.example.test/guide.pdf'],
    ['word', 'Brief.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'https://assets.example.test/brief.docx'],
    ['file', 'Notes.txt', 'text/plain', 'https://assets.example.test/notes.txt'],
  ] as const

  it.each(fixtures)('persists typed %s URL metadata in a reloadable Cherry link', (kind, name, mediaType, url) => {
    const source = attachmentSource({ kind, mediaType, name, size: 128, url })
    expect(source).toContain(`[${name}](${url} "w-editor-attachment:kind=${kind};mediaType=`)
    expect(parseAttachmentAt(source, 0)).toEqual({
      commandId: `insert.${kind}`,
      kind,
      mediaType,
      name,
      size: 128,
      source,
      sourceSpan: { from: 0, to: source.length },
      url,
    })
    expect(projectOrdinaryMarkdown({ documentId: `attachment-${kind}`, markdown: source, revision: 2 }).content.content?.[0]).toMatchObject({
      attrs: {
        attachmentKind: kind,
        editorId: 'attachment-editor',
        kind: 'attachment',
        mediaType,
        name,
        size: 128,
        source,
        url,
      },
      type: 'semanticBlock',
    })
  })

  it('exports as a safe ordinary Cherry link carrying the typed metadata title', () => {
    const source = attachmentSource({
      kind: 'pdf',
      mediaType: 'application/pdf',
      name: 'Guide.pdf',
      size: 128,
      url: 'https://assets.example.test/guide.pdf',
    })
    const html = new CherryRenderAdapter().render({ documentId: 'attachment-export', markdown: source, revision: 1 }).html
    const template = document.createElement('template')
    template.innerHTML = html
    const link = template.content.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://assets.example.test/guide.pdf')
    expect(link?.getAttribute('title')).toBe('w-editor-attachment:kind=pdf;mediaType=application%2Fpdf;size=128')
    expect(link?.textContent).toBe('Guide.pdf')
    expect(template.content.querySelector('script')).toBeNull()
  })

  it('rejects missing typed metadata and non-serializable attachment fields', () => {
    expect(parseAttachmentAt('[Guide.pdf](https://assets.example.test/guide.pdf)', 0)).toBeNull()
    expect(() => attachmentSource({
      kind: 'pdf',
      mediaType: 'invalid',
      name: 'Guide.pdf',
      size: 128,
      url: 'https://assets.example.test/guide.pdf',
    })).toThrow()
    expect(() => attachmentSource({
      kind: 'file',
      mediaType: 'text/plain',
      name: 'Notes.txt',
      size: Number.NaN,
      url: 'blob:https://assets.example.test/id',
    })).toThrow()
  })
})
