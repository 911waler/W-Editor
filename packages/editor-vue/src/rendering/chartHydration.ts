// The Cherry add-on ships no declaration; this ambient module is shared by every package consumer.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../env.d.ts" />

import EChartsTableEngine from 'cherry-markdown/dist/addons/advance/cherry-table-echarts-plugin.esm.js'
import * as echarts from 'echarts'

import { CHART_TABLE_TYPES, type ChartTableType } from '@w-editor/editor-core'

import bundledChinaMap from './data/china.json'

const BUNDLED_CHINA_MAP_KEYS = Object.freeze([
  'china',
  'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json',
  './assets/data/china.json',
])
let bundledChinaMapRegistered = false

function ensureBundledChinaMap(): void {
  if (bundledChinaMapRegistered) return
  const map = bundledChinaMap as unknown as Parameters<typeof echarts.registerMap>[1]
  for (const key of BUNDLED_CHINA_MAP_KEYS) {
    if (echarts.getMap(key) === undefined) echarts.registerMap(key, map)
  }
  bundledChinaMapRegistered = true
}

const CHART_LOCALE = Object.freeze({
  chartLibraryNotLoadedTip: 'Chart library is unavailable.',
  chartRenderError: 'Chart render failed',
  heatmapData: 'Heatmap data',
  high: 'High',
  low: 'Low',
  mapChartError: 'Map chart failed',
  mapChartErrorTip: 'Map data is unavailable.',
  mapChartLoading: 'Loading map',
  mapChartLoadingTip: 'Loading map data…',
  mapChartRetry: 'Retry',
  mapData: 'Map data',
  maxValue: 'Maximum',
  minValue: 'Minimum',
  pieData: 'Pie data',
  radarData: 'Radar data',
  saveAsImage: 'Save as image',
  scatterData: 'Scatter data',
})

function isChartTableType(value: string | null): value is ChartTableType {
  return value !== null && CHART_TABLE_TYPES.some((type) => type === value)
}

function isStringMatrix(value: unknown): value is readonly (readonly string[])[] {
  return Array.isArray(value)
    && value.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === 'string'))
}

function hasSafeChartDataset(container: Element): boolean {
  if (!isChartTableType(container.getAttribute('data-chart-type'))) return false
  try {
    const table: unknown = JSON.parse(container.getAttribute('data-table-data') ?? '')
    const options: unknown = JSON.parse(container.getAttribute('data-chart-options') ?? '')
    if (typeof table !== 'object' || table === null || Array.isArray(table)) return false
    const record = table as Record<string, unknown>
    if (!Array.isArray(record['header']) || !record['header'].every((cell) => typeof cell === 'string')) return false
    if (!isStringMatrix(record['rows'])) return false
    if (typeof options !== 'object' || options === null || Array.isArray(options)) return false
    return Object.values(options).every((value) => (
      typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string'
    ))
  } catch {
    return false
  }
}

export function hydrateCherryChartPreviews(
  root: HTMLElement,
  options: Readonly<{ showToolbox?: boolean; showTooltip?: boolean }> = Object.freeze({}),
): () => void {
  const view = root.ownerDocument.defaultView
  const containers = [...root.querySelectorAll<HTMLElement>('.cherry-echarts-wrapper')]
    .filter(hasSafeChartDataset)
  if (containers.length === 0) return () => undefined

  if (containers.some((container) => container.getAttribute('data-chart-type') === 'map')) {
    ensureBundledChinaMap()
  }

  const engine = new EChartsTableEngine({
    cherry: { locale: CHART_LOCALE },
    cherryOptions: {},
    echarts,
  })
  engine.$buildEchartsThemeFromCss(root)
  const ResizeObserverConstructor = view?.ResizeObserver
  const resizeObserver = ResizeObserverConstructor === undefined
    ? null
    : new ResizeObserverConstructor((entries) => {
        for (const entry of entries) {
          if (view === null || !(entry.target instanceof view.HTMLElement)) continue
          const chart = echarts.getInstanceByDom(entry.target)
          const width = entry.target.clientWidth
          if (chart !== undefined && width > 0 && Math.abs(chart.getWidth() - width) > 1) {
            chart.resize({ width })
          }
        }
      })
  for (const container of containers) {
    const type = container.getAttribute('data-chart-type') as ChartTableType
    const option = engine.$chartOptionsFromDataset(container)
    const tooltip = typeof option['tooltip'] === 'object' && option['tooltip'] !== null
      ? option['tooltip'] as Record<string, unknown>
      : {}
    option['tooltip'] = {
      ...tooltip,
      renderMode: 'richText',
      ...(options.showTooltip === false ? { show: false } : {}),
    }
    if (options.showToolbox === false) {
      const toolbox = typeof option['toolbox'] === 'object' && option['toolbox'] !== null
        ? option['toolbox'] as Record<string, unknown>
        : {}
      option['toolbox'] = { ...toolbox, show: false }
    }
    engine.createChart(container, option, type)
    resizeObserver?.observe(container)
    const chart = echarts.getInstanceByDom(container)
    const width = container.clientWidth
    if (chart !== undefined && width > 0 && Math.abs(chart.getWidth() - width) > 1) {
      chart.resize({ width })
    }
  }
  return () => {
    resizeObserver?.disconnect()
    engine.onDestroy()
  }
}
