import { describe, expect, it } from 'vitest'

import { ALIGNMENT_VALUES, CodecRegistry, ordinaryBlockCodecs, projectOrdinaryMarkdown } from '../../src/codecs'
import { renderWithCherryOracle } from '../harness/cherryOracle'

describe('Cherry alignment codecs', () => {
  it.each(ALIGNMENT_VALUES)('recognizes, projects, and renders %s alignment', (alignment) => {
    const source = `::: ${alignment}\n# Heading\n\nAligned paragraph\n:::`
    const registry = new CodecRegistry(ordinaryBlockCodecs)
    const matches = registry.scanBlocks({ markdown: source, revision: 2 })
    expect(matches).toEqual([expect.objectContaining({
      codecId: `alignment-${alignment}`,
      originalSource: source,
    })])
    const codec = registry.get(`alignment-${alignment}`)
    if (codec === undefined) throw new Error('Missing alignment codec.')
    expect(codec.validate(source)).toEqual({ valid: true })

    const projection = projectOrdinaryMarkdown({ documentId: alignment, markdown: source, revision: 2 })
    expect(projection.content.content?.[0]).toMatchObject({
      attrs: { alignment },
      content: [{ type: 'heading' }, { type: 'paragraph' }],
      type: 'alignmentBlock',
    })
    const host = document.createElement('div')
    host.innerHTML = renderWithCherryOracle(source).html
    expect(host.querySelector(`.cherry-text-align__${alignment}`)).not.toBeNull()
  })
})
