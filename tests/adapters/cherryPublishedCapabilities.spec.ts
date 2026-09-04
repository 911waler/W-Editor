import { describe, expect, it, vi } from 'vitest'
import Cherry from 'cherry-markdown/dist/cherry-markdown.esm.js'
import * as echarts from 'echarts'
import mermaid from 'mermaid'

function createPublishedCherry(value: string, afterInit = vi.fn()): { cherry: Cherry; host: HTMLElement } {
  const host = document.createElement('div')
  host.id = `cherry-capability-${crypto.randomUUID()}`
  document.body.append(host)
  const cherry = new Cherry({
    id: host.id,
    value,
    externals: { echarts, mermaid },
    editor: { defaultModel: 'editOnly' },
    callback: { afterInit },
    toolbars: {
      toolbar: false,
      toolbarRight: false,
      bubble: false,
      float: false,
      sidebar: false,
    },
  })
  return { cherry, host }
}

describe('published Cherry 0.11.9 stable capabilities', () => {
  it('supplies edit-only lifecycle, exact initial value, selection, composition events, and rendering', () => {
    const initial = '# Source\n\ntext'
    const afterInit = vi.fn()
    const { cherry, host } = createPublishedCherry(initial, afterInit)
    const view = cherry.getCodeMirror()
    const content = view.contentDOM
    const destroyedContent = content

    try {
      expect(cherry.getValue()).toBe(initial)
      expect(afterInit).toHaveBeenCalled()
      expect(host.querySelector('.cherry-editor')).not.toBeNull()
      expect(cherry.getStatus()).toMatchObject({ editor: 'show', previewer: 'hide' })

      view.dispatch({ selection: { anchor: 2, head: 8 } })
      expect(view.state.selection.main).toMatchObject({ anchor: 2, head: 8 })
      expect(view.state.sliceDoc(2, 8)).toBe('Source')

      let composing = false
      const composingEvents: boolean[] = []
      content.addEventListener('compositionstart', () => {
        composing = true
        composingEvents.push(composing)
      })
      content.addEventListener('compositionend', () => {
        composing = false
        composingEvents.push(composing)
      })
      content.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '中' }))
      expect(composing).toBe(true)
      content.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中' }))
      expect(composing).toBe(false)
      expect(composingEvents).toEqual([true, false])

      expect(cherry.getHtml(false)).toContain('<h1')
      expect(cherry.getHtml(false)).toContain('Source')
    } finally {
      vi.clearAllTimers()
      cherry.destroy()
      host.remove()
    }

    expect(destroyedContent.isConnected).toBe(false)
  })

})
