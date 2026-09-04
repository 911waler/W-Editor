import { hydrateCherryChartPreviews } from '../rendering/chartHydration'
import { CherryRenderAdapter } from './cherryRenderAdapter'

export { hydrateCherryChartPreviews } from '../rendering/chartHydration'

export interface ChartPreviewRendererContract {
  readonly mount: (target: HTMLElement, source: string) => () => void
}

/** Chart preview keeps the shared Cherry renderer and only owns its mount lifecycle. */
export class CherryChartPreviewRenderer implements ChartPreviewRendererContract {
  readonly #renderer = new CherryRenderAdapter()

  mount(target: HTMLElement, source: string): () => void {
    const rendered = this.#renderer.render(Object.freeze({
      documentId: 'chart-preview',
      markdown: source,
      revision: 0,
    }))
    const template = document.createElement('template')
    template.innerHTML = rendered.html
    const figure = template.content.querySelector<HTMLElement>('.cherry-table-figure')
    if (figure === null || figure.querySelector('.cherry-echarts-wrapper') === null) {
      throw new TypeError('Chart preview source did not produce a Cherry chart figure.')
    }

    const theme = document.createElement('div')
    theme.className = 'cherry theme__default chart-preview-theme'
    const content = document.createElement('div')
    content.className = 'cherry-markdown chart-preview-content'
    content.append(figure)
    theme.append(content)
    target.replaceChildren(theme)

    let disposed = false
    let pendingFrame: number | null = null
    let destroyCharts: (() => void) | null = null
    const hydrateWhenConnected = (): void => {
      if (disposed || !target.isConnected) return
      destroyCharts = hydrateCherryChartPreviews(content, { showTooltip: false })
    }
    if (target.isConnected) {
      hydrateWhenConnected()
    } else {
      queueMicrotask(() => {
        if (disposed) return
        if (target.isConnected) hydrateWhenConnected()
        else pendingFrame = requestAnimationFrame(hydrateWhenConnected)
      })
    }
    return () => {
      disposed = true
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame)
      destroyCharts?.()
    }
  }
}

export const defaultCherryChartPreviewRenderer = new CherryChartPreviewRenderer()
