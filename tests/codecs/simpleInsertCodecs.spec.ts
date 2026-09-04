import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { CodecRegistry, ordinaryBlockCodecs, projectOrdinaryMarkdown, simpleInlineCodecs } from '../../src/codecs'
import { renderWithCherryOracle } from '../harness/cherryOracle'

const fixture = readFileSync('tests/fixtures/cherry/simple-inserts.md', 'utf8').trimEnd()

describe('link, inline-code, hard-break, horizontal-rule, and TOC codecs', () => {
  it('recognizes exact inline and block safe units and projects direct structures', () => {
    const inlineRegistry = new CodecRegistry(simpleInlineCodecs)
    expect(inlineRegistry.scanInline({ markdown: fixture, revision: 0 }, { from: 0, to: fixture.length })
      .map((match) => match.codecId)).toEqual(['link', 'inline-code', 'hard-break'])

    const blockRegistry = new CodecRegistry(ordinaryBlockCodecs)
    expect(blockRegistry.scanBlocks({ markdown: fixture, revision: 0 }).map((match) => match.codecId)).toEqual([
      'heading',
      'paragraph',
      'horizontal-rule',
      'table-of-contents',
    ])
    const projection = projectOrdinaryMarkdown({ documentId: 'simple-inserts', markdown: fixture, revision: 0 })
    expect(projection.content.content?.map((node) => node.type)).toEqual([
      'heading',
      'paragraph',
      'horizontalRule',
      'tocBlock',
    ])
    expect(projection.content.content?.[1]?.content?.map((node) => node.type)).toContain('hardBreak')
  })

  it('retains all five meanings in Cherry output, including a heading-derived TOC', () => {
    const rendered = renderWithCherryOracle(fixture)
    const host = document.createElement('div')
    host.innerHTML = rendered.html
    expect(host.querySelector('a[href="https://example.com"]')?.textContent).toBe('label')
    expect(host.querySelector('code')?.textContent).toBe('code')
    expect(host.querySelector('br')).not.toBeNull()
    expect(host.querySelector('hr')).not.toBeNull()
    expect(host.querySelector('.toc a')?.textContent).toContain('Heading')
  })
})
