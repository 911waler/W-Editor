import { describe, expect, it, vi } from 'vitest'

import type { EditorMode } from '../../src/services'
import { ActiveModeHistory } from '../../src/services/activeModeHistory'

describe('ActiveModeHistory', () => {
  it('routes undo and redo only to the active native editor mode', () => {
    let mode: EditorMode = 'source'
    const source = { redo: vi.fn(() => true), undo: vi.fn(() => true) }
    const visual = { redo: vi.fn(() => true), undo: vi.fn(() => true) }
    const history = new ActiveModeHistory({ activeMode: () => mode, source, visual })

    expect(history.undo()).toBe(true)
    expect(source.undo).toHaveBeenCalledOnce()
    expect(visual.undo).not.toHaveBeenCalled()

    mode = 'visual'
    expect(history.redo()).toBe(true)
    expect(visual.redo).toHaveBeenCalledOnce()
    expect(source.redo).not.toHaveBeenCalled()

    mode = 'preview'
    expect(history.undo()).toBe(false)
    expect(history.redo()).toBe(false)
    expect(source.undo).toHaveBeenCalledOnce()
    expect(visual.redo).toHaveBeenCalledOnce()
  })
})
