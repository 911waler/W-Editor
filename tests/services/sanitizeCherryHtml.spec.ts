import { describe, expect, it } from 'vitest'

import { chartTableStarterSource, disclosureStarterSource } from '../../src/codecs'
import { CHERRY_SAFE_RENDER_POLICY, sanitizeCherryHtml } from '../../src/services/sanitizeCherryHtml'
import representativeMarkdown from '../fixtures/cherry/representative.md?raw'
import { renderWithCherryOracle } from '../harness/cherryOracle'

function parse(html: string): HTMLTemplateElement {
  const template = document.createElement('template')
  template.innerHTML = html
  return template
}

describe('sanitizeCherryHtml', () => {
  it('retains KaTeX renderer classes while rejecting unrelated author classes', () => {
    const output = sanitizeCherryHtml([
      '<span class="katex article-owned"><span class="katex-html" aria-hidden="true">',
      '<span class="base"><span class="strut"></span><span class="mord mathnormal">E</span>',
      '<span class="mrel">=</span><span class="mord"><span class="mord mathnormal">mc</span>',
      '<span class="msupsub"><span class="vlist-t"><span class="vlist-r"><span class="vlist">2</span></span></span></span>',
      '</span></span></span>',
    ].join(''))
    const template = parse(output)

    expect(template.content.querySelector('.katex .katex-html .base .msupsub .vlist-t')).not.toBeNull()
    expect(template.content.querySelector('.article-owned')).toBeNull()
  })

  it('removes scripts and all event-handler attributes while retaining safe content', () => {
    const output = sanitizeCherryHtml([
      '<div class="cherry-panel" onclick="globalThis.pwned = true">safe',
      '<script>globalThis.pwned = true</script>',
      '<img src="https://assets.example.test/image.png" alt="safe" onerror="globalThis.pwned = true">',
      '</div>',
    ].join(''))
    const template = parse(output)

    expect(output).toContain('safe')
    expect(template.content.querySelector('script')).toBeNull()
    expect(template.content.querySelector('[onclick], [onerror]')).toBeNull()
  })

  it('removes unsafe URL schemes and retains declared navigation and media forms', () => {
    const output = sanitizeCherryHtml([
      '<a id="bad-js" href="java&#x0A;script:alert(1)">bad</a>',
      '<a id="bad-data" href="data:text/html;base64,PHNjcmlwdD4=">bad</a>',
      '<img id="bad-svg" src="data:image/svg+xml,<svg onload=alert(1)>">',
      '<a id="web" href="https://example.test/path">web</a>',
      '<a id="mail" href="mailto:editor@example.test">mail</a>',
      '<a id="local" href="./document.md">local</a>',
      '<img id="image" src="https://assets.example.test/image.png">',
    ].join(''))
    const template = parse(output)

    expect(template.content.querySelector('#bad-js')?.hasAttribute('href')).toBe(false)
    expect(template.content.querySelector('#bad-data')?.hasAttribute('href')).toBe(false)
    expect(template.content.querySelector('#bad-svg')?.hasAttribute('src')).toBe(false)
    expect(template.content.querySelector('#web')?.getAttribute('href')).toBe('https://example.test/path')
    expect(template.content.querySelector('#mail')?.getAttribute('href')).toBe('mailto:editor@example.test')
    expect(template.content.querySelector('#local')?.getAttribute('href')).toBe('./document.md')
    expect(template.content.querySelector('#image')?.getAttribute('src')).toBe('https://assets.example.test/image.png')
  })

  it('drops unrestricted raw-HTML containers and executable embedding surfaces', () => {
    const output = sanitizeCherryHtml([
      '<iframe src="https://example.test/embed"></iframe>',
      '<object data="https://example.test/file"></object>',
      '<embed src="https://example.test/file">',
      '<form action="https://example.test/collect"><input name="secret"></form>',
      '<style>body { display: none }</style>',
      '<svg><a href="javascript:alert(1)">svg</a></svg>',
      '<p class="article-owned">ordinary text</p>',
    ].join(''))
    const template = parse(output)

    expect(template.content.querySelector('iframe, object, embed, form, style, svg')).toBeNull()
    expect(template.content.querySelector('input')).toBeNull()
    expect(template.content.querySelector('p')?.textContent).toBe('ordinary text')
    expect(template.content.querySelector('p')?.hasAttribute('class')).toBe(false)
  })

  it('retains the registered Cherry renderer tags, attributes, and safe inline styles', () => {
    const oracle = renderWithCherryOracle(representativeMarkdown)

    expect(sanitizeCherryHtml(oracle.html)).toBe(oracle.html)
  })

  it('retains inert chart metadata required to hydrate a Cherry chart preview', () => {
    const oracle = renderWithCherryOracle(chartTableStarterSource('chart.line'))
    const output = sanitizeCherryHtml(oracle.html)
    const template = parse(output)
    const chart = template.content.querySelector('.cherry-echarts-wrapper')

    expect(chart).not.toBeNull()
    expect(chart?.getAttribute('data-chart-type')).toBe('line')
    expect(chart?.getAttribute('data-chart-options')).toContain('Line Table')
    expect(chart?.getAttribute('data-table-data')).toContain('"1"')
  })

  it('retains only the inert Cherry radio controls required to display and switch tab panels', () => {
    const oracle = renderWithCherryOracle(disclosureStarterSource('layout.tabs'))
    const output = sanitizeCherryHtml(oracle.html)
    const template = parse(output)
    const tabs = template.content.querySelector('.cherry-tabs')

    expect(tabs).not.toBeNull()
    expect(tabs?.querySelectorAll('input.cherry-tabs--radio[type="radio"]')).toHaveLength(2)
    expect(tabs?.querySelectorAll('label.cherry-tabs--label')).toHaveLength(2)
    expect(tabs?.querySelector('input.cherry-tabs--radio:checked')).not.toBeNull()
    expect(output).not.toMatch(/(?:\son[a-z]+\s*=|javascript:)/iu)
  })

  it('permits safe raster data URLs and rejects active or non-image data', () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
    const output = sanitizeCherryHtml([
      `<img id="drawio" class="cherry-drawio" src="${png}" alt="diagram">`,
      '<img id="gif" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">',
      '<img id="html" src="data:text/html;base64,PHNjcmlwdD4=">',
    ].join(''))
    const template = parse(output)

    expect(template.content.querySelector('#drawio')?.getAttribute('src')).toBe(png)
    expect(template.content.querySelector('#drawio')?.getAttribute('class')).toBe('cherry-drawio')
    expect(template.content.querySelector('#gif')?.getAttribute('src')).toBe('data:image/gif;base64,R0lGODlhAQABAAAAACw=')
    expect(template.content.querySelector('#html')?.hasAttribute('src')).toBe(false)
  })

  it('keeps only safe Cherry style declarations', () => {
    const output = sanitizeCherryHtml([
      '<span id="safe" style="font-size:24px;line-height:1em;color:#b42318;background-color:#fff3cd">safe</span>',
      '<span id="unsafe" style="position:fixed;background-image:url(javascript:alert(1));color:#b42318">unsafe</span>',
    ].join(''))
    const template = parse(output)

    expect(template.content.querySelector('#safe')?.getAttribute('style')).toBe('font-size:24px;line-height:1em;color:#b42318;background-color:#fff3cd')
    expect(template.content.querySelector('#unsafe')?.getAttribute('style')).toBe('color: #b42318;')
  })

  it('keeps the exact restricted style policy and strips raw author layout declarations', () => {
    expect(CHERRY_SAFE_RENDER_POLICY.allowedStyleProperties).toEqual([
      'background-color',
      'color',
      'font-size',
      'line-height',
      'position',
      'text-align',
    ])

    const output = sanitizeCherryHtml([
      '<span id="author" style="background-color:#fff3cd;color:#b42318;font-size:24px;line-height:1em;position:relative;text-align:center;top:3px;height:4px;vertical-align:super;margin-left:5px">safe</span>',
    ].join(''))
    const template = parse(output)
    const style = template.content.querySelector('#author')?.getAttribute('style') ?? ''

    expect(style).toBe('background-color: #fff3cd; color: #b42318; font-size: 24px; line-height: 1em; position: relative; text-align: center;')
    expect(style).not.toMatch(/(?:^|;)\s*(?:top|height|vertical-align|margin-left)\s*:/u)
  })
})
