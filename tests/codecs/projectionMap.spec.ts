import { describe, expect, it, vi } from 'vitest'

import type { ProjectionMap, ProjectionMapEntry, SourceSpan } from '../../src/codecs/contracts'
import { ProjectionMapTransaction, ProjectionMapValidationError } from '../../src/codecs/projectionMap'
import { DocumentSession, type PatchPlan } from '../../src/core/documentSession'

function entry(id: string, codecId: string, span: SourceSpan, source: string, structural = false): ProjectionMapEntry {
  return {
    codecId,
    originalSource: source,
    projectionId: id,
    safePatchUnit: {
      codecId,
      expectedSource: source,
      sourceSpan: span,
      strategy: { kind: 'direct', scope: 'block' },
      structural,
      unitId: `${id}-unit`,
    },
    sourceSpan: span,
  }
}

function map(markdown: string, entries: readonly ProjectionMapEntry[], revision = 0): ProjectionMap {
  return { documentLength: markdown.length, entries, revision }
}

describe('ProjectionMap revision transactions', () => {
  it('reparses affected units and shifts later spans by the committed delta', () => {
    const markdown = 'alpha\nbeta\n'
    const session = new DocumentSession({ documentId: 'article', markdown })
    const transaction = new ProjectionMapTransaction(map(markdown, [
      entry('alpha', 'paragraph', { from: 0, to: 5 }, 'alpha'),
      entry('beta', 'paragraph', { from: 6, to: 10 }, 'beta'),
    ]))
    const reparseUnit = vi.fn(({ entry: current, sourceSpan, candidateMarkdown }) => entry(
      current.projectionId,
      current.codecId,
      sourceSpan,
      candidateMarkdown.slice(sourceSpan.from, sourceSpan.to),
    ))
    const plan: PatchPlan = {
      baseRevision: 0,
      patches: [{ codecId: 'paragraph', expected: 'alpha', from: 0, replacement: 'A', to: 5 }],
      transactionId: 'edit-alpha',
    }

    const result = transaction.apply(session, plan, {
      rebuild: () => { throw new Error('full rebuild is not expected') },
      reparseUnit,
      validate: () => ({ valid: true }),
    })

    expect(result.strategy).toBe('affected-units')
    expect(reparseUnit).toHaveBeenCalledOnce()
    expect(result.map).toEqual(map('A\nbeta\n', [
      entry('alpha', 'paragraph', { from: 0, to: 1 }, 'A'),
      entry('beta', 'paragraph', { from: 2, to: 6 }, 'beta'),
    ], 1))
    expect(session.snapshot()).toEqual({ documentId: 'article', markdown: 'A\nbeta\n', revision: 1 })
  })

  it('validates a full rebuild before committing an ambiguous structural change', () => {
    const markdown = '::: info\nbody\n:::'
    const session = new DocumentSession({ documentId: 'article', markdown })
    const transaction = new ProjectionMapTransaction(map(markdown, [
      entry('container', 'container', { from: 0, to: markdown.length }, markdown, true),
    ]))
    const plan: PatchPlan = {
      baseRevision: 0,
      patches: [{ codecId: 'container', expected: markdown, from: 0, replacement: '::: warning\nbody\n:::', to: markdown.length }],
      transactionId: 'edit-container',
    }

    expect(() => transaction.apply(session, plan, {
      rebuild: (candidate, revision) => map(candidate, [entry('container', 'container', { from: 0, to: candidate.length }, candidate, true)], revision),
      reparseUnit: () => { throw new Error('local reparse is not expected') },
      validate: () => ({ code: 'INVALID_CONTAINER_SHAPE', message: 'Container shape is invalid.', sourceSpan: null, valid: false }),
    })).toThrowError(ProjectionMapValidationError)

    expect(session.snapshot()).toEqual({ documentId: 'article', markdown, revision: 0 })
    expect(transaction.snapshot().revision).toBe(0)
  })

  it('commits a validated full rebuild as one transaction', () => {
    const markdown = '::: info\nbody\n:::'
    const replacement = '::: warning\nbody\n:::'
    const session = new DocumentSession({ documentId: 'article', markdown })
    const transaction = new ProjectionMapTransaction(map(markdown, [
      entry('container', 'container', { from: 0, to: markdown.length }, markdown, true),
    ]))

    const result = transaction.apply(session, {
      baseRevision: 0,
      patches: [{ codecId: 'container', expected: markdown, from: 0, replacement, to: markdown.length }],
      transactionId: 'edit-container',
    }, {
      rebuild: (candidate, revision) => map(candidate, [entry('container', 'container', { from: 0, to: candidate.length }, candidate, true)], revision),
      reparseUnit: () => { throw new Error('local reparse is not expected') },
      validate: () => ({ valid: true }),
    })

    expect(result.strategy).toBe('full-rebuild')
    expect(session.snapshot()).toEqual({ documentId: 'article', markdown: replacement, revision: 1 })
    expect(transaction.snapshot().revision).toBe(1)
  })
})
