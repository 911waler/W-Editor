import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import NwuReader from '../../src/ui/NwuReader.vue'

function reader(markdown: string) {
  return mount(NwuReader, { attachTo: document.body, props: { config: {
    userId: 1, csrfToken: 'test', initialDocumentId: 'blog:68', readonly: true,
    apiBase: '/api/blog-editor', blogListUrl: '/blogs',
    readerDocument: { documentId: 'blog:68', title: '导航测试', markdown },
  } } })
}
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia')
afterEach(() => {
  vi.useRealTimers()
  if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia)
  else Reflect.deleteProperty(window, 'matchMedia')
  document.body.replaceChildren()
})

it('shows back-to-top after one content viewport and scrolls the reading pane, hiding again at top', async () => {
  const app = reader('## 正文')
  try {
    await flushPromises()
    const pane = app.get<HTMLElement>('.nwu-reader-content')
    Object.defineProperty(pane.element, 'clientHeight', { value: 600 })
    const scroll = vi.fn(); pane.element.scrollTo = scroll
    expect(app.find('[data-reader-back-top]').exists()).toBe(false)
    pane.element.scrollTop = 700
    await pane.trigger('scroll')
    const button = app.find('[data-reader-back-top]')
    expect(button.exists()).toBe(true)
    await button.trigger('click')
    expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    pane.element.scrollTop = 0
    await pane.trigger('scroll')
    expect(app.find('[data-reader-back-top]').exists()).toBe(false)
  } finally { app.unmount() }
})

it.each([
  ['generated', '[目录](#section)\n\n## Section'],
  ['encoded', '[目录](#%E7%AB%A0%E8%8A%82)\n\n## 章节'],
  ['manual id', '[目录](#g06)\n\n<a id="g06"></a>\n\n## Section'],
  ['manual name', '[目录](#g06)\n\n<a name="g06"></a>\n\n## Section'],
  ['generated TOC', '[[toc]]\n\n## Section'],
])('returns from a %s heading to the clicked body TOC entry', async (_, markdown) => {
  const app = reader(markdown)
  try {
    await flushPromises()
    const root = app.get('.ProseMirror')
    const link = root.get<HTMLAnchorElement>('a[href^="#"]')
    const heading = root.get<HTMLElement>('h2')
    const scroll = vi.fn(); link.element.scrollIntoView = scroll
    await heading.trigger('click')
    expect(scroll).not.toHaveBeenCalled()
    await link.trigger('click', { button: 0 })
    const currentLink = root.get<HTMLAnchorElement>('a[href^="#"]')
    currentLink.element.scrollIntoView = scroll
    await heading.trigger('click', { button: 0 })
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
    expect(document.activeElement).toBe(currentLink.element)
    expect(currentLink.classes()).toContain('nwu-reader-toc-returned')
    expect(root.text()).toContain('目录')
  } finally { app.unmount() }
})

it('returns to the most recently clicked entry and supports keyboard without hijacking nested links', async () => {
  const app = reader('[第一目录](#section)\n\n[第二目录](#section)\n\n## Section\n\n## [外链](https://example.invalid)')
  try {
    await flushPromises()
    const root = app.get('.ProseMirror')
    const links = root.findAll<HTMLAnchorElement>('a[href="#section"]')
    const first = vi.fn(); links[0]!.element.scrollIntoView = first
    const second = vi.fn(); links[1]!.element.scrollIntoView = second
    await links[0]!.trigger('click', { button: 0 })
    await links[1]!.trigger('click', { button: 0 })
    const heading = root.get('h2')
    await heading.trigger('keydown', { key: 'Enter' })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
    const external = root.get('h2 a')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })
    external.element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  } finally { app.unmount() }
})

it('respects reduced motion and clears the return highlight', async () => {
  const app = reader('[目录](#section)\n\n## Section')
  try {
    await flushPromises()
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) })
    vi.useFakeTimers()
    const link = app.get<HTMLAnchorElement>('.ProseMirror a[href]')
    const scroll = vi.fn(); link.element.scrollIntoView = scroll
    await link.trigger('click', { button: 0 })
    await app.get('.ProseMirror h2').trigger('keydown', { key: 'Enter' })
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' })
    await vi.advanceTimersByTimeAsync(1700)
    expect(link.classes()).not.toContain('nwu-reader-toc-returned')
    const pane = app.get<HTMLElement>('.nwu-reader-content')
    Object.defineProperty(pane.element, 'clientHeight', { value: 600 })
    pane.element.scrollTop = 700
    pane.element.scrollTo = scroll
    await pane.trigger('scroll')
    await app.get('[data-reader-back-top]').trigger('click')
    expect(scroll).toHaveBeenLastCalledWith({ top: 0, behavior: 'auto' })
  } finally { app.unmount() }
})
