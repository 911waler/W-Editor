export type FormulaMode = 'block' | 'inline'

export interface FormulaMatch {
  readonly content: string
  readonly from: number
  readonly mode: FormulaMode
  readonly source: string
  readonly to: number
}

function escapedAt(source: string, offset: number): boolean {
  let backslashes = 0
  for (let index = offset - 1; index >= 0 && source[index] === '\\'; index -= 1) backslashes += 1
  return backslashes % 2 === 1
}

function containsUnescapedDollar(content: string): boolean {
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '$' && !escapedAt(content, index)) return true
  }
  return false
}

function containsUnescapedBlockDelimiter(content: string): boolean {
  for (let index = 0; index < content.length - 1; index += 1) {
    if (content[index] === '$' && content[index + 1] === '$' && !escapedAt(content, index)) return true
  }
  return false
}

export function serializeFormula(mode: FormulaMode, content: string): string {
  const normalized = content.trim()
  if (normalized.length === 0) throw new RangeError('Formula content must be non-empty.')
  if (normalized.includes('\0')) throw new RangeError('Formula content cannot contain NUL.')
  if (mode === 'inline' && containsUnescapedDollar(normalized)) {
    throw new RangeError('Formula content cannot contain an unescaped $ delimiter.')
  }
  if (mode === 'block' && containsUnescapedBlockDelimiter(normalized)) {
    throw new RangeError('Formula content cannot contain an unescaped $$ delimiter.')
  }
  return mode === 'inline' ? `$${normalized}$` : `$$\n${normalized}\n$$`
}

export function parseInlineFormulaAt(source: string, offset: number): FormulaMatch | null {
  if (source[offset] !== '$' || source[offset + 1] === '$' || escapedAt(source, offset)) return null
  for (let cursor = offset + 1; cursor < source.length && source[cursor] !== '\n' && source[cursor] !== '\r'; cursor += 1) {
    if (source[cursor] !== '$' || source[cursor + 1] === '$' || escapedAt(source, cursor)) continue
    const content = source.slice(offset + 1, cursor)
    if (content.trim().length === 0) return null
    return Object.freeze({
      content,
      from: offset,
      mode: 'inline',
      source: source.slice(offset, cursor + 1),
      to: cursor + 1,
    })
  }
  return null
}

export function parseBlockFormulaAt(source: string, offset: number): FormulaMatch | null {
  if (offset > 0 && source[offset - 1] !== '\n') return null
  const opener = /^\$\$\r?\n/u.exec(source.slice(offset))
  if (opener === null) return null
  const bodyFrom = offset + opener[0].length
  const close = /\r?\n\$\$(?=\r?\n|$)/gu
  close.lastIndex = bodyFrom
  const match = close.exec(source)
  if (match === null || match.index <= bodyFrom) return null
  const to = match.index + match[0].length
  return Object.freeze({
    content: source.slice(bodyFrom, match.index),
    from: offset,
    mode: 'block',
    source: source.slice(offset, to),
    to,
  })
}

export function formulaAtSelection(
  markdown: string,
  selection: Readonly<{ readonly from: number; readonly to: number }>,
): FormulaMatch | null {
  const from = Math.min(selection.from, selection.to)
  const to = Math.max(selection.from, selection.to)
  const matches: FormulaMatch[] = []
  for (let offset = 0; offset < markdown.length; offset += 1) {
    const block = parseBlockFormulaAt(markdown, offset)
    if (block !== null) {
      matches.push(block)
      offset = block.to - 1
      continue
    }
    const inline = parseInlineFormulaAt(markdown, offset)
    if (inline !== null) {
      matches.push(inline)
      offset = inline.to - 1
    }
  }
  return matches.find((match) => (
    from === match.from && to === match.to
  ) || (
    from === to && from >= match.from && from <= match.to
  ) || (
    from < match.to && to > match.from
  )) ?? null
}
