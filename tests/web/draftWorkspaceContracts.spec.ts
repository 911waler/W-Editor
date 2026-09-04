import { describe, expect, it } from 'vitest'

import {
  WEB_SCHEMA_VERSION,
  createRecoveryDraft,
  createWorkspaceExchange,
  createWorkspaceState,
} from '../../packages/editor-web/src/index'

describe('draft and workspace exchange contracts', () => {
  it('creates an immutable per-user/per-document recovery draft with reconstructible state only', () => {
    const draft = createRecoveryDraft({
      baseServerRevision: 'server-7',
      documentId: 'article-7',
      localRevision: 12,
      markdown: '# Recover me',
      mode: 'visual',
      selection: { anchor: 4, head: 10 },
      sidebar: { collapsed: false, width: 252 },
      sourceAnchor: { from: 0, to: 10 },
      scroll: { left: 0, top: 480 },
      updatedAt: '2026-08-26T15:00:00.000Z',
      userId: 'user-7',
    })

    expect(draft).toMatchObject({
      baseServerRevision: 'server-7',
      documentId: 'article-7',
      localRevision: 12,
      mode: 'visual',
      schemaVersion: WEB_SCHEMA_VERSION,
      userId: 'user-7',
    })
    expect(Object.isFrozen(draft)).toBe(true)
    expect(Object.isFrozen(draft.selection)).toBe(true)
    expect(Object.isFrozen(draft.scroll)).toBe(true)
    expect(draft).not.toHaveProperty('undo')
    expect(draft).not.toHaveProperty('dom')
    expect(draft).not.toHaveProperty('temporaryUi')
  })

  it('normalizes workspace state and rejects unsafe positions', () => {
    const state = createWorkspaceState({
      mode: 'source',
      selection: { anchor: 2, head: 2 },
      sourceAnchor: null,
      scroll: { left: 0, top: 32 },
      sidebar: { collapsed: true, width: 280 },
    })
    expect(state).toEqual({
      mode: 'source',
      selection: { anchor: 2, head: 2 },
      sourceAnchor: null,
      scroll: { left: 0, top: 32 },
      sidebar: { collapsed: true, width: 280 },
    })
    expect(() => createWorkspaceState({
      mode: 'source',
      selection: { anchor: -1, head: 2 },
      sourceAnchor: null,
      scroll: { left: 0, top: 0 },
      sidebar: { collapsed: false, width: 252 },
    })).toThrow()
  })

  it('keeps a workspace exchange bounded to one user and document', () => {
    const draft = createRecoveryDraft({
      baseServerRevision: null,
      documentId: 'article-8',
      localRevision: 1,
      markdown: '# Draft',
      mode: 'preview',
      selection: null,
      sidebar: { collapsed: false, width: 252 },
      sourceAnchor: null,
      scroll: { left: 0, top: 0 },
      updatedAt: '2026-08-26T15:00:00.000Z',
      userId: 'user-8',
    })
    const exchange = createWorkspaceExchange({
      documentId: 'article-8',
      draft,
      mode: 'preview',
      selection: null,
      sidebar: { collapsed: false, width: 252 },
      sourceAnchor: null,
      scroll: { left: 0, top: 0 },
      userId: 'user-8',
    })
    expect(exchange).toMatchObject({ documentId: 'article-8', userId: 'user-8', draft })
    expect(Object.isFrozen(exchange)).toBe(true)
    expect(() => createWorkspaceExchange({
      documentId: 'other',
      draft,
      mode: 'preview',
      selection: null,
      sidebar: { collapsed: false, width: 252 },
      sourceAnchor: null,
      scroll: { left: 0, top: 0 },
      userId: 'user-8',
    })).toThrow()
  })
})
