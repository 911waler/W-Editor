import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  CodecRegistry,
  PANEL_DESCRIPTORS,
  PANEL_VARIANTS,
  ordinaryBlockCodecs,
  panelStarterSource,
  projectOrdinaryMarkdown,
} from '../../src/codecs'
import { renderWithCherryOracle } from '../harness/cherryOracle'

const fixture = readFileSync('tests/fixtures/cherry/panels.md', 'utf8').trimEnd()

describe('Cherry panel codecs', () => {
  it('recognizes, projects, validates, and serializes every exact panel fixture', () => {
    const registry = new CodecRegistry(ordinaryBlockCodecs)
    const matches = registry.scanBlocks({ markdown: fixture, revision: 7 })
    expect(matches.map((match) => match.codecId)).toEqual(PANEL_VARIANTS.map((variant) => `panel-${variant}`))

    for (const match of matches) {
      const codec = registry.get(match.codecId)
      if (codec === undefined) throw new Error(`Missing ${match.codecId}.`)
      const node = codec.project(match, 7)
      const unit = codec.safePatchUnit(node)
      if (unit === null) throw new Error(`Missing safe unit for ${match.codecId}.`)
      expect(node).toMatchObject({
        editStrategy: { editorId: 'panel-editor', kind: 'semantic-editor' },
        kind: 'semantic',
        nodeType: 'panel',
      })
      expect(unit).toMatchObject({ expectedSource: match.originalSource, structural: true })
      expect(codec.validate(match.originalSource)).toEqual({ valid: true })
      expect(codec.serialize({ node, safePatchUnit: unit })).toBe(match.originalSource)
    }
  })

  it('provides one descriptor and a valid starter for primary/tips and all four status variants', () => {
    expect(PANEL_DESCRIPTORS.map((descriptor) => descriptor.commandId)).toEqual([
      'panel.primary',
      'panel.info',
      'panel.warning',
      'panel.danger',
      'panel.success',
    ])
    const registry = new CodecRegistry(ordinaryBlockCodecs)
    for (const descriptor of PANEL_DESCRIPTORS) {
      const starter = panelStarterSource(descriptor.commandId)
      const matches = registry.scanBlocks({ markdown: starter, revision: 0 })
      expect(matches).toHaveLength(1)
      expect(matches[0]?.codecId).toBe(`panel-${descriptor.variant}`)
    }
  })

  it('projects typed semantic previews and Cherry renders every variant', () => {
    const projection = projectOrdinaryMarkdown({ documentId: 'panels', markdown: fixture, revision: 7 })
    expect(projection.content.content).toHaveLength(PANEL_VARIANTS.length)
    expect(projection.content.content?.map((node) => node.attrs?.['variant'])).toEqual(PANEL_VARIANTS)
    expect(projection.content.content?.every((node) => node.type === 'semanticBlock' && node.attrs?.['kind'] === 'panel')).toBe(true)

    const host = document.createElement('div')
    host.innerHTML = renderWithCherryOracle(fixture).html
    for (const variant of PANEL_VARIANTS) {
      expect(host.querySelector(`.cherry-panel__${variant}`)).not.toBeNull()
    }
  })
})
