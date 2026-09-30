import { describe, expect, it, vi } from 'vitest'
import { CherryRenderAdapter } from '../../src/adapters/cherryRenderAdapter'
import { TiptapVisualAdapter } from '../../src/adapters'
import { parseInlineFormulaAt, projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession } from '../../src/core'

const expressions = [
  String.raw`\langle c|H_0|c^{(2)}\rangle =E_c\langle c|c^{(2)}\rangle`,
  String.raw`\begin{aligned}
&\langle c|H_0|c^{(2)}\rangle
+\langle c|H_1|c^{(1)}\rangle
+\frac12\langle c|H_2|c\rangle\\
&\qquad=
E_c\langle c|c^{(2)}\rangle
+\epsilon_1\langle c|c^{(1)}\rangle
+\epsilon_2\langle c|c\rangle
\end{aligned}`,
]
expressions.push(expressions[1]!.replace(/\n/gu, '\r\n'))
expressions.push('x % keep the comment newline\n+y')

describe('inline formula source regression', () => {
  it('does not consume a following paragraph or block formula as an inline closing delimiter', () => {
    for (const source of ['$x\n\ny$', '$x\r\n \r\ny$', '$x\n$$\ny\n$$', '$5\n```text\n$x$\n```']) {
      expect(parseInlineFormulaAt(source, 0)).toBeNull()
    }
  })

  it('keeps multiline formula examples inside code literal and block formulas intact', async () => {
    const expression = expressions[1]!
    const literal = `$${expression}$`
    const markdown = ['```tex', literal, '```', '', '`$x+y$`', '', '    $x', '    +y$', '', 'Price $5', '```text', '$x$', '```', '', '$$', expression, '$$'].join('\n')
    const renderer = new CherryRenderAdapter()
    try {
      const host = document.createElement('div')
      host.innerHTML = renderer.render({ documentId: 'examples', markdown, revision: 0 }).html
      expect(host.querySelector('pre')?.textContent).toContain(literal)
      expect(host.querySelectorAll('.Cherry-InlineMath')).toHaveLength(0)
      expect(host.querySelectorAll('.Cherry-Math .katex')).toHaveLength(1)
      expect(host.textContent).not.toContain('wEditorFormula')
    } finally {
      await vi.runOnlyPendingTimersAsync()
      renderer.pipeline.destroy()
    }
  })

  for (const [index, expression] of expressions.entries()) {
    const markdown = `因为 $${expression}$，与右边第一项抵消。`
    it(`renders bra-ket expression ${index} in the reader`, async () => {
      const renderer = new CherryRenderAdapter()
      try {
        const result = renderer.render({ documentId: 'formula', markdown, revision: 0 })
        const host = document.createElement('div')
        host.innerHTML = result.html
        expect(host.querySelectorAll('.katex')).toHaveLength(1)
        expect(host.querySelector('annotation')?.textContent).toBe(expression.replace(/\r\n/gu, '\n'))
        expect(host.querySelector('.katex-error, .cherry-formula-error')).toBeNull()
        expect(result.snapshot.markdown).toBe(markdown)
      } finally {
        await vi.runOnlyPendingTimersAsync()
        renderer.pipeline.destroy()
      }
    })
    it(`renders bra-ket expression ${index} in the visual editor`, () => {
      const host = document.createElement('div')
      document.body.append(host)
      const session = new DocumentSession({ documentId: 'formula', markdown })
      const onSemanticEdit = vi.fn()
      const adapter = new TiptapVisualAdapter({ host, project: projectOrdinaryMarkdown, session, onSemanticEdit })
      try {
        expect(host.querySelectorAll('[data-formula-mode="inline"] .katex')).toHaveLength(1)
        expect(host.querySelector('annotation')?.textContent).toBe(expression.replace(/\r\n/gu, '\n'))
        expect(session.snapshot().markdown).toBe(markdown)
        host.querySelector('[data-formula-mode="inline"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
        expect(onSemanticEdit).toHaveBeenCalledWith(expect.objectContaining({ formulaContent: expression, source: `$${expression}$` }))
      } finally { adapter.destroy(); host.remove() }
    })
  }
})
