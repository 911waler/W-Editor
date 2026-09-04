import {
  chartTableDescriptor,
  chartTableStarterSource,
  parseChartTableAt,
  validateChartTableSource,
  type ChartTableCommandId,
  type ChartTableModel,
} from '../codecs'
import type { DocumentSnapshot, PatchPlan } from '../core'

export interface ChartTableCommandPlan {
  readonly plan: PatchPlan
  readonly selection: Readonly<{ from: number; to: number }>
  readonly source: string
}

export function chartTableAtSelection(
  markdown: string,
  selection: Readonly<{ from: number; to: number }>,
): ChartTableModel | null {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  let offset = 0
  while (offset < markdown.length) {
    const chart = parseChartTableAt(markdown, offset)
    if (chart !== null) {
      if (from >= chart.sourceSpan.from && to <= chart.sourceSpan.to) return chart
      offset = chart.sourceSpan.to
      continue
    }
    const newline = markdown.indexOf('\n', offset)
    if (newline === -1) break
    offset = newline + 1
  }
  return null
}

export function createChartTableCommandPlan(
  snapshot: DocumentSnapshot,
  selection: Readonly<{ from: number; to: number }>,
  commandId: ChartTableCommandId,
  transactionId: string,
  draftSource = chartTableStarterSource(commandId),
): ChartTableCommandPlan {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  if (from < 0 || to > snapshot.markdown.length) throw new RangeError('Chart-table selection is outside the current Markdown snapshot.')
  const descriptor = chartTableDescriptor(commandId)
  if (descriptor === null) throw new RangeError(`Unknown chart-table command: ${commandId}.`)
  const validation = validateChartTableSource(commandId, draftSource)
  if (!validation.valid) throw new RangeError(validation.message)
  const selected = chartTableAtSelection(snapshot.markdown, { from, to })
  const replacesSelected = selected?.chartType === descriptor.chartType
  const lineEnd = snapshot.markdown.indexOf('\n', from)
  const range = replacesSelected
    ? selected.sourceSpan
    : Object.freeze({ from: lineEnd === -1 ? snapshot.markdown.length : lineEnd, to: lineEnd === -1 ? snapshot.markdown.length : lineEnd })
  const replacement = replacesSelected || snapshot.markdown.length === 0 ? draftSource : `\n\n${draftSource}`
  return Object.freeze({
    plan: Object.freeze({
      baseRevision: snapshot.revision,
      patches: Object.freeze([Object.freeze({
        codecId: `chart-${descriptor.chartType}`,
        expected: snapshot.markdown.slice(range.from, range.to),
        from: range.from,
        replacement,
        to: range.to,
      })]),
      transactionId,
    }),
    selection: Object.freeze({ from: range.from + replacement.length, to: range.from + replacement.length }),
    source: draftSource,
  })
}
