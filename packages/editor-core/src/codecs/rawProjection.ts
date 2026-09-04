import type { CommitAcknowledgement, DocumentSession } from '../core/documentSession'
import { CodecRegistry } from './codecRegistry'
import type { ProjectionNode, SourceSpan } from './contracts'

export type RawProjectionNode = Extract<ProjectionNode, { readonly kind: 'rawBlock' | 'rawInline' }>

export interface CreateRawProjectionInput {
  readonly kind: RawProjectionNode['kind']
  readonly markdown: string
  readonly projectionId: string
  readonly revision: number
  readonly sourceSpan: SourceSpan
}

export function createRawProjection(input: CreateRawProjectionInput): RawProjectionNode {
  const { from, to } = input.sourceSpan
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > input.markdown.length) {
    throw new RangeError('Raw projection span is outside the Markdown source.')
  }
  return Object.freeze({
    codecId: input.kind === 'rawInline' ? 'raw-inline' : 'raw-block',
    editStrategy: Object.freeze({ kind: 'raw-source' as const }),
    kind: input.kind,
    originalSource: input.markdown.slice(from, to),
    projectionId: input.projectionId,
    revision: input.revision,
    sourceSpan: Object.freeze({ from, to }),
  })
}

export type RawDraftResult =
  | { readonly kind: 'applied'; readonly acknowledgement: CommitAcknowledgement; readonly node: ProjectionNode }
  | { readonly kind: 'cancelled'; readonly node: RawProjectionNode }

export interface CreateRawSourceDraftInput {
  readonly node: RawProjectionNode
  readonly registry: CodecRegistry
  readonly session: DocumentSession
  readonly transactionId: string
}

export interface RawSourceDraft {
  readonly apply: () => RawDraftResult
  readonly cancel: () => RawDraftResult
  readonly dirty: () => boolean
  readonly source: () => string
  readonly update: (source: string) => void
}

export function createRawSourceDraft(input: CreateRawSourceDraftInput): RawSourceDraft {
  let draftSource = input.node.originalSource

  return {
    source: () => draftSource,
    dirty: () => draftSource !== input.node.originalSource,
    update: (source: string) => {
      draftSource = source
    },
    cancel: () => Object.freeze({ kind: 'cancelled' as const, node: input.node }),
    apply: () => {
      const acknowledgement = input.session.commitPatchPlan({
        baseRevision: input.node.revision,
        patches: [{
          codecId: input.node.codecId,
          expected: input.node.originalSource,
          from: input.node.sourceSpan.from,
          replacement: draftSource,
          to: input.node.sourceSpan.to,
        }],
        transactionId: input.transactionId,
      })
      const current = input.session.snapshot()
      const replacementSpan = {
        from: input.node.sourceSpan.from,
        to: input.node.sourceSpan.from + draftSource.length,
      }
      const context = { markdown: current.markdown, revision: current.revision }
      const recognized = input.node.kind === 'rawInline'
        ? input.registry.scanInline(context, replacementSpan)
        : input.registry.scanBlocks(context)
      const exactMatch = recognized.find((match) => (
        match.sourceSpan.from === replacementSpan.from && match.sourceSpan.to === replacementSpan.to
      ))
      const codec = exactMatch === undefined ? undefined : input.registry.get(exactMatch.codecId)
      const node = exactMatch === undefined || codec === undefined
        ? createRawProjection({
            kind: input.node.kind,
            markdown: current.markdown,
            projectionId: input.node.projectionId,
            revision: current.revision,
            sourceSpan: replacementSpan,
          })
        : codec.project(exactMatch, current.revision)
      return Object.freeze({ acknowledgement, kind: 'applied' as const, node })
    },
  }
}
