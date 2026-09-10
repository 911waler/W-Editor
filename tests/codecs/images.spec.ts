import { describe, expect, it } from 'vitest'

import { CherryRenderAdapter } from '../../src/adapters'
import { normalizeImageUrl, parseInlineImageAt, serializeImage } from '../../src/codecs'

describe('inline image codec', () => {
  it('preserves mixed and duplicate metadata through parse and name-only edits', () => {
    for (const source of ['![old](/a.png "caption"){align=center width=100 data-x=1}',
      '![old](/a.png){width=100 width=200 custom=yes}']) {
      const parsed = parseInlineImageAt(source, 0)
      if (parsed === null) throw new Error('Expected a recognized image')
      expect(parsed.width).toBe(100)
      expect(serializeImage(parsed)).toBe(source)
      expect(serializeImage({ ...parsed, name: 'new' })).toBe(source.replace('![old]', '![new]'))
    }
  })

  it('preserves untouched malformed and duplicate dimensions when another dimension changes', () => {
    for (const extension of ['{width=0 custom=yes}', '{width=100  width=200 custom=yes}']) {
      const source = `![x](/a.png)${extension}`
      const parsed = parseInlineImageAt(source, 0)
      if (parsed === null) throw new Error('Expected an image')
      expect(serializeImage({ ...parsed, height: 20 })).toBe(source.slice(0, -1) + ' height=20}')
    }
  })

  it('only excludes matched code spans and respects escaped image markers', () => {
    const source = '`unmatched ``code`` ![x](/a.png)'
    expect(parseInlineImageAt(source, source.indexOf('!['))?.url).toBe('/a.png')
    const inside = '`` literal ` ![x](/a.png) ``'
    expect(parseInlineImageAt(inside, inside.indexOf('!['))).toBeNull()
    expect(parseInlineImageAt('\\![literal](/a.png)', 1)).toBeNull()
  })

  it('round-trips apostrophes inside safe image destinations separately from titles', () => {
    const source = serializeImage({ name: 'Book', url: "https://example.test/O'Reilly.png", width: null, height: null })
    expect(parseInlineImageAt(source, 0)?.url).toBe("https://example.test/O'Reilly.png")
    expect(parseInlineImageAt(source.slice(0, -1) + ' "caption")', 0)?.url).toBe("https://example.test/O'Reilly.png")
  })

  it('stops after one image when two images share a line', () => {
    const source = '![甲](/static/blog-images/1/png-4) ![乙](https://example.test/b.png)'

    expect(parseInlineImageAt(source, 0)).toEqual({
      height: null,
      name: '甲',
      source: '![甲](/static/blog-images/1/png-4)',
      sourceSpan: { from: 0, to: source.indexOf(' ![乙]') },
      url: '/static/blog-images/1/png-4',
      width: null,
    })
    expect(parseInlineImageAt(source, source.indexOf('![乙]'))?.url).toBe('https://example.test/b.png')
  })

  it('parses empty alt text, escapes, balanced URL parentheses, and an optional title', () => {
    const source = String.raw`![](/asset/a\(draft\).png "a title") and ![a\]b](https://example.test/a_(1).png)`

    expect(parseInlineImageAt(source, 0)).toMatchObject({
      name: '',
      source: String.raw`![](/asset/a\(draft\).png "a title")`,
      url: '/asset/a(draft).png',
    })
    expect(parseInlineImageAt(source, source.indexOf('![a'))).toMatchObject({
      name: 'a]b',
      url: 'https://example.test/a_(1).png',
    })
  })

  it('preserves exact CRLF source, dimensions, and unknown extensions', () => {
    const source = '![旧图](/static/no-extension){width=320 height=180}\r\nnext'
    expect(parseInlineImageAt(source, 0)).toEqual({
      height: 180,
      name: '旧图',
      source: '![旧图](/static/no-extension){width=320 height=180}',
      sourceSpan: { from: 0, to: source.indexOf('\r') },
      url: '/static/no-extension',
      width: 320,
    })

    const unknown = '![旧图](/a.png){width=320 align=center data-x=1}'
    expect(parseInlineImageAt(unknown, 0)).toMatchObject({
      height: null,
      source: unknown,
      width: 320,
    })
  })

  it('does not recognize image-shaped text inside an inline code span', () => {
    const source = '`literal ![not an image](/a.png)` then ![image](/b.png)'
    expect(parseInlineImageAt(source, source.indexOf('!['))).toBeNull()
    expect(parseInlineImageAt(source, source.lastIndexOf('!['))?.url).toBe('/b.png')
  })

  it('normalizes allowed image addresses and rejects unsafe variants', () => {
    expect(normalizeImageUrl('/static/blog-images/1/png-4')).toBe('/static/blog-images/1/png-4')
    expect(normalizeImageUrl('https://example.test/a.png')).toBe('https://example.test/a.png')
    expect(normalizeImageUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
    expect(normalizeImageUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeImageUrl('//other.test/a.png')).toBeNull()
    expect(normalizeImageUrl('/safe\\evil.png')).toBeNull()
    expect(normalizeImageUrl('/safe\u0000evil.png')).toBeNull()
  })

  it('serializes safe images with positive pixel dimensions', () => {
    expect(serializeImage({ name: '甲', url: '/a.png', width: 320, height: 180 }))
      .toBe('![甲](/a.png){width=320 height=180}')
    expect(serializeImage({ name: '', url: '/a(1).png', width: null, height: null }))
      .toBe('![](/a%281%29.png)')
    expect(() => serializeImage({ name: 'x', url: '/a.png', width: 0, height: 10 })).toThrow()
    expect(() => serializeImage({ name: 'x', url: '/a.png', width: 10.5, height: 10 })).toThrow()
  })

  it('preserves title and unknown metadata while updating recognized image fields', () => {
    const source = '![old](/a.png "caption"){align=center width=100 data-x=1}'
    expect(serializeImage({ name: 'old', url: '/a.png', width: 100, height: null, source })).toBe(source)
    expect(serializeImage({ name: 'new', url: '/b.png', width: 320, height: 180, source }))
      .toBe('![new](/b.png "caption"){align=center width=320 data-x=1 height=180}')
  })

  it('renders pinned Cherry dimensions and aligned image groups', () => {
    const markdown = '::: center\n![甲](/a.png){width=320 height=180} ![乙](/b.png){width=240 height=120}\n:::'
    const html = new CherryRenderAdapter().render({ documentId: 'image-dimensions', markdown, revision: 1 }).html
    const template = document.createElement('template')
    template.innerHTML = html
    const images = [...template.content.querySelectorAll('img')]

    expect(images).toHaveLength(2)
    expect(images[0]?.getAttribute('width')).toBe('320')
    expect(images[0]?.getAttribute('height')).toBe('180')
    expect(images[0]?.closest('.cherry-text-align__center')).not.toBeNull()
  })
})
