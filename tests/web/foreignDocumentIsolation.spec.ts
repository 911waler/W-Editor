import { describe, expect, it, vi } from 'vitest'

import { mountWRenderer, type WRendererInstance } from '../../packages/editor-web/src/index'

describe('foreign-document Renderer isolation', () => {
  it('keeps temporary hosts, hydrated actions, clipboard, and destroy inside the iframe realm', async () => {
    const iframe = document.createElement('iframe')
    document.body.append(iframe)
    const foreignDocument = iframe.contentDocument
    const foreignWindow = iframe.contentWindow
    if (foreignDocument === null || foreignWindow === null) throw new Error('Expected an iframe document realm.')
    const firstContainer = foreignDocument.createElement('div')
    const secondContainer = foreignDocument.createElement('div')
    foreignDocument.body.append(firstContainer, secondContainer)
    const parentWriteText = vi.fn(async () => undefined)
    const foreignWriteText = vi.fn(async () => undefined)
    const parentClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    const foreignClipboard = Object.getOwnPropertyDescriptor(foreignWindow.navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: parentWriteText } })
    Object.defineProperty(foreignWindow.navigator, 'clipboard', { configurable: true, value: { writeText: foreignWriteText } })
    let first: WRendererInstance | null = null
    let second: WRendererInstance | null = null

    try {
      const parentChildrenBefore = document.body.childElementCount
      first = mountWRenderer(firstContainer, {
        markdown: '```ts\nconst first = 1\n```',
        profile: 'reader',
      })
      second = mountWRenderer(secondContainer, {
        markdown: '# Second reader',
        profile: 'reader',
      })

      expect(document.body.childElementCount).toBe(parentChildrenBefore)
      const firstRoot = firstContainer.querySelector<HTMLElement>('[data-w-editor-instance]')
      expect(firstRoot?.ownerDocument).toBe(foreignDocument)
      firstContainer.querySelector<HTMLButtonElement>('[data-w-editor-action="copy-code"]')?.click()
      await Promise.resolve()
      expect(foreignWriteText).toHaveBeenCalledWith('const first = 1')
      expect(parentWriteText).not.toHaveBeenCalled()

      await expect(first.destroy()).resolves.toEqual({ status: 'destroyed' })
      expect(firstContainer.childElementCount).toBe(0)
      expect(second.snapshot()).toMatchObject({ markdown: '# Second reader', profile: 'reader' })
      expect(secondContainer.querySelector('[data-w-editor-instance]')).not.toBeNull()
      expect(document.body.childElementCount).toBe(parentChildrenBefore)
    } finally {
      await first?.destroy()
      await second?.destroy()
      await vi.runAllTimersAsync()
      if (parentClipboard === undefined) Reflect.deleteProperty(navigator, 'clipboard')
      else Object.defineProperty(navigator, 'clipboard', parentClipboard)
      if (foreignClipboard === undefined) Reflect.deleteProperty(foreignWindow.navigator, 'clipboard')
      else Object.defineProperty(foreignWindow.navigator, 'clipboard', foreignClipboard)
      iframe.remove()
    }
  })
})
