import { parseFencedCodeAt, serializeFencedCode } from './fencedCode'
import type {
  Codec,
  CodecMatch,
  ProjectionNode,
  SafePatchUnit,
  SourceSpan,
  ValidationResult,
} from './contracts'

export const MERMAID_DIAGRAM_TYPES = Object.freeze([
  'flowchart',
  'sequence',
  'state',
  'class',
  'pie',
  'gantt',
] as const)

export type MermaidDiagramType = (typeof MERMAID_DIAGRAM_TYPES)[number]
export type MermaidCommandId = `mermaid.${MermaidDiagramType}`

export interface MermaidDescriptor {
  readonly commandId: MermaidCommandId
  readonly diagramType: MermaidDiagramType
  readonly icon: string
  readonly labels: Readonly<{ en: string; ru: string; zh: string }>
}

export interface MermaidModel {
  readonly code: string
  readonly diagramType: MermaidDiagramType | null
  readonly source: string
  readonly sourceSpan: SourceSpan
}

export const MERMAID_DESCRIPTORS: readonly MermaidDescriptor[] = Object.freeze([
  Object.freeze({ commandId: 'mermaid.flowchart', diagramType: 'flowchart', icon: '◇', labels: Object.freeze({ en: 'Flowchart', ru: 'Блок-схема', zh: '流程图' }) }),
  Object.freeze({ commandId: 'mermaid.sequence', diagramType: 'sequence', icon: '⇄', labels: Object.freeze({ en: 'Sequence diagram', ru: 'Диаграмма последовательности', zh: '时序图' }) }),
  Object.freeze({ commandId: 'mermaid.state', diagramType: 'state', icon: '○', labels: Object.freeze({ en: 'State diagram', ru: 'Диаграмма состояний', zh: '状态图' }) }),
  Object.freeze({ commandId: 'mermaid.class', diagramType: 'class', icon: '□', labels: Object.freeze({ en: 'Class diagram', ru: 'Диаграмма классов', zh: '类图' }) }),
  Object.freeze({ commandId: 'mermaid.pie', diagramType: 'pie', icon: '◕', labels: Object.freeze({ en: 'Pie diagram', ru: 'Круговая диаграмма', zh: '饼图' }) }),
  Object.freeze({ commandId: 'mermaid.gantt', diagramType: 'gantt', icon: '▥', labels: Object.freeze({ en: 'Gantt diagram', ru: 'Диаграмма Ганта', zh: '甘特图' }) }),
])

const STARTER_CODE: Readonly<Record<MermaidDiagramType, string>> = Object.freeze({
  class: 'classDiagram\n  class Document\n  Document : +String markdown',
  flowchart: 'flowchart LR\n  Start([Start]) --> Finish([Finish])',
  gantt: 'gantt\n  title Example plan\n  dateFormat YYYY-MM-DD\n  section Work\n  Draft :2026-01-01, 2d',
  pie: 'pie title Example distribution\n  "One" : 60\n  "Two" : 40',
  sequence: 'sequenceDiagram\n  participant User\n  participant Editor\n  User->>Editor: Edit Markdown\n  Editor-->>User: Render preview',
  state: 'stateDiagram-v2\n  [*] --> Editing\n  Editing --> [*]',
})

export function mermaidDescriptor(commandId: string): MermaidDescriptor | null {
  return MERMAID_DESCRIPTORS.find((descriptor) => descriptor.commandId === commandId) ?? null
}

export function mermaidDiagramType(code: string): MermaidDiagramType | null {
  const firstLine = code.split(/\r?\n/u).find((line) => {
    const trimmed = line.trim()
    return trimmed.length > 0 && !trimmed.startsWith('%%')
  })?.trim() ?? ''
  if (/^(?:flowchart|graph)(?:\s|$)/iu.test(firstLine)) return 'flowchart'
  if (/^sequenceDiagram(?:\s|$)/iu.test(firstLine)) return 'sequence'
  if (/^stateDiagram(?:-v2)?(?:\s|$)/iu.test(firstLine)) return 'state'
  if (/^classDiagram(?:\s|$)/iu.test(firstLine)) return 'class'
  if (/^pie(?:\s|$)/iu.test(firstLine)) return 'pie'
  if (/^gantt(?:\s|$)/iu.test(firstLine)) return 'gantt'
  return null
}

export function parseMermaidAt(markdown: string, offset: number): MermaidModel | null {
  const fenced = parseFencedCodeAt(markdown, offset)
  if (fenced === null || fenced.language.toLowerCase() !== 'mermaid') return null
  const diagramType = mermaidDiagramType(fenced.code)
  return Object.freeze({
    code: fenced.code,
    diagramType,
    source: fenced.source,
    sourceSpan: fenced.sourceSpan,
  })
}

export function mermaidSource(code: string): string {
  if (code.trim().length === 0) throw new RangeError('Mermaid source must not be empty.')
  if (code.includes('\0')) throw new RangeError('Mermaid source cannot contain NUL.')
  return serializeFencedCode('mermaid', code)
}

export function mermaidStarterSource(commandId: MermaidCommandId): string {
  const descriptor = mermaidDescriptor(commandId)
  if (descriptor === null) throw new RangeError(`Unknown Mermaid command: ${commandId}.`)
  return mermaidSource(STARTER_CODE[descriptor.diagramType])
}

function matchForType(markdown: string, offset: number, diagramType: MermaidDiagramType): CodecMatch | null {
  const mermaid = parseMermaidAt(markdown, offset)
  if (mermaid === null || mermaid.diagramType !== diagramType) return null
  return Object.freeze({
    captures: Object.freeze({ code: mermaid.code, diagramType }),
    originalSource: mermaid.source,
    sourceSpan: mermaid.sourceSpan,
  })
}

function projectMermaid(match: CodecMatch, revision: number, diagramType: MermaidDiagramType): ProjectionNode {
  return Object.freeze({
    codecId: `mermaid-${diagramType}`,
    data: Object.freeze({ code: match.captures['code'] ?? '', diagramType }),
    editStrategy: Object.freeze({ editorId: 'mermaid-editor', kind: 'semantic-editor' as const }),
    kind: 'semantic' as const,
    nodeType: 'mermaid',
    originalSource: match.originalSource,
    projectionId: `mermaid-${diagramType}:${match.sourceSpan.from}:${match.sourceSpan.to}`,
    revision,
    sourceSpan: Object.freeze({ ...match.sourceSpan }),
  })
}

function safePatchUnit(node: ProjectionNode): SafePatchUnit {
  return Object.freeze({
    codecId: node.codecId,
    expectedSource: node.originalSource,
    sourceSpan: Object.freeze({ ...node.sourceSpan }),
    strategy: node.editStrategy,
    structural: true,
    unitId: node.projectionId,
  })
}

function validateMermaidType(source: string, diagramType: MermaidDiagramType): ValidationResult {
  const parsed = parseMermaidAt(source, 0)
  if (parsed === null || parsed.sourceSpan.to !== source.length || parsed.diagramType !== diagramType) {
    return Object.freeze({
      code: 'INVALID_MERMAID_SOURCE',
      message: `Source must be one complete Mermaid ${diagramType} diagram.`,
      sourceSpan: null,
      valid: false,
    })
  }
  return Object.freeze({ valid: true })
}

export function validateMermaidSource(commandId: MermaidCommandId, source: string): ValidationResult {
  const descriptor = mermaidDescriptor(commandId)
  return descriptor === null
    ? Object.freeze({ code: 'INVALID_MERMAID_COMMAND', message: `Unknown Mermaid command: ${commandId}.`, sourceSpan: null, valid: false })
    : validateMermaidType(source, descriptor.diagramType)
}

function mermaidCodec(diagramType: MermaidDiagramType, index: number): Codec {
  const codecId = `mermaid-${diagramType}`
  const definition: Codec = {
    id: codecId,
    precedence: 95 - index,
    project: (match, revision) => projectMermaid(match, revision, diagramType),
    recognize: (context, offset) => matchForType(context.markdown, offset, diagramType),
    safePatchUnit,
    scope: 'block' as const,
    serialize: ({ node }) => {
      if (node.kind !== 'semantic' || node.nodeType !== 'mermaid' || node.data['diagramType'] !== diagramType) {
        throw new TypeError(`${codecId} requires a matching semantic Mermaid projection node.`)
      }
      return mermaidSource(String(node.data['code'] ?? ''))
    },
    validate: (source) => validateMermaidType(source, diagramType),
  }
  return Object.freeze(definition)
}

export const mermaidCodecs: readonly Codec[] = Object.freeze(
  MERMAID_DIAGRAM_TYPES.map((diagramType, index) => mermaidCodec(diagramType, index)),
)
