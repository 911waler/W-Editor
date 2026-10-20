import { isFormulaId, type FormulaReferenceCandidate, type FormulaMode } from '@w-editor/editor-core'
import type { PreparedFormulaSources } from './prepareCherryFormulas'
import { renderSafeKatex } from './safeKatexRenderer'
import { createRandomId } from './randomId'
import { sanitizeCherryHtml } from './sanitizeCherryHtml'
import { renumberBlockFormulas } from './formulaNumbering'

interface FormulaPlaceholder {
  readonly id: string
  readonly mode: FormulaMode
  readonly source: string
  readonly formulaId: string | null
}

function createMissingAnnotationFallback(wrapper: Element, ownerDocument: Document): HTMLElement {
  const fallback = ownerDocument.createElement('span')
  fallback.className = 'cherry-formula-error'
  const content = wrapper.cloneNode(true) as Element
  content.querySelectorAll('.formula-node__number').forEach(label => label.remove())
  const visibleText = content.textContent ?? ''
  fallback.textContent = visibleText.length > 0 ? visibleText : '⚠'
  if (wrapper.matches('.Cherry-Math')) {
    const block = ownerDocument.createElement('div')
    block.className = 'Cherry-Math'
    block.append(fallback)
    return block
  }
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
  sources: PreparedFormulaSources = new Map(),
  trustedTargets: readonly FormulaReferenceCandidate[] = [],
): string {
  const rawTemplate = ownerDocument.createElement('template')
  rawTemplate.innerHTML = rawHtml
  // Raw HTML cannot claim a target identity, number, or application reference state.
  for (const element of rawTemplate.content.querySelectorAll<HTMLElement>('[id], [data-formula-id], [data-formula-reference-target]')) {
    if (element.id.startsWith('wformula-')) element.removeAttribute('id')
    element.removeAttribute('data-formula-id')
    element.removeAttribute('data-formula-reference-target')
  }

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
    placeholders.push(Object.freeze({ id, mode, source: sources.get(annotationSource) ?? annotationSource, formulaId: sources.formulaIds?.get(annotationSource) ?? null }))
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
    const rendered = renderSafeKatex(captured.mode, captured.source, ownerDocument)
    wrapper.innerHTML = rendered.html
    const result = rendered.status === 'error' && captured.mode === 'block' ? createMissingAnnotationFallback(wrapper, ownerDocument) : wrapper
    if (captured.mode === 'block' && isFormulaId(captured.formulaId)) result.dataset['formulaId'] = captured.formulaId
    placeholder.replaceWith(result)
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

  const blocks = [...sanitizedTemplate.content.querySelectorAll<HTMLElement>('.Cherry-Math')]
  if (trustedTargets.length === blocks.length && blocks.every((block, index) => {
    const source = trustedTargets[index]?.content
    if (source === undefined) return false
    const annotation = block.querySelector('annotation[encoding="application/x-tex"]')
    if (annotation) return annotation.textContent === source
    // A second sanitizer pass sees the safe error fallback without a MathML
    // annotation. Match a fresh trusted-source rendering, never its supplied ID.
    const rendered = renderSafeKatex('block', source, ownerDocument)
    if (rendered.status !== 'error') return false
    const expected = ownerDocument.createElement('div')
    expected.innerHTML = rendered.html
    return block.querySelector('.cherry-formula-error')?.textContent === expected.textContent
  })) {
    blocks.forEach((block, index) => { const id = trustedTargets[index]?.formulaId; if (isFormulaId(id)) block.dataset['formulaId'] = id })
  }
  for (const anchor of sanitizedTemplate.content.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const match = /^#wformula-([A-Za-z0-9_-]{1,128})$/u.exec(anchor.getAttribute('href') ?? '')
    if (match) { anchor.dataset['formulaReferenceTarget'] = match[1]!; anchor.classList.add('formula-reference'); anchor.tabIndex = 0 }
  }
  renumberBlockFormulas(sanitizedTemplate.content)
  return sanitizedTemplate.innerHTML
}
