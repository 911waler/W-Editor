import { describe, expect, it } from 'vitest'
import { referenceMarkdown } from '../../packages/editor-core/src'
import { createTiptapPresentation } from '../../packages/editor-vue/src/rendering/tiptapPresentation'
import { createSharedRendererPipeline } from '../../packages/editor-vue/src/rendering/sharedRendererPipeline'
import { renderSafeTiptapExportDocument } from '../../packages/editor-vue/src/services/browserFileExport'

describe('reference reader presentation', () => {
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
})
