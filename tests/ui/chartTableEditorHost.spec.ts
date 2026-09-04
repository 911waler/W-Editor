import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import type { ChartPreviewRendererContract } from '../../src/adapters'
import { chartTableStarterSource, parseChartTableAt } from '../../src/codecs'
import ChartTableEditorHost from '../../src/ui/ChartTableEditorHost.vue'

function previewRenderer(): ChartPreviewRendererContract & { readonly mount: ReturnType<typeof vi.fn> } {
  return {
    mount: vi.fn((target: HTMLElement, source: string) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.textContent = source
      target.replaceChildren(svg)
      return vi.fn()
    }),
  }
}

function mountEditor(locale: 'en' | 'ru' | 'zh' = 'en', chartRenderer = previewRenderer()) {
  const parsed = parseChartTableAt(chartTableStarterSource('chart.line'), 0)
  if (parsed === null) throw new Error('Line starter must parse.')
  const wrapper = mount(ChartTableEditorHost, {
    attachTo: document.body,
    props: {
      chartType: parsed.chartType,
      chartRenderer,
      columns: parsed.columns,
      locale,
      options: parsed.options,
      rows: parsed.rows,
      title: parsed.title,
    },
  })
  return { chartRenderer, wrapper }
}

describe('ChartTableEditorHost', () => {
  it('replaces chart editor labels and a dirty-close confirmation when the locale changes', async () => {
    const { wrapper } = mountEditor('zh')
    expect(wrapper.get('[role="dialog"]').text()).toContain('图表表格语义编辑器')
    expect(wrapper.text()).toContain('编辑图表表格')
    expect(wrapper.text()).toContain('图表类型')
    expect(wrapper.text()).toContain('标题')
    expect(wrapper.text()).toContain('应用')
    expect(wrapper.text()).not.toContain('Chart-table editor')

    await wrapper.get('#chart-table-title').setValue('Changed')
    await wrapper.get('.dialog-backdrop').trigger('mousedown')
    expect(wrapper.get('[role="alertdialog"]').text()).toContain('放弃图表表格更改？')

    await wrapper.setProps({ locale: 'ru' })

    expect(wrapper.get('[role="dialog"]').text()).toContain('Семантический редактор таблицы диаграммы')
    expect(wrapper.text()).toContain('Редактировать таблицу диаграммы')
    expect(wrapper.text()).toContain('Тип диаграммы')
    expect(wrapper.text()).toContain('Заголовок')
    expect(wrapper.text()).toContain('Применить')
    expect(wrapper.get('[role="alertdialog"]').text()).toContain('Отменить изменения таблицы диаграммы?')
    wrapper.unmount()
  })

  it('emits the edited type, title, headers, and cell data on one Apply', async () => {
    const { wrapper } = mountEditor()
    await wrapper.get('#chart-table-type').setValue('bar')
    await wrapper.get('#chart-table-title').setValue('Updated chart')
    await wrapper.get('#chart-column-0').setValue('Q1')
    await wrapper.get('#chart-cell-0-1').setValue('42')
    await wrapper.get('.primary-action').trigger('click')

    const draft = wrapper.emitted('apply')?.[0]?.[0]
    expect(draft).toMatchObject({
      chartType: 'bar',
      columns: ['Q1', 'b', 'c'],
      rows: [['x', '42', '2', '3'], ['y', '2', '4', '6'], ['z', '7', '5', '3']],
      title: 'Updated chart',
    })
    expect(wrapper.emitted('apply')).toHaveLength(1)
    wrapper.unmount()
  })

  it('cancels without emitting an apply', async () => {
    const { wrapper } = mountEditor()
    await wrapper.get('button:not(.primary-action)').trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('apply')).toBeUndefined()
    wrapper.unmount()
  })

  it('renders a draft-only live chart preview and refreshes it before Apply', async () => {
    const { chartRenderer, wrapper } = mountEditor()
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-chart-draft-preview]').attributes('aria-label')).toBe('Live chart preview')
    expect(wrapper.get('[data-chart-draft-preview] svg').text()).toContain('Line Table')
    expect(chartRenderer.mount).toHaveBeenCalledOnce()

    await wrapper.get('#chart-table-title').setValue('Draft-only title')
    await wrapper.get('#chart-cell-0-1').setValue('84')
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-chart-draft-preview] svg').text()).toContain('Draft-only title')
    expect(wrapper.get('[data-chart-draft-preview] svg').text()).toContain('84')
    expect(wrapper.emitted('apply')).toBeUndefined()

    await wrapper.get('.primary-action').trigger('click')
    expect(wrapper.emitted('apply')?.[0]?.[0]).toMatchObject({ title: 'Draft-only title' })
    wrapper.unmount()
  })
})
