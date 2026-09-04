import { describe, expect, it } from 'vitest'

import { DocumentSession } from '../../src/core'
import { createCodeBlockCommandPlan } from '../../src/services'

describe('source code-block commands', () => {
  it('inserts and edits the exact selected fenced block as one checked patch', () => {
    const session = new DocumentSession({ documentId: 'source-code', markdown: 'Alpha' })
    const inserted = createCodeBlockCommandPlan(session.snapshot(), { from: 2, to: 2 }, 'js', 'alert(1)', 'code:insert')
    expect(session.previewPatchPlan(inserted.plan)).toBe('Alpha\n\n```js\nalert(1)\n```')
    session.commitPatchPlan(inserted.plan)

    const from = session.snapshot().markdown.indexOf('alert')
    const edited = createCodeBlockCommandPlan(session.snapshot(), { from, to: from }, 'ts', 'const value = 1', 'code:edit')
    expect(edited.plan.patches).toEqual([{
      codecId: 'fenced-code',
      expected: '```js\nalert(1)\n```',
      from: 7,
      replacement: '```ts\nconst value = 1\n```',
      to: session.snapshot().markdown.length,
    }])
  })
})
