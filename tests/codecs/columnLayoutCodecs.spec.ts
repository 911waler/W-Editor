import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  CodecRegistry,
  columnLayoutStarterSource,
  ordinaryBlockCodecs,
  projectOrdinaryMarkdown,
  type ColumnLayoutCommandId,
} from '../../src/codecs'
import { renderWithCherryOracle } from '../harness/cherryOracle'

const fixture = readFileSync('tests/fixtures/cherry/column-layouts.md', 'utf8').trimEnd()
const CASES: readonly Readonly<{ commandId: ColumnLayoutCommandId; columns: number; kind: string }>[] = [
  { commandId: 'layout.two-column', columns: 2, kind: 'two-column' },
  { commandId: 'layout.multi-column', columns: 3, kind: 'multi-column' },
]

describe('Cherry column-layout codecs', () => {
  it('recognizes exact two-column and multi-column containers as dedicated semantic units', () => {
    const registry = new CodecRegistry(ordinaryBlockCodecs)
    const matches = registry.scanBlocks({ markdown: fixture, revision: 3 })
    expect(matches.map((match) => match.codecId)).toEqual(['layout-two-column', 'layout-multi-column'])
    for (const match of matches) {
      const codec = registry.get(match.codecId)
      if (codec === undefined) throw new Error(`Missing ${match.codecId}.`)
      const node = codec.project(match, 3)
      expect(node).toMatchObject({
        editStrategy: { editorId: 'column-layout-editor', kind: 'semantic-editor' },
        kind: 'semantic',
        nodeType: 'column-layout',
      })
      expect(codec.validate(match.originalSource)).toEqual({ valid: true })
    }
  })

  it.each(CASES)('provides a valid safe starter and typed $kind preview', ({ commandId, columns, kind }) => {
    const source = columnLayoutStarterSource(commandId)
    const projection = projectOrdinaryMarkdown({ documentId: kind, markdown: source, revision: 0 })
    expect(projection.content.content?.[0]).toMatchObject({
      attrs: { items: expect.any(Array), kind: 'column-layout', layoutKind: kind },
      type: 'semanticBlock',
    })
    expect(projection.content.content?.[0]?.attrs?.['items']).toHaveLength(columns)

    const host = document.createElement('div')
    host.innerHTML = renderWithCherryOracle(source).html
    expect(host.querySelector(`.cherry-panel-cols__${columns}cols`)).not.toBeNull()
    expect(host.querySelectorAll('.cherry-panel--col')).toHaveLength(columns)
  })
})
