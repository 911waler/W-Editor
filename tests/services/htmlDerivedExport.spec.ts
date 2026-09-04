import { describe, expect, it, vi } from 'vitest'

import { CherryRenderAdapter } from '../../src/adapters'
import { BrowserFileExportError, createHtmlDerivedExports, createStandaloneExportHtml, EXPORT_STYLES } from '../../src/services/browserFileExport'

describe('safe HTML-derived exports', () => {
  it('applies the same content-presentation typography used by Visual and Preview to static/PDF capture', () => {
    const style = document.createElement('style')
    style.textContent = EXPORT_STYLES
    const content = document.createElement('main')
    content.className = 'rendered-document-content'
    content.innerHTML = '<h1>Heading</h1><p>Paragraph <em>italic</em></p><blockquote><p>Quote</p></blockquote><ul><li>Item</li></ul>'
    document.head.append(style)
    document.body.append(content)
    try {
      const heading = getComputedStyle(content.querySelector('h1')!)
      const paragraph = getComputedStyle(content.querySelector(':scope > p')!)
      const quote = getComputedStyle(content.querySelector('blockquote')!)
      const list = getComputedStyle(content.querySelector('ul')!)
      expect(heading.fontFamily).toBe('var(--w-editor-heading-font-family)')
      expect(getComputedStyle(document.documentElement).getPropertyValue('--w-editor-heading-font-family').replace(/\s/gu, '')).toBe('Georgia,serif')
      expect(heading.fontSize).toBe('32px')
      expect(heading.marginTop).toBe('30px')
      expect(paragraph.fontFamily).toBe('var(--w-editor-content-font-family)')
      expect(getComputedStyle(document.documentElement).getPropertyValue('--w-editor-content-font-family')).toContain('Inter')
      expect(paragraph.lineHeight).toBe('var(--w-editor-line-height, 1.75)')
      expect(paragraph.marginTop).toBe('16px')
      expect(quote.borderLeftWidth).toBe('3px')
      expect(quote.paddingLeft).toBe('16px')
      expect(list.paddingLeft).toBe('24px')
    } finally {
      content.remove()
      style.remove()
    }
  })

  it('falls back safely when an untyped caller supplies invalid presentation metadata', () => {
    const html = createStandaloneExportHtml({
      bodyHtml: '<p>Safe</p>',
      documentId: 'presentation-boundary',
      lineHeight: Number.POSITIVE_INFINITY,
      revision: 1,
      theme: '" onclick="bad()' as never,
    })
    expect(html).toContain('class="cherry theme__default')
    expect(html).toContain('style="--w-editor-line-height:1.75"')
    expect(html).not.toContain('onclick="bad()')
  })

  it('renders one exact snapshot once and derives standalone HTML and Word-compatible artifacts from it', async () => {
    const snapshot = Object.freeze({ documentId: 'safe-article', markdown: '# Exact\n', revision: 12 })
    const render = vi.fn(() => ({
      html: '<h1>Exact</h1><script>globalThis.pwned=true</script><a href="javascript:alert(1)" onclick="bad()">unsafe</a>',
      snapshot,
    }))

    const artifacts = createHtmlDerivedExports(snapshot, { render })

    expect(render).toHaveBeenCalledOnce()
    expect(render).toHaveBeenCalledWith(snapshot)
    expect(artifacts.rendered).toEqual({
      bodyHtml: '<h1>Exact</h1><a>unsafe</a>',
      documentId: 'safe-article',
      presentationEngine: 'cherry',
      revision: 12,
    })
    expect(artifacts.html).toMatchObject({ filename: 'safe-article.html', mediaType: 'text/html;charset=utf-8', revision: 12 })
    expect(artifacts.word).toMatchObject({ filename: 'safe-article.doc', mediaType: 'application/msword;charset=utf-8', revision: 12 })

    const html = await artifacts.html.blob.text()
    const word = await artifacts.word.blob.text()
    expect(html).toMatch(/^<!doctype html>\n<html lang="en">/u)
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('data-revision="12"><h1>Exact</h1><a>unsafe</a>')
    expect([...new Uint8Array(await artifacts.word.blob.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(word.startsWith('<!doctype html>')).toBe(true)
    expect(word).toContain('xmlns:w="urn:schemas-microsoft-com:office:word"')
    for (const document of [html, word]) {
      expect(document).not.toMatch(/<script|onclick=|javascript:/iu)
      expect(document).toContain('<style>')
      expect(document).toContain('<main class="w-editor-export cherry-markdown rendered-document-content"')
    }
  })

  it('rejects a renderer result that does not belong to the flushed revision', () => {
    const snapshot = Object.freeze({ documentId: 'article', markdown: 'authoritative', revision: 4 })
    expect(() => createHtmlDerivedExports(snapshot, {
      render: () => ({ html: '<p>stale</p>', snapshot: { ...snapshot, markdown: 'stale' } }),
    })).toThrow(expect.objectContaining<Partial<BrowserFileExportError>>({
      code: 'BROWSER_FILE_EXPORT_FAILED',
      message: 'The Cherry renderer returned a different document revision.',
    }))
  })

  it('preserves trusted KaTeX geometry while keeping author HTML untrusted at the export boundary', () => {
    const snapshot = Object.freeze({
      documentId: 'formula-export-parity',
      markdown: [
        'Inline $E=mc^2$.',
        '',
        '<span onclick="globalThis.pwned=true" style="top:999px;height:999px">unsafe author HTML</span>',
        '',
        '$$',
        String.raw`\lim_{\Delta x \to 0} \frac{f(x+\Delta x)-f(x)}{\Delta x}`,
        '$$',
      ].join('\n'),
      revision: 9,
    })

    const artifacts = createHtmlDerivedExports(snapshot, new CherryRenderAdapter())
    const template = document.createElement('template')
    template.innerHTML = artifacts.rendered.bodyHtml
    const formulaStyles = [...template.content.querySelectorAll<HTMLElement>('.katex [style]')]
      .map((element) => element.getAttribute('style') ?? '')
      .join(';')

    expect(template.content.querySelectorAll('.Cherry-InlineMath .katex')).toHaveLength(1)
    expect(template.content.querySelectorAll('.Cherry-Math .katex-display')).toHaveLength(1)
    expect(formulaStyles).toMatch(/(?:height|margin-left|top|vertical-align)\s*:/u)
    expect(template.content.querySelector('[onclick]')).toBeNull()
    expect(artifacts.rendered.bodyHtml).not.toContain('999px')
  })
})
