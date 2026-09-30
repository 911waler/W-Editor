import type { JSONContent } from '@tiptap/core'

import type { Codec, CodecMatch, ProjectionNode, SafePatchUnit, ValidationResult } from './contracts'
import { parseReferenceAt } from './references'
import { parseInlineImageAt } from './images'
import { parseInlineFormulaAt } from './formulas'
import { recognizeRichInlineMark, richMarkJSON } from './richInlineMarks'
import { recognizeSimpleInline, simpleInlineMarkJSON } from './simpleInlineSyntax'

export type InlineMarkCommandId =
  | 'text.bold'
  | 'text.italic'
  | 'text.strike'
  | 'text.subscript'
  | 'text.superscript'
  | 'text.underline'

export interface InlineMarkSpec {
  readonly close: string
  readonly codecId: string
  readonly commandId: InlineMarkCommandId
  readonly markType: 'bold' | 'italic' | 'strike' | 'subscript' | 'superscript' | 'underline'
  readonly open: string
  readonly precedence: number
}

export const INLINE_MARK_SPECS: readonly InlineMarkSpec[] = Object.freeze([
  Object.freeze({ close: '**', codecId: 'inline-bold', commandId: 'text.bold', markType: 'bold', open: '**', precedence: 80 }),
  Object.freeze({ close: '~~', codecId: 'inline-strike', commandId: 'text.strike', markType: 'strike', open: '~~', precedence: 75 }),
  Object.freeze({ close: '++', codecId: 'inline-underline', commandId: 'text.underline', markType: 'underline', open: '++', precedence: 70 }),
  Object.freeze({ close: '*', codecId: 'inline-italic', commandId: 'text.italic', markType: 'italic', open: '*', precedence: 60 }),
  Object.freeze({ close: '~', codecId: 'inline-subscript', commandId: 'text.subscript', markType: 'subscript', open: '~', precedence: 55 }),
  Object.freeze({ close: '^', codecId: 'inline-superscript', commandId: 'text.superscript', markType: 'superscript', open: '^', precedence: 50 }),
])

export function inlineMarkSpec(commandId: string): InlineMarkSpec | null {
  return INLINE_MARK_SPECS.find((spec) => spec.commandId === commandId) ?? null
}

function recognizeDelimited(markdown: string, offset: number, spec: InlineMarkSpec): CodecMatch | null {
  if (!markdown.startsWith(spec.open, offset)) return null
  const bodyFrom = offset + spec.open.length
  const closeFrom = markdown.indexOf(spec.close, bodyFrom)
  if (closeFrom <= bodyFrom || markdown.slice(bodyFrom, closeFrom).includes('\n')) return null
  const to = closeFrom + spec.close.length
  return Object.freeze({
    captures: Object.freeze({ body: markdown.slice(bodyFrom, closeFrom), markType: spec.markType }),
    originalSource: markdown.slice(offset, to),
    sourceSpan: Object.freeze({ from: offset, to }),
  })
}

function projectMatch(spec: InlineMarkSpec, match: CodecMatch, revision: number): ProjectionNode {
  return Object.freeze({
    attributes: Object.freeze({ body: match.captures['body'] ?? '', markType: spec.markType }),
    children: Object.freeze([]),
    codecId: spec.codecId,
    editStrategy: Object.freeze({ kind: 'direct' as const, scope: 'inline' as const }),
    kind: 'structured' as const,
    nodeType: 'text-mark',
    originalSource: match.originalSource,
    projectionId: `${spec.codecId}:${match.sourceSpan.from}:${match.sourceSpan.to}`,
    revision,
    sourceSpan: Object.freeze({ ...match.sourceSpan }),
  })
}

function safeUnit(node: ProjectionNode): SafePatchUnit {
  return Object.freeze({
    codecId: node.codecId,
    expectedSource: node.originalSource,
    sourceSpan: Object.freeze({ ...node.sourceSpan }),
    strategy: node.editStrategy,
    structural: false,
    unitId: node.projectionId,
  })
}

function codec(spec: InlineMarkSpec): Codec {
  const definition: Codec = {
    id: spec.codecId,
    precedence: spec.precedence,
    project: (match, revision) => projectMatch(spec, match, revision),
    recognize: (context, offset) => recognizeDelimited(context.markdown, offset, spec),
    safePatchUnit: safeUnit,
    scope: 'inline' as const,
    serialize: ({ node }) => `${spec.open}${node.kind === 'structured' ? String(node.attributes['body'] ?? '') : ''}${spec.close}`,
    validate: (source): ValidationResult => recognizeDelimited(source, 0, spec)?.originalSource === source
      ? Object.freeze({ valid: true })
      : Object.freeze({ code: 'INVALID_INLINE_MARK', message: `Invalid ${spec.commandId} source.`, sourceSpan: null, valid: false }),
  }
  return Object.freeze(definition)
}

export const inlineMarkCodecs: readonly Codec[] = Object.freeze(INLINE_MARK_SPECS.map(codec))

function sameMarks(left: readonly JSONMark[] | undefined, right: readonly JSONMark[] | undefined): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? [])
}

type JSONMark = NonNullable<JSONContent['marks']>[number]

function appendText(content: JSONContent[], text: string, marks: readonly JSONMark[] = []): void {
  if (text.length === 0) return
  const previous = content.at(-1)
  if (previous?.type === 'text' && sameMarks(previous.marks, marks)) {
    content[content.length - 1] = Object.freeze({ ...previous, text: `${previous.text ?? ''}${text}` })
    return
  }
  content.push(Object.freeze({ ...(marks.length === 0 ? {} : { marks: [...marks] }), text, type: 'text' }))
}

function parseRange(source: string, inheritedMarks: readonly JSONMark[] = []): JSONContent[] {
  if (inheritedMarks.some((mark) => mark.type === 'code')) {
    return [{ type: 'text', text: source, marks: [...inheritedMarks] }]
  }
  const content: JSONContent[] = []
  let plain = ''
  let offset = 0
  const flushPlain = (): void => {
    appendText(content, plain, inheritedMarks)
    plain = ''
  }
  while (offset < source.length) {
    if (source[offset] === '\\' && source[offset + 1] === '[') { plain += source.slice(offset, offset + 2); offset += 2; continue }
    const reference = inheritedMarks.some(mark => mark.type === 'link') ? null : parseReferenceAt(source, offset)
    if (reference) {
      flushPlain()
      content.push({ type: 'citation', attrs: { id: reference.id, number: reference.number, text: reference.text } })
      offset = reference.to
      continue
    }
    const image = parseInlineImageAt(source, offset)
    if (image !== null) {
      flushPlain()
      content.push({ type: 'inlineImage', attrs: {
        name: image.name, url: image.url, source: image.source,
        width: image.width, height: image.height,
      }, ...(inheritedMarks.length === 0 ? {} : { marks: [...inheritedMarks] }) })
      offset = image.sourceSpan.to
      continue
    }
    const formula = parseInlineFormulaAt(source, offset)
    if (formula !== null) {
      flushPlain()
      content.push(Object.freeze({
        attrs: Object.freeze({
          content: formula.content,
          formulaMode: 'inline',
          source: formula.source,
        }),
        type: 'inlineFormula',
      }))
      offset = formula.to
      continue
    }
    const simpleMatch = recognizeSimpleInline(source, offset)
    if (simpleMatch !== null && simpleMatch.spec.commandId !== 'insert.hard-break') {
      flushPlain()
      const nested = parseRange(
        simpleMatch.body,
        Object.freeze([...inheritedMarks, simpleInlineMarkJSON(simpleMatch)]),
      )
      content.push(...nested)
      offset = simpleMatch.to
      continue
    }
    const richMatch = recognizeRichInlineMark(source, offset)
    if (richMatch !== null) {
      flushPlain()
      const nested = parseRange(
        richMatch.body,
        Object.freeze([...inheritedMarks, richMarkJSON(richMatch.spec, richMatch.value)]),
      )
      content.push(...nested)
      offset = richMatch.to
      continue
    }
    const match = INLINE_MARK_SPECS
      .map((spec) => ({ match: recognizeDelimited(source, offset, spec), spec }))
      .find((candidate) => candidate.match !== null)
    if (match?.match === null || match === undefined) {
      if (source.startsWith('@@', offset)) {
        flushPlain()
        const closing = source.indexOf('@@', offset + 2)
        const to = closing === -1 ? source.length : closing + 2
        content.push(Object.freeze({
          attrs: Object.freeze({ source: source.slice(offset, to) }),
          type: 'rawInline',
        }))
        offset = to
        continue
      }
      plain += source[offset] ?? ''
      offset += 1
      continue
    }
    flushPlain()
    const body = match.match.captures['body'] ?? ''
    const nested = parseRange(body, Object.freeze([...inheritedMarks, Object.freeze({ type: match.spec.markType })]))
    content.push(...nested)
    offset = match.match.sourceSpan.to
  }
  flushPlain()
  return content
}

export function parseInlineMarkdown(source: string): readonly JSONContent[] {
  return Object.freeze(parseRange(source))
}
