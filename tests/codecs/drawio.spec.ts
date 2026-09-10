import { describe, expect, it } from 'vitest'

import { CherryRenderAdapter } from '../../src/adapters'
import { CodecRegistry, drawioCodec, drawioSource, parseDrawioAt, projectOrdinaryMarkdown } from '../../src/codecs'

describe('Cherry draw.io codec', () => {
  const png = 'data:image/png;base64,AAAA'
  const xml = '<mxfile host="W-Editor"><diagram id="page-1"/></mxfile>'
  const source = '![Architecture](data:image/png;base64,AAAA){data-type=drawio data-xml=%3Cmxfile%20host=%22W-Editor%22%3E%3Cdiagram%20id=%22page-1%22/%3E%3C/mxfile%3E}'

  it('serializes the exact Cherry PNG plus encodeURI XML form and projects a semantic node', () => {
    expect(drawioSource('Architecture', png, xml)).toBe(source)
    expect(parseDrawioAt(source, 0)).toEqual({
      commandId: 'insert.drawio',
      name: 'Architecture',
      png,
      source,
      sourceSpan: { from: 0, to: source.length },
      xml,
    })
    const projection = projectOrdinaryMarkdown({ documentId: 'drawio', markdown: source, revision: 3 })
    expect(projection.content.content?.[0]).toMatchObject({
      attrs: {
        codecId: 'drawio',
        editorId: 'drawio-editor',
        kind: 'drawio',
        name: 'Architecture',
        png,
        source,
        xml,
      },
      type: 'semanticBlock',
    })
    expect(projection.map.entries[0]?.safePatchUnit.strategy).toEqual({
      editorId: 'drawio-editor',
      kind: 'semantic-editor',
    })
  })

  it('recognizes through the registry and renders the portable PNG through pinned Cherry', () => {
    const registry = new CodecRegistry([drawioCodec])
    expect(registry.scanBlocks({ markdown: source, revision: 1 })[0]).toMatchObject({ codecId: 'drawio', originalSource: source })
    const html = new CherryRenderAdapter().render({ documentId: 'drawio-preview', markdown: source, revision: 1 }).html
    const template = document.createElement('template')
    template.innerHTML = html
    const image = template.content.querySelector('img')
    expect(image?.getAttribute('src')).toBe(png)
    expect(image?.getAttribute('data-type')).toBe('drawio')
  })

  it('rejects non-PNG data, non-mxfile XML, invalid names, malformed encoding, and partial constructs', () => {
    expect(() => drawioSource('Diagram', 'data:image/gif;base64,AAAA', xml)).toThrow()
    expect(() => drawioSource('Diagram]', png, xml)).toThrow()
    expect(() => drawioSource('Diagram', png, '<svg/>')).toThrow()
    expect(parseDrawioAt('![Diagram](data:image/png;base64,AAAA){data-type=drawio data-xml=%ZZ}', 0)).toBeNull()
    expect(parseDrawioAt(`prefix ${source}`, 0)).toBeNull()
  })
})

describe('durable draw.io preview URLs', () => {
  it('round trips a stored PNG address with editable XML through the original codec', () => {
    const xml = '<mxfile><diagram>editable</diagram></mxfile>'
    const source = drawioSource('Diagram', '/api/blog-editor/assets/abc.png', xml)
    expect(parseDrawioAt(source, 0)).toMatchObject({png:'/api/blog-editor/assets/abc.png',xml})
  })
  it('rejects executable and protocol-relative previews', () => {
    for (const url of ['javascript:alert(1)', '//evil.test/image.png', '/\\evil.test/x']) {
      expect(() => drawioSource('Diagram', url, '<mxfile/>')).toThrow()
    }
  })
})
