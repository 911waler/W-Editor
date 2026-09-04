import type { DocumentSnapshot } from '../core'

export interface DocumentStatistics {
  readonly bytes: number
  readonly characters: number
  readonly charactersWithoutWhitespace: number
  readonly lines: number
  readonly paragraphs: number
  readonly revision: number
  readonly words: number
}

const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu

export function calculateDocumentStatistics(snapshot: DocumentSnapshot): DocumentStatistics {
  const markdown = snapshot.markdown
  const normalized = markdown.replace(/\r\n?/g, '\n')
  const paragraphs = normalized.trim().length === 0
    ? 0
    : normalized.trim().split(/\n[\t ]*\n+/u).filter((paragraph) => paragraph.trim().length > 0).length
  return Object.freeze({
    bytes: new TextEncoder().encode(markdown).byteLength,
    characters: [...markdown].length,
    charactersWithoutWhitespace: [...markdown].filter((character) => !/\s/u.test(character)).length,
    lines: markdown.length === 0 ? 0 : normalized.split('\n').length,
    paragraphs,
    revision: snapshot.revision,
    words: normalized.match(WORD_PATTERN)?.length ?? 0,
  })
}
