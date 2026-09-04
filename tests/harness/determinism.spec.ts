import { describe, expect, it, vi } from 'vitest'

import { FIXED_TEST_TIME } from '../setup'
import {
  expectExactSnapshot,
  expectExactSourceRange,
  expectOnlyRangeChanged,
} from '../helpers/documentAssertions'

describe('deterministic Vitest harness', () => {
  it('pins time, UUIDs, and fake timers for every test', async () => {
    expect(new Date()).toEqual(FIXED_TEST_TIME)
    expect(crypto.randomUUID()).toBe('00000000-0000-4000-8000-000000000001')
    expect(crypto.randomUUID()).toBe('00000000-0000-4000-8000-000000000002')

    const callback = vi.fn()
    setTimeout(callback, 250)
    await vi.advanceTimersByTimeAsync(249)
    expect(callback).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(callback).toHaveBeenCalledOnce()
  })

  it('asserts exact revisions, source ranges, and isolated replacements', () => {
    expectExactSnapshot(
      { documentId: 'doc-a', revision: 4, markdown: 'alpha beta' },
      { documentId: 'doc-a', revision: 4, markdown: 'alpha beta' },
    )
    expectExactSourceRange('alpha beta', { from: 6, to: 10 }, 'beta')
    expectOnlyRangeChanged('alpha beta', 'alpha **beta**', { from: 6, to: 10 }, '**beta**')
  })
})
