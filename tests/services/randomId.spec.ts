import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRandomId } from '../../packages/editor-vue/src/services/randomId'
import { installRandomUuid } from '../../src/nwu/uuid'

afterEach(() => vi.restoreAllMocks())

describe('editor internal identifiers', () => {
  it('preserves a working UUID provider and its receiver', () => {
    const source = { randomUUID() { expect(this).toBe(source); return '12345678-1234-4234-8234-123456789abc' as const } }
    expect(createRandomId(source)).toBe('12345678-1234-4234-8234-123456789abc')
  })

  it('survives the Firefox HTTP UUID shim when getRandomValues throws OperationError', () => {
    const failure = new DOMException('The operation failed for an operation-specific reason', 'OperationError')
    const source = { getRandomValues: () => { throw failure } }
    const uuid = installRandomUuid(source)
    const ids = Array.from({ length: 100 }, () => createRandomId({ randomUUID: uuid }))
    expect(new Set(ids).size).toBe(100)
    // The browser crypto function itself must continue to report its failure.
    expect(() => source.getRandomValues()).toThrow(failure)
  })

  it('keeps fallback identifiers distinct even at the same time with repeated randomness', () => {
    vi.spyOn(Date, 'now').mockReturnValue(123456789)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(new Set(Array.from({ length: 100 }, () => createRandomId(null))).size).toBe(100)
  })

  it('does not conceal unrelated programming errors', () => {
    expect(() => createRandomId({ randomUUID: () => { throw new TypeError('bad provider') } })).toThrow('bad provider')
  })
})
