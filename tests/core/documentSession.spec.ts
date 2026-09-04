import { describe, expect, it, vi } from 'vitest'

import { DocumentSession } from '../../src/core/documentSession'

describe('DocumentSession authority', () => {
  it('retains document identity and the exact initial Markdown snapshot', () => {
    const markdown = '# Title\r\n\r\nExact  spacing.\n'
    const session = new DocumentSession({ documentId: 'article-17', markdown })

    expect(session.snapshot()).toEqual({
      documentId: 'article-17',
      markdown,
      revision: 0,
    })
  })

  it('advances revisions monotonically and records each mutation origin', () => {
    const session = new DocumentSession({ documentId: 'article-17', markdown: 'zero' })

    const first = session.commitSource({ markdown: 'one\n', origin: 'cherry-source' })
    const second = session.commitSource({ markdown: 'two  \n', origin: 'import' })

    expect(first).toMatchObject({ changed: true, origin: 'cherry-source', previousRevision: 0, revision: 1 })
    expect(second).toMatchObject({ changed: true, origin: 'import', previousRevision: 1, revision: 2 })
    expect(session.snapshot()).toEqual({ documentId: 'article-17', markdown: 'two  \n', revision: 2 })
  })

  it('notifies subscribers once per committed change and supports unsubscribe', () => {
    const session = new DocumentSession({ documentId: 'article-17', markdown: 'before' })
    const subscriber = vi.fn()
    const unsubscribe = session.subscribe(subscriber)

    session.commitSource({ markdown: 'after', origin: 'checkpoint-restore', transactionId: 'restore-1' })
    unsubscribe()
    session.commitSource({ markdown: 'after again', origin: 'cherry-source' })

    expect(subscriber).toHaveBeenCalledTimes(1)
    expect(subscriber).toHaveBeenCalledWith({
      acknowledgement: {
        changed: true,
        documentId: 'article-17',
        origin: 'checkpoint-restore',
        previousRevision: 0,
        revision: 1,
        transactionId: 'restore-1',
      },
      current: { documentId: 'article-17', markdown: 'after', revision: 1 },
      previous: { documentId: 'article-17', markdown: 'before', revision: 0 },
    })
  })
})
