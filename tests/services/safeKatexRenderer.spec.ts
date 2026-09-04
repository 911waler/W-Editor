import { describe, expect, it } from 'vitest'

import { renderSafeKatex } from '../../src/services/safeKatexRenderer'

describe('renderSafeKatex', () => {
  it.each([
    ['inline', 'E=mc^2'],
    ['block', String.raw`\lim_{\Delta x \to 0} \frac{f(x+\Delta x)-f(x)}{\Delta x}`],
    ['block', String.raw`\sqrt{1+x^2}+\left(\frac{a}{b}\right)`],
  ] as const)('keeps KaTeX layout markup for %s %s', (mode, source) => {
    const result = renderSafeKatex(mode, source)

    expect(result.status).toBe('ready')
    expect(result.html).toContain('class="katex"')
    expect(result.html).toMatch(/style="[^"]*(?:height|top|vertical-align|margin)/u)
    expect(result.html).toContain('katex-mathml')
    expect(result.html).toContain('katex-html')
  })

  it('returns a visible error for invalid source', () => {
    const result = renderSafeKatex('inline', String.raw`\frac{`)

    expect(result.status).toBe('error')
    if (result.status !== 'error') {
      throw new Error('Expected invalid source to return an error result.')
    }
    expect(result.html).toContain('katex-error')
    expect(result.message.length).toBeGreaterThan(0)
  })

  it('does not create a trusted URL or script for trust-requiring source', () => {
    const result = renderSafeKatex('inline', String.raw`\href{javascript:alert(1)}{bad}`)

    expect(result.html).not.toContain('href="javascript:')
    expect(result.html).not.toContain('<script')
  })
})
