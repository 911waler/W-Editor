/// <reference types="vite/client" />

declare module 'cherry-markdown/dist/addons/advance/cherry-table-echarts-plugin.esm.js' {
  export default class EChartsTableEngine {
    constructor(options: {
      readonly cherry: { readonly locale: Readonly<Record<string, string>> }
      readonly cherryOptions: Readonly<Record<string, unknown>>
      readonly echarts: typeof import('echarts')
    })

    $buildEchartsThemeFromCss(root: HTMLElement): void
    $chartOptionsFromDataset(container: Element): Record<string, unknown>
    createChart(container: Element, option: Readonly<Record<string, unknown>>, type: string): unknown
    onDestroy(): void
  }
}
