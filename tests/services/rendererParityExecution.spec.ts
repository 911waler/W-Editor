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

  it('preserves numbered formula identities, forward links and unavailable targets in Reader and Final', () => {
    const pipeline = createSharedRendererPipeline()
    const markdown = readFileSync('tests/fixtures/cherry/formula-references.md', 'utf8')
    try {
      for (const profile of ['author-preview', 'reader'] as const) {
        const result = pipeline.render({ documentId: 'formula-reference-parity', markdown, revision: 0 }, profile, document)
        const root = document.createElement('div')
        root.innerHTML = result.html
        const first = root.querySelector('[id="wformula-parity-first"]')
        const second = root.querySelector('[id="wformula-parity-second"]')
        expect(first?.getAttribute('data-formula-number')).toBe('1')
        expect(second?.getAttribute('data-formula-number')).toBe('2')
        const references = root.querySelectorAll('[data-formula-reference-target]')
        expect(references).toHaveLength(3)
        expect(references[0]?.textContent).toBe('Equation 2')
        expect(references[0]?.getAttribute('href')).toBe('#wformula-parity-second')
        expect(references[1]?.textContent).toBe('Equation 1')
        expect(references[1]?.getAttribute('href')).toBe('#wformula-parity-first')
        expect(references[2]?.textContent).toBe('Equation (unavailable)')
        expect(references[2]?.hasAttribute('href')).toBe(false)
        expect(references[2]?.getAttribute('aria-disabled')).toBe('true')
        expect(result.snapshot.markdown).toBe(markdown)
      }
    } finally { pipeline.destroy() }
  })
})
