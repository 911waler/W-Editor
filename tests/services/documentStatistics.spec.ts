import { describe, expect, it } from 'vitest'

import { DocumentSession } from '../../src/core'
import { calculateBodyWordCount, calculateDocumentStatistics } from '../../src/services/documentStatistics'
import { referenceMarkdown, serializeDocumentReferenceStyle } from '../../src/codecs'

describe('calculateBodyWordCount', () => {
  const count = (markdown: string) => calculateBodyWordCount({ documentId: 'body', markdown, revision: 0 })

  it('counts Han characters individually and other words/numbers by token', () => {
    expect(count('中文 English 2026，测试！')).toBe(6)
    expect(count("𠀀研究 don't cafe\u0301 123")).toBe(6)
    expect(count('')).toBe(0)
    expect(count(' ，！👋 ')).toBe(0)
  })

  it('counts visible headings, lists, link labels and table cells, without syntax or URLs', () => {
    expect(count('# 标题\n\n**正文** [链接](https://example.com/hidden/path)\n\n- item\n- next\n\n| 表头 | 值 |\n| --- | --- |\n| 内容 | 42 |')).toBe(14)
    expect(count('hel**lo** world')).toBe(2)
  })

  it('ignores citation payloads, repeated citations and the document reference style', () => {
    const citation = referenceMarkdown({ id: 'paper', number: 123, text: 'A very long reference title and author list', metadata: { title: 'Hidden title' }, style: 'apa' })
    const markdown = `${serializeDocumentReferenceStyle('apa')}\n研究${citation} test ${citation}`
    expect(count(markdown)).toBe(3)
    expect(count(`研究 test ${referenceMarkdown({ id: 'other', number: 9, text: 'Changed reference' })}`)).toBe(3)
    expect(count('研究 test')).toBe(3)
  })

  it('uses the current rich-mark parser including the repaired RGB paste syntax', () => {
    expect(count('!16 !!rgb(93, 93, 93) 中文 English!!!')).toBe(3)
    expect(count('!!#5d5d5d 中文 English!!')).toBe(3)
  })

  it('excludes code, formulas, image metadata and generated TOC', () => {
    expect(count('正文 `hidden code` $x+y$ ![hidden image](https://example.com/image.png)\n\n```js\nconst hidden = 1\n```\n\n$$\nx+y\n$$\n\n[[toc]]')).toBe(2)
  })

  it.each([
    ['::: info Note\nPlain body text CITATION\n:::', 4],
    ['::: 2cols Layout\nLeft column CITATION\n::\nRight column\n:::', 5],
    ['+++ Label\nBody CITATION\n+++', 2],
    ['::: tabs\n:: First\nBody CITATION\n:: Second\nMore text\n:::', 5],
    ['::: timeline History\n:: [done] 2026 Started\nTest body CITATION\n:::', 5],
  ])('includes prose inside structured containers: %s', (markdown, expected) => {
    const citation = referenceMarkdown({ id: 'nested', number: 7, text: 'Excluded reference title' })
    expect(count(markdown.replace('CITATION', citation))).toBe(expected)
  })
})

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
