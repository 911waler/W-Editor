import { describe, expect, it, vi } from 'vitest'

import type { DocumentSnapshot } from '../../src/core'
import { WorkspaceModeAdapters } from '../../src/services'

const initial = Object.freeze({
  documentId: 'article-1',
  markdown: '# Exact\r\n\r\nsource',
  revision: 4,
}) satisfies DocumentSnapshot

describe('workspace mode adapters', () => {
  it('prepares without changing the visible surface and activates synchronously', () => {
    const renderer = { render: vi.fn((snapshot: DocumentSnapshot) => ({ html: '<h1>Exact</h1>', snapshot })) }
    const modes = new WorkspaceModeAdapters(initial, renderer)
    const published = vi.fn()
    modes.subscribe(published)

    const prepared = modes.adapters.visual.prepare(initial)

    expect(prepared).not.toBeInstanceOf(Promise)
    expect(modes.snapshot()).toEqual({ markdown: initial.markdown, mode: 'source', revision: 4 })
    if (prepared instanceof Promise) throw new Error('Expected synchronous visual preparation.')
    prepared.activate()
    expect(modes.snapshot()).toEqual({ markdown: initial.markdown, mode: 'visual', revision: 4 })
    expect(published).toHaveBeenCalledOnce()
  })

  it('prepares final preview through the renderer for the exact revision', () => {
    const renderer = { render: vi.fn((snapshot: DocumentSnapshot) => ({ html: '<h1>Exact</h1>', snapshot })) }
    const modes = new WorkspaceModeAdapters(initial, renderer)

    const prepared = modes.adapters.preview.prepare(initial)

    if (prepared instanceof Promise) throw new Error('Expected synchronous preview preparation.')
    expect(renderer.render).toHaveBeenCalledWith(initial)
    expect(modes.snapshot().mode).toBe('source')
    prepared.activate()
    expect(modes.snapshot()).toEqual({ html: '<h1>Exact</h1>', mode: 'preview', revision: 4 })
  })

  it('prepares application Preview through the Visual projection without invoking the renderer', () => {
    const renderer = { render: vi.fn(() => { throw new Error('The renderer must not run.') }) }
    const prepareVisual = vi.fn()
    const modes = new WorkspaceModeAdapters(initial, renderer, 'source', prepareVisual, 'visual-readonly')

    const prepared = modes.adapters.preview.prepare(initial)

    if (prepared instanceof Promise) throw new Error('Expected synchronous preview preparation.')
    expect(prepareVisual).toHaveBeenCalledWith(initial)
    expect(renderer.render).not.toHaveBeenCalled()
    prepared.activate()
    expect(modes.snapshot()).toEqual({ html: '', mode: 'preview', revision: 4 })
  })

  it('discarding a prepared surface preserves the current surface', () => {
    const modes = new WorkspaceModeAdapters(initial, { render: (snapshot) => ({ html: '', snapshot }) })
    const prepared = modes.adapters.visual.prepare(initial)
    if (prepared instanceof Promise) throw new Error('Expected synchronous visual preparation.')

    prepared.discard()
    prepared.activate()

    expect(modes.snapshot()).toEqual({ markdown: initial.markdown, mode: 'source', revision: 4 })
  })

  it('runs visual projection preflight before publishing or activating the target surface', () => {
    const failure = Object.assign(new Error('Injected real projector failure.'), { code: 'CODEC_THROW' })
    const prepareVisual = vi.fn(() => { throw failure })
    const modes = new WorkspaceModeAdapters(
      initial,
      { render: (snapshot) => ({ html: '', snapshot }) },
      'source',
      prepareVisual,
    )
    const published = vi.fn()
    modes.subscribe(published)

    expect(() => modes.adapters.visual.prepare(initial)).toThrow(failure)
    expect(prepareVisual).toHaveBeenCalledWith(initial)
    expect(modes.snapshot()).toEqual({ markdown: initial.markdown, mode: 'source', revision: 4 })
    expect(published).not.toHaveBeenCalled()
  })
})
