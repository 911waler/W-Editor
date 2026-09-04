import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  CHART_TABLE_DESCRIPTORS,
  CHART_TABLE_TYPES,
  CodecRegistry,
  chartTableStarterSource,
  ordinaryBlockCodecs,
  parseChartTableAt,
  projectOrdinaryMarkdown,
} from '../../src/codecs'
import { renderWithCherryOracle } from '../harness/cherryOracle'

const fixture = readFileSync('tests/fixtures/cherry/chart-tables.md', 'utf8').trimEnd()

describe('Cherry chart-table codecs and semantic projection', () => {
  it('recognizes, projects, validates, and serializes all eight exact upstream fixtures', () => {
    const registry = new CodecRegistry(ordinaryBlockCodecs)
    const matches = registry.scanBlocks({ markdown: fixture, revision: 4 })
    expect(matches.map((match) => match.codecId)).toEqual(
      CHART_TABLE_TYPES.map((chartType) => `chart-${chartType}`),
    )

    for (const match of matches) {
      const codec = registry.get(match.codecId)
      if (codec === undefined) throw new Error(`Missing ${match.codecId}.`)
      const node = codec.project(match, 4)
      const unit = codec.safePatchUnit(node)
      if (unit === null) throw new Error(`Missing safe unit for ${match.codecId}.`)
      expect(node).toMatchObject({
        editStrategy: { editorId: 'chart-table-editor', kind: 'semantic-editor' },
        kind: 'semantic',
        nodeType: 'chart-table',
      })
      expect(unit).toMatchObject({ expectedSource: match.originalSource, structural: true })
      expect(codec.validate(match.originalSource)).toEqual({ valid: true })
      expect(codec.serialize({ node, safePatchUnit: unit })).toBe(match.originalSource)
    }
  })

  it('provides descriptors and exact parseable starter data for every command', () => {
    expect(CHART_TABLE_DESCRIPTORS.map((descriptor) => descriptor.commandId)).toEqual([
      'chart.line',
      'chart.bar',
      'chart.radar',
      'chart.map',
      'chart.heatmap',
      'chart.scatter',
      'chart.pie',
      'chart.sankey',
    ])
    for (const descriptor of CHART_TABLE_DESCRIPTORS) {
      const source = chartTableStarterSource(descriptor.commandId)
      const chart = parseChartTableAt(source, 0)
      expect(chart).toMatchObject({
        chartType: descriptor.chartType,
        source,
        sourceSpan: { from: 0, to: source.length },
      })
      expect(chart?.columns.length).toBeGreaterThan(0)
      expect(chart?.rows.length).toBeGreaterThan(0)
      expect(chart?.title.length).toBeGreaterThan(0)
    }
  })

  it('projects typed semantic nodes with title, type, cells, source, and Cherry chart meaning', () => {
    const projection = projectOrdinaryMarkdown({ documentId: 'chart-fixture', markdown: fixture, revision: 4 })
    expect(projection.content.content).toHaveLength(8)
    expect(projection.content.content?.map((node) => node.attrs?.['chartType'])).toEqual(CHART_TABLE_TYPES)
    expect(projection.content.content?.every((node) => (
      node.type === 'semanticBlock'
      && node.attrs?.['kind'] === 'chart-table'
      && node.attrs?.['editorId'] === 'chart-table-editor'
      && Array.isArray(node.attrs?.['columns'])
      && Array.isArray(node.attrs?.['rows'])
    ))).toBe(true)

    const host = document.createElement('div')
    host.innerHTML = renderWithCherryOracle(fixture).html
    expect(host.querySelectorAll('.cherry-table-figure')).toHaveLength(8)
    expect(host.querySelectorAll('[data-chart-options]')).toHaveLength(8)
  })
})
