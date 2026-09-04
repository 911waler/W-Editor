import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { CodecRegistry, ordinaryBlockCodecs, projectOrdinaryMarkdown } from '../../src/codecs'
import { renderWithCherryOracle } from '../harness/cherryOracle'

const fixture = readFileSync('tests/fixtures/cherry/formula.md', 'utf8').trimEnd()

describe('formula codec', () => {
  it('uses an exact safe unit and a dedicated block projection', () => {
    const registry = new CodecRegistry(ordinaryBlockCodecs)
    const matches = registry.scanBlocks({ markdown: fixture, revision: 0 })
    expect(matches).toEqual([expect.objectContaining({ codecId: 'formula', originalSource: fixture })])
    const codec = registry.get('formula')
    if (codec === undefined) throw new Error('Missing formula codec.')
    const node = codec.project(matches[0]!, 0)
    const safePatchUnit = codec.safePatchUnit(node)
    if (safePatchUnit === null) throw new Error('Missing formula safe unit.')
    expect(codec.serialize({ node, safePatchUnit })).toBe(fixture)

    const projection = projectOrdinaryMarkdown({ documentId: 'formula', markdown: fixture, revision: 0 })
    expect(projection.content.content?.[0]).toMatchObject({
      attrs: { content: 'E = mc^2', formulaMode: 'block', originalSource: fixture },
      type: 'formulaBlock',
    })
  })

  it('keeps inline formulas at their exact position inside an ordinary paragraph', () => {
    const projection = projectOrdinaryMarkdown({
      documentId: 'inline-formula',
      markdown: 'Before $x+y$ after',
      revision: 0,
    })
    expect(projection.content.content?.[0]).toMatchObject({
      content: [
        { text: 'Before ', type: 'text' },
        { attrs: { content: 'x+y', formulaMode: 'inline', source: '$x+y$' }, type: 'inlineFormula' },
        { text: ' after', type: 'text' },
      ],
      type: 'paragraph',
    })
  })

  it('renders through the pinned Cherry formula hook', () => {
    const rendered = renderWithCherryOracle(fixture)
    const host = document.createElement('div')
    host.innerHTML = rendered.html
    expect(host.querySelector('.Cherry-Math')).not.toBeNull()
    expect(host.querySelector('.Cherry-Math')?.getAttribute('data-formula-source')).toContain('E')
  })
})
