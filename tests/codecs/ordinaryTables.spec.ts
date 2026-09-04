import { describe, expect, it } from 'vitest'

import { parseOrdinaryTableAt, projectOrdinaryMarkdown } from '../../src/codecs'

const TABLE = '| Name | Score | Note |\r\n| :--- | :---: | ---: |\r\n| Ada | 99 | Exact  |\r\n| Lin | 95 | Good |'

describe('ordinary GFM tables', () => {
  it('parses exact source, rectangular cells, and left/center/right column alignment', () => {
    const markdown = `Before\r\n\r\n${TABLE}\r\n\r\nAfter`
    const from = markdown.indexOf('| Name')
    const match = parseOrdinaryTableAt(markdown, from)
    expect(match).toEqual({
      alignments: ['left', 'center', 'right'],
      delimiters: [':---', ':---:', '---:'],
      headers: ['Name', 'Score', 'Note'],
      rows: [['Ada', '99', 'Exact'], ['Lin', '95', 'Good']],
      source: TABLE,
      sourceSpan: { from, to: from + TABLE.length },
    })
  })

  it('distinguishes unspecified alignment from explicit left and projects both without losing delimiter syntax', () => {
    const source = '| Plain | Left |\n| --- | :------ |\n| A | B |'
    const match = parseOrdinaryTableAt(source, 0)
    expect(match).toMatchObject({
      alignments: ['unspecified', 'left'],
      delimiters: ['---', ':------'],
    })

    const projection = projectOrdinaryMarkdown({ documentId: 'table-alignment-syntax', markdown: source, revision: 4 })
    const table = projection.content.content?.[0]
    expect(table?.attrs?.['markdownDelimiters']).toEqual(['---', ':------'])
    expect(table?.content?.[0]?.content?.map((cell) => cell.attrs?.['align'])).toEqual([null, 'left'])
  })

  it('projects a GFM table that omits optional leading and trailing pipes', () => {
    const source = 'Name | Score\n--- | ---:\nAda | 99'
    const projection = projectOrdinaryMarkdown({ documentId: 'table-without-edge-pipes', markdown: source, revision: 1 })

    expect(projection.content.content?.[0]).toMatchObject({
      attrs: expect.objectContaining({ codecId: 'ordinary-table', originalSource: source }),
      type: 'table',
    })
  })

  it('projects a directly editable Tiptap table with no merged-cell widths', () => {
    const projection = projectOrdinaryMarkdown({ documentId: 'ordinary-table', markdown: TABLE, revision: 3 })
    const table = projection.content.content?.[0]
    expect(table).toMatchObject({ attrs: { codecId: 'ordinary-table' }, type: 'table' })
    expect(table?.content).toHaveLength(3)
    expect(table?.content?.[0]?.content?.map((cell) => [cell.type, cell.attrs?.['align']])).toEqual([
      ['tableHeader', 'left'],
      ['tableHeader', 'center'],
      ['tableHeader', 'right'],
    ])
    expect(table?.content?.[1]?.content?.map((cell) => cell.type)).toEqual(['tableCell', 'tableCell', 'tableCell'])
    expect(projection.map.entries).toEqual([
      expect.objectContaining({ codecId: 'ordinary-table', originalSource: TABLE, sourceSpan: { from: 0, to: TABLE.length } }),
    ])
  })

  it('does not fabricate a structured table from a non-rectangular candidate', () => {
    const malformed = '| A | B |\n| --- | --- |\n| only one |'
    expect(parseOrdinaryTableAt(malformed, 0)).toBeNull()
    const projection = projectOrdinaryMarkdown({ documentId: 'malformed-table', markdown: malformed, revision: 0 })
    expect(projection.content.content).toEqual([
      expect.objectContaining({ attrs: expect.objectContaining({ source: malformed }), type: 'rawBlock' }),
    ])
  })
})
