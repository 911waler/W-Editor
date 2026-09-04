import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type ChartPreviewRendererContract,
  TiptapTransactionPatchPlanner,
  TiptapVisualAdapter,
  serializeOrdinaryTiptapPatch,
} from '../../src/adapters'
import {
  chartTableSource,
  chartTableStarterSource,
  parseChartTableAt,
  projectOrdinaryMarkdown,
} from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

const adapters: TiptapVisualAdapter[] = []

function renderer(): ChartPreviewRendererContract & {
  readonly cleanup: ReturnType<typeof vi.fn>
  readonly mount: ReturnType<typeof vi.fn>
} {
  const cleanup = vi.fn()
  return {
    cleanup,
    mount: vi.fn((target: HTMLElement, source: string) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.dataset['renderedChart'] = source.includes(':bar:') ? 'bar' : 'line'
      target.replaceChildren(svg)
      return cleanup
    }),
  }
}

afterEach(() => {
  while (adapters.length > 0) adapters.pop()?.destroy()
  document.body.replaceChildren()
})

describe('chart-table form apply synchronization', () => {
  it('renders a chart, exposes accessible data, opens its editor control, and cleans up updates', () => {
    const original = chartTableStarterSource('chart.line')
    const parsed = parseChartTableAt(original, 0)
    if (parsed === null) throw new Error('Line starter must parse.')
    const rows = parsed.rows.map((row, rowIndex) => (
      rowIndex === 0 ? Object.freeze([row[0] ?? '', '42', ...row.slice(2)]) : row
    ))
    const replacement = chartTableSource({
      chartType: 'bar',
      columns: parsed.columns,
      options: parsed.options,
      rows,
      title: 'Quarterly bars',
    })
    const host = document.createElement('div')
    document.body.append(host)
    const plans: PatchPlan[] = []
    const onSemanticEdit = vi.fn()
    const chartRenderer = renderer()
    const session = new DocumentSession({ documentId: 'chart-edit', markdown: original })
    const adapter = new TiptapVisualAdapter({
      chartRenderer,
      host,
      onSemanticEdit,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) plans.push(patchPlan)
      },
      patchPlanner: new TiptapTransactionPatchPlanner({
        createTransactionId: () => `chart-edit:${plans.length + 1}`,
        serialize: serializeOrdinaryTiptapPatch,
      }),
      project: projectOrdinaryMarkdown,
      session,
    })
    adapters.push(adapter)
    const node = host.querySelector<HTMLElement>('[data-semantic-kind="chart-table"]')
    expect(node?.getAttribute('data-chart-type')).toBe('line')
    expect(node?.querySelector('.semantic-preview__title')?.textContent).toBe('Line Table')
    expect(node?.querySelector('.semantic-preview__chart-rendered svg')?.getAttribute('data-rendered-chart')).toBe('line')
    expect(node?.querySelector('.semantic-preview__chart-data')?.getAttribute('aria-label')).toBe('Line Table data')
    expect(node?.querySelector('.semantic-preview__chart-data')?.classList.contains('visually-hidden')).toBe(true)
    expect(chartRenderer.mount).toHaveBeenCalledWith(expect.any(HTMLElement), original)

    const editButton = node?.querySelector<HTMLButtonElement>('[data-semantic-edit="chart-table-editor"]')
    editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onSemanticEdit).toHaveBeenCalledWith(expect.objectContaining({
      chartType: 'line',
      columns: parsed.columns,
      editorId: 'chart-table-editor',
      kind: 'chart-table',
      rows: parsed.rows,
      source: original,
      title: 'Line Table',
    }))
    expect(editButton?.getAttribute('aria-label')).toBe('Edit chart: Line chart')

    const replacementModel = parseChartTableAt(replacement, 0)
    if (replacementModel === null) throw new Error('Replacement chart must parse.')
    expect(adapter.applySemanticBlock({
      chartType: replacementModel.chartType,
      columns: replacementModel.columns,
      editorId: 'chart-table-editor',
      identity: 'Bar chart',
      kind: 'chart-table',
      options: replacementModel.options,
      rows: replacementModel.rows,
      source: replacement,
      title: replacementModel.title,
    })).toEqual({ active: true, changed: true })
    expect(plans).toHaveLength(1)
    expect(plans[0]?.patches).toEqual([{
      codecId: 'chart-line',
      expected: original,
      from: 0,
      replacement,
      to: original.length,
    }])
    expect(node?.getAttribute('data-chart-type')).toBe('bar')
    expect(node?.querySelector('.semantic-preview__title')?.textContent).toBe('Quarterly bars')
    expect(node?.querySelector('.semantic-preview__chart-rendered svg')?.getAttribute('data-rendered-chart')).toBe('bar')
    expect(node?.querySelector('tbody tr:first-child td')?.textContent).toBe('42')
    expect(chartRenderer.cleanup).toHaveBeenCalledOnce()

    session.commitPatchPlan(plans[0]!)
    const snapshot = session.snapshot()
    adapter.acknowledgeSynchronization({ map: projectOrdinaryMarkdown(snapshot).map, snapshot })
    expect(snapshot.markdown).toBe(replacement)
    expect(adapter.undo()).toBe(true)
    expect(plans).toHaveLength(2)
    expect(plans[1]?.patches[0]?.replacement).toBe(original)
  })
})
