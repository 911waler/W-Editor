import type { JSONContent } from '@tiptap/core'

import type { Codec, CodecMatch, ProjectionNode, SafePatchUnit, ValidationResult } from './contracts'
import { parseFencedCodeAt, rawFencedCodeCandidateAt } from './fencedCode'

export type RichInlineMarkCommandId = 'text.background' | 'text.color' | 'text.ruby' | 'text.size'

export interface RichInlineMarkSpec {
  readonly codecId: string
  readonly commandId: RichInlineMarkCommandId
  readonly mark: Readonly<{ attrs: Readonly<Record<string, string>>; type: string }>
  readonly precedence: number
  readonly valueName: 'annotation' | 'color' | 'size'
}

interface RecognizedRichMark {
  readonly body: string
  readonly bodyFrom: number
  readonly source: string
  readonly to: number
  readonly value: string
}

const COLOR_PATTERN = '(?:#[0-9a-zA-Z]{3,6}|[a-z]{3,20})'

export const RICH_INLINE_MARK_SPECS: readonly RichInlineMarkSpec[] = Object.freeze([
  Object.freeze({
    codecId: 'inline-background',
    commandId: 'text.background',
    mark: Object.freeze({ attrs: Object.freeze({ color: '' }), type: 'highlight' }),
    precedence: 95,
    valueName: 'color',
  }),
  Object.freeze({
    codecId: 'inline-color',
    commandId: 'text.color',
    mark: Object.freeze({ attrs: Object.freeze({ color: '' }), type: 'textStyle' }),
    precedence: 90,
    valueName: 'color',
  }),
  Object.freeze({
    codecId: 'inline-size',
    commandId: 'text.size',
    mark: Object.freeze({ attrs: Object.freeze({ fontSize: '' }), type: 'textStyle' }),
    precedence: 85,
    valueName: 'size',
  }),
  Object.freeze({
    codecId: 'inline-ruby',
    commandId: 'text.ruby',
    mark: Object.freeze({ attrs: Object.freeze({ annotation: '' }), type: 'ruby' }),
    precedence: 82,
    valueName: 'annotation',
  }),
])

export function richInlineMarkSpec(commandId: string): RichInlineMarkSpec | null {
  return RICH_INLINE_MARK_SPECS.find((spec) => spec.commandId === commandId) ?? null
}

function delimitedRichMark(
  source: string,
  offset: number,
  spec: RichInlineMarkSpec,
  opener: RegExp,
  close: string,
): RecognizedRichMark | null {
  const rest = source.slice(offset)
  const match = opener.exec(rest)
  if (match === null) return null
  const bodyFrom = offset + match[0].length
  const nested = recognizeRichInlineMark(source, bodyFrom)
  const closeFrom = nested !== null && source.startsWith(close, nested.to)
    ? nested.to
    : source.indexOf(close, bodyFrom)
  if (closeFrom <= bodyFrom || source.slice(bodyFrom, closeFrom).includes('\n')) return null
  const to = closeFrom + close.length
  return Object.freeze({
    body: source.slice(bodyFrom, closeFrom),
    bodyFrom,
    source: source.slice(offset, to),
    to,
    value: match[1] ?? '',
  })
}

function recognize(source: string, offset: number, spec: RichInlineMarkSpec): RecognizedRichMark | null {
  switch (spec.commandId) {
    case 'text.background':
      return delimitedRichMark(source, offset, spec, new RegExp(`^!!!(${COLOR_PATTERN}) `, 'u'), '!!!')
    case 'text.color':
      return delimitedRichMark(source, offset, spec, new RegExp(`^!!(${COLOR_PATTERN}) `, 'u'), '!!')
    case 'text.size':
      return delimitedRichMark(source, offset, spec, /^!([0-9]{1,2}) /u, '!')
    case 'text.ruby':
      {
        const rest = source.slice(offset)
        const match = /^\{ ([^|{}\n]+?) \| ([^{}\n]+?) \}/u.exec(rest)
      if (match !== null) {
        const matchedSource = match[0]
        return Object.freeze({
          body: match[1] ?? '',
          bodyFrom: offset + 2,
          source: matchedSource,
          to: offset + matchedSource.length,
          value: match[2] ?? '',
        })
      }
      return null
      }
  }
}

export function recognizeRichInlineMark(source: string, offset: number): Readonly<{
  body: string
  source: string
  spec: RichInlineMarkSpec
  to: number
  value: string
}> | null {
  for (const spec of RICH_INLINE_MARK_SPECS) {
    const match = recognize(source, offset, spec)
    if (match !== null) return Object.freeze({ ...match, spec })
  }
  return null
}

export function richInlineMarkAtSelection(
  source: string,
  selection: Readonly<{ from: number; to: number }>,
): Readonly<{ commandId: RichInlineMarkCommandId; value: string }> | null {
  for (let offset = 0; offset <= selection.from; offset += 1) {
    const match = recognizeRichInlineMark(source, offset)
    if (match === null) continue
    const bodyFrom = offset + match.source.indexOf(match.body)
    if (bodyFrom === selection.from && bodyFrom + match.body.length === selection.to) {
      return Object.freeze({ commandId: match.spec.commandId, value: match.value })
    }
  }
  return null
}

export function formatRichInlineMark(commandId: RichInlineMarkCommandId, body: string, value: string): string {
  switch (commandId) {
    case 'text.background': return `!!!${value} ${body}!!!`
    case 'text.color': return `!!${value} ${body}!!`
    case 'text.ruby': return `{ ${body} | ${value} }`
    case 'text.size': return `!${value} ${body}!`
  }
}

const CANONICAL_RICH_MARK_ORDER = Object.freeze([
  'text.size',
  'text.background',
  'text.color',
] as const satisfies readonly RichInlineMarkCommandId[])
const RICH_RENDER_BOUNDARY = '<!--w-editor-rich-boundary-->'

function escapeRichInlineHtmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function canonicalizeRecognizedRichMark(
  match: NonNullable<ReturnType<typeof recognizeRichInlineMark>>,
  rubyNeedsSemanticBoundary: boolean,
): string {
  if (match.spec.commandId === 'text.ruby' && rubyNeedsSemanticBoundary) {
    return `<ruby>${escapeRichInlineHtmlText(match.body)}<rt>${escapeRichInlineHtmlText(match.value)}</rt></ruby>`
  }
  if (!CANONICAL_RICH_MARK_ORDER.includes(match.spec.commandId as (typeof CANONICAL_RICH_MARK_ORDER)[number])) {
    return match.source
  }
  const chain: Array<Readonly<{ commandId: RichInlineMarkCommandId; value: string }>> = []
  let current = match
  let body = current.body
  while (CANONICAL_RICH_MARK_ORDER.includes(current.spec.commandId as (typeof CANONICAL_RICH_MARK_ORDER)[number])) {
    if (chain.some(({ commandId }) => commandId === current.spec.commandId)) return match.source
    chain.push(Object.freeze({ commandId: current.spec.commandId, value: current.value }))
    const nested = recognizeRichInlineMark(current.body, 0)
    if (nested === null || nested.to !== current.body.length) {
      body = current.body
      break
    }
    current = nested
  }
  const ordered = [...chain].sort((left, right) => (
    CANONICAL_RICH_MARK_ORDER.indexOf(left.commandId as (typeof CANONICAL_RICH_MARK_ORDER)[number])
    - CANONICAL_RICH_MARK_ORDER.indexOf(right.commandId as (typeof CANONICAL_RICH_MARK_ORDER)[number])
  ))
  for (const entry of ordered.reverse()) body = formatRichInlineMark(entry.commandId, body, entry.value)
  return body
}

function isEscaped(source: string, offset: number): boolean {
  let backslashes = 0
  for (let cursor = offset - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) backslashes += 1
  return backslashes % 2 === 1
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

export function normalizeRichInlineMarkdownForCherry(markdown: string): string {
  let normalized = ''
  let offset = 0
  let previousTokenWasRich = false
  while (offset < markdown.length) {
    const atLineStart = offset === 0 || markdown[offset - 1] === '\n'
    if (atLineStart) {
      const fenced = parseFencedCodeAt(markdown, offset)
      if (fenced !== null) {
        normalized += markdown.slice(offset, fenced.sourceSpan.to)
        offset = fenced.sourceSpan.to
        previousTokenWasRich = false
        continue
      }
      const unterminated = rawFencedCodeCandidateAt(markdown, offset)
      if (unterminated !== null) return normalized + unterminated.source
    }
    const codeEnd = inlineCodeEnd(markdown, offset)
    if (codeEnd !== null) {
      normalized += markdown.slice(offset, codeEnd)
      offset = codeEnd
      previousTokenWasRich = false
      continue
    }
    if (!isEscaped(markdown, offset)) {
      const rich = recognizeRichInlineMark(markdown, offset)
      if (rich !== null) {
        if (previousTokenWasRich) normalized += RICH_RENDER_BOUNDARY
        const previousCharacter = markdown[offset - 1] ?? '\n'
        const rubyNeedsSemanticBoundary = rich.spec.commandId === 'text.ruby' && !/\s/u.test(previousCharacter)
        normalized += canonicalizeRecognizedRichMark(rich, rubyNeedsSemanticBoundary)
        offset = rich.to
        previousTokenWasRich = true
        continue
      }
    }
    normalized += markdown[offset] ?? ''
    offset += 1
    previousTokenWasRich = false
  }
  return normalized
}

export function richMarkJSON(spec: RichInlineMarkSpec, value: string): NonNullable<JSONContent['marks']>[number] {
  if (spec.commandId === 'text.ruby') return Object.freeze({ attrs: { annotation: value }, type: 'ruby' })
  if (spec.commandId === 'text.size') return Object.freeze({ attrs: { fontSize: `${value}px` }, type: 'textStyle' })
  return Object.freeze({ attrs: { color: value }, type: spec.mark.type })
}

function codecMatch(source: string, offset: number, spec: RichInlineMarkSpec): CodecMatch | null {
  const match = recognize(source, offset, spec)
  if (match === null) return null
  return Object.freeze({
    captures: Object.freeze({ body: match.body, value: match.value }),
    originalSource: match.source,
    sourceSpan: Object.freeze({ from: offset, to: match.to }),
  })
}

function projectMatch(spec: RichInlineMarkSpec, match: CodecMatch, revision: number): ProjectionNode {
  return Object.freeze({
    attributes: Object.freeze({
      body: match.captures['body'] ?? '',
      value: match.captures['value'] ?? '',
    }),
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

function codec(spec: RichInlineMarkSpec): Codec {
  const definition: Codec = {
    id: spec.codecId,
    precedence: spec.precedence,
    project: (match, revision) => projectMatch(spec, match, revision),
    recognize: (context, offset) => codecMatch(context.markdown, offset, spec),
    safePatchUnit: safeUnit,
    scope: 'inline' as const,
    serialize: ({ node }) => formatRichInlineMark(
      spec.commandId,
      node.kind === 'structured' ? String(node.attributes['body'] ?? '') : '',
      node.kind === 'structured' ? String(node.attributes['value'] ?? '') : '',
    ),
    validate: (source): ValidationResult => codecMatch(source, 0, spec)?.originalSource === source
      ? Object.freeze({ valid: true })
      : Object.freeze({
          code: 'INVALID_RICH_INLINE_MARK',
          message: `Invalid ${spec.commandId} source.`,
          sourceSpan: null,
          valid: false,
        }),
  }
  return Object.freeze(definition)
}

export const richInlineMarkCodecs: readonly Codec[] = Object.freeze(RICH_INLINE_MARK_SPECS.map(codec))
