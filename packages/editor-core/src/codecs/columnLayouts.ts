import type { Codec, CodecMatch, ProjectionNode, SafePatchUnit, SourceSpan, ValidationResult } from './contracts'

export type ColumnLayoutKind = 'multi-column' | 'two-column'
export type ColumnLayoutCommandId = 'layout.multi-column' | 'layout.two-column'

export interface ColumnLayoutModel {
  readonly columns: readonly string[]
  readonly kind: ColumnLayoutKind
  readonly source: string
  readonly sourceSpan: SourceSpan
  readonly title: string
}

const COLUMN_LAYOUT_PATTERN = /^:::[ \t]+(2cols|cols)(?:[ \t]+([^\r\n]*?))?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*:::[ \t]*(?=\r?\n|$)/u

function splitColumns(body: string): readonly string[] {
  return Object.freeze(body.split(/\r?\n[ \t]*::[ \t]*(?=\r?\n|$)/u).map((column) => column.trim()))
}

export function parseColumnLayoutAt(markdown: string, offset: number): ColumnLayoutModel | null {
  if (!Number.isInteger(offset) || offset < 0 || offset > markdown.length) {
    throw new RangeError('Column-layout recognition offset is outside the Markdown source.')
  }
  if (offset > 0 && markdown[offset - 1] !== '\n') return null
  const match = COLUMN_LAYOUT_PATTERN.exec(markdown.slice(offset))
  if (match === null) return null
  const source = match[0]
  return Object.freeze({
    columns: splitColumns(match[3] ?? ''),
    kind: match[1] === '2cols' ? 'two-column' : 'multi-column',
    source,
    sourceSpan: Object.freeze({ from: offset, to: offset + source.length }),
    title: match[2] ?? '',
  })
}

export function columnLayoutSource(input: Pick<ColumnLayoutModel, 'columns' | 'kind' | 'title'>): string {
  const columns = input.columns.map((column) => column.replace(/\r\n/gu, '\n').trim())
  const requiredCount = input.kind === 'two-column' ? 2 : 3
  if (columns.length < requiredCount || (input.kind === 'two-column' && columns.length !== 2)) {
    throw new RangeError(`${input.kind} requires ${input.kind === 'two-column' ? 'exactly two' : 'at least three'} columns.`)
  }
  if (columns.some((column) => column.length === 0 || column.includes('\0') || /(?:^|\n)[ \t]*:{2,3}[ \t]*(?:\n|$)/u.test(column))) {
    throw new RangeError('Each column must contain valid non-empty content without a container delimiter.')
  }
  const keyword = input.kind === 'two-column' ? '2cols' : 'cols'
  const title = input.title.trim()
  const header = title.length === 0 ? `::: ${keyword}` : `::: ${keyword} ${title}`
  return `${header}\n${columns.join('\n::\n')}\n:::`
}

export function columnLayoutStarterSource(commandId: ColumnLayoutCommandId): string {
  return commandId === 'layout.two-column'
    ? columnLayoutSource({ columns: ['First column', 'Second column'], kind: 'two-column', title: 'Columns' })
    : columnLayoutSource({ columns: ['First column', 'Second column', 'Third column'], kind: 'multi-column', title: 'Columns' })
}

export function validateColumnLayoutSource(commandId: ColumnLayoutCommandId, source: string): ValidationResult {
  const model = parseColumnLayoutAt(source, 0)
  const expectedKind: ColumnLayoutKind = commandId === 'layout.two-column' ? 'two-column' : 'multi-column'
  const valid = model !== null
    && model.sourceSpan.to === source.length
    && model.kind === expectedKind
    && model.columns.every((column) => column.length > 0)
    && (expectedKind === 'two-column' ? model.columns.length === 2 : model.columns.length >= 3)
  return valid
    ? Object.freeze({ valid: true })
    : Object.freeze({
        code: 'INVALID_COLUMN_LAYOUT_SOURCE',
        message: `Source must be one valid Cherry ${expectedKind === 'two-column' ? '2cols' : 'cols'} container.`,
        sourceSpan: null,
        valid: false,
      })
}

function codecFor(kind: ColumnLayoutKind): Codec {
  const codecId = `layout-${kind}`
  const definition: Codec = {
    id: codecId,
    precedence: kind === 'two-column' ? 74 : 73,
    project: (match, revision): ProjectionNode => Object.freeze({
      codecId,
      data: Object.freeze({
        columns: Object.freeze((match.captures['columns'] ?? '').split('\0')),
        kind,
        title: match.captures['title'] ?? '',
      }),
      editStrategy: Object.freeze({ editorId: 'column-layout-editor', kind: 'semantic-editor' as const }),
      kind: 'semantic' as const,
      nodeType: 'column-layout',
      originalSource: match.originalSource,
      projectionId: `${codecId}:${match.sourceSpan.from}:${match.sourceSpan.to}`,
      revision,
      sourceSpan: Object.freeze({ ...match.sourceSpan }),
    }),
    recognize: (context, offset): CodecMatch | null => {
      const model = parseColumnLayoutAt(context.markdown, offset)
      if (model === null || model.kind !== kind) return null
      return Object.freeze({
        captures: Object.freeze({ columns: model.columns.join('\0'), kind, title: model.title }),
        originalSource: model.source,
        sourceSpan: model.sourceSpan,
      })
    },
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
      if (node.kind !== 'semantic' || node.nodeType !== 'column-layout') {
        throw new TypeError(`${codecId} requires a semantic column-layout projection node.`)
      }
      const columns = node.data['columns']
      if (!Array.isArray(columns) || !columns.every((column) => typeof column === 'string')) {
        throw new TypeError(`${codecId} requires string column data.`)
      }
      return columnLayoutSource({ columns, kind, title: String(node.data['title'] ?? '') })
    },
    validate: (source): ValidationResult => validateColumnLayoutSource(
      kind === 'two-column' ? 'layout.two-column' : 'layout.multi-column',
      source,
    ),
  }
  return Object.freeze(definition)
}

export const columnLayoutCodecs: readonly Codec[] = Object.freeze([
  codecFor('two-column'),
  codecFor('multi-column'),
])
