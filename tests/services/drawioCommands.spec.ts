import { describe, expect, it } from 'vitest'

import { drawioSource } from '../../src/codecs'
import { createDrawioCommandPlan, drawioAtSelection } from '../../src/services'

describe('draw.io command plans', () => {
  const png = 'data:image/png;base64,AAAA'

  it('inserts exact Cherry draw.io source in one checked patch', () => {
    const result = createDrawioCommandPlan(
      { documentId: 'drawio-empty', markdown: '', revision: 0 },
      { from: 0, to: 0 },
      'Diagram',
      png,
      '<mxfile></mxfile>',
      'drawio-empty:1',
    )
    expect(result.plan.patches).toEqual([{
      codecId: 'drawio',
      expected: '',
      from: 0,
      replacement: drawioSource('Diagram', png, '<mxfile></mxfile>'),
      to: 0,
    }])
  })

  it('finds and replaces only the selected existing draw.io construct', () => {
    const original = drawioSource('Original', png, '<mxfile><diagram id="old"/></mxfile>')
    const replacement = drawioSource('Original', png, '<mxfile><diagram id="new"/></mxfile>')
    const markdown = `Before\n\n${original}\n\nAfter`
    const position = markdown.indexOf('Original')
    expect(drawioAtSelection(markdown, { from: position, to: position })?.xml).toContain('old')
    const result = createDrawioCommandPlan(
      { documentId: 'drawio-edit', markdown, revision: 4 },
      { from: position, to: position },
      'Original',
      png,
      '<mxfile><diagram id="new"/></mxfile>',
      'drawio-edit:1',
    )
    expect(result.plan.patches[0]).toEqual({
      codecId: 'drawio',
      expected: original,
      from: markdown.indexOf(original),
      replacement,
      to: markdown.indexOf(original) + original.length,
    })
  })
})
