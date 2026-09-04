import { describe, expect, it } from 'vitest'

import {
  SHARED_CONTRACT_VERSION,
  type DocumentSnapshot,
  type EditorMode,
  type MutationOrigin,
} from '../../src/core/publicContracts'
import { DocumentSession, type DocumentSnapshot as RootDocumentSnapshot } from '../../src/core'

describe('shared public contracts', () => {
  it('is exposed through the root playground compatibility boundary', () => {
    const snapshot = {
      documentId: 'article',
      markdown: '# Article',
      revision: 0,
    } satisfies DocumentSnapshot
    const session = new DocumentSession(snapshot)
    const rootSnapshot: RootDocumentSnapshot = snapshot
    const mode = 'source' satisfies EditorMode
    const origin = 'toolbar-command' satisfies MutationOrigin

    expect(SHARED_CONTRACT_VERSION).toBe('1.0.0')
    expect(session.snapshot()).toEqual(snapshot)
    expect(mode).toBe('source')
    expect(origin).toBe('toolbar-command')
    expect(rootSnapshot).toEqual(snapshot)
  })
})
