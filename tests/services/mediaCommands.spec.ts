import { describe, expect, it } from 'vitest'

import { createMediaCommandPlan, mediaAtSelection } from '../../src/services'
import { DocumentSession } from '../../src/core'

describe('media command plans', () => {
  it.each(['Before\n\nAfter', '\n\n'])('aligns a new source image on an unowned empty line in %j', (markdown) => {
    const from = markdown.startsWith('Before') ? 7 : 1
    const result = createMediaCommandPlan({ documentId: 'blank', markdown, revision: 0 },
      { from, to: from }, 'image', 'New', '/new.png', 'blank-layout',
      { width: null, height: null, alignment: 'center' })
    const patch = result.plan.patches[0]!
    const updated = markdown.slice(0, patch.from) + patch.replacement + markdown.slice(patch.to)
    expect(updated).toContain('::: center\n![New](/new.png)\n:::')
  })

  it('keeps an indented list continuation image inside its list while changing dimensions', () => {
    const markdown = '- Item\n\n  ![Old](/a.png){width=320}'
    const from = markdown.indexOf('Old')
    const result = createMediaCommandPlan({ documentId: 'continuation', markdown, revision: 0 },
      { from, to: from }, 'image', 'New', '/a.png', 'nested-layout',
      { width: 160, height: null, alignment: 'center' })
    const patch = result.plan.patches[0]!
    expect(markdown.slice(0, patch.from) + patch.replacement + markdown.slice(patch.to))
      .toBe('- Item\n\n  ![New](/a.png){width=160}')
  })
  it('updates exact image dimensions and clears them without losing title or unknown attributes', () => {
    const markdown = 'Before ![Old](/a.png "Title"){width=320 height=180 loading=lazy} after'
    const session = new DocumentSession({ documentId: 'image-layout', markdown })
    const sized = createMediaCommandPlan(session.snapshot(), { from: 12, to: 12 },
      'image', 'New', '/new.png', 'size', { width: 640, height: 240 })
    expect(session.previewPatchPlan(sized.plan)).toBe('Before ![New](/new.png "Title"){width=640 height=240 loading=lazy} after')
    session.commitPatchPlan(sized.plan)
    const reset = createMediaCommandPlan(session.snapshot(), { from: 12, to: 12 },
      'image', 'New', '/new.png', 'reset', { width: null, height: null })
    expect(session.previewPatchPlan(reset.plan)).toBe('Before ![New](/new.png "Title"){ loading=lazy} after')
    expect(reset.source).toBe('![New](/new.png "Title"){ loading=lazy}')
  })

  it.each(['left', 'center', 'right'] as const)('applies image size and %s alignment to its whole paragraph in one checked patch', (alignment) => {
    const markdown = 'Keep\n\nBefore\n![Old](/a.png) ![Other](/b.png) after\n\nTail'
    const session = new DocumentSession({ documentId: `image-${alignment}`, markdown })
    const from = markdown.indexOf('Old')
    const result = createMediaCommandPlan(session.snapshot(), { from, to: from },
      'image', 'New', '/new.png', 'layout', { width: 400, height: 200, alignment })
    const body = 'Before\n![New](/new.png){width=400 height=200} ![Other](/b.png) after'
    expect(result.plan.patches).toHaveLength(1)
    expect(session.previewPatchPlan(result.plan)).toBe(alignment === 'left'
      ? `Keep\n\n${body}\n\nTail`
      : `Keep\n\n::: ${alignment}\n${body}\n:::\n\nTail`)
    const next = session.previewPatchPlan(result.plan)
    expect(next.slice(result.selection.from - result.source.length, result.selection.to)).toBe(result.source)
  })

  it.each(['left', 'center', 'right'] as const)('keeps an existing %s image alignment when applying the same setting', (alignment) => {
    const markdown = `Keep\n\n::: ${alignment}\nBefore ![Old](/a.png){width=320 height=180} after\n:::\n\nTail`
    const session = new DocumentSession({ documentId: `same-${alignment}`, markdown })
    const from = markdown.indexOf('Old')
    const result = createMediaCommandPlan(session.snapshot(), { from, to: from },
      'image', 'New', '/a.png', 'same', { width: null, height: null, alignment })
    expect(session.previewPatchPlan(result.plan)).toBe(`Keep\n\n::: ${alignment}\nBefore ![New](/a.png) after\n:::\n\nTail`)
  })

  it('changes an existing image paragraph alignment without touching surrounding blocks', () => {
    const markdown = 'Keep\n\n::: center\n![Old](/a.png){width=320}\n\nAnother paragraph\n:::\n\nTail'
    const session = new DocumentSession({ documentId: 'change-alignment', markdown })
    const from = markdown.indexOf('Old')
    const result = createMediaCommandPlan(session.snapshot(), { from, to: from },
      'image', 'New', '/new.png', 'align-right', { width: 160, height: null, alignment: 'right' })
    expect(result.plan.patches).toHaveLength(1)
    expect(session.previewPatchPlan(result.plan)).toBe('Keep\n\n::: right\n![New](/new.png){width=160}\n\nAnother paragraph\n:::\n\nTail')
  })

  it.each([
    '- Item\n  ![Old](/a.png){width=320}',
    '| Image |\n| --- |\n| ![Old](/a.png){width=320} |',
    '> ![Old](/a.png){width=320}',
  ])('ignores unsupported nested alignment while updating image metadata: %s', (markdown) => {
    const session = new DocumentSession({ documentId: 'nested-image-layout', markdown })
    const from = markdown.indexOf('Old')
    const result = createMediaCommandPlan(session.snapshot(), { from, to: from },
      'image', 'New', '/new.png', 'nested', { width: 160, height: 80, alignment: 'center' })
    expect(session.previewPatchPlan(result.plan)).toBe(markdown.replace('![Old](/a.png){width=320}', '![New](/new.png){width=160 height=80}'))
  })

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
