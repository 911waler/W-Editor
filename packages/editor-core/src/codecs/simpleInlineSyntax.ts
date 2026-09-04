import type { JSONContent } from '@tiptap/core'

import type { Codec, CodecMatch, ProjectionNode, SafePatchUnit, ValidationResult } from './contracts'

export type SimpleInlineCommandId = 'insert.inline-code' | 'insert.link'

export interface SimpleInlineSpec {
  readonly codecId: 'hard-break' | 'inline-code' | 'link'
  readonly commandId: 'insert.hard-break' | SimpleInlineCommandId
  readonly precedence: number
}

export const SIMPLE_INLINE_SPECS: readonly SimpleInlineSpec[] = Object.freeze([
  Object.freeze({ codecId: 'link', commandId: 'insert.link', precedence: 88 }),
  Object.freeze({ codecId: 'inline-code', commandId: 'insert.inline-code', precedence: 84 }),
  Object.freeze({ codecId: 'hard-break', commandId: 'insert.hard-break', precedence: 40 }),
])

export function simpleInlineSpec(commandId: string): SimpleInlineSpec | null {
  return SIMPLE_INLINE_SPECS.find((spec) => spec.commandId === commandId) ?? null
}

export function recognizeSimpleInline(source: string, offset: number): Readonly<{
  attrs: Readonly<Record<string, string>>
  body: string
  source: string
  spec: SimpleInlineSpec
  to: number
}> | null {
  const rest = source.slice(offset)
  const link = /^\[([^\]\n]+)\]\(([^)\s\n]+)\)/u.exec(rest)
  if (link !== null) {
    return Object.freeze({
      attrs: Object.freeze({ href: link[2] ?? '' }),
      body: link[1] ?? '',
      source: link[0],
      spec: SIMPLE_INLINE_SPECS[0] as SimpleInlineSpec,
      to: offset + link[0].length,
    })
  }
  const code = /^`([^`\n]+?)`/u.exec(rest)
  if (code !== null) {
    return Object.freeze({
      attrs: Object.freeze({}),
      body: code[1] ?? '',
      source: code[0],
      spec: SIMPLE_INLINE_SPECS[1] as SimpleInlineSpec,
      to: offset + code[0].length,
    })
  }
  if (rest.startsWith('  \n')) {
    return Object.freeze({
      attrs: Object.freeze({}),
      body: '',
      source: '  \n',
      spec: SIMPLE_INLINE_SPECS[2] as SimpleInlineSpec,
      to: offset + 3,
    })
  }
  return null
}

export function simpleInlineMarkJSON(match: NonNullable<ReturnType<typeof recognizeSimpleInline>>): NonNullable<JSONContent['marks']>[number] {
  return match.spec.commandId === 'insert.link'
    ? Object.freeze({ attrs: { href: match.attrs['href'] ?? '' }, type: 'link' })
    : Object.freeze({ type: 'code' })
}

function codecMatch(source: string, offset: number, spec: SimpleInlineSpec): CodecMatch | null {
  const match = recognizeSimpleInline(source, offset)
  if (match?.spec.commandId !== spec.commandId) return null
  return Object.freeze({
    captures: Object.freeze({ body: match.body, ...match.attrs }),
    originalSource: match.source,
    sourceSpan: Object.freeze({ from: offset, to: match.to }),
  })
}

function projectMatch(spec: SimpleInlineSpec, match: CodecMatch, revision: number): ProjectionNode {
  return Object.freeze({
    attributes: Object.freeze({ body: match.captures['body'] ?? '', ...match.captures }),
    children: Object.freeze([]),
    codecId: spec.codecId,
    editStrategy: Object.freeze({ kind: 'direct' as const, scope: 'inline' as const }),
    kind: 'structured' as const,
    nodeType: spec.codecId,
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

function codec(spec: SimpleInlineSpec): Codec {
  const definition: Codec = {
    id: spec.codecId,
    precedence: spec.precedence,
    project: (match, revision) => projectMatch(spec, match, revision),
    recognize: (context, offset) => codecMatch(context.markdown, offset, spec),
    safePatchUnit: safeUnit,
    scope: 'inline',
    serialize: ({ node }) => node.originalSource,
    validate: (source): ValidationResult => codecMatch(source, 0, spec)?.originalSource === source
      ? Object.freeze({ valid: true })
      : Object.freeze({ code: 'INVALID_SIMPLE_INLINE', message: `Invalid ${spec.commandId} source.`, sourceSpan: null, valid: false }),
  }
  return Object.freeze(definition)
}

export const simpleInlineCodecs: readonly Codec[] = Object.freeze(SIMPLE_INLINE_SPECS.map(codec))
