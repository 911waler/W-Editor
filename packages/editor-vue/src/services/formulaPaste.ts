import type { FormulaMode } from '@w-editor/editor-core'

const DELIMITERS: readonly Readonly<{ open: string; close: string; mode: FormulaMode }>[] = Object.freeze([
  Object.freeze({ open: '$$', close: '$$', mode: 'block' }),
  Object.freeze({ open: '$', close: '$', mode: 'inline' }),
  Object.freeze({ open: '\\(', close: '\\)', mode: 'inline' }),
  Object.freeze({ open: '\\[', close: '\\]', mode: 'block' }),
])

/** Recognize one complete clipboard wrapper, without validating the inner TeX. */
export function formulaFromClipboard(text: string): Readonly<{ content: string; mode: FormulaMode }> | null {
  const source = text.trim()
  const delimiter = DELIMITERS.find(candidate => source.startsWith(candidate.open))
  if (delimiter === undefined) return null
  let backslashes = 0
  let comment = false
  for (let index = delimiter.open.length; index < source.length; index += 1) {
    const character = source[index]
    if (comment) {
      if (character === '\r' || character === '\n') comment = false
      continue
    }
    const escaped = backslashes % 2 === 1
    if (character === '%' && !escaped) {
      comment = true
      backslashes = 0
      continue
    }
    if (!escaped && source.startsWith(delimiter.close, index)) {
      if (index + delimiter.close.length !== source.length) return null
      const content = source.slice(delimiter.open.length, index).trim()
      return content.length === 0 ? null : Object.freeze({ content, mode: delimiter.mode })
    }
    if (!escaped && source.startsWith(delimiter.open, index)) return null
    backslashes = character === '\\' ? backslashes + 1 : 0
  }
  return null
}
