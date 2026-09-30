import type { FormulaMode } from '@w-editor/editor-core'
import { renderSafeKatex } from './safeKatexRenderer'
import { createRandomId } from './randomId'
import { sanitizeCherryHtml } from './sanitizeCherryHtml'

interface FormulaPlaceholder {
  readonly id: string
  readonly mode: FormulaMode
  readonly source: string
}

function createMissingAnnotationFallback(wrapper: Element, ownerDocument: Document): HTMLElement {
  const fallback = ownerDocument.createElement('span')
  fallback.className = 'cherry-formula-error'
  const visibleText = wrapper.textContent ?? ''
  fallback.textContent = visibleText.length > 0 ? visibleText : '⚠'
  return fallback
}

function formulaMode(wrapper: Element): FormulaMode {
  return wrapper.matches('.Cherry-Math') ? 'block' : 'inline'
}

function formulaWrappers(template: HTMLTemplateElement): Element[] {
  return [...template.content.querySelectorAll('.Cherry-InlineMath, .Cherry-Math')]
}

function findCapturedElement(root: DocumentFragment, id: string): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>('[id]')]
    .find((element) => element.id === id) ?? null
}

export function sanitizeCherryHtmlWithSafeFormulas(
  rawHtml: string,
  ownerDocument: Document = document,
  sources: ReadonlyMap<string, string> = new Map(),
): string {
  const rawTemplate = ownerDocument.createElement('template')
  rawTemplate.innerHTML = rawHtml

  const prefix = `w-editor-formula-placeholder-${createRandomId(ownerDocument.defaultView?.crypto)}`
  const placeholders: FormulaPlaceholder[] = []

  for (const wrapper of formulaWrappers(rawTemplate)) {
    if (wrapper.parentNode === null) continue

    const mode = formulaMode(wrapper)
    const annotation = wrapper.querySelector('annotation[encoding="application/x-tex"]')
    if (annotation === null) {
      wrapper.replaceWith(createMissingAnnotationFallback(wrapper, ownerDocument))
      continue
    }

    const id = `${prefix}-${placeholders.length + 1}`
    const placeholder = ownerDocument.createElement(mode === 'block' ? 'div' : 'span')
    placeholder.id = id
    const annotationSource = annotation.textContent ?? ''
    placeholders.push(Object.freeze({ id, mode, source: sources.get(annotationSource) ?? annotationSource }))
    wrapper.replaceWith(placeholder)
  }

  const sanitizedTemplate = ownerDocument.createElement('template')
  sanitizedTemplate.innerHTML = sanitizeCherryHtml(rawTemplate.innerHTML, ownerDocument)
  const capturedIds = new Set(placeholders.map(({ id }) => id))

  for (const captured of placeholders) {
    const placeholder = findCapturedElement(sanitizedTemplate.content, captured.id)
    if (placeholder === null) continue

    const wrapper = ownerDocument.createElement(captured.mode === 'block' ? 'div' : 'span')
    wrapper.className = captured.mode === 'block' ? 'Cherry-Math' : 'Cherry-InlineMath'
    wrapper.innerHTML = renderSafeKatex(captured.mode, captured.source, ownerDocument).html
    placeholder.replaceWith(wrapper)
  }

  for (const element of sanitizedTemplate.content.querySelectorAll<HTMLElement>('[id]')) {
    if (capturedIds.has(element.id)) element.removeAttribute('id')
  }

  for (const anchor of sanitizedTemplate.content.querySelectorAll<HTMLAnchorElement>('a.anchor')) {
    anchor.removeAttribute('href')
    anchor.setAttribute('aria-hidden', 'true')
  }
  for (const toc of sanitizedTemplate.content.querySelectorAll<HTMLElement>('.toc')) {
    const items = [...toc.children].filter((child): child is HTMLLIElement => child instanceof HTMLLIElement && child.classList.contains('toc-li'))
    const first = items[0]
    if (first === undefined) continue
    const list = ownerDocument.createElement('ol')
    list.className = 'toc-node__list'
    toc.insertBefore(list, first)
    for (const item of items) list.append(item)
  }

  return sanitizedTemplate.innerHTML
}
