import { describe, expect, it } from 'vitest'

import { chartTableStarterSource } from '../../src/codecs'
import { createChartTableCommandPlan } from '../../src/services'

describe('chart-table command plans', () => {
  it('inserts exact starter source into an empty document', () => {
    const source = chartTableStarterSource('chart.line')
    const result = createChartTableCommandPlan(
      { documentId: 'chart-empty', markdown: '', revision: 0 },
      { from: 0, to: 0 },
      'chart.line',
      'chart-empty:1',
    )
    expect(result.source).toBe(source)
    expect(result.plan.patches).toEqual([{
      codecId: 'chart-line',
      expected: '',
      from: 0,
      replacement: source,
      to: 0,
    }])
  })

  it('replaces one selected matching chart table without touching surrounding Markdown', () => {
    const original = chartTableStarterSource('chart.pie')
    const replacement = original.replace('Pie Table', 'Updated distribution').replace('| 苹果 | 35 |', '| 苹果 | 55 |')
    const markdown = `Before\n\n${original}\n\nAfter`
    const from = markdown.indexOf(original) + 5
    const result = createChartTableCommandPlan(
      { documentId: 'chart-selected', markdown, revision: 3 },
      { from, to: from },
      'chart.pie',
      'chart-selected:1',
      replacement,
    )
    expect(result.plan.patches[0]).toEqual({
      codecId: 'chart-pie',
      expected: original,
      from: markdown.indexOf(original),
      replacement,
      to: markdown.indexOf(original) + original.length,
    })
  })
})
