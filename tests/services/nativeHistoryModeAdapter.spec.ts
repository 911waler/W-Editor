import { describe, expect, it, vi } from 'vitest'

import type { DocumentSnapshot } from '../../src/core'
import {
  NativeHistoryModeAdapter,
  type NativeHistorySurface,
} from '../../src/services/nativeHistoryModeAdapter'

class FakeNativeSurface implements NativeHistorySurface {
  readonly destroy = vi.fn()
  #position = 0
  #redo = 0

  edit(): void {
    this.#position += 1
    this.#redo = 0
  }

  undo = (): boolean => {
    if (this.#position === 0) return false
    this.#position -= 1
    this.#redo += 1
    return true
  }

  redo = (): boolean => {
    if (this.#redo === 0) return false
    this.#redo -= 1
    this.#position += 1
    return true
  }
}

const snapshot: DocumentSnapshot = Object.freeze({ documentId: 'article', markdown: 'source', revision: 4 })

function historyAdapter(mode: 'source' | 'visual') {
  const created: FakeNativeSurface[] = []
  const adapter = new NativeHistoryModeAdapter({
    activateSurface: vi.fn(),
    createSurface: vi.fn(() => {
      const surface = new FakeNativeSurface()
      created.push(surface)
      return surface
    }),
    deactivateSurface: vi.fn(),
    mode,
  })
  return { adapter, created }
}

describe('NativeHistoryModeAdapter', () => {
  it('keeps Cherry-source and Tiptap-visual history in independent native surfaces', async () => {
    const source = historyAdapter('source')
    const visual = historyAdapter('visual')
    const sourceActivation = await source.adapter.prepare(snapshot)
    sourceActivation.activate()
    source.adapter.current()?.edit()
    expect(source.adapter.undo()).toBe(true)
    expect(source.adapter.redo()).toBe(true)

    const visualActivation = await visual.adapter.prepare(snapshot)
    visualActivation.activate()
    visual.adapter.current()?.edit()
    expect(visual.adapter.undo()).toBe(true)
    expect(source.adapter.undo()).toBe(true)
    expect(source.adapter.segment()).toBe(1)
    expect(visual.adapter.segment()).toBe(1)
  })

  it('destroys the old surface and begins an empty history segment on reactivation', async () => {
    const source = historyAdapter('source')
    const first = await source.adapter.prepare(snapshot)
    first.activate()
    source.adapter.current()?.edit()
    const firstSurface = source.adapter.current()

    source.adapter.deactivate()
    expect(firstSurface?.destroy).toHaveBeenCalledOnce()
    const second = await source.adapter.prepare({ ...snapshot, revision: 5 })
    second.activate()

    expect(source.adapter.segment()).toBe(2)
    expect(source.adapter.current()).not.toBe(firstSurface)
    expect(source.adapter.undo()).toBe(false)
  })
})
