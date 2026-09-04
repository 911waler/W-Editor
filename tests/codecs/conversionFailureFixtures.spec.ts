import { describe, expect, it } from 'vitest'

import { CodecRegistry } from '../../src/codecs/codecRegistry'
import { ProjectionMapTransaction, StaleProjectionMapError } from '../../src/codecs/projectionMap'
import { DocumentSession } from '../../src/core/documentSession'
import {
  CODEC_THROW_MARKDOWN,
  enforceResourceLimit,
  invalidSchemaProjectionFixture,
  resourceLimitFixture,
  staleProjectionMapFixture,
  throwingCodecFixture,
} from '../fixtures/conversionFailures'

describe('deterministic conversion failure fixtures', () => {
  it('injects a codec throw at a stable source offset', () => {
    const registry = new CodecRegistry([throwingCodecFixture])
    expect(() => registry.scanInline(
      { markdown: CODEC_THROW_MARKDOWN, revision: 3 },
      { from: 0, to: CODEC_THROW_MARKDOWN.length },
    )).toThrowError('Injected codec failure at offset 0.')
  })

  it('provides a stable projection that cannot belong to the application schema', () => {
    expect(invalidSchemaProjectionFixture).toEqual({
      content: [{ type: 'fixture-node-that-is-not-in-the-schema' }],
      type: 'doc',
    })
  })

  it('injects an observably stale projection map', () => {
    const session = new DocumentSession({ documentId: 'article', markdown: 'source' })
    const transaction = new ProjectionMapTransaction(staleProjectionMapFixture('source', session.snapshot().revision))

    expect(() => transaction.apply(session, {
      baseRevision: 0,
      patches: [{ codecId: 'paragraph', expected: 'source', from: 0, replacement: 'next', to: 6 }],
      transactionId: 'stale-map',
    }, {
      rebuild: () => { throw new Error('not reached') },
      reparseUnit: () => { throw new Error('not reached') },
      validate: () => ({ valid: true }),
    })).toThrowError(StaleProjectionMapError)
    expect(session.snapshot().revision).toBe(0)
  })

  it('injects a declared resource-limit failure with stable metadata', () => {
    expect(() => enforceResourceLimit(
      resourceLimitFixture.markdown,
      resourceLimitFixture.maximumCharacters,
    )).toThrowError(expect.objectContaining({
      actualCharacters: resourceLimitFixture.markdown.length,
      code: 'DECLARED_RESOURCE_LIMIT_EXCEEDED',
      maximumCharacters: 128,
    }))
  })
})
