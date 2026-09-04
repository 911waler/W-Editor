import { describe, expect, it, vi } from 'vitest'

import { DocumentSession, PatchPlanRejectedError, type PatchPlan } from '../../src/core/documentSession'

function plan(patches: PatchPlan['patches'], baseRevision = 0): PatchPlan {
  return {
    baseRevision,
    patches,
    transactionId: 'visual-transaction-1',
  }
}

describe('revision-checked PatchPlan rejection', () => {
  it('applies non-overlapping replacements from the end and commits once', () => {
    const session = new DocumentSession({ documentId: 'article', markdown: 'alpha beta gamma' })
    const subscriber = vi.fn()
    session.subscribe(subscriber)

    const acknowledgement = session.commitPatchPlan(plan([
      { codecId: 'paragraph', expected: 'alpha', from: 0, replacement: 'A', to: 5 },
      { codecId: 'paragraph', expected: 'gamma', from: 11, replacement: 'GAMMAS', to: 16 },
    ]))

    expect(session.snapshot().markdown).toBe('A beta GAMMAS')
    expect(acknowledgement).toMatchObject({ changed: true, revision: 1, transactionId: 'visual-transaction-1' })
    expect(subscriber).toHaveBeenCalledTimes(1)
  })

  it('rejects a stale base revision', () => {
    const session = new DocumentSession({ documentId: 'article', markdown: 'alpha beta' })
    session.commitSource({ markdown: 'new alpha beta', origin: 'cherry-source' })

    expect(() => session.commitPatchPlan(plan([
      { codecId: 'paragraph', expected: 'alpha', from: 0, replacement: 'ALPHA', to: 5 },
    ]))).toThrowError(expect.objectContaining({ code: 'STALE_REVISION' }))
  })

  it('rejects an expected substring mismatch', () => {
    const session = new DocumentSession({ documentId: 'article', markdown: 'alpha beta' })

    expect(() => session.commitPatchPlan(plan([
      { codecId: 'paragraph', expected: 'gamma', from: 0, replacement: 'ALPHA', to: 5 },
    ]))).toThrowError(expect.objectContaining({ code: 'EXPECTED_SOURCE_MISMATCH', patchIndex: 0 }))
  })

  it('rejects overlapping ranges', () => {
    const session = new DocumentSession({ documentId: 'article', markdown: 'alpha beta' })

    expect(() => session.commitPatchPlan(plan([
      { codecId: 'paragraph', expected: 'alpha', from: 0, replacement: 'A', to: 5 },
      { codecId: 'paragraph', expected: 'ha b', from: 3, replacement: 'B', to: 7 },
    ]))).toThrowError(expect.objectContaining({ code: 'OVERLAPPING_RANGES' }))
  })

  it('rejects invalid replacement values at the runtime boundary', () => {
    const session = new DocumentSession({ documentId: 'article', markdown: 'alpha beta' })
    const invalidPlan = plan([
      { codecId: 'paragraph', expected: 'alpha', from: 0, replacement: 17 as unknown as string, to: 5 },
    ])

    expect(() => session.commitPatchPlan(invalidPlan)).toThrowError(PatchPlanRejectedError)
    expect(() => session.commitPatchPlan(invalidPlan)).toThrowError(expect.objectContaining({ code: 'INVALID_REPLACEMENT' }))
  })

  it('rejects an entire multi-range plan without a partial commit', () => {
    const session = new DocumentSession({ documentId: 'article', markdown: 'alpha beta gamma' })
    const subscriber = vi.fn()
    session.subscribe(subscriber)

    expect(() => session.commitPatchPlan(plan([
      { codecId: 'paragraph', expected: 'alpha', from: 0, replacement: 'ALPHA', to: 5 },
      { codecId: 'paragraph', expected: 'wrong', from: 11, replacement: 'GAMMA', to: 16 },
    ]))).toThrowError(expect.objectContaining({ code: 'EXPECTED_SOURCE_MISMATCH', patchIndex: 1 }))

    expect(session.snapshot()).toEqual({ documentId: 'article', markdown: 'alpha beta gamma', revision: 0 })
    expect(subscriber).not.toHaveBeenCalled()
  })
})
