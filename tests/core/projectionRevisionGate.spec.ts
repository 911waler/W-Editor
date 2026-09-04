import { describe, expect, it, vi } from 'vitest'

import { DocumentSession } from '../../src/core/documentSession'
import { ProjectionRevisionGate } from '../../src/core/projectionRevisionGate'

describe('projection origin and revision acknowledgements', () => {
  it('acknowledges a reflected own-origin revision without a feedback commit', () => {
    const session = new DocumentSession({ documentId: 'article', markdown: 'alpha' })
    const hydrate = vi.fn()
    const visualGate = new ProjectionRevisionGate('tiptap-visual', hydrate)
    const dispositions: string[] = []
    session.subscribe((change) => dispositions.push(visualGate.receive(change)))

    session.commitPatchPlan({
      baseRevision: 0,
      patches: [{ codecId: 'paragraph', expected: 'alpha', from: 0, replacement: 'beta', to: 5 }],
      transactionId: 'visual-1',
    })

    expect(dispositions).toEqual(['acknowledged-own-origin'])
    expect(visualGate.acknowledgement()).toEqual({
      origin: 'tiptap-visual',
      revision: 1,
      transactionId: 'visual-1',
    })
    expect(hydrate).not.toHaveBeenCalled()
    expect(session.snapshot()).toEqual({ documentId: 'article', markdown: 'beta', revision: 1 })
  })

  it('hydrates an external revision without adding projection history', () => {
    const session = new DocumentSession({ documentId: 'article', markdown: 'alpha' })
    const hydrate = vi.fn()
    const visualGate = new ProjectionRevisionGate('tiptap-visual', hydrate)
    session.subscribe((change) => visualGate.receive(change))

    session.commitSource({ markdown: 'external\r\n', origin: 'cherry-source', transactionId: 'source-1' })

    expect(hydrate).toHaveBeenCalledOnce()
    expect(hydrate).toHaveBeenCalledWith({
      addToHistory: false,
      snapshot: { documentId: 'article', markdown: 'external\r\n', revision: 1 },
    })
    expect(session.snapshot().revision).toBe(1)
  })
})
