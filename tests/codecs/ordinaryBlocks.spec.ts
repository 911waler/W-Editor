import { describe, expect, it } from 'vitest'

import { CodecRegistry } from '../../src/codecs/codecRegistry'
import { ordinaryBlockCodecs, projectOrdinaryMarkdown } from '../../src/codecs/ordinaryBlocks'

describe('ordinary paragraph and H1-H5 codecs', () => {
  it('projects H1-H5 and paragraphs as ordinary nodes with exact source spans', () => {
    const markdown = '# H1\r\n\r\n## H2\r\n\r\n### H3\r\n\r\n#### H4\r\n\r\n##### H5\r\n\r\nParagraph  exact.\r\n'
    const projection = projectOrdinaryMarkdown({ documentId: 'ordinary', markdown, revision: 7 })

    expect(projection.content.content?.map((node) => [node.type, node.attrs?.['level'] ?? null])).toEqual([
      ['heading', 1],
      ['heading', 2],
      ['heading', 3],
      ['heading', 4],
      ['heading', 5],
      ['paragraph', null],
    ])
    expect(projection.map.revision).toBe(7)
    expect(projection.map.documentLength).toBe(markdown.length)
    for (const entry of projection.map.entries) {
      expect(markdown.slice(entry.sourceSpan.from, entry.sourceSpan.to)).toBe(entry.originalSource)
      expect(entry.safePatchUnit.expectedSource).toBe(entry.originalSource)
      expect(entry.safePatchUnit.strategy).toEqual({ kind: 'direct', scope: 'block' })
    }
  })

  it('recognizes the same exact blocks through the precedence-ordered codec registry', () => {
    const markdown = '# Heading\n\nParagraph\ncontinued'
    const registry = new CodecRegistry(ordinaryBlockCodecs)

    expect(registry.scanBlocks({ markdown, revision: 0 })).toEqual([
      expect.objectContaining({ codecId: 'heading', originalSource: '# Heading', sourceSpan: { from: 0, to: 9 } }),
      expect.objectContaining({ codecId: 'paragraph', originalSource: 'Paragraph\ncontinued', sourceSpan: { from: 11, to: 30 } }),
    ])
  })

  it('projects an explicitly empty paragraph between ordinary blocks', () => {
    const markdown = '甲\n\n\n\n丙'
    const projection = projectOrdinaryMarkdown({ documentId: 'empty-paragraph', markdown, revision: 0 })

    expect(projection.content.content?.map((node) => ({
      sourceFrom: node.attrs?.['sourceFrom'],
      sourceTo: node.attrs?.['sourceTo'],
      text: node.content?.[0]?.text ?? '',
      type: node.type,
    }))).toEqual([
      { sourceFrom: 0, sourceTo: 1, text: '甲', type: 'paragraph' },
      { sourceFrom: 3, sourceTo: 3, text: '', type: 'paragraph' },
      { sourceFrom: 5, sourceTo: 6, text: '丙', type: 'paragraph' },
    ])
    expect(projection.map.entries.map((entry) => entry.originalSource)).toEqual(['甲', '', '丙'])
  })
})
