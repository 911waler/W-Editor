import { describe, expect, it } from 'vitest'

import { highlightCodeTokens, supportsCodeHighlightLanguage } from '../../src/adapters/codeSyntaxHighlighting'
import { CODE_LANGUAGE_OPTIONS } from '../../src/codecs'

describe('language-aware code syntax highlighting', () => {
  it('covers every declared language option with a registered grammar or explicit plain text', () => {
    expect(CODE_LANGUAGE_OPTIONS.filter((option) => option.value.length > 0)
      .every((option) => supportsCodeHighlightLanguage(option.value))).toBe(true)
  })

  it('produces different token ranges for JavaScript and Python declarations', () => {
    const source = "def greet(name):\n    print('Hello', name)"
    const javascript = highlightCodeTokens(source, 'javascript')
    const python = highlightCodeTokens(source, 'python')

    expect(javascript.find((token) => source.slice(token.from, token.to) === 'def')?.token).not.toBe('keyword')
    expect(python.find((token) => source.slice(token.from, token.to) === 'def')?.token).toBe('keyword')
    expect(python).not.toEqual(javascript)
  })

  it('safely leaves plain text and unsupported custom languages undecorated', () => {
    expect(highlightCodeTokens('const answer = 42', '')).toEqual([])
    expect(highlightCodeTokens('const answer = 42', 'haskell')).toEqual([])
  })
})
