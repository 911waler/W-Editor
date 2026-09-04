import { describe, expect, expectTypeOf, it } from 'vitest'

import type {
  Codec,
  CodecMatch,
  EditStrategy,
  ProjectionMap,
  ProjectionNode,
  SafePatchUnit,
  SourceSpan,
  ValidationResult,
} from '../../src/codecs/contracts'

function projectionKind(node: ProjectionNode): string {
  switch (node.kind) {
    case 'rawBlock':
    case 'rawInline':
      return node.kind
    case 'semantic':
    case 'structured':
      return node.nodeType
    default: {
      const exhaustive: never = node
      return exhaustive
    }
  }
}

function strategyKind(strategy: EditStrategy): string {
  switch (strategy.kind) {
    case 'direct':
      return strategy.scope
    case 'raw-source':
      return strategy.kind
    case 'read-only':
      return strategy.reason
    case 'semantic-editor':
      return strategy.editorId
    default: {
      const exhaustive: never = strategy
      return exhaustive
    }
  }
}

function validationMessage(result: ValidationResult): string {
  if (result.valid) {
    return 'valid'
  }
  return `${result.code}:${result.message}`
}

describe('span-aware codec contracts', () => {
  it('retains exhaustive discriminants and exact span relationships', () => {
    const sourceSpan = { from: 2, to: 8 } satisfies SourceSpan
    const strategy = { kind: 'direct', scope: 'inline' } satisfies EditStrategy
    const safePatchUnit = {
      codecId: 'emphasis',
      expectedSource: '*text*',
      sourceSpan,
      strategy,
      structural: false,
      unitId: 'unit-1',
    } satisfies SafePatchUnit
    const node = {
      attributes: {},
      children: [],
      codecId: 'emphasis',
      editStrategy: strategy,
      kind: 'structured',
      nodeType: 'paragraph',
      originalSource: '*text*',
      projectionId: 'projection-1',
      revision: 3,
      sourceSpan,
    } satisfies ProjectionNode
    const map = {
      documentLength: 8,
      entries: [{
        codecId: node.codecId,
        originalSource: node.originalSource,
        projectionId: node.projectionId,
        safePatchUnit,
        sourceSpan,
      }],
      revision: node.revision,
    } satisfies ProjectionMap

    expect(projectionKind(node)).toBe('paragraph')
    expect(strategyKind(strategy)).toBe('inline')
    expect(map.entries[0]?.sourceSpan).toBe(sourceSpan)
    expect(validationMessage({ valid: true })).toBe('valid')
  })

  it('fixes codec method inputs and outputs at compile time', () => {
    expectTypeOf<Codec['recognize']>().returns.toEqualTypeOf<CodecMatch | null>()
    expectTypeOf<Codec['validate']>().returns.toEqualTypeOf<ValidationResult>()
    expectTypeOf<Codec['safePatchUnit']>().returns.toEqualTypeOf<SafePatchUnit | null>()
  })
})
