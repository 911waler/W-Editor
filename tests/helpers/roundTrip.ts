import { expect } from 'vitest'

import type { SourceSpan } from '../../src/codecs/contracts'
import { renderWithCherryOracle, type CherryOracleResult } from '../harness/cherryOracle'

export interface DeclaredSafeEdit {
  readonly expectedSource: string
  readonly replacement: string
  readonly sourceSpan: SourceSpan
}

export interface RoundTripExpectation {
  readonly after: string
  readonly before: string
  readonly edits: readonly DeclaredSafeEdit[]
  readonly expectedHtmlFragments: readonly string[]
}

export function expectMarkdownRoundTrip(expectation: RoundTripExpectation): CherryOracleResult {
  const ascending = [...expectation.edits].sort((left, right) => left.sourceSpan.from - right.sourceSpan.from)
  let previousTo = 0
  for (const edit of ascending) {
    expect(edit.sourceSpan.from).toBeGreaterThanOrEqual(previousTo)
    expect(expectation.before.slice(edit.sourceSpan.from, edit.sourceSpan.to)).toBe(edit.expectedSource)
    previousTo = edit.sourceSpan.to
  }

  let declaredResult = expectation.before
  for (const edit of [...ascending].reverse()) {
    declaredResult = `${declaredResult.slice(0, edit.sourceSpan.from)}${edit.replacement}${declaredResult.slice(edit.sourceSpan.to)}`
  }
  expect(expectation.after).toBe(declaredResult)

  let beforeCursor = 0
  let afterCursor = 0
  for (const edit of ascending) {
    const untouchedLength = edit.sourceSpan.from - beforeCursor
    expect(expectation.after.slice(afterCursor, afterCursor + untouchedLength)).toBe(
      expectation.before.slice(beforeCursor, edit.sourceSpan.from),
    )
    beforeCursor = edit.sourceSpan.to
    afterCursor += untouchedLength + edit.replacement.length
  }
  expect(expectation.after.slice(afterCursor)).toBe(expectation.before.slice(beforeCursor))

  const oracle = renderWithCherryOracle(expectation.after)
  for (const fragment of expectation.expectedHtmlFragments) {
    expect(oracle.html).toContain(fragment)
  }
  return oracle
}
