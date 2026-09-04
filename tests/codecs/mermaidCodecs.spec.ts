import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  CodecRegistry,
  MERMAID_DESCRIPTORS,
  MERMAID_DIAGRAM_TYPES,
  mermaidStarterSource,
  ordinaryBlockCodecs,
  projectOrdinaryMarkdown,
} from '../../src/codecs'
import { renderWithCherryOracle } from '../harness/cherryOracle'

const fixture = readFileSync('tests/fixtures/cherry/mermaid.md', 'utf8').trimEnd()

describe('Mermaid codecs and semantic projection', () => {
  it('recognizes, projects, validates, and serializes all six exact Cherry fixtures', () => {
    const registry = new CodecRegistry(ordinaryBlockCodecs)
    const matches = registry.scanBlocks({ markdown: fixture, revision: 6 })
    expect(matches.map((match) => match.codecId)).toEqual(
      MERMAID_DIAGRAM_TYPES.map((diagramType) => `mermaid-${diagramType}`),
    )

    for (const match of matches) {
      const codec = registry.get(match.codecId)
      if (codec === undefined) throw new Error(`Missing ${match.codecId}.`)
      const node = codec.project(match, 6)
      const unit = codec.safePatchUnit(node)
      if (unit === null) throw new Error(`Missing safe unit for ${match.codecId}.`)
      expect(node).toMatchObject({
        editStrategy: { editorId: 'mermaid-editor', kind: 'semantic-editor' },
        kind: 'semantic',
        nodeType: 'mermaid',
      })
      expect(unit).toMatchObject({ expectedSource: match.originalSource, structural: true })
      expect(codec.validate(match.originalSource)).toEqual({ valid: true })
      expect(codec.serialize({ node, safePatchUnit: unit })).toBe(match.originalSource)
    }
  })

  it('provides one type-specific descriptor and valid starter for every required Mermaid command', () => {
    expect(MERMAID_DESCRIPTORS.map((descriptor) => descriptor.commandId)).toEqual([
      'mermaid.flowchart',
      'mermaid.sequence',
      'mermaid.state',
      'mermaid.class',
      'mermaid.pie',
      'mermaid.gantt',
    ])
    const registry = new CodecRegistry(ordinaryBlockCodecs)
    for (const descriptor of MERMAID_DESCRIPTORS) {
      const starter = mermaidStarterSource(descriptor.commandId)
      const matches = registry.scanBlocks({ markdown: starter, revision: 0 })
      expect(matches).toHaveLength(1)
      expect(matches[0]?.codecId).toBe(`mermaid-${descriptor.diagramType}`)
    }
  })

  it('projects six typed semantic nodes and preserves Cherry Mermaid meaning', () => {
    const projection = projectOrdinaryMarkdown({ documentId: 'mermaid-fixture', markdown: fixture, revision: 6 })
    expect(projection.content.content).toHaveLength(6)
    expect(projection.content.content?.map((node) => node.attrs?.['diagramType'])).toEqual(MERMAID_DIAGRAM_TYPES)
    expect(projection.content.content?.every((node) => (
      node.type === 'semanticBlock'
      && node.attrs?.['kind'] === 'mermaid'
      && node.attrs?.['editorId'] === 'mermaid-editor'
    ))).toBe(true)

    const host = document.createElement('div')
    host.innerHTML = renderWithCherryOracle(fixture).html
    expect(host.querySelectorAll('figure[data-type="mermaid"]')).toHaveLength(6)
    expect(host.querySelectorAll('code.language-mermaid')).toHaveLength(6)
  })
})
