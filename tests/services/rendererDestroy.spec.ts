import { describe, expect, it, vi } from 'vitest'

import {
  hydrateRendererContent,
  type MermaidPreviewRendererContract,
  type RendererHydrationOptions,
} from '../../packages/editor-vue/src/adapters'
import { createInstanceDomService } from '../../packages/editor-vue/src/services/instanceDomService'

describe('Renderer destroy lifecycle', () => {
  it('does not let delayed Mermaid hydration or listeners survive destroy', async () => {
    const root = document.createElement('div')
    root.innerHTML = '<pre><code class="language-mermaid">flowchart LR\n  A --> B</code></pre>'
    document.body.append(root)
    let resolveRender: (svg: string) => void = () => undefined
    const renderer: MermaidPreviewRendererContract = {
      render: vi.fn(() => new Promise<string>((resolve) => { resolveRender = resolve })),
    }
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const options = {
      locale: 'en',
      mermaidRenderer: renderer,
      profile: 'reader',
    } as unknown as RendererHydrationOptions & { readonly mermaidRenderer: MermaidPreviewRendererContract }
    const dispose = hydrateRendererContent(root, options)
    const mutation = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText' })
    const copy = root.querySelector<HTMLButtonElement>('[data-w-editor-action="copy-code"]')
    dispose()
    copy?.click()
    resolveRender('<svg data-delayed="true"></svg>')
    await Promise.resolve()

    expect(renderer.render).toHaveBeenCalledTimes(1)
    expect(writeText).not.toHaveBeenCalled()
    expect(root.querySelector('[data-w-editor-mermaid-preview]')).toBeNull()
    expect(root.dispatchEvent(mutation)).toBe(true)
    expect(mutation.defaultPrevented).toBe(false)
    root.remove()
  })

  it('disconnects all instance-owned observers and listeners while another instance remains active', () => {
    const firstRoot = document.createElement('div')
    const secondRoot = document.createElement('div')
    document.body.append(firstRoot, secondRoot)
    const first = createInstanceDomService(firstRoot, { instanceId: 'destroy-first' })
    const second = createInstanceDomService(secondRoot, { instanceId: 'keep-second' })
    const disconnect = vi.fn()
    const observe = vi.fn()
    const observer = { disconnect, observe }
    first.observe(observer, firstRoot, { childList: true })
    const firstListener = vi.fn()
    const secondListener = vi.fn()
    first.listen(firstRoot, 'custom', firstListener)
    second.listen(secondRoot, 'custom', secondListener)

    first.destroy()
    firstRoot.dispatchEvent(new Event('custom'))
    secondRoot.dispatchEvent(new Event('custom'))
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(firstListener).not.toHaveBeenCalled()
    expect(secondListener).toHaveBeenCalledTimes(1)
    expect(second.overlayRoot.isConnected).toBe(true)
    second.destroy()
    firstRoot.remove()
    secondRoot.remove()
  })
})
