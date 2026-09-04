import { describe, expect, it } from 'vitest'

import { CherryRenderAdapter } from '../../src/adapters/cherryRenderAdapter'
import { CherrySourceAdapter } from '../../src/adapters/cherrySourceAdapter'
import { formatRichInlineMark, type RichInlineMarkCommandId } from '../../src/codecs/richInlineMarks'
import { DocumentSession } from '../../src/core/documentSession'
import representativeMarkdown from '../fixtures/cherry/representative.md?raw'
import { renderWithCherryOracle } from '../harness/cherryOracle'

function expectedAccessibleRendererHtml(rawCherryHtml: string): string {
  const template = document.createElement('template')
  template.innerHTML = rawCherryHtml

  for (const anchor of template.content.querySelectorAll<HTMLAnchorElement>('a.anchor')) {
    anchor.removeAttribute('href')
    anchor.setAttribute('aria-hidden', 'true')
  }
  for (const toc of template.content.querySelectorAll<HTMLElement>('.toc')) {
    const items = [...toc.children]
      .filter((child): child is HTMLLIElement => child instanceof HTMLLIElement && child.classList.contains('toc-li'))
    const first = items[0]
    if (first === undefined) continue
    const list = document.createElement('ol')
    list.className = 'toc-node__list'
    toc.insertBefore(list, first)
    for (const item of items) list.append(item)
  }
  for (const [index, item] of [...template.content.querySelectorAll<HTMLElement>('li.check-list-item')].entries()) {
    item.dataset['wEditorTaskIndex'] = String(index)
  }

  return template.innerHTML
}

describe('CherryRenderAdapter', () => {
  it('renders the exact supplied snapshot independently and tears down its host', () => {
    const sourceHost = document.createElement('div')
    document.body.append(sourceHost)
    const session = new DocumentSession({
      documentId: 'render-source',
      markdown: 'source remains active\r\n',
    })
    const sourceAdapter = new CherrySourceAdapter({ host: sourceHost, session })
    const snapshot = Object.freeze({
      documentId: 'render-target',
      markdown: '# Final\r\n\r\nexact  snapshot\r\n',
      revision: 7,
    })

    try {
      const result = new CherryRenderAdapter().render(snapshot)

      expect(result.snapshot).toBe(snapshot)
      expect(result.snapshot.markdown).toBe('# Final\r\n\r\nexact  snapshot\r\n')
      expect(result.html).toContain('<h1')
      expect(result.html).toContain('exact  snapshot')
      expect(session.snapshot()).toEqual({
        documentId: 'render-source',
        markdown: 'source remains active\r\n',
        revision: 0,
      })
      expect(sourceAdapter.value()).toBe('source remains active\r\n')
      expect(document.querySelector('[data-w-editor-cherry-render-host]')).toBeNull()
    } finally {
      sourceAdapter.destroy()
      sourceHost.remove()
    }
  })

  it('matches the pinned Cherry oracle for registered extension output', () => {
    const snapshot = Object.freeze({
      documentId: 'registered-extensions',
      markdown: representativeMarkdown,
      revision: 11,
    })
    const oracle = renderWithCherryOracle(representativeMarkdown)
    const result = new CherryRenderAdapter().render(snapshot)

    expect(result.snapshot.markdown).toBe(representativeMarkdown)
    expect(result.html).toBe(expectedAccessibleRendererHtml(oracle.html))
    const rendered = document.createElement('template')
    rendered.innerHTML = result.html
    expect(rendered.content.querySelector('a.anchor')?.hasAttribute('href')).toBe(false)
    expect(rendered.content.querySelector('a.anchor')?.getAttribute('aria-hidden')).toBe('true')
    expect(rendered.content.querySelector('.toc > ol.toc-node__list > li.toc-li')).not.toBeNull()
    expect(result.html).toContain('Oracle panel')
    expect(result.html).toContain('timeline')
    expect(result.html).toContain('Hidden detail body')
    expect(result.html).toContain('language-mermaid')
  })

  it('returns only sanitized HTML for article-controlled raw markup', () => {
    const snapshot = Object.freeze({
      documentId: 'unsafe-render',
      markdown: [
        '# Safe heading',
        '',
        '<div class="article-owned" onclick="globalThis.pwned = true">',
        '<script>globalThis.pwned = true</script>',
        '<a href="javascript:alert(1)">unsafe link</a>',
        '</div>',
      ].join('\n'),
      revision: 3,
    })
    const result = new CherryRenderAdapter().render(snapshot)
    const template = document.createElement('template')
    template.innerHTML = result.html

    expect(result.snapshot).toBe(snapshot)
    expect(template.content.querySelector('script')).toBeNull()
    expect(template.content.querySelector('[onclick]')).toBeNull()
    const unsafeLink = [...template.content.querySelectorAll('a')]
      .find((link) => link.textContent === 'unsafe link')
    expect(unsafeLink?.hasAttribute('href')).toBe(false)
    expect(result.html).toContain('Safe heading')
  })

  it('renders adjacent legacy compound rich marks without leaking Cherry delimiters', () => {
    const snapshot = Object.freeze({
      documentId: 'legacy-compound-rich-marks',
      markdown: '!!#e6730d A!!!!#0066cc !!!#00ff00 B!!!!!',
      revision: 4,
    })

    const result = new CherryRenderAdapter().render(snapshot)
    const template = document.createElement('template')
    template.innerHTML = result.html
    const text = template.content.textContent?.replace(/\s+/gu, ' ').trim()
    const orange = template.content.querySelector<HTMLElement>('[style*="color:#e6730d"]')
    const blue = template.content.querySelector<HTMLElement>('[style*="color:#0066cc"]')
    const green = template.content.querySelector<HTMLElement>('[style*="background-color:#00ff00"]')

    expect(text).toBe('AB')
    expect(orange?.textContent).toBe('A')
    expect(blue?.textContent).toBe('B')
    expect(green?.textContent).toBe('B')
    expect(result.html).not.toContain('!!#')
  })

  it('renders every distinct adjacent size, background, and color subset without delimiter leakage', () => {
    const markStates = Array.from({ length: 8 }, (_, mask) => Object.freeze({
      background: Boolean(mask & 2),
      color: Boolean(mask & 1),
      size: Boolean(mask & 4),
    }))
    const format = (body: string, state: (typeof markStates)[number]): string => {
      let source = body
      const innerToOuter: ReadonlyArray<readonly [RichInlineMarkCommandId, string, boolean]> = [
        ['text.color', '#0066cc', state.color],
        ['text.background', '#00ff00', state.background],
        ['text.size', '18', state.size],
      ]
      for (const [commandId, value, enabled] of innerToOuter) {
        if (enabled) source = formatRichInlineMark(commandId, source, value)
      }
      return source
    }

    for (const left of markStates) {
      for (const right of markStates) {
        if (left === right) continue
        const markdown = format('A', left) + format('B', right)
        const result = new CherryRenderAdapter().render(Object.freeze({
          documentId: `compound-rich-mark-matrix-${JSON.stringify(left)}-${JSON.stringify(right)}`,
          markdown,
          revision: 1,
        }))
        const template = document.createElement('template')
        template.innerHTML = result.html

        expect(template.content.textContent?.replace(/\s+/gu, '').trim(), markdown).toBe('AB')
        expect(result.html, markdown).not.toContain('!!#')
      }
    }
  })

  it('renders the actual Welcome formatting sequence without exposing rich delimiters', () => {
    const markdown = '**啊**++啊++*啊*~~啊~~~啊~啊^啊^{ 啊 | a }啊啊啊!!#0066cc 啊!!!!#e60000 啊!!!!#e6730d 啊!!!!!#0080e6 啊!!!!!!#00cc00 啊!!!啊啊啊$E = mc^2$啊啊啊'
    const result = new CherryRenderAdapter().render(Object.freeze({
      documentId: 'welcome',
      markdown,
      revision: 795,
    }))
    const template = document.createElement('template')
    template.innerHTML = result.html

    expect(template.content.textContent).not.toContain('!!#')
    expect(result.html).not.toContain('!!#')
    expect(result.html).not.toContain('w-editor-rich-boundary')
    expect(template.content.textContent).not.toContain('{ 啊 | a }')
    expect(template.content.querySelector('ruby')?.childNodes[0]?.textContent).toBe('啊')
    expect(template.content.querySelector('ruby rt')?.textContent).toBe('a')
    expect(template.content.querySelector('[style*="color:#0066cc"]')?.textContent).toBe('啊')
    expect(template.content.querySelector('[style*="color:#e60000"]')?.textContent).toBe('啊')
    expect(template.content.querySelector('[style*="color:#e6730d"]')?.textContent).toBe('啊')
    expect(template.content.querySelector('[style*="background-color:#0080e6"]')?.textContent).toBe('啊')
    expect(template.content.querySelector('[style*="background-color:#00cc00"]')?.textContent).toBe('啊')
  })

  it('rehydrates Final inline and block formulas without widening raw HTML trust', () => {
    const blockFormula = String.raw`\lim_{\Delta x \to 0} \frac{f(x+\Delta x)-f(x)}{\Delta x}`
    const snapshot = Object.freeze({
      documentId: 'final-formula-layout',
      markdown: [
        'Inline $E=mc^2$.',
        '',
        '<div id="author-formula-placeholder-2" onclick="globalThis.pwned = true" style="top: 999px; height: 999px; vertical-align: bottom; margin-left: 999px">',
        '<script>globalThis.pwned = true</script>',
        '<a href="javascript:alert(1)" onfocus="globalThis.pwned = true">unsafe link</a>',
        '<svg onload="globalThis.pwned = true"><circle /></svg>',
        'author placeholder content',
        '</div>',
        '',
        '$$',
        blockFormula,
        '$$',
      ].join('\n'),
      revision: 12,
    })

    const result = new CherryRenderAdapter().render(snapshot)
    const template = document.createElement('template')
    template.innerHTML = result.html

    expect(template.content.querySelectorAll('.Cherry-InlineMath .katex')).toHaveLength(1)
    expect(template.content.querySelectorAll('.Cherry-Math .katex')).toHaveLength(1)
    expect(result.html).toContain('annotation encoding="application/x-tex"')
    expect(result.html).toMatch(/style="[^"]*vertical-align/iu)
    expect(result.html).toMatch(/style="[^"]*height/iu)
    expect(result.html).toMatch(/style="[^"]*top/iu)
    expect(template.content.querySelector('script')).toBeNull()
    expect(template.content.querySelector('[onclick], [onfocus], [onload]')).toBeNull()
    expect(template.content.querySelector('svg')).toBeNull()
    expect(template.content.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(template.content.querySelector('#author-formula-placeholder-2')).not.toBeNull()
    expect(template.content.querySelector('#author-formula-placeholder-2')?.classList.contains('Cherry-InlineMath')).toBe(false)
    expect(result.html).not.toMatch(/w-editor-formula-placeholder/iu)
  })
})
