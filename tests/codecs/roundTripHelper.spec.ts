import { describe, expect, it } from 'vitest'

import { expectMarkdownRoundTrip } from '../helpers/roundTrip'

describe('lossless Markdown round-trip helper', () => {
  it('proves a view-only projection is byte-identical and Cherry-correct', () => {
    const markdown = '# Exact\r\n\r\nParagraph  with spacing.\r\n'

    const oracle = expectMarkdownRoundTrip({
      after: markdown,
      before: markdown,
      edits: [],
      expectedHtmlFragments: ['<h1', 'Paragraph  with spacing.'],
    })

    expect(oracle.markdown).toBe(markdown)
  })

  it('proves only declared safe ranges change while Cherry meaning remains correct', () => {
    const before = '# Keep\r\n\r\nParagraph with *old*.\r\n\r\nTrailing  text.\r\n'
    const from = before.indexOf('*old*')
    const sourceSpan = { from, to: from + '*old*'.length }
    const replacement = '**new**'
    const after = `${before.slice(0, sourceSpan.from)}${replacement}${before.slice(sourceSpan.to)}`

    const oracle = expectMarkdownRoundTrip({
      after,
      before,
      edits: [{ expectedSource: '*old*', replacement, sourceSpan }],
      expectedHtmlFragments: ['<h1', '<strong>new</strong>', 'Trailing  text.'],
    })

    expect(oracle.html).not.toContain('<em>old</em>')
  })
})
