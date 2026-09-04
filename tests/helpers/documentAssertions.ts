import { expect } from 'vitest'

export interface TestDocumentSnapshot {
  readonly documentId: string
  readonly revision: number
  readonly markdown: string
}

export interface TestSourceRange {
  readonly from: number
  readonly to: number
}

export function expectExactSnapshot(
  actual: TestDocumentSnapshot,
  expected: TestDocumentSnapshot,
): void {
  expect(actual.documentId).toBe(expected.documentId)
  expect(actual.revision).toBe(expected.revision)
  expect(actual.markdown).toBe(expected.markdown)
}

export function expectExactSourceRange(
  source: string,
  range: TestSourceRange,
  expectedSubstring: string,
): void {
  expect(Number.isInteger(range.from)).toBe(true)
  expect(Number.isInteger(range.to)).toBe(true)
  expect(range.from).toBeGreaterThanOrEqual(0)
  expect(range.to).toBeGreaterThanOrEqual(range.from)
  expect(range.to).toBeLessThanOrEqual(source.length)
  expect(source.slice(range.from, range.to)).toBe(expectedSubstring)
}

export function expectOnlyRangeChanged(
  before: string,
  after: string,
  range: TestSourceRange,
  replacement: string,
): void {
  expectExactSourceRange(before, range, before.slice(range.from, range.to))
  expect(after).toBe(`${before.slice(0, range.from)}${replacement}${before.slice(range.to)}`)
}
