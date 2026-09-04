import { describe, expect, it } from 'vitest'

import { createTaskItemCheckedPlan, taskItemMarkers } from '../../src/services'

describe('author-preview task item commands', () => {
  it('locates rendered-order task markers while ignoring fenced examples', () => {
    const markdown = [
      '- [ ] Parent',
      '      - [x] Child',
      '',
      '```md',
      '- [ ] Not a rendered task',
      '```',
    ].join('\n')
    expect(taskItemMarkers(markdown)).toEqual([
      expect.objectContaining({ checked: false, index: 0, marker: '[ ]' }),
      expect.objectContaining({ checked: true, index: 1, marker: '[x]' }),
    ])
  })

  it('creates one revision-checked marker patch for the requested rendered task', () => {
    const markdown = '- [ ] Parent\n      - [x] Child'
    const plan = createTaskItemCheckedPlan(
      Object.freeze({ documentId: 'tasks', markdown, revision: 7 }),
      1,
      false,
      'author-preview-task:test',
    )
    expect(plan).toEqual({
      baseRevision: 7,
      patches: [{
        codecId: 'task-list',
        expected: '[x]',
        from: markdown.lastIndexOf('[x]'),
        replacement: '[ ]',
        to: markdown.lastIndexOf('[x]') + 3,
      }],
      transactionId: 'author-preview-task:test',
    })
  })

  it('rejects an out-of-range task identity and a no-op state', () => {
    const snapshot = Object.freeze({ documentId: 'tasks', markdown: '- [ ] Parent', revision: 0 })
    expect(() => createTaskItemCheckedPlan(snapshot, 1, true, 'missing')).toThrow(RangeError)
    expect(createTaskItemCheckedPlan(snapshot, 0, false, 'no-op')).toBeNull()
  })
})
