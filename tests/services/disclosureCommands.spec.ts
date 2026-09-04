import { describe, expect, it, vi } from 'vitest'

import { disclosureStarterSource } from '../../src/codecs'
import { DocumentSession } from '../../src/core'
import { createDisclosureDraft } from '../../src/services'

describe('detached tabs and accordion drafts', () => {
  it.each(['layout.tabs', 'layout.accordion'] as const)('%s applies once and cancel applies nothing', (commandId) => {
    const session = new DocumentSession({ documentId: commandId, markdown: 'Alpha' })
    const subscriber = vi.fn()
    session.subscribe(subscriber)
    const cancelled = createDisclosureDraft({
      commandId,
      selection: { from: 2, to: 2 },
      session,
      transactionId: `${commandId}:cancel`,
    })
    cancelled.update(cancelled.source().replace(/content/gu, 'cancelled content'))
    expect(cancelled.cancel()).toEqual({ kind: 'cancelled' })
    expect(session.snapshot().revision).toBe(0)
    expect(subscriber).not.toHaveBeenCalled()

    const applied = createDisclosureDraft({
      commandId,
      selection: { from: 2, to: 2 },
      session,
      transactionId: `${commandId}:apply`,
    })
    const edited = applied.source().replace(/content/gu, 'edited content')
    expect(applied.update(edited)).toEqual({ valid: true })
    expect(applied.apply()).toMatchObject({ kind: 'applied' })
    expect(session.snapshot()).toMatchObject({ markdown: `Alpha\n\n${edited}`, revision: 1 })
    expect(subscriber).toHaveBeenCalledOnce()
  })

  it('retains an invalid draft locally and refuses to dispatch it', () => {
    const session = new DocumentSession({ documentId: 'invalid-tabs', markdown: 'Alpha' })
    const draft = createDisclosureDraft({
      commandId: 'layout.tabs',
      selection: { from: 0, to: 0 },
      session,
      transactionId: 'tabs:invalid',
    })
    const invalid = '::: tabs\n:: Only\nOne\n:::'
    expect(draft.update(invalid)).toMatchObject({ valid: false })
    expect(draft.source()).toBe(invalid)
    expect(draft.apply()).toMatchObject({ kind: 'invalid' })
    expect(session.snapshot().revision).toBe(0)
  })

  it('starts with the specified safe starter source', () => {
    const session = new DocumentSession({ documentId: 'starter', markdown: '' })
    const draft = createDisclosureDraft({
      commandId: 'layout.tabs',
      selection: { from: 0, to: 0 },
      session,
      transactionId: 'starter',
    })
    expect(draft.source()).toBe(disclosureStarterSource('layout.tabs'))
  })
})
