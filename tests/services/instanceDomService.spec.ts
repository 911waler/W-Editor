import { describe, expect, it, vi } from 'vitest'

import { createInstanceDomService } from '../../packages/editor-vue/src/services/instanceDomService'

describe('instance DOM service', () => {
  it('owns ids, overlay roots, scoped queries and listener cleanup per instance', () => {
    const firstRoot = document.createElement('section')
    const secondRoot = document.createElement('section')
    firstRoot.innerHTML = '<button data-owned="first">first</button>'
    secondRoot.innerHTML = '<button data-owned="second">second</button>'
    document.body.append(firstRoot, secondRoot)
    const first = createInstanceDomService(firstRoot, { instanceId: 'reader-a' })
    const second = createInstanceDomService(secondRoot, { instanceId: 'reader-b' })
    const listener = vi.fn()

    expect(first.instanceId).toBe('reader-a')
    expect(first.createId('code')).toBe('w-editor-reader-a-code')
    expect(first.query('[data-owned="second"]')).toBeNull()
    expect(second.query('[data-owned="second"]')?.textContent).toBe('second')
    expect(first.overlayRoot.id).toBe('w-editor-reader-a-overlay')
    expect(first.overlayRoot.parentElement).toBe(firstRoot)
    first.listen(firstRoot, 'click', listener)
    firstRoot.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(listener).toHaveBeenCalledTimes(1)

    first.destroy()
    expect(firstRoot.querySelector('[data-w-editor-overlay="reader-a"]')).toBeNull()
    firstRoot.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(listener).toHaveBeenCalledTimes(1)
    expect(second.overlayRoot.isConnected).toBe(true)

    second.destroy()
    firstRoot.remove()
    secondRoot.remove()
  })
})
