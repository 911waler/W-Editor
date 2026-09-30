import { describe, expect, it } from 'vitest'

import { createMediaCommandPlan, mediaAtSelection } from '../../src/services'

describe('media command plans', () => {
  it('inserts an image at the source cursor and edits just one inline token preserving title and size', () => {
    const inserted = createMediaCommandPlan({ documentId: 'inline', markdown: 'Left Right', revision: 0 },
      { from: 5, to: 5 }, 'image', 'Photo', '/photo.png', 'insert')
    expect(inserted.plan.patches[0]).toMatchObject({ from: 5, to: 5, replacement: '![Photo](/photo.png)' })
    const markdown = 'A ![Old](/a.png "Title"){width=320 height=180} ![B](/b.png)'
    const result = createMediaCommandPlan({ documentId: 'inline', markdown, revision: 0 },
      { from: 6, to: 6 }, 'image', 'New', '/new.png', 'edit')
    expect(result.plan.patches[0]).toMatchObject({ from: 2,
      expected: '![Old](/a.png "Title"){width=320 height=180}',
      replacement: '![New](/new.png "Title"){width=320 height=180}' })
    expect(mediaAtSelection('`![Not an image](/a.png)`', { from: 5, to: 5 })).toBeNull()
  })

  it('inserts exact Cherry media source in one checked patch', () => {
    const result = createMediaCommandPlan(
      { documentId: 'media-empty', markdown: '', revision: 0 },
      { from: 0, to: 0 },
      'audio',
      'Fixture audio',
      'https://assets.example.test/audio.wav',
      'media-empty:1',
    )
    expect(result.plan.patches).toEqual([{
      codecId: 'media-audio',
      expected: '',
      from: 0,
      replacement: '!audio[Fixture audio](https://assets.example.test/audio.wav)',
      to: 0,
    }])
  })

  it('finds and replaces only a selected same-kind media construct', () => {
    const original = '![Original](https://assets.example.test/original.png)'
    const markdown = `Before\n\n${original}\n\nAfter`
    const selected = mediaAtSelection(markdown, { from: markdown.indexOf('Original'), to: markdown.indexOf('Original') })
    expect(selected?.name).toBe('Original')
    const result = createMediaCommandPlan(
      { documentId: 'media-edit', markdown, revision: 7 },
      { from: markdown.indexOf('Original'), to: markdown.indexOf('Original') },
      'image',
      'Updated',
      'https://assets.example.test/updated.png',
      'media-edit:1',
    )
    expect(result.plan.patches[0]).toEqual({
      codecId: 'media-image',
      expected: original,
      from: markdown.indexOf(original),
      replacement: '![Updated](https://assets.example.test/updated.png)',
      to: markdown.indexOf(original) + original.length,
    })
  })
})
