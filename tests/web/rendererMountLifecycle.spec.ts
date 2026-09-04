import { describe, expect, it, vi } from 'vitest'

import { mountWRenderer } from '../../packages/editor-web/src/index'

describe('mountWRenderer lifecycle and profiles', () => {
  it('mounts a reader, updates canonical Markdown, and never exposes author events', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const onAuthorEvent = vi.fn()
    const instance = mountWRenderer(container, {
      markdown: '# Reader\n\n```ts\nconst value = 1\n```',
      onAuthorEvent,
      profile: 'reader',
    })

    expect(instance.snapshot()).toMatchObject({ profile: 'reader', revision: 0 })
    expect(container.querySelector('[data-w-editor-profile="reader"]')).not.toBeNull()
    const presentation = container.querySelector<HTMLElement>('[data-tiptap-presentation] .ProseMirror')
    expect(presentation).not.toBeNull()
    expect(presentation?.dataset['presentationEngine']).toBe('tiptap')
    expect(presentation?.dataset['rendererProfile']).toBe('reader')
    expect(presentation?.getAttribute('contenteditable')).toBe('false')
    expect(container.querySelector('[data-w-editor-action="edit-code"]')).toBeNull()
    expect(container.querySelector('[data-semantic-edit]')).toBeNull()
    expect(container.querySelector('[data-semantic-copy="code-block"]')).not.toBeNull()

    const updated = instance.setMarkdown('# Updated')
    expect(updated).toMatchObject({ markdown: '# Updated', profile: 'reader', revision: 1 })
    expect(onAuthorEvent).not.toHaveBeenCalled()

    await expect(instance.destroy()).resolves.toEqual({ status: 'destroyed' })
    expect(container.childElementCount).toBe(0)
    container.remove()
  })

  it('keeps the author-preview code action in the author profile', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const onAuthorEvent = vi.fn()
    const instance = mountWRenderer(container, {
      markdown: '```ts\nconst value = 1\n```',
      onAuthorEvent,
      profile: 'author-preview',
    })

    const edit = container.querySelector<HTMLButtonElement>('[data-w-editor-action="edit-code"]')
    expect(edit).not.toBeNull()
    edit?.click()
    expect(onAuthorEvent).toHaveBeenCalledWith({ index: 0, type: 'code-edit' })

    await instance.destroy()
    container.remove()
  })

  it('commits an author-preview task toggle to the renderer Markdown snapshot and emits one controlled event', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const onAuthorEvent = vi.fn()
    const instance = mountWRenderer(container, {
      markdown: '- [ ] Review the release',
      onAuthorEvent,
      profile: 'author-preview',
    })

    const task = container.querySelector<HTMLInputElement>('input[type="checkbox"]')
    expect(task).not.toBeNull()
    task?.click()

    expect(instance.snapshot().markdown).toBe('- [x] Review the release')
    expect(instance.snapshot().revision).toBe(1)
    expect(onAuthorEvent).toHaveBeenCalledOnce()
    expect(onAuthorEvent).toHaveBeenCalledWith(expect.objectContaining({
      checked: true,
      index: 0,
      type: 'task-toggle',
    }))

    await instance.destroy()
    container.remove()
  })

  it('renders an unknown block once through a sanitized atomic presentation fallback', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const source = '::: mystery\nFallback body\n:::'
    const instance = mountWRenderer(container, { markdown: source, profile: 'reader' })

    const fallbacks = container.querySelectorAll('[data-w-editor-presentation-fallback="cherry-raw"]')
    expect(fallbacks).toHaveLength(1)
    expect(fallbacks[0]?.textContent).toContain('Fallback body')
    expect(container.querySelector('[data-w-editor-node="raw-block"]')).toBeNull()
    expect(instance.snapshot().markdown).toBe(source)

    await instance.destroy()
    container.remove()
  })
})
