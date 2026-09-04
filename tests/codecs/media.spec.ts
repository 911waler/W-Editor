import { describe, expect, it } from 'vitest'

import { CherryRenderAdapter } from '../../src/adapters'
import { mediaSource, parseMediaAt, projectOrdinaryMarkdown } from '../../src/codecs'

describe('Cherry media codecs', () => {
  const fixtures = [
    ['image', 'Fixture image', 'https://assets.example.test/image.png', '![Fixture image](https://assets.example.test/image.png)'],
    ['audio', 'Fixture audio', 'https://assets.example.test/audio.wav', '!audio[Fixture audio](https://assets.example.test/audio.wav)'],
    ['video', 'Fixture video', 'https://assets.example.test/video.mp4', '!video[Fixture video](https://assets.example.test/video.mp4)'],
  ] as const

  it.each(fixtures)('preserves exact %s source and projects a typed editable semantic node', (kind, name, url, source) => {
    expect(mediaSource(kind, name, url)).toBe(source)
    expect(parseMediaAt(source, 0)).toEqual({
      commandId: `insert.${kind}`,
      kind,
      name,
      source,
      sourceSpan: { from: 0, to: source.length },
      url,
    })
    const projection = projectOrdinaryMarkdown({ documentId: `media-${kind}`, markdown: source, revision: 4 })
    expect(projection.content.content?.[0]).toMatchObject({
      attrs: {
        codecId: `media-${kind}`,
        editorId: 'media-editor',
        kind: 'media',
        mediaKind: kind,
        name,
        source,
        url,
      },
      type: 'semanticBlock',
    })
    expect(projection.map.entries[0]?.safePatchUnit.strategy).toEqual({
      editorId: 'media-editor',
      kind: 'semantic-editor',
    })
  })

  it('renders all three forms through pinned Cherry semantics and sanitization', () => {
    const markdown = fixtures.map((fixture) => fixture[3]).join('\n\n')
    const html = new CherryRenderAdapter().render({ documentId: 'media-preview', markdown, revision: 1 }).html
    const template = document.createElement('template')
    template.innerHTML = html
    expect(template.content.querySelector('img')?.getAttribute('src')).toBe('https://assets.example.test/image.png')
    expect(template.content.querySelector('audio')?.getAttribute('src')).toBe('https://assets.example.test/audio.wav')
    expect(template.content.querySelector('video')?.getAttribute('src')).toBe('https://assets.example.test/video.mp4')
    expect(template.content.querySelector('script')).toBeNull()
  })

  it('accepts safe inline raster images and rejects unsafe URLs, credentials, invalid names, and partial constructs', () => {
    expect(mediaSource('image', 'Image', 'data:image/png;base64,AAAA')).toBe('![Image](data:image/png;base64,AAAA)')
    expect(() => mediaSource('image', 'Image', 'data:image/svg+xml;base64,AAAA')).toThrow()
    expect(() => mediaSource('audio', 'Bad] name', 'https://assets.example.test/audio.wav')).toThrow()
    expect(parseMediaAt('!video[Video](blob:https://example.test/id)', 0)).toBeNull()
    expect(parseMediaAt('prefix ![Image](https://assets.example.test/image.png)', 0)).toBeNull()
  })
})
