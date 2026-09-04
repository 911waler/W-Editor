import { describe, expect, it, vi } from 'vitest'

import { CodecRegistry } from '../../src/codecs/codecRegistry'
import type { Codec } from '../../src/codecs/contracts'
import { createRawProjection, createRawSourceDraft } from '../../src/codecs/rawProjection'
import { DocumentSession } from '../../src/core/documentSession'

const strongCodec: Codec = {
  id: 'strong',
  precedence: 20,
  scope: 'inline',
  recognize: (context, offset) => {
    if (!context.markdown.startsWith('**known**', offset)) return null
    return {
      captures: { text: 'known' },
      originalSource: '**known**',
      sourceSpan: { from: offset, to: offset + 9 },
    }
  },
  project: (match, revision) => ({
    attributes: { text: match.captures['text'] },
    children: [],
    codecId: 'strong',
    editStrategy: { kind: 'direct', scope: 'inline' },
    kind: 'structured',
    nodeType: 'strong',
    originalSource: match.originalSource,
    projectionId: `strong:${match.sourceSpan.from}`,
    revision,
    sourceSpan: match.sourceSpan,
  }),
  safePatchUnit: () => null,
  serialize: ({ node }) => node.originalSource,
  validate: () => ({ valid: true }),
}

describe('lossless raw projections', () => {
  it('projects unknown inline source visibly and exactly in place', () => {
    const markdown = 'before @@mystery(x)@@ after'
    const node = createRawProjection({
      kind: 'rawInline',
      markdown,
      projectionId: 'raw-inline-1',
      revision: 8,
      sourceSpan: { from: 7, to: 21 },
    })

    expect(node).toMatchObject({
      codecId: 'raw-inline',
      editStrategy: { kind: 'raw-source' },
      kind: 'rawInline',
      originalSource: '@@mystery(x)@@',
      revision: 8,
      sourceSpan: { from: 7, to: 21 },
    })
  })

  it('projects unknown block source with original line endings', () => {
    const markdown = 'before\r\n::: unknown\r\nbody  \r\n:::\r\nafter'
    const from = markdown.indexOf(':::')
    const to = markdown.lastIndexOf(':::') + 3
    const node = createRawProjection({ kind: 'rawBlock', markdown, projectionId: 'raw-block-1', revision: 2, sourceSpan: { from, to } })

    expect(node.originalSource).toBe('::: unknown\r\nbody  \r\n:::')
    expect(node.kind).toBe('rawBlock')
  })

  it('applies only the raw range and promotes a now-recognized replacement', () => {
    const session = new DocumentSession({ documentId: 'article', markdown: 'before @@raw@@ after' })
    const node = createRawProjection({
      kind: 'rawInline',
      markdown: session.snapshot().markdown,
      projectionId: 'raw-inline-1',
      revision: 0,
      sourceSpan: { from: 7, to: 14 },
    })
    const draft = createRawSourceDraft({ node, registry: new CodecRegistry([strongCodec]), session, transactionId: 'raw-edit-1' })

    draft.update('**known**')
    const result = draft.apply()

    expect(session.snapshot()).toEqual({ documentId: 'article', markdown: 'before **known** after', revision: 1 })
    expect(result.kind).toBe('applied')
    if (result.kind === 'applied') {
      expect(result.node).toMatchObject({ codecId: 'strong', kind: 'structured', originalSource: '**known**', revision: 1 })
    }
  })

  it('retains a still-unknown applied replacement as raw', () => {
    const session = new DocumentSession({ documentId: 'article', markdown: '@@raw@@' })
    const node = createRawProjection({ kind: 'rawInline', markdown: '@@raw@@', projectionId: 'raw-1', revision: 0, sourceSpan: { from: 0, to: 7 } })
    const draft = createRawSourceDraft({ node, registry: new CodecRegistry([strongCodec]), session, transactionId: 'raw-edit-2' })

    draft.update('@@still-raw@@')
    const result = draft.apply()

    expect(result.kind).toBe('applied')
    if (result.kind === 'applied') {
      expect(result.node).toMatchObject({ kind: 'rawInline', originalSource: '@@still-raw@@', revision: 1 })
    }
  })

  it('cancels a changed draft without a revision or notification', () => {
    const session = new DocumentSession({ documentId: 'article', markdown: '@@raw@@' })
    const subscriber = vi.fn()
    session.subscribe(subscriber)
    const node = createRawProjection({ kind: 'rawInline', markdown: '@@raw@@', projectionId: 'raw-1', revision: 0, sourceSpan: { from: 0, to: 7 } })
    const draft = createRawSourceDraft({ node, registry: new CodecRegistry([]), session, transactionId: 'raw-edit-3' })

    draft.update('changed')
    const result = draft.cancel()

    expect(result).toEqual({ kind: 'cancelled', node })
    expect(session.snapshot().revision).toBe(0)
    expect(subscriber).not.toHaveBeenCalled()
  })
})
