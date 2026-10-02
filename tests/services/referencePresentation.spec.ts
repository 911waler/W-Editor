import { describe, expect, it } from 'vitest'
import { buildReferenceList } from '../../packages/editor-vue/src/adapters/referenceNode'
import { referenceMarkdown } from '../../packages/editor-core/src'
import { createTiptapPresentation } from '../../packages/editor-vue/src/rendering/tiptapPresentation'
import { createSharedRendererPipeline } from '../../packages/editor-vue/src/rendering/sharedRendererPipeline'
import { renderSafeTiptapExportDocument } from '../../packages/editor-vue/src/services/browserFileExport'

describe('reference reader presentation', () => {
  it('keeps empty reference lists free of headings and text in all presentation modes', () => {
    const list = buildReferenceList([], document)
    expect(list.hidden).toBe(true)
    expect(list.textContent).toBe('')
    expect(list.querySelector('h2')).toBeNull()
  })
  it('links only bibliography numbers, keeping URLs and DOI as plain text', () => {
    const list = buildReferenceList([{ id: 'url', number: 1, text: 'https://example.org/paper' }, { id: 'doi', number: 2, text: '10.1234/book', metadata: { doi: '10.1234/book' } }], document)
    expect([...list.querySelectorAll('a')].map(a => a.textContent)).toEqual(['[1]', '[2]'])
    expect(list.textContent).toContain('https://example.org/paper')
    expect(list.textContent).toContain('10.1234/book')
  })
  const reference = referenceMarkdown({ id: 'book', number: 7, text: '<img src=x onerror=alert(1)> A book' })
  const snapshot = { documentId: 'refs', revision: 1, markdown: `First ${reference}\n\nSecond ${reference}` }
  it('renders one safe bibliography, returns to the clicked occurrence and exports the list', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const presentation = createTiptapPresentation(host, { snapshot, profile: 'reader' })
    try {
      expect(host.querySelectorAll('.w-reference-list p')).toHaveLength(1)
      expect(host.querySelectorAll('.w-reference-list img')).toHaveLength(0)
      expect(host.querySelectorAll('[onerror]')).toHaveLength(0)
      const references = host.querySelectorAll<HTMLAnchorElement>('[data-reference-id]')
      references[1]!.click()
      host.querySelector<HTMLAnchorElement>('[data-reference-back]')!.click()
      expect(document.activeElement).toBe(references[1])
      const exported = renderSafeTiptapExportDocument(snapshot, host.querySelector<HTMLElement>('.ProseMirror')!)
      expect(exported.bodyHtml).toContain('reference-book')
      expect(exported.bodyHtml).toContain('&lt;img')
    } finally { presentation.destroy(); host.remove() }
  })
  it('renders references through Cherry too', () => {
    const pipeline = createSharedRendererPipeline()
    try {
      const rendered = pipeline.render(snapshot)
      expect(rendered.html).toContain('data-reference-id="book"')
      expect(rendered.html).toContain('w-reference-list')
      const parsed = document.createElement('div')
      parsed.innerHTML = rendered.html
      expect(parsed.querySelector('img, [onerror]')).toBeNull()
    } finally { pipeline.destroy() }
  })
  it('formats structured bibliography entries in both reader pipelines while preserving portable source', () => {
    const source = referenceMarkdown({ id: 'structured', number: 9, text: 'Manual source', metadata: { title: 'Example title', authors: [{ family: 'Smith', given: 'Jane' }], year: '2020', type: 'book' }, style: 'apa' })
    const snapshot = { documentId: 'structured', revision: 1, markdown: source }
    const host = document.createElement('div')
    document.body.append(host)
    const presentation = createTiptapPresentation(host, { snapshot, profile: 'reader' })
    const pipeline = createSharedRendererPipeline()
    try {
      expect(host.querySelector('.w-reference-list')?.textContent).toContain('Smith, J. (2020). Example title.')
      const parsed = document.createElement('div')
      parsed.innerHTML = pipeline.render(snapshot).html
      expect(parsed.querySelector('.w-reference-list')?.textContent).toContain('Smith, J. (2020). Example title.')
      expect(parsed.querySelector('[data-reference-source]')?.getAttribute('data-reference-source')).toBe(source)
    } finally { presentation.destroy(); pipeline.destroy(); host.remove() }
  })

})
