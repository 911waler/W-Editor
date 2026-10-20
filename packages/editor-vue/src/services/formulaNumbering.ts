import { isFormulaId } from '@w-editor/editor-core'
import type { UiLocalizationStore } from './uiLocalization'

/** Derive presentation numbers from the complete document's current DOM order. */
export function renumberBlockFormulas(root: ParentNode, localization?: UiLocalizationStore): void {
  const blocks = root.querySelectorAll<HTMLElement>('.formula-node--block, .Cherry-Math')
  const identities = new Map<string, HTMLElement[]>()
  for (const block of blocks) {
    const id = block.dataset['formulaId']
    if (isFormulaId(id)) identities.set(id, [...(identities.get(id) ?? []), block])
  }
  for (const [index, block] of blocks.entries()) {
    const number = String(index + 1)
    const id = block.dataset['formulaId']
    const anchor = isFormulaId(id) && identities.get(id)?.length === 1 ? `wformula-${id}` : null
    if (anchor && block.id !== anchor) block.id = anchor
    if (!anchor && block.id.startsWith('wformula-')) block.removeAttribute('id')
    if (block.getAttribute('data-formula-number') !== number) {
      block.setAttribute('data-formula-number', number)
    }
    const labels = [...block.children].filter(child => child.classList.contains('formula-node__number'))
    let label = labels[0]
    if (label === undefined) {
      label = block.ownerDocument.createElement('span')
      label.className = 'formula-node__number'
      block.append(label)
    }
    const text = `(${number})`
    if (label.textContent !== text) label.textContent = text
    for (const duplicate of labels.slice(1)) duplicate.remove()
  }
  for (const reference of root.querySelectorAll<HTMLElement>('[data-formula-reference-target]')) {
    const id = reference.dataset['formulaReferenceTarget']
    const targets = isFormulaId(id) ? identities.get(id) : undefined
    const target = targets?.length === 1 ? targets[0] : undefined
    const number = target?.dataset['formulaNumber']
    const text = number ? localization?.t('formula.referenceNumber', { number }) ?? `Equation ${number}`
      : localization?.t('formula.referenceMissing') ?? 'Equation (unavailable)'
    if (reference.textContent !== text) reference.textContent = text
    if (target) {
      const href = `#${target.id}`
      if (reference.getAttribute('href') !== href) reference.setAttribute('href', href)
      if (reference.hasAttribute('aria-disabled')) reference.removeAttribute('aria-disabled')
    } else {
      if (reference.hasAttribute('href')) reference.removeAttribute('href')
      if (reference.getAttribute('aria-disabled') !== 'true') reference.setAttribute('aria-disabled', 'true')
    }
  }
}

export function bindFormulaReferenceNavigation(root: HTMLElement): () => void {
  const navigate = (event: Event): void => {
    if (event instanceof KeyboardEvent && event.key !== 'Enter') return
    const reference = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-formula-reference-target]') : null
    if (!reference || !root.contains(reference)) return
    event.preventDefault()
    const href = reference.getAttribute('href')
    const target = href ? [...root.querySelectorAll<HTMLElement>('[id]')].find(node => `#${node.id}` === href) : null
    target?.scrollIntoView?.({ block: 'center' })
    if (target) { target.tabIndex = -1; target.focus({ preventScroll: true }) }
  }
  root.addEventListener('click', navigate)
  root.addEventListener('keydown', navigate)
  return () => { root.removeEventListener('click', navigate); root.removeEventListener('keydown', navigate) }
}
