import { describe, expect, it, vi } from 'vitest'

import { timelineStarterSource } from '../../src/codecs'
import { DocumentSession } from '../../src/core'
import { createTimelineDraft } from '../../src/services'

describe('detached timeline drafts', () => {
  it('cancels a dirty draft without creating a revision', () => {
    const session = new DocumentSession({ documentId: 'timeline-cancel', markdown: 'Alpha' })
    const subscriber = vi.fn()
    session.subscribe(subscriber)
    const draft = createTimelineDraft({
      selection: { from: 5, to: 5 },
      session,
      transactionId: 'timeline:cancel',
    })
    draft.update(draft.source().replace('Timeline', 'Cancelled timeline'))
    expect(draft.cancel()).toEqual({ kind: 'cancelled' })
    expect(session.snapshot()).toMatchObject({ markdown: 'Alpha', revision: 0 })
    expect(subscriber).not.toHaveBeenCalled()
  })

  it('applies one validated draft as exactly one transaction', () => {
    const session = new DocumentSession({ documentId: 'timeline-apply', markdown: 'Alpha' })
    const subscriber = vi.fn()
    session.subscribe(subscriber)
    const draft = createTimelineDraft({
      selection: { from: 5, to: 5 },
      session,
      transactionId: 'timeline:apply',
    })
    const edited = timelineStarterSource().replace('Timeline', 'Release plan')
    expect(draft.update(edited)).toEqual({ valid: true })
    expect(draft.apply()).toMatchObject({ kind: 'applied' })
    expect(session.snapshot()).toMatchObject({ markdown: `Alpha\n\n${edited}`, revision: 1 })
    expect(subscriber).toHaveBeenCalledOnce()
  })

  it('retains an invalid draft locally and refuses to dispatch it', () => {
    const session = new DocumentSession({ documentId: 'timeline-invalid', markdown: 'Alpha' })
    const draft = createTimelineDraft({
      selection: { from: 5, to: 5 },
      session,
      transactionId: 'timeline:invalid',
    })
    const invalid = '::: timeline Release\n:: [unknown] today Invalid status\n:::'
    expect(draft.update(invalid)).toMatchObject({ valid: false })
    expect(draft.source()).toBe(invalid)
    expect(draft.apply()).toMatchObject({ kind: 'invalid' })
    expect(session.snapshot()).toMatchObject({ markdown: 'Alpha', revision: 0 })
  })
})
