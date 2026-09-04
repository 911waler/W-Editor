import { describe, expect, it } from 'vitest'

import { installAuthorityInspection } from '../../src/services/e2eAuthority'

describe('E2E-only authority inspection', () => {
  it('exposes only a read operation and returns a frozen snapshot', () => {
    installAuthorityInspection(() => ({
      actionCount: 3,
      autosaveStatus: 'saved',
      documentId: 'welcome',
      markdown: '**exact**',
      mode: 'visual',
      revision: 7,
      synchronizationStatus: 'synchronized',
    }))

    const inspection = window.__W_EDITOR_AUTHORITY__
    expect(inspection).toBeDefined()
    expect(Object.keys(inspection ?? {})).toEqual(['read'])
    expect(Object.isFrozen(inspection)).toBe(true)

    const snapshot = inspection?.read()
    expect(snapshot).toEqual({
      actionCount: 3,
      autosaveStatus: 'saved',
      documentId: 'welcome',
      markdown: '**exact**',
      mode: 'visual',
      revision: 7,
      synchronizationStatus: 'synchronized',
    })
    expect(Object.isFrozen(snapshot)).toBe(true)
  })
})
