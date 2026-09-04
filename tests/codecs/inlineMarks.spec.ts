import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { CodecRegistry, inlineMarkCodecs, projectOrdinaryMarkdown } from '../../src/codecs'
import { renderWithCherryOracle } from '../harness/cherryOracle'

const fixture = readFileSync('tests/fixtures/cherry/inline-marks.md', 'utf8').trimEnd()

describe('Cherry-compatible inline mark codecs', () => {
  it('recognizes and losslessly serializes every registered mark fixture', () => {
    const registry = new CodecRegistry(inlineMarkCodecs)
    const matches = registry.scanInline({ markdown: fixture, revision: 0 }, { from: 0, to: fixture.length })

    expect(matches.map((match) => match.codecId)).toEqual([
      'inline-bold',
      'inline-italic',
      'inline-strike',
      'inline-underline',
      'inline-subscript',
      'inline-superscript',
    ])
    for (const match of matches) {
      const codec = registry.get(match.codecId)
      if (codec === undefined) throw new Error(`Missing codec ${match.codecId}.`)
      const node = codec.project(match, 0)
      const safePatchUnit = codec.safePatchUnit(node)
      if (safePatchUnit === null) throw new Error(`Missing safe unit for ${match.codecId}.`)
      expect(codec.serialize({ node, safePatchUnit })).toBe(match.originalSource)
      expect(codec.validate(match.originalSource)).toEqual({ valid: true })
    }
  })

  it('projects the fixture as direct Tiptap marks and retains Cherry rendering meaning', () => {
    const projection = projectOrdinaryMarkdown({ documentId: 'inline-marks', markdown: fixture, revision: 0 })
    const marks = projection.content.content?.[0]?.content
      ?.flatMap((node) => node.marks?.map((mark) => mark.type) ?? [])

    expect(marks).toEqual(['bold', 'italic', 'strike', 'underline', 'subscript', 'superscript'])
    const rendered = renderWithCherryOracle(fixture)
    const host = document.createElement('div')
    host.innerHTML = rendered.html
    expect(host.querySelector('strong')?.textContent).toBe('bold')
    expect(host.querySelector('em')?.textContent).toBe('italic')
    expect(host.querySelector('s, del')?.textContent).toBe('strike')
    expect(host.querySelector('u')?.textContent).toBe('underline')
    expect(host.querySelector('sub')?.textContent).toBe('subscript')
    expect(host.querySelector('sup')?.textContent).toBe('superscript')
  })
})
