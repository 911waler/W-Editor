import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  CodecRegistry,
  ordinaryBlockCodecs,
  projectOrdinaryMarkdown,
  timelineStarterSource,
  validateTimelineSource,
} from '../../src/codecs'
import { renderWithCherryOracle } from '../harness/cherryOracle'

const fixture = readFileSync('tests/fixtures/cherry/timeline.md', 'utf8').trimEnd()

describe('timeline codec', () => {
  it('recognizes exact Cherry timeline syntax as one semantic safe unit', () => {
    const registry = new CodecRegistry(ordinaryBlockCodecs)
    const matches = registry.scanBlocks({ markdown: fixture, revision: 4 })
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({ codecId: 'layout-timeline', originalSource: fixture })
    const codec = registry.get('layout-timeline')
    if (codec === undefined || matches[0] === undefined) throw new Error('Timeline codec was not registered.')
    const node = codec.project(matches[0], 4)
    expect(node).toMatchObject({
      editStrategy: { editorId: 'timeline-editor', kind: 'semantic-editor' },
      kind: 'semantic',
      nodeType: 'timeline',
    })
    const safePatchUnit = codec.safePatchUnit(node)
    if (safePatchUnit === null) throw new Error('Timeline codec did not provide a safe patch unit.')
    expect(safePatchUnit).toMatchObject({
      codecId: 'layout-timeline',
      expectedSource: fixture,
      structural: true,
    })
    expect(codec.validate(fixture)).toEqual({ valid: true })
    expect(codec.serialize({ node, safePatchUnit })).toBe(fixture)
  })

  it('provides a valid starter and a typed five-status projection', () => {
    const starter = timelineStarterSource()
    expect(validateTimelineSource(starter)).toEqual({ valid: true })
    const projection = projectOrdinaryMarkdown({ documentId: 'timeline', markdown: fixture, revision: 0 })
    expect(projection.content.content?.[0]).toMatchObject({
      attrs: {
        items: [
          { status: 'done', time: '2026-01-15', title: 'Project kickoff' },
          { status: 'doing' },
          { status: 'todo' },
          { status: 'error' },
          { status: 'milestone' },
        ],
        kind: 'timeline',
        title: 'Release plan',
      },
      type: 'semanticBlock',
    })
  })

  it('retains invalid source as a local validation result', () => {
    expect(validateTimelineSource('::: timeline\n:: [done] 2026-01-15 Missing container title\n:::')).toMatchObject({ valid: false })
    expect(validateTimelineSource('::: timeline Release\n:: [unknown] 2026-01-15 Unknown status\n:::')).toMatchObject({ valid: false })
  })

  it('renders all timeline statuses through the pinned Cherry engine', () => {
    const host = document.createElement('div')
    host.innerHTML = renderWithCherryOracle(fixture).html
    expect(host.querySelector('.cherry-timeline')).not.toBeNull()
    expect(host.querySelectorAll('.cherry-timeline--item')).toHaveLength(5)
    for (const status of ['done', 'doing', 'todo', 'error', 'milestone']) {
      expect(host.querySelector(`.cherry-timeline--item__${status}`)).not.toBeNull()
    }
  })
})
