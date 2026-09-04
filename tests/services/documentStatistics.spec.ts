import { describe, expect, it } from 'vitest'

import { DocumentSession } from '../../src/core'
import { calculateDocumentStatistics } from '../../src/services/documentStatistics'

describe('calculateDocumentStatistics', () => {
  it('derives deterministic Unicode/source statistics from an exact revision without mutating it', () => {
    const session = new DocumentSession({
      documentId: 'statistics',
      markdown: '# Café editor\r\n\r\nПривет, мир! 👋',
      revision: 7,
    })
    const before = session.snapshot()

    expect(calculateDocumentStatistics(before)).toEqual({
      bytes: new TextEncoder().encode(before.markdown).byteLength,
      characters: [...before.markdown].length,
      charactersWithoutWhitespace: [...before.markdown].filter((character) => !/\s/u.test(character)).length,
      lines: 3,
      paragraphs: 2,
      revision: 7,
      words: 4,
    })
    expect(session.snapshot()).toEqual(before)
  })

  it('reports zero counts for an empty authoritative source', () => {
    expect(calculateDocumentStatistics({ documentId: 'empty', markdown: '', revision: 0 })).toEqual({
      bytes: 0,
      characters: 0,
      charactersWithoutWhitespace: 0,
      lines: 0,
      paragraphs: 0,
      revision: 0,
      words: 0,
    })
  })
})
