import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { createSharedRendererPipeline } from '../../packages/editor-vue/src/rendering/sharedRendererPipeline'

interface MatrixRow {
  readonly capabilityId: string
  readonly fixture: string
}

interface SemanticMatrix {
  readonly rows: readonly MatrixRow[]
}

function readMatrix(): SemanticMatrix {
  return JSON.parse(readFileSync('tests/fixtures/renderer/visual-semantic-matrix.json', 'utf8')) as SemanticMatrix
}

function normalizedHtml(html: string): string {
  const template = document.createElement('template')
  template.innerHTML = html
  template.content.querySelectorAll('[data-sign]').forEach((node) => node.removeAttribute('data-sign'))
  template.content.querySelectorAll('.cherry-echarts-wrapper').forEach((node) => node.removeAttribute('id'))
  return template.innerHTML
}

describe('executable Reader/Final Renderer parity', () => {
  it.each(readMatrix().rows)('compares real semantic DOM for $capabilityId', ({ fixture }) => {
    const pipeline = createSharedRendererPipeline()
    const snapshot = Object.freeze({
      documentId: `parity-${fixture}`,
      markdown: readFileSync(fixture, 'utf8'),
      revision: 0,
    })

    const finalPreview = pipeline.render(snapshot, 'author-preview', document)
    const reader = pipeline.render(snapshot, 'reader', document)

    expect(normalizedHtml(reader.html)).toBe(normalizedHtml(finalPreview.html))
    expect(reader.snapshot.markdown).toBe(snapshot.markdown)
    expect(finalPreview.snapshot.markdown).toBe(snapshot.markdown)
    expect(reader.capabilities.allowsCodeEdit).toBe(false)
    expect(finalPreview.capabilities.allowsCodeEdit).toBe(true)
    pipeline.destroy()
  })
})
