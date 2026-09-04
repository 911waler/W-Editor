import { describe, expect, it } from 'vitest'

import { DocumentSession, type WholeSourceMutationOrigin } from '../../src/core/documentSession'

describe.each<WholeSourceMutationOrigin>(['cherry-source', 'clear', 'import', 'reset', 'checkpoint-restore'])('%s whole-source commits', (origin) => {
  it('preserves the supplied source exactly', () => {
    const session = new DocumentSession({ documentId: 'article', markdown: 'before' })
    const exactSource = '\uFEFF# Exact\r\n\r\nTrailing spaces  \r\n\n'

    const acknowledgement = session.commitSource({ markdown: exactSource, origin, transactionId: `${origin}-1` })

    expect(session.snapshot().markdown).toBe(exactSource)
    expect(session.snapshot().revision).toBe(1)
    expect(acknowledgement).toMatchObject({ origin, transactionId: `${origin}-1` })
  })
})
