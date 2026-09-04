import DOMPurify from 'dompurify'
import mermaid from 'mermaid'

export interface MermaidPreviewRendererContract {
  readonly render: (source: string, ownerDocument?: Document) => Promise<string>
}

let renderSequence = 0

export const W_EDITOR_MERMAID_OPTIONS = Object.freeze({
  flowchart: Object.freeze({ htmlLabels: false }),
  gantt: Object.freeze({ useWidth: 800 }),
  htmlLabels: false,
  securityLevel: 'strict' as const,
  startOnLoad: false,
})

export function initializeMermaidRendering(): void {
  mermaid.initialize(W_EDITOR_MERMAID_OPTIONS)
}

export function sanitizeMermaidSvg(svg: string, ownerDocument: Document = document): string {
  const sanitized = DOMPurify.sanitize(svg, {
    FORBID_TAGS: ['foreignObject', 'script'],
    USE_PROFILES: { svg: true, svgFilters: true },
  })
  const template = ownerDocument.createElement('template')
  template.innerHTML = sanitized
  const root = template.content.querySelector('svg')
  if (root === null) throw new Error('Mermaid did not return an SVG preview.')
  for (const element of root.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      if (/^on/iu.test(attribute.name)) element.removeAttribute(attribute.name)
      if ((attribute.name === 'href' || attribute.name.endsWith(':href')) && /^\s*javascript:/iu.test(attribute.value)) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  return root.outerHTML
}

export class MermaidPreviewRenderer implements MermaidPreviewRendererContract {
  async render(source: string, ownerDocument: Document = document): Promise<string> {
    initializeMermaidRendering()
    await mermaid.parse(source)
    const result = await mermaid.render(`w-editor-mermaid-${++renderSequence}`, source)
    return sanitizeMermaidSvg(result.svg, ownerDocument)
  }
}

export const defaultMermaidPreviewRenderer = new MermaidPreviewRenderer()
