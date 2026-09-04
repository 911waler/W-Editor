import { parseFencedCodeAt, rawFencedCodeCandidateAt } from './fencedCode'
import { INLINE_MARK_SPECS } from './inlineMarks'
import { normalizeRichInlineMarkdownForCherry } from './richInlineMarks'

const INLINE_RENDER_BOUNDARY = '<!--w-editor-inline-boundary-->'

function indentationWidth(value: string): number {
  return value.replace(/\t/gu, '    ').length
}

function normalizeTaskListIndentation(markdown: string): string {
  const parts = markdown.split(/(\r\n|\r|\n)/u)
  const normalized: string[] = []
  const indentationStack: number[] = []
  let fence: Readonly<{ character: '`' | '~'; length: number }> | null = null

  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index] ?? ''
    const ending = parts[index + 1] ?? ''
    const fenceMatch = /^[ \t]*(`{3,}|~{3,})/u.exec(line)
    if (fenceMatch !== null) {
      const delimiter = fenceMatch[1] ?? ''
      const character = delimiter[0]
      if (fence === null && (character === '`' || character === '~')) {
        fence = Object.freeze({ character, length: delimiter.length })
      } else if (fence !== null && character === fence.character && delimiter.length >= fence.length) {
        fence = null
      }
      indentationStack.length = 0
      normalized.push(line, ending)
      continue
    }
    if (fence !== null) {
      normalized.push(line, ending)
      continue
    }

    const task = /^([ \t]*)(-[ \t]+\[[ xX]\][ \t]+.*)$/u.exec(line)
    if (task === null) {
      indentationStack.length = 0
      normalized.push(line, ending)
      continue
    }

    const indentation = indentationWidth(task[1] ?? '')
    if (indentationStack.length === 0 || indentation < (indentationStack[0] ?? 0)) {
      indentationStack.length = 0
      indentationStack.push(indentation)
    } else {
      while (indentationStack.length > 1 && indentation < (indentationStack.at(-1) ?? 0)) indentationStack.pop()
      const current = indentationStack.at(-1) ?? indentation
      if (indentation > current) indentationStack.push(indentation)
      else if (indentation !== current) indentationStack[indentationStack.length - 1] = indentation
    }
    const baseIndentation = indentationStack[0] ?? 0
    const depth = Math.max(0, indentationStack.length - 1)
    normalized.push(`${' '.repeat(baseIndentation + depth * 2)}${task[2] ?? ''}`, ending)
  }
  return normalized.join('')
}

function inlineCodeEnd(source: string, offset: number): number | null {
  if (source[offset] !== '`') return null
  let openerEnd = offset
  while (source[openerEnd] === '`') openerEnd += 1
  const delimiter = source.slice(offset, openerEnd)
  const closeFrom = source.indexOf(delimiter, openerEnd)
  if (closeFrom < openerEnd || source.slice(openerEnd, closeFrom).includes('\n')) return null
  return closeFrom + delimiter.length
}

function standardInlineMarkAt(source: string, offset: number): Readonly<{ source: string; to: number }> | null {
  for (const spec of INLINE_MARK_SPECS) {
    if (!source.startsWith(spec.open, offset)) continue
    const bodyFrom = offset + spec.open.length
    const closeFrom = source.indexOf(spec.close, bodyFrom)
    if (closeFrom <= bodyFrom || source.slice(bodyFrom, closeFrom).includes('\n')) continue
    const to = closeFrom + spec.close.length
    return Object.freeze({ source: source.slice(offset, to), to })
  }
  return null
}

function separateAdjacentStandardMarks(markdown: string): string {
  let normalized = ''
  let offset = 0
  let previousTokenWasMark = false
  while (offset < markdown.length) {
    const atLineStart = offset === 0 || markdown[offset - 1] === '\n'
    if (atLineStart) {
      const fenced = parseFencedCodeAt(markdown, offset)
      if (fenced !== null) {
        normalized += markdown.slice(offset, fenced.sourceSpan.to)
        offset = fenced.sourceSpan.to
        previousTokenWasMark = false
        continue
      }
      const unterminated = rawFencedCodeCandidateAt(markdown, offset)
      if (unterminated !== null) return normalized + unterminated.source
    }
    const codeEnd = inlineCodeEnd(markdown, offset)
    if (codeEnd !== null) {
      normalized += markdown.slice(offset, codeEnd)
      offset = codeEnd
      previousTokenWasMark = false
      continue
    }
    const mark = standardInlineMarkAt(markdown, offset)
    if (mark !== null) {
      if (previousTokenWasMark) normalized += INLINE_RENDER_BOUNDARY
      normalized += mark.source
      offset = mark.to
      previousTokenWasMark = true
      continue
    }
    normalized += markdown[offset] ?? ''
    offset += 1
    previousTokenWasMark = false
  }
  return normalized
}

/** Render-only Cherry compatibility. The returned value must never replace Markdown authority. */
export function normalizeMarkdownForCherry(markdown: string): string {
  return separateAdjacentStandardMarks(normalizeTaskListIndentation(normalizeRichInlineMarkdownForCherry(markdown)))
}
