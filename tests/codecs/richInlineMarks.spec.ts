import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  CodecRegistry,
  normalizeRichInlineMarkdownForCherry,
  parseInlineMarkdown,
  projectOrdinaryMarkdown,
  richInlineMarkCodecs,
} from '../../src/codecs'
import { renderWithCherryOracle } from '../harness/cherryOracle'

const fixture = readFileSync('tests/fixtures/cherry/rich-inline-marks.md', 'utf8').trimEnd()

describe('Cherry-compatible attributed inline mark codecs', () => {
  it('leaves RGB-looking code examples and invalid color sources untouched', () => {
    const source = '!!rgb(93, 93, 93) example!!'
    const code = ['`' + source + '`', '', '```text', source, '```'].join('\n')
    expect(normalizeRichInlineMarkdownForCherry(code)).toBe(code)
    expect(normalizeRichInlineMarkdownForCherry('!!rgb(999, 93, 93) invalid!!'))
      .toBe('!!rgb(999, 93, 93) invalid!!')
  })

  it('renders legacy RGB color and background with nested size through Cherry', () => {
    const source = '!16 !!!rgb(255, 255, 0) !!rgb(93, 93, 93) 网页文字!!!!!!'
    const normalized = normalizeRichInlineMarkdownForCherry(source)
    expect(normalized).toBe('!16 !!!#ffff00 !!#5d5d5d 网页文字!!!!!!')
    const host = document.createElement('div')
    host.innerHTML = renderWithCherryOracle(normalized).html
    expect(host.textContent?.trim()).toBe('网页文字')
  })

  it('recognizes and losslessly serializes Ruby, size, text color, and background color', () => {
    const registry = new CodecRegistry(richInlineMarkCodecs)
    const matches = registry.scanInline({ markdown: fixture, revision: 0 }, { from: 0, to: fixture.length })

    expect(matches.map((match) => match.codecId)).toEqual([
      'inline-ruby',
      'inline-size',
      'inline-color',
      'inline-background',
    ])
    for (const match of matches) {
      const codec = registry.get(match.codecId)
      if (codec === undefined) throw new Error(`Missing codec ${match.codecId}.`)
      const node = codec.project(match, 0)
      const safePatchUnit = codec.safePatchUnit(node)
      if (safePatchUnit === null) throw new Error(`Missing safe unit for ${match.codecId}.`)
      expect(codec.serialize({ node, safePatchUnit })).toBe(match.originalSource)
      expect(codec.validate(match.originalSource)).toEqual({ valid: true })
    }
  })

  it('projects direct attributed marks and retains Cherry rendering meaning', () => {
    const projection = projectOrdinaryMarkdown({ documentId: 'rich-inline', markdown: fixture, revision: 0 })
    const marked = projection.content.content?.[0]?.content?.filter((node) => node.marks !== undefined) ?? []
    expect(marked.map((node) => node.marks?.[0]?.type)).toEqual(['ruby', 'textStyle', 'textStyle', 'highlight'])

    const rendered = renderWithCherryOracle(fixture)
    const host = document.createElement('div')
    host.innerHTML = rendered.html
    expect(host.querySelector('ruby')?.childNodes[0]?.textContent?.trim()).toBe('base')
    expect(host.querySelector('rt')?.textContent?.trim()).toBe('annotation')
    expect(host.querySelector('[style*="font-size:18px"]')?.textContent).toBe('size')
    expect(host.querySelector('[style*="color:#c2410c"]')?.textContent).toBe('color')
    expect(host.querySelector('[style*="background-color:#fde68a"]')?.textContent).toBe('background')
  })

  it('projects adjacent size and color marks without exposing their Cherry source', () => {
    const markdown = '!32 啊!!24 啊!啊啊\n\n!!#0066cc 啊!!!!#e6730d 啊!!啊啊'
    const projection = projectOrdinaryMarkdown({ documentId: 'adjacent-rich-inline', markdown, revision: 0 })

    expect(projection.content.content?.[0]?.content).toEqual([
      { marks: [{ attrs: { fontSize: '32px' }, type: 'textStyle' }], text: '啊', type: 'text' },
      { marks: [{ attrs: { fontSize: '24px' }, type: 'textStyle' }], text: '啊', type: 'text' },
      { text: '啊啊', type: 'text' },
    ])
    expect(projection.content.content?.[1]?.content).toEqual([
      { marks: [{ attrs: { color: '#0066cc' }, type: 'textStyle' }], text: '啊', type: 'text' },
      { marks: [{ attrs: { color: '#e6730d' }, type: 'textStyle' }], text: '啊', type: 'text' },
      { text: '啊啊', type: 'text' },
    ])
  })

  it.each([
    ['legacy color-over-background', '!!#0066cc !!!#00ff00 B!!!!!'],
    ['canonical background-over-color', '!!!#00ff00 !!#0066cc B!!!!!'],
  ])('projects %s compound rich marks without exposing delimiters', (_label, markdown) => {
    const content = parseInlineMarkdown(markdown)

    expect(content).toHaveLength(1)
    expect(content[0]).toMatchObject({ text: 'B', type: 'text' })
    expect(content[0]?.marks).toEqual(expect.arrayContaining([
      { attrs: { color: '#0066cc' }, type: 'textStyle' },
      { attrs: { color: '#00ff00' }, type: 'highlight' },
    ]))
    expect(content[0]?.text).not.toContain('!')
  })

  it('canonicalizes renderer input while leaving inline and fenced code byte-for-byte intact', () => {
    const legacy = '!!#0066cc !!!#00ff00 B!!!!!'
    const canonical = '!!!#00ff00 !!#0066cc B!!!!!'
    const markdown = [
      legacy,
      '',
      `\`${legacy}\``,
      '',
      '```text',
      legacy,
      '```',
    ].join('\n')

    expect(normalizeRichInlineMarkdownForCherry(markdown)).toBe([
      canonical,
      '',
      `\`${legacy}\``,
      '',
      '```text',
      legacy,
      '```',
    ].join('\n'))
  })

  it('separates adjacent top-level rich runs only in renderer input', () => {
    const adjacent = '!!#0066cc A!!!!#e60000 B!!!!#e6730d C!!!!!#0080e6 D!!!!!!#00cc00 E!!!'
    const boundary = '<!--w-editor-rich-boundary-->'

    expect(normalizeRichInlineMarkdownForCherry(adjacent)).toBe([
      '!!#0066cc A!!',
      '!!#e60000 B!!',
      '!!#e6730d C!!',
      '!!!#0080e6 D!!!',
      '!!!#00cc00 E!!!',
    ].join(boundary))
    expect(normalizeRichInlineMarkdownForCherry(`\`${adjacent}\``)).toBe(`\`${adjacent}\``)
    expect(normalizeRichInlineMarkdownForCherry(['```text', adjacent, '```'].join('\n')))
      .toBe(['```text', adjacent, '```'].join('\n'))
  })

  it('converts recognized Ruby to escaped semantic renderer HTML without touching code', () => {
    const ruby = `{ <&> | "a&b's" }`
    const semantic = '<ruby>&lt;&amp;&gt;<rt>&quot;a&amp;b&#39;s&quot;</rt></ruby>'

    expect(normalizeRichInlineMarkdownForCherry(ruby)).toBe(ruby)
    expect(normalizeRichInlineMarkdownForCherry(` ${ruby}`)).toBe(` ${ruby}`)
    expect(normalizeRichInlineMarkdownForCherry(`^前^${ruby}`)).toBe(`^前^${semantic}`)
    expect(normalizeRichInlineMarkdownForCherry(`\`${ruby}\``)).toBe(`\`${ruby}\``)
    expect(normalizeRichInlineMarkdownForCherry(['```text', ruby, '```'].join('\n')))
      .toBe(['```text', ruby, '```'].join('\n'))
  })
})
