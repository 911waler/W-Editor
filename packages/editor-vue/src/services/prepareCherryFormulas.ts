import { parseBlockFormulaAt, serializeFormula, parseFencedCodeAt, parseInlineFormulaAt, rawFencedCodeCandidateAt } from '@w-editor/editor-core'
export interface PreparedFormulaSources extends ReadonlyMap<string, string> { readonly formulaIds?: ReadonlyMap<string, string> }

import { createRandomId } from './randomId'

/** Protect multiline inline TeX from Cherry's single-line math rule and Markdown hooks. */
export function prepareCherryFormulas(markdown: string, ownerDocument: Document): Readonly<{
  markdown: string
  sources: PreparedFormulaSources
}> {
  const formulaIds = new Map<string, string>()
  const sources = Object.assign(new Map<string, string>(), { formulaIds })
  const prefix = `wEditorFormula${createRandomId(ownerDocument.defaultView?.crypto).replace(/[^a-z0-9]/giu, '')}`
  let prepared = ''
  for (let offset = 0; offset < markdown.length;) {
    if (offset === 0 || markdown[offset - 1] === '\n') {
      if (/^(?: {4}| {0,3}\t)/u.test(markdown.slice(offset))) {
        const end = markdown.indexOf('\n', offset)
        const to = end === -1 ? markdown.length : end + 1
        prepared += markdown.slice(offset, to)
        offset = to
        continue
      }
      const fenced = parseFencedCodeAt(markdown, offset)
      const block = parseBlockFormulaAt(markdown, offset)
      const to = fenced?.sourceSpan.to ?? block?.to
      if (to !== undefined) {
        if (block?.formulaId) {
          const token = `${prefix}B${sources.size}`
          sources.set(token, block.content)
          formulaIds.set(token, block.formulaId)
          prepared += serializeFormula('block', token)
        } else prepared += markdown.slice(offset, to)
        offset = to
        continue
      }
      if (rawFencedCodeCandidateAt(markdown, offset) !== null) {
        prepared += markdown.slice(offset)
        break
      }
    }
    // Code spans are literal examples, including those containing newlines.
    if (markdown[offset] === '`') {
      const delimiter = /^`+/u.exec(markdown.slice(offset))?.[0] ?? '`'
      const close = markdown.indexOf(delimiter, offset + delimiter.length)
      if (close !== -1) {
        const to = close + delimiter.length
        prepared += markdown.slice(offset, to)
        offset = to
        continue
      }
    }
    const formula = parseInlineFormulaAt(markdown, offset)
    if (formula !== null) {
      if (/[\r\n]/u.test(formula.content)) {
        const token = `${prefix}F${sources.size}`
        sources.set(token, formula.content)
        prepared += `$${token}$`
      } else {
        prepared += formula.source
      }
      offset = formula.to
      continue
    }
    prepared += markdown[offset] ?? ''
    offset += 1
  }
  return { markdown: prepared, sources }
}
