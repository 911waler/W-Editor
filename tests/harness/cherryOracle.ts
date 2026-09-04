import Cherry from 'cherry-markdown/dist/cherry-markdown.esm.js'
import * as echarts from 'echarts'
import mermaid from 'mermaid'

import { W_EDITOR_CHERRY_ENGINE_OPTIONS } from '../../src/adapters/wEditorCherrySyntax'

export interface CherryOracleResult {
  readonly markdown: string
  readonly html: string
}

export function renderWithCherryOracle(markdown: string): CherryOracleResult {
  const host = document.createElement('div')
  host.id = `cherry-oracle-${crypto.randomUUID()}`
  host.hidden = true
  document.body.append(host)

  const cherry = new Cherry({
    id: host.id,
    engine: W_EDITOR_CHERRY_ENGINE_OPTIONS,
    value: markdown,
    externals: {
      echarts,
      mermaid,
    },
    editor: {
      defaultModel: 'previewOnly',
    },
    toolbars: {
      toolbar: false,
      toolbarRight: false,
      bubble: false,
      float: false,
      sidebar: false,
    },
  })

  try {
    return {
      markdown,
      html: cherry.getHtml(false),
    }
  } finally {
    cherry.destroy()
    host.remove()
  }
}
