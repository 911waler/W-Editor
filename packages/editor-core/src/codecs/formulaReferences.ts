import { isFormulaId, parseBlockFormulaAt, parseInlineFormulaAt } from './formulas'
import { parseFencedCodeAt, rawFencedCodeCandidateAt } from './fencedCode'
import { projectOrdinaryMarkdown } from './ordinaryBlocks'

export interface FormulaReferenceCandidate {
  readonly from: number
  readonly to: number
  readonly content: string
  readonly number: number
  readonly formulaId: string | null
}

export function formulaReferenceMarkdown(targetId: string): string {
  if (!isFormulaId(targetId)) throw new RangeError('Invalid formula reference identity.')
  return `[公式](#wformula-${targetId})`
}

export function parseFormulaReferenceAt(source: string, offset: number): { targetId: string; to: number } | null {
  const match = /^\[公式\]\(#wformula-([A-Za-z0-9_-]{1,128})\)/u.exec(source.slice(offset))
  return match ? { targetId: match[1]!, to: offset + match[0].length } : null
}

// Scan in source order: a literal opener in code or TeX must not consume the
// rest of the document as HTML, while actual opaque HTML owns its whole body.
function opaqueHtmlRanges(markdown: string): readonly { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = []
  let offset = 0
  while (offset < markdown.length) {
    if (offset === 0 || markdown[offset - 1] === '\n') {
      const fence = parseFencedCodeAt(markdown, offset) ?? rawFencedCodeCandidateAt(markdown, offset)
      if (fence) { offset = 'sourceSpan' in fence ? fence.sourceSpan.to : fence.to; continue }
      const indented = /^(?: {4}| {0,3}\t)[^\n]*/u.exec(markdown.slice(offset))
      if (indented) { offset += indented[0].length; continue }
      const formula = parseBlockFormulaAt(markdown, offset)
      if (formula) { offset = formula.to; continue }
    }
    if (markdown[offset] === '\\') { offset += 2; continue }
    if (markdown[offset] === '`') {
      const opener = /^`+/u.exec(markdown.slice(offset))![0]
      const endOfParagraph = /\r?\n[ \t]*\r?\n/u.exec(markdown.slice(offset))
      const boundary = endOfParagraph ? offset + endOfParagraph.index : markdown.length
      const runs = /`+/gu
      runs.lastIndex = offset + opener.length
      let closing: RegExpExecArray | null
      let codeTo = offset + opener.length
      while ((closing = runs.exec(markdown)) && closing.index < boundary) {
        if (closing[0].length === opener.length) { codeTo = closing.index + opener.length; break }
      }
      offset = codeTo
      continue
    }
    const inline = markdown[offset] === '$' ? parseInlineFormulaAt(markdown, offset) : null
    if (inline) { offset = inline.to; continue }
    const opaque = markdown[offset] === '<'
      ? /^(?:<!--[\s\S]*?(?:-->|$)|<(script|style|pre|textarea)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$))/iu.exec(markdown.slice(offset))
      : null
    if (opaque) {
      ranges.push({ from: offset, to: offset + opaque[0].length })
      offset += opaque[0].length
      continue
    }
    offset += 1
  }
  return ranges
}

export function formulaReferenceCandidates(markdown: string): readonly FormulaReferenceCandidate[] {
  const projection = projectOrdinaryMarkdown({ documentId: 'formula-inventory', markdown, revision: 0 })
  const opaqueRanges = opaqueHtmlRanges(markdown)
  return Object.freeze((projection.content.content ?? []).filter(node => node.type === 'formulaBlock')
    .filter(node => !opaqueRanges.some(range => Number(node.attrs?.['sourceFrom']) >= range.from && Number(node.attrs?.['sourceFrom']) < range.to))
    .map((node, index) => Object.freeze({
    from: Number(node.attrs?.['sourceFrom']), to: Number(node.attrs?.['sourceTo']),
    content: String(node.attrs?.['content'] ?? ''), number: index + 1,
    formulaId: isFormulaId(node.attrs?.['formulaId']) ? node.attrs['formulaId'] : null,
  })))
}
