export interface SourceSpan {
  readonly from: number
  readonly to: number
}

export type EditStrategy =
  | { readonly kind: 'direct'; readonly scope: 'block' | 'inline' | 'joined-blocks' }
  | { readonly editorId: string; readonly kind: 'semantic-editor' }
  | { readonly kind: 'raw-source' }
  | { readonly kind: 'read-only'; readonly reason: string }

interface ProjectionNodeBase {
  readonly codecId: string
  readonly editStrategy: EditStrategy
  readonly originalSource: string
  readonly projectionId: string
  readonly revision: number
  readonly sourceSpan: SourceSpan
}

export type ProjectionNode =
  | (ProjectionNodeBase & {
      readonly attributes: Readonly<Record<string, unknown>>
      readonly children: readonly ProjectionNode[]
      readonly kind: 'structured'
      readonly nodeType: string
    })
  | (ProjectionNodeBase & {
      readonly data: Readonly<Record<string, unknown>>
      readonly kind: 'semantic'
      readonly nodeType: string
    })
  | (ProjectionNodeBase & { readonly kind: 'rawInline' })
  | (ProjectionNodeBase & { readonly kind: 'rawBlock' })

export interface SafePatchUnit {
  readonly codecId: string
  readonly expectedSource: string
  readonly sourceSpan: SourceSpan
  readonly strategy: EditStrategy
  readonly structural: boolean
  readonly unitId: string
}

export type ValidationResult =
  | { readonly valid: true }
  | {
      readonly code: string
      readonly message: string
      readonly sourceSpan: SourceSpan | null
      readonly valid: false
    }

export interface ProjectionMapEntry {
  readonly codecId: string
  readonly originalSource: string
  readonly projectionId: string
  readonly safePatchUnit: SafePatchUnit
  readonly sourceSpan: SourceSpan
}

export interface ProjectionMap {
  readonly documentLength: number
  readonly entries: readonly ProjectionMapEntry[]
  readonly revision: number
}

export interface CodecMatch {
  readonly captures: Readonly<Record<string, string>>
  readonly originalSource: string
  readonly sourceSpan: SourceSpan
}

export interface CodecRecognitionContext {
  readonly markdown: string
  readonly revision: number
}

export interface CodecSerializationInput {
  readonly node: ProjectionNode
  readonly safePatchUnit: SafePatchUnit
}

export interface Codec {
  readonly id: string
  readonly precedence: number
  readonly scope: 'block' | 'inline'
  readonly project: (match: CodecMatch, revision: number) => ProjectionNode
  readonly recognize: (context: CodecRecognitionContext, offset: number) => CodecMatch | null
  readonly safePatchUnit: (node: ProjectionNode) => SafePatchUnit | null
  readonly serialize: (input: CodecSerializationInput) => string
  readonly validate: (source: string) => ValidationResult
}
