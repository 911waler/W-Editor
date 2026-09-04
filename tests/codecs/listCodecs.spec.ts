import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { CodecRegistry, ordinaryBlockCodecs, projectOrdinaryMarkdown } from '../../src/codecs'
import { renderWithCherryOracle } from '../harness/cherryOracle'

const fixture = readFileSync('tests/fixtures/cherry/lists.md', 'utf8').trimEnd()

describe('ordinary list codecs', () => {
  it('recognizes exact list safe units and projects direct list structures', () => {
    const registry = new CodecRegistry(ordinaryBlockCodecs)
    const matches = registry.scanBlocks({ markdown: fixture, revision: 0 })
    expect(matches.map((match) => match.codecId)).toEqual(['ordered-list', 'bullet-list', 'task-list'])
    for (const match of matches) {
      const codec = registry.get(match.codecId)
      if (codec === undefined) throw new Error(`Missing codec ${match.codecId}.`)
      const node = codec.project(match, 0)
      const safePatchUnit = codec.safePatchUnit(node)
      if (safePatchUnit === null) throw new Error(`Missing safe unit for ${match.codecId}.`)
      expect(codec.serialize({ node, safePatchUnit })).toBe(match.originalSource)
    }

    const projection = projectOrdinaryMarkdown({ documentId: 'lists', markdown: fixture, revision: 0 })
    expect(projection.content.content?.map((node) => node.type)).toEqual(['orderedList', 'bulletList', 'taskList'])
    expect(projection.content.content?.[2]?.content?.map((item) => item.attrs?.['checked'])).toEqual([false, true])
  })

  it('retains ordered, bullet, and checkbox meaning in Cherry', () => {
    const rendered = renderWithCherryOracle(fixture)
    const host = document.createElement('div')
    host.innerHTML = rendered.html
    expect(host.querySelectorAll('ol li')).toHaveLength(2)
    expect(host.querySelectorAll('ul li').length).toBeGreaterThanOrEqual(4)
    expect(host.querySelectorAll('.ch-icon-square, .ch-icon-check')).toHaveLength(2)
  })
})
