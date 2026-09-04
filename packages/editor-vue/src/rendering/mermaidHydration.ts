import type { MermaidPreviewRendererContract } from '../adapters/mermaidPreviewRenderer'
import { defaultMermaidPreviewRenderer } from '../adapters/mermaidPreviewRenderer'

export interface MermaidHydrationOptions {
  readonly onError?: (error: unknown) => void
  readonly renderer?: MermaidPreviewRendererContract
}

export function hydrateMermaidPreviews(
  root: HTMLElement,
  options: MermaidHydrationOptions = {},
): () => void {
  const ownerDocument = root.ownerDocument
  const view = ownerDocument.defaultView
  const renderer = options.renderer ?? defaultMermaidPreviewRenderer
  const pending = new Set<HTMLElement>()
  let disposed = false
  for (const code of root.querySelectorAll<HTMLElement>('pre > code.language-mermaid')) {
    const pre = code.parentElement
    if (view === null || !(pre instanceof view.HTMLPreElement) || pre.nextElementSibling?.matches('[data-w-editor-mermaid-preview]') === true) continue
    const preview = ownerDocument.createElement('div')
    preview.dataset['wEditorMermaidPreview'] = 'true'
    preview.className = 'rendered-document-mermaid-preview'
    preview.setAttribute('aria-live', 'polite')
    pre.insertAdjacentElement('afterend', preview)
    pending.add(preview)
    void renderer.render(code.textContent ?? '', ownerDocument).then((svg) => {
      pending.delete(preview)
      if (disposed || !preview.isConnected) return
      const template = ownerDocument.createElement('template')
      template.innerHTML = svg
      preview.replaceChildren(template.content.cloneNode(true))
      preview.dataset['renderState'] = 'ready'
    }).catch((error: unknown) => {
      pending.delete(preview)
      if (disposed || !preview.isConnected) return
      preview.dataset['renderState'] = 'error'
      preview.textContent = error instanceof Error ? error.message : 'Mermaid preview failed.'
      options.onError?.(error)
    })
  }
  return () => {
    disposed = true
    for (const preview of pending) preview.remove()
    root.querySelectorAll<HTMLElement>('[data-w-editor-mermaid-preview]').forEach((preview) => preview.remove())
  }
}
