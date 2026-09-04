import type { FormulaMode } from '@w-editor/editor-core'
import { renderSafeKatex } from '../services/safeKatexRenderer'

export function renderFormulaVisual(mode: FormulaMode, content: string): HTMLElement {
  const element = document.createElement(mode === 'inline' ? 'span' : 'div')
  element.className = `formula-rendered formula-rendered--${mode}`
  element.setAttribute('role', 'img')
  element.setAttribute('aria-label', `Rendered ${mode} formula`)
  const result = renderSafeKatex(mode, content)
  const parsed = document.createElement('template')
  parsed.innerHTML = result.html
  element.dataset['renderState'] = result.status
  element.append(parsed.content)
  return element
}
