import type {
  Codec,
  CodecMatch,
  ProjectionNode,
  SafePatchUnit,
  SourceSpan,
  ValidationResult,
} from './contracts'
import { splitTableRow } from './ordinaryTables'

export const CHART_TABLE_TYPES = Object.freeze([
  'line',
  'bar',
  'radar',
  'map',
  'heatmap',
  'scatter',
  'pie',
  'sankey',
] as const)

export type ChartTableType = (typeof CHART_TABLE_TYPES)[number]
export type ChartTableCommandId = `chart.${ChartTableType}`
export type ChartTableOptionValue = boolean | number | string

export interface ChartTableDescriptor {
  readonly chartType: ChartTableType
  readonly commandId: ChartTableCommandId
  readonly icon: string
  readonly labels: Readonly<{ en: string; ru: string; zh: string }>
}

export interface ChartTableModel {
  readonly chartType: ChartTableType
  readonly columns: readonly string[]
  readonly options: Readonly<Record<string, ChartTableOptionValue>>
  readonly rows: readonly (readonly string[])[]
  readonly source: string
  readonly sourceSpan: SourceSpan
  readonly title: string
}

export interface ChartTableDraft {
  readonly chartType: ChartTableType
  readonly columns: readonly string[]
  readonly options?: Readonly<Record<string, ChartTableOptionValue>>
  readonly rows: readonly (readonly string[])[]
  readonly title: string
}

export const CHART_TABLE_DESCRIPTORS: readonly ChartTableDescriptor[] = Object.freeze([
  Object.freeze({ chartType: 'line', commandId: 'chart.line', icon: '⌁', labels: Object.freeze({ en: 'Line chart', ru: 'Линейный график', zh: '折线图' }) }),
  Object.freeze({ chartType: 'bar', commandId: 'chart.bar', icon: '▥', labels: Object.freeze({ en: 'Bar chart', ru: 'Столбчатая диаграмма', zh: '柱状图' }) }),
  Object.freeze({ chartType: 'radar', commandId: 'chart.radar', icon: '⌾', labels: Object.freeze({ en: 'Radar chart', ru: 'Радарная диаграмма', zh: '雷达图' }) }),
  Object.freeze({ chartType: 'map', commandId: 'chart.map', icon: '⌖', labels: Object.freeze({ en: 'Map chart', ru: 'Карта', zh: '地图' }) }),
  Object.freeze({ chartType: 'heatmap', commandId: 'chart.heatmap', icon: '▦', labels: Object.freeze({ en: 'Heatmap', ru: 'Тепловая карта', zh: '热力图' }) }),
  Object.freeze({ chartType: 'scatter', commandId: 'chart.scatter', icon: '⠿', labels: Object.freeze({ en: 'Scatter chart', ru: 'Точечная диаграмма', zh: '散点图' }) }),
  Object.freeze({ chartType: 'pie', commandId: 'chart.pie', icon: '◔', labels: Object.freeze({ en: 'Pie chart', ru: 'Круговая диаграмма', zh: '饼状图' }) }),
  Object.freeze({ chartType: 'sankey', commandId: 'chart.sankey', icon: '⇝', labels: Object.freeze({ en: 'Sankey chart', ru: 'Диаграмма Санки', zh: '桑基图' }) }),
])

const STARTERS: Readonly<Record<ChartTableType, string>> = Object.freeze({
  bar: '| :bar: {"title": "Bar Table"} | a | b | c |\n| :-: | :-: | :-: | :-: |\n| x | 1 | 2 | 3 |\n| y | 2 | 4 | 6 |\n| z | 7 | 5 | 3 |',
  heatmap: '| :heatmap:{"title": "Heatmap Table"} | 周一 | 周二 | 周三 | 周四 | 周五 |\n| :-: | :-: | :-: | :-: | :-: | :-: |\n| 9:00 | 10 | 15 | 8 | 12 | 20 |\n| 12:00 | 25 | 30 | 18 | 22 | 35 |\n| 15:00 | 18 | 20 | 25 | 28 | 30 |\n| 18:00 | 35 | 40 | 32 | 38 | 45 |',
  line: '| :line: {"title": "Line Table"} | a | b | c |\n| :-: | :-: | :-: | :-: |\n| x | 1 | 2 | 3 |\n| y | 2 | 4 | 6 |\n| z | 7 | 5 | 3 |',
  map: '| :map:{"title": "Map Table", "mapDataSource": "https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json"} | 数值 |\n| :-: | :-: |\n| 北京 | 120 |\n| 上海 | 280 |\n| 广东 | 350 |\n| 四川 | 180 |\n| 江苏 | 290 |\n| 浙江 | 220 |',
  pie: '| :pie:{"title": "Pie Table"} | 数值 |\n| :-: | :-: |\n| 苹果 | 35 |\n| 香蕉 | 25 |\n| 橙子 | 20 |\n| 葡萄 | 15 |\n| 其他 | 5 |',
  radar: '| :radar: {"title": "Radar Table"} | 技能1 | 技能2 | 技能3 | 技能4 | 技能5 |\n| :-: | :-: | :-: | :-: | :-: | :-: |\n| 用户A | 90 | 85 | 75 | 80 | 88 |\n| 用户B | 75 | 90 | 88 | 85 | 78 |\n| 用户C | 85 | 78 | 90 | 88 | 85 |',
  sankey: '| :sankey:{"title": "Sankey Table"} | Target | Value |\n| :-: | :-: | :-: |\n| A | A1 | 5 |\n| A | A2 | 3 |\n| B | B1 | 8 |\n| A | B1 | 3 |\n| B1 | A1 | 1 |\n| B1 | C | 2 |',
  scatter: '| :scatter:{"title": "Scatter Table"} | X | Y | Size | Series |\n| :-: | :-: | :-: | :-: | :-: |\n| A1 | 10 | 20 | 5 | S1 |\n| A2 | 15 | 35 | 8 | S1 |\n| B1 | 30 | 12 | 3 | S2 |\n| B2 | 25 | 28 | 6 | S2 |\n| C1 | 50 | 40 | 9 | S3 |\n| C2 | 60 | 55 | 7 | S3 |',
})

function lineEnd(markdown: string, offset: number): number {
  const newline = markdown.indexOf('\n', offset)
  if (newline === -1) return markdown.length
  return newline > offset && markdown[newline - 1] === '\r' ? newline - 1 : newline
}

function nextLineOffset(markdown: string, end: number): number {
  if (end >= markdown.length) return markdown.length
  return markdown[end] === '\r' && markdown[end + 1] === '\n' ? end + 2 : end + 1
}

function isChartType(value: string): value is ChartTableType {
  return CHART_TABLE_TYPES.some((type) => type === value)
}

function parseOptions(source: string): Readonly<Record<string, ChartTableOptionValue>> | null {
  try {
    const parsed: unknown = JSON.parse(source)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const options: Record<string, ChartTableOptionValue> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
      if (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string') return null
      options[key] = value
    }
    return Object.freeze(options)
  } catch {
    return null
  }
}

export function chartTableDescriptor(commandId: string): ChartTableDescriptor | null {
  return CHART_TABLE_DESCRIPTORS.find((descriptor) => descriptor.commandId === commandId) ?? null
}

export function chartTableStarterSource(commandId: ChartTableCommandId): string {
  const descriptor = chartTableDescriptor(commandId)
  if (descriptor === null) throw new RangeError(`Unknown chart-table command: ${commandId}.`)
  return STARTERS[descriptor.chartType]
}

export function parseChartTableAt(markdown: string, offset: number): ChartTableModel | null {
  if (!Number.isInteger(offset) || offset < 0 || offset > markdown.length) return null
  const headerEnd = lineEnd(markdown, offset)
  const delimiterFrom = nextLineOffset(markdown, headerEnd)
  if (delimiterFrom >= markdown.length) return null
  const delimiterEnd = lineEnd(markdown, delimiterFrom)
  const header = splitTableRow(markdown.slice(offset, headerEnd))
  const delimiters = splitTableRow(markdown.slice(delimiterFrom, delimiterEnd))
  if (header === null || delimiters === null || header.length < 2 || header.length !== delimiters.length) return null
  if (delimiters.some((cell) => !/^:?-+:?$/u.test(cell))) return null
  const marker = /^:([a-z]+):\s*(\{.*\})\s*$/u.exec(header[0] ?? '')
  if (marker === null) return null
  const chartType = marker[1] ?? ''
  if (!isChartType(chartType)) return null
  const options = parseOptions(marker[2] ?? '')
  if (options === null) return null

  const rows: string[][] = []
  let to = delimiterEnd
  let cursor = nextLineOffset(markdown, delimiterEnd)
  while (cursor < markdown.length) {
    const candidateEnd = lineEnd(markdown, cursor)
    const line = markdown.slice(cursor, candidateEnd)
    if (line.trim().length === 0) break
    const cells = splitTableRow(line)
    if (cells === null || cells.length !== header.length) return null
    rows.push([...cells])
    to = candidateEnd
    cursor = nextLineOffset(markdown, candidateEnd)
  }
  if (rows.length === 0) return null
  return Object.freeze({
    chartType,
    columns: Object.freeze(header.slice(1)),
    options,
    rows: Object.freeze(rows.map((row) => Object.freeze(row))),
    source: markdown.slice(offset, to),
    sourceSpan: Object.freeze({ from: offset, to }),
    title: typeof options['title'] === 'string' ? options['title'] : '',
  })
}

function escapeCell(cell: string): string {
  return cell.replace(/\\/gu, '\\\\').replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ')
}

function optionsSource(draft: ChartTableDraft): string {
  const options = { ...draft.options, title: draft.title }
  const entries = Object.entries(options).filter(([key]) => (
    key !== '__proto__' && key !== 'constructor' && key !== 'prototype'
  ))
  return `{${entries.map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(', ')}}`
}

export function chartTableSource(draft: ChartTableDraft): string {
  if (draft.title.trim().length === 0) throw new RangeError('Chart-table title must not be empty.')
  if (draft.columns.length === 0) throw new RangeError('Chart tables require at least one value column.')
  const width = draft.columns.length + 1
  if (draft.rows.length === 0 || draft.rows.some((row) => row.length !== width)) {
    throw new RangeError(`Chart-table rows must each contain exactly ${width} cells.`)
  }
  const optionGap = draft.chartType === 'line' || draft.chartType === 'bar' || draft.chartType === 'radar' ? ' ' : ''
  const header = [`:${draft.chartType}:${optionGap}${optionsSource(draft)}`, ...draft.columns]
  return [
    `| ${header.map(escapeCell).join(' | ')} |`,
    `| ${header.map(() => ':-:').join(' | ')} |`,
    ...draft.rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`),
  ].join('\n')
}

function matchForType(markdown: string, offset: number, chartType: ChartTableType): CodecMatch | null {
  const chart = parseChartTableAt(markdown, offset)
  if (chart === null || chart.chartType !== chartType) return null
  return Object.freeze({
    captures: Object.freeze({ chart: JSON.stringify(chart) }),
    originalSource: chart.source,
    sourceSpan: chart.sourceSpan,
  })
}

function projectChart(match: CodecMatch, revision: number, chartType: ChartTableType): ProjectionNode {
  const parsed = JSON.parse(match.captures['chart'] ?? '{}') as ChartTableModel
  return Object.freeze({
    codecId: `chart-${chartType}`,
    data: Object.freeze({
      chartType,
      columns: Object.freeze(parsed.columns),
      options: Object.freeze(parsed.options),
      rows: Object.freeze(parsed.rows),
      title: parsed.title,
    }),
    editStrategy: Object.freeze({ editorId: 'chart-table-editor', kind: 'semantic-editor' as const }),
    kind: 'semantic' as const,
    nodeType: 'chart-table',
    originalSource: match.originalSource,
    projectionId: `chart-${chartType}:${match.sourceSpan.from}:${match.sourceSpan.to}`,
    revision,
    sourceSpan: Object.freeze({ ...match.sourceSpan }),
  })
}

function safePatchUnit(node: ProjectionNode): SafePatchUnit {
  return Object.freeze({
    codecId: node.codecId,
    expectedSource: node.originalSource,
    sourceSpan: Object.freeze({ ...node.sourceSpan }),
    strategy: node.editStrategy,
    structural: true,
    unitId: node.projectionId,
  })
}

function validateChartType(source: string, chartType: ChartTableType): ValidationResult {
  const parsed = parseChartTableAt(source, 0)
  if (parsed === null || parsed.sourceSpan.to !== source.length || parsed.chartType !== chartType) {
    return Object.freeze({
      code: 'INVALID_CHART_TABLE_SOURCE',
      message: `Source must be one complete Cherry ${chartType} chart table.`,
      sourceSpan: null,
      valid: false,
    })
  }
  return Object.freeze({ valid: true })
}

export function validateChartTableSource(commandId: ChartTableCommandId, source: string): ValidationResult {
  const descriptor = chartTableDescriptor(commandId)
  return descriptor === null
    ? Object.freeze({ code: 'INVALID_CHART_TABLE_COMMAND', message: `Unknown chart-table command: ${commandId}.`, sourceSpan: null, valid: false })
    : validateChartType(source, descriptor.chartType)
}

function chartTableCodec(chartType: ChartTableType, index: number): Codec {
  const codecId = `chart-${chartType}`
  const definition: Codec = {
    id: codecId,
    precedence: 89 - index,
    project: (match, revision) => projectChart(match, revision, chartType),
    recognize: (context, offset) => matchForType(context.markdown, offset, chartType),
    safePatchUnit,
    scope: 'block' as const,
    serialize: ({ node }) => {
      if (node.kind !== 'semantic' || node.nodeType !== 'chart-table' || node.data['chartType'] !== chartType) {
        throw new TypeError(`${codecId} requires a matching semantic chart-table projection node.`)
      }
      return chartTableSource({
        chartType,
        columns: node.data['columns'] as readonly string[],
        options: node.data['options'] as Readonly<Record<string, ChartTableOptionValue>>,
        rows: node.data['rows'] as readonly (readonly string[])[],
        title: String(node.data['title'] ?? ''),
      })
    },
    validate: (source) => validateChartType(source, chartType),
  }
  return Object.freeze(definition)
}

export const chartTableCodecs: readonly Codec[] = Object.freeze(
  CHART_TABLE_TYPES.map((chartType, index) => chartTableCodec(chartType, index)),
)
