import { describe, expect, it } from 'vitest'

import Cherry from 'cherry-markdown/dist/cherry-markdown.esm.js'
import * as echarts from 'echarts'
import katex from 'katex'
import mermaid from 'mermaid'

import { W_EDITOR_CHERRY_ENGINE_OPTIONS } from '../../src/adapters/wEditorCherrySyntax'
import { sanitizeCherryHtmlWithSafeFormulas } from '../../src/services/rehydrateCherryFormulas'

const blockFormula = String.raw`\lim_{\Delta x \to 0} \frac{f(x+\Delta x)-f(x)}{\Delta x}`

function parse(html: string): DocumentFragment {
  const template = document.createElement('template')
  template.innerHTML = html
  return template.content
}

function renderRawCherry(markdown: string): string {
  const host = document.createElement('div')
  host.id = `cherry-formula-oracle-${crypto.randomUUID()}`
  host.hidden = true
  document.body.append(host)

  const cherry = new Cherry({
    el: host,
    engine: W_EDITOR_CHERRY_ENGINE_OPTIONS,
    value: markdown,
    externals: { echarts, katex, mermaid },
    editor: { defaultModel: 'previewOnly' },
    toolbars: {
      toolbar: false,
      toolbarRight: false,
      bubble: false,
      float: false,
      sidebar: false,
    },
  })

  try {
    return cherry.getHtml(false)
  } finally {
    cherry.destroy()
    host.remove()
  }
}

describe('sanitizeCherryHtmlWithSafeFormulas', () => {
  it('rehydrates in a foreign document when randomUUID is unavailable', () => {
    const iframe = document.createElement('iframe')
    document.body.append(iframe)
    const foreignDocument = iframe.contentDocument
    const foreignWindow = iframe.contentWindow
    if (foreignDocument === null || foreignWindow === null) throw new Error('Expected a foreign document realm.')
    const originalCrypto = Object.getOwnPropertyDescriptor(foreignWindow, 'crypto')

    try {
      Object.defineProperty(foreignWindow, 'crypto', { configurable: true, value: {} })
      const result = sanitizeCherryHtmlWithSafeFormulas(
        '<span class="Cherry-InlineMath"><annotation encoding="application/x-tex">x</annotation></span>',
        foreignDocument,
      )

      expect(result).toContain('Cherry-InlineMath')
      expect(result).toContain('katex')
      expect(result).not.toContain('w-editor-formula-placeholder')
    } finally {
      if (originalCrypto === undefined) Reflect.deleteProperty(foreignWindow, 'crypto')
      else Object.defineProperty(foreignWindow, 'crypto', originalCrypto)
      iframe.remove()
    }
  })

  it('rehydrates exact Cherry inline and block formulas after ordinary HTML sanitization', () => {
    const markdown = [
      'Inline $E=mc^2$.',
      '',
      '<div id="author-formula-placeholder-1" onclick="globalThis.pwned = true" style="top: 999px; height: 999px; vertical-align: bottom; margin-left: 999px">',
      '<script>globalThis.pwned = true</script>',
      '<a href="javascript:alert(1)" onmouseover="globalThis.pwned = true">unsafe link</a>',
      '<svg onload="globalThis.pwned = true"><circle /></svg>',
      'author placeholder content',
      '</div>',
      '',
      '$$',
      blockFormula,
      '$$',
    ].join('\n')

    const rawHtml = renderRawCherry(markdown)
    const result = sanitizeCherryHtmlWithSafeFormulas(rawHtml)
    const fragment = parse(result)

    expect(fragment.querySelectorAll('.Cherry-InlineMath .katex')).toHaveLength(1)
    expect(fragment.querySelectorAll('.Cherry-Math .katex')).toHaveLength(1)
    expect(fragment.querySelectorAll('.Cherry-InlineMath')).toHaveLength(1)
    expect(fragment.querySelectorAll('.Cherry-Math')).toHaveLength(1)
    expect(result).toContain('<math')
    expect(result).toContain('annotation encoding="application/x-tex"')
    expect(result).toMatch(/style="[^"]*vertical-align/iu)
    expect(result).toMatch(/style="[^"]*height/iu)
    expect(result).toMatch(/style="[^"]*top/iu)

    expect(fragment.querySelector('script')).toBeNull()
    expect(fragment.querySelector('[onclick], [onmouseover], [onload]')).toBeNull()
    expect(fragment.querySelector('svg')).toBeNull()
    expect(fragment.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(fragment.querySelector('#author-formula-placeholder-1')).not.toBeNull()
    expect(fragment.querySelector('#author-formula-placeholder-1')?.classList.contains('Cherry-Math')).toBe(false)
    expect(fragment.querySelector('#author-formula-placeholder-1')?.textContent).toContain('author placeholder content')
    expect(result).not.toMatch(/w-editor-formula-placeholder/iu)
  })

  it('preserves renderer-owned SVG when a captured expression creates one', () => {
    const rawHtml = renderRawCherry('$$\n\\sqrt{x}\n$$')
    expect(rawHtml).toContain('<svg')

    const result = sanitizeCherryHtmlWithSafeFormulas(rawHtml)

    expect(result).toContain('<svg')
    expect(result).toContain('<math')
    expect(result).not.toMatch(/w-editor-formula-placeholder/iu)
  })

  it('uses a visible sanitized fallback when a formula annotation is missing', () => {
    const rawHtml = '<span class="Cherry-InlineMath"><span class="author-descendant" onclick="pwned()">Untrusted formula body</span></span>'

    const result = sanitizeCherryHtmlWithSafeFormulas(rawHtml)
    const fragment = parse(result)
    const fallback = fragment.querySelector('.cherry-formula-error')

    expect(fallback).not.toBeNull()
    expect(fallback?.querySelector('.author-descendant')).toBeNull()
    expect(fallback?.hasAttribute('onclick')).toBe(false)
    expect(fallback?.textContent).toContain('Untrusted formula body')
    expect(fragment.querySelector('.Cherry-InlineMath')).toBeNull()
  })
})
