import { describe, expect, it } from 'vitest'

import { normalizeMarkdownForCherry } from '../../src/codecs'
import { renderWithCherryOracle } from '../harness/cherryOracle'

describe('Cherry render-only Markdown compatibility', () => {
  it('converts Tiptap task indentation without changing fenced code', () => {
    const markdown = [
      '- [ ] Parent',
      '      - [ ] Child',
      '            - [x] Grandchild',
      '',
      '```md',
      '- [ ] Code parent',
      '      - [ ] Code child',
      '```',
    ].join('\n')

    expect(normalizeMarkdownForCherry(markdown)).toBe([
      '- [ ] Parent',
      '  - [ ] Child',
      '    - [x] Grandchild',
      '',
      '```md',
      '- [ ] Code parent',
      '      - [ ] Code child',
      '```',
    ].join('\n'))
  })

  it('separates adjacent standard marks for Cherry without changing visible text', () => {
    const markdown = '**粗体在前***斜体在后*\n\n*斜体在前***粗体在后**'
    const normalized = normalizeMarkdownForCherry(markdown)
    expect(normalized).toContain('<!--w-editor-inline-boundary-->')

    const rendered = renderWithCherryOracle(normalized)
    const host = document.createElement('div')
    host.innerHTML = rendered.html
    expect(host.querySelectorAll('strong')).toHaveLength(2)
    expect(host.querySelectorAll('em')).toHaveLength(2)
    expect(host.textContent).toBe('粗体在前斜体在后斜体在前粗体在后')
  })
})
