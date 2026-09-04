import type { Codec, CodecMatch, ProjectionNode, SafePatchUnit, SourceSpan, ValidationResult } from './contracts'

export const ALIGNMENT_VALUES = Object.freeze(['left', 'center', 'right', 'justify'] as const)
export type AlignmentValue = (typeof ALIGNMENT_VALUES)[number]
export type AlignmentCommandId = `align.${AlignmentValue}`

export interface AlignmentModel {
  readonly alignment: AlignmentValue
  readonly body: string
  readonly source: string
  readonly sourceSpan: SourceSpan
}

const ALIGNMENT_PATTERN = /^:::[ \t]+(left|center|right|justify)[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*:::[ \t]*(?=\r?\n|$)/u
const INCOMPATIBLE_LINE = /^(?:[ \t]*(?:```|~~~|:::|\+\+\+|\$\$|\[\[toc\]\]|---[ \t]*$|[-*+][ \t]+|[0-9]+\.[ \t]+|\|))/u

export function alignmentValue(commandId: string): AlignmentValue | null {
  const value = commandId.startsWith('align.') ? commandId.slice('align.'.length) : ''
  return ALIGNMENT_VALUES.includes(value as AlignmentValue) ? value as AlignmentValue : null
}

export function isCompatibleAlignmentBody(body: string): boolean {
  return body.trim().length > 0
    && !body.includes('\0')
    && body.split(/\r?\n/u).every((line) => line.trim().length === 0 || !INCOMPATIBLE_LINE.test(line))
}

export function parseAlignmentAt(markdown: string, offset: number): AlignmentModel | null {
  if (!Number.isInteger(offset) || offset < 0 || offset > markdown.length) {
    throw new RangeError('Alignment recognition offset is outside the Markdown source.')
  }
  if (offset > 0 && markdown[offset - 1] !== '\n') return null
  const match = ALIGNMENT_PATTERN.exec(markdown.slice(offset))
  if (match === null) return null
  const source = match[0]
  return Object.freeze({
    alignment: match[1] as AlignmentValue,
    body: match[2] ?? '',
    source,
    sourceSpan: Object.freeze({ from: offset, to: offset + source.length }),
  })
}

export function alignmentSource(alignment: AlignmentValue, body: string): string {
  if (!ALIGNMENT_VALUES.includes(alignment)) throw new RangeError(`Unsupported alignment: ${String(alignment)}.`)
  const normalizedBody = body.replace(/\r\n/gu, '\n').trim()
  if (!isCompatibleAlignmentBody(normalizedBody)) {
    throw new RangeError('Alignment accepts only non-empty paragraph and H1-H5 block ranges.')
  }
  return `::: ${alignment}\n${normalizedBody}\n:::`
}

function matchAlignment(markdown: string, offset: number, alignment: AlignmentValue): CodecMatch | null {
  const model = parseAlignmentAt(markdown, offset)
  if (model === null || model.alignment !== alignment) return null
  return Object.freeze({
    captures: Object.freeze({ alignment, body: model.body }),
    originalSource: model.source,
    sourceSpan: model.sourceSpan,
  })
}

function alignmentCodec(alignment: AlignmentValue, index: number): Codec {
  const codecId = `alignment-${alignment}`
  const definition: Codec = {
    id: codecId,
    precedence: 75 - index,
    project: (match, revision): ProjectionNode => Object.freeze({
      attributes: Object.freeze({ alignment, body: match.captures['body'] ?? '' }),
      children: Object.freeze([]),
      codecId,
      editStrategy: Object.freeze({ kind: 'direct' as const, scope: 'joined-blocks' as const }),
      kind: 'structured' as const,
      nodeType: 'alignment',
      originalSource: match.originalSource,
      projectionId: `${codecId}:${match.sourceSpan.from}:${match.sourceSpan.to}`,
      revision,
      sourceSpan: Object.freeze({ ...match.sourceSpan }),
    }),
    recognize: (context, offset) => matchAlignment(context.markdown, offset, alignment),
    safePatchUnit: (node): SafePatchUnit => Object.freeze({
      codecId,
      expectedSource: node.originalSource,
      sourceSpan: Object.freeze({ ...node.sourceSpan }),
      strategy: node.editStrategy,
      structural: true,
      unitId: node.projectionId,
    }),
    scope: 'block',
    serialize: ({ node }) => {
      if (node.kind !== 'structured' || node.nodeType !== 'alignment') {
        throw new TypeError(`${codecId} requires a structured alignment projection node.`)
      }
      return alignmentSource(alignment, String(node.attributes['body'] ?? ''))
    },
    validate: (source): ValidationResult => {
      const parsed = parseAlignmentAt(source, 0)
      return parsed !== null
        && parsed.sourceSpan.to === source.length
        && parsed.alignment === alignment
        && isCompatibleAlignmentBody(parsed.body)
        ? Object.freeze({ valid: true })
        : Object.freeze({
            code: 'INVALID_ALIGNMENT_SOURCE',
            message: `Source must be one compatible Cherry ${alignment} alignment container.`,
            sourceSpan: null,
            valid: false,
          })
    },
  }
  return Object.freeze(definition)
}

export const alignmentCodecs: readonly Codec[] = Object.freeze(
  ALIGNMENT_VALUES.map((alignment, index) => alignmentCodec(alignment, index)),
)
