import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  CodecRegistry,
  disclosureStarterSource,
  ordinaryBlockCodecs,
  projectOrdinaryMarkdown,
  validateDisclosureSource,
  type DisclosureCommandId,
} from '../../src/codecs'
import { renderWithCherryOracle } from '../harness/cherryOracle'

const fixture = readFileSync('tests/fixtures/cherry/disclosures.md', 'utf8').trimEnd()
const COMMANDS: readonly DisclosureCommandId[] = ['layout.tabs', 'layout.accordion']

describe('tabs and accordion codecs', () => {
  it('recognizes both exact syntax families as semantic safe units', () => {
    const registry = new CodecRegistry(ordinaryBlockCodecs)
    const matches = registry.scanBlocks({ markdown: fixture, revision: 4 })
    expect(matches.map((match) => match.codecId)).toEqual(['layout-tabs', 'layout-accordion'])
    for (const match of matches) {
      const codec = registry.get(match.codecId)
      if (codec === undefined) throw new Error(`Missing ${match.codecId}.`)
      const node = codec.project(match, 4)
      expect(node).toMatchObject({
        editStrategy: { editorId: 'disclosure-editor', kind: 'semantic-editor' },
        kind: 'semantic',
        nodeType: 'disclosure',
      })
      expect(codec.validate(match.originalSource)).toEqual({ valid: true })
    }
  })

  it.each(COMMANDS)('provides a locally valid %s starter and typed preview', (commandId) => {
    const source = disclosureStarterSource(commandId)
    expect(validateDisclosureSource(commandId, source)).toEqual({ valid: true })
    const projection = projectOrdinaryMarkdown({ documentId: commandId, markdown: source, revision: 0 })
    expect(projection.content.content?.[0]).toMatchObject({
      attrs: {
        items: expect.any(Array),
        kind: 'disclosure',
        layoutKind: commandId === 'layout.tabs' ? 'tabs' : 'accordion',
      },
      type: 'semanticBlock',
    })
  })

  it('rejects incomplete local drafts without throwing away their source', () => {
    const invalidTabs = '::: tabs\n:: Only\nOne body\n:::'
    const invalidAccordion = '+++ Title\n\n+++'
    expect(validateDisclosureSource('layout.tabs', invalidTabs)).toMatchObject({ valid: false })
    expect(validateDisclosureSource('layout.accordion', invalidAccordion)).toMatchObject({ valid: false })
  })

  it('renders tabs and accordion through the pinned Cherry engine', () => {
    const host = document.createElement('div')
    host.innerHTML = renderWithCherryOracle(fixture).html
    expect(host.querySelector('.cherry-tabs')).not.toBeNull()
    expect(host.querySelector('.cherry-detail details summary')?.textContent).toContain('More details')
  })
})
