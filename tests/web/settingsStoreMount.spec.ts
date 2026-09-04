import { describe, expect, it, vi } from 'vitest'

import type { SettingsStore, SettingsSubscriber } from '../../packages/editor-core/src/ports'

import { mountWEditor, mountWRenderer, type WEditorReadyEvent, type WRendererReadyEvent } from '../../packages/editor-web/src/index'

function createSettingsStore(
  siteDefaults: Readonly<Record<string, unknown>> | Promise<Readonly<Record<string, unknown>>>,
  userOverrides: Readonly<Record<string, unknown>> | Promise<Readonly<Record<string, unknown>>>,
) {
  let subscriber: ((change: { readonly key: string; readonly value: unknown | undefined }) => void) | null = null
  const store: SettingsStore = {
    clearUserOverride: vi.fn(),
    getSiteDefaults: () => siteDefaults,
    getUserOverrides: () => userOverrides,
    setUserOverride: vi.fn(),
    subscribe: (next: SettingsSubscriber) => {
      subscriber = next
      return () => { subscriber = null }
    },
  }
  return {
    emit(key: string, value: unknown | undefined): void {
      subscriber?.({ key, value })
    },
    store,
  }
}

describe('Web Mount SettingsStore lifecycle', () => {
  it('waits for asynchronous settings before ready and applies precedence plus live reset', async () => {
    let resolveSite!: (value: Readonly<Record<string, unknown>>) => void
    const settings = createSettingsStore(
      new Promise((resolve) => { resolveSite = resolve }),
      { appearanceTheme: 'dark', lineSpacing: 'double' },
    )
    const onReady = vi.fn<(event: WEditorReadyEvent) => void>()
    const container = document.createElement('div')
    document.body.append(container)
    const instance = mountWEditor(container, {
      document: { documentId: 'settings-async', markdown: '# Settings' },
      onReady,
      settingsStore: settings.store,
      theme: 'blue',
    })

    expect(onReady).not.toHaveBeenCalled()
    expect(container.querySelector('[data-w-editor-instance]')).not.toBeNull()
    expect(container.querySelector('[data-w-editor-instance]')?.getAttribute('data-theme')).toBe('blue')
    resolveSite({ appearanceTheme: 'green', lineSpacing: 'compact' })
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce())

    const root = container.querySelector<HTMLElement>('[data-w-editor-instance]')!
    expect(root.getAttribute('data-theme')).toBe('dark')
    expect(root.getAttribute('data-line-spacing')).toBe('double')
    expect(root.style.getPropertyValue('--w-editor-line-height')).toBe('2')

    settings.emit('appearanceTheme', undefined)
    settings.emit('lineSpacing', undefined)
    expect(root.getAttribute('data-theme')).toBe('green')
    expect(root.getAttribute('data-line-spacing')).toBe('compact')
    expect(instance.snapshot()).toMatchObject({ markdown: '# Settings', revision: 0 })

    await instance.destroy()
    expect(container.childElementCount).toBe(0)
    settings.emit('appearanceTheme', 'red')
    container.remove()
  })

  it('reports settings failure, keeps safe defaults, and does not mutate document state', async () => {
    const onReady = vi.fn()
    const onError = vi.fn()
    const settings = createSettingsStore(
      Promise.reject(new Error('settings unavailable')),
      { appearanceTheme: 'red' },
    )
    const container = document.createElement('div')
    document.body.append(container)
    const instance = mountWEditor(container, {
      document: { documentId: 'settings-failure', markdown: '# Safe', serverRevision: 'server-1' },
      onError,
      onReady,
      settingsStore: settings.store,
    })

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'SETTINGS_UNAVAILABLE' }),
    })))
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'SETTINGS_UNAVAILABLE' }),
    }))
    expect(onReady).toHaveBeenCalledOnce()
    expect(instance.snapshot()).toMatchObject({ markdown: '# Safe', revision: 0, serverRevision: 'server-1' })
    expect(container.querySelector('[data-w-editor-instance]')?.getAttribute('data-theme')).toBe('gray')

    await instance.destroy()
    container.remove()
  })

  it('applies SettingsStore to a Reader and releases its subscription on destroy', async () => {
    const settings = createSettingsStore({ appearanceTheme: 'violet', lineSpacing: 'compact' }, {})
    const onReady = vi.fn<(event: WRendererReadyEvent) => void>()
    const container = document.createElement('div')
    document.body.append(container)
    const instance = mountWRenderer(container, {
      markdown: '# Reader settings',
      onReady,
      profile: 'reader',
      settingsStore: settings.store,
    })

    expect(onReady).toHaveBeenCalledOnce()
    const root = container.querySelector<HTMLElement>('[data-w-editor-instance]')!
    expect(root.getAttribute('data-theme')).toBe('violet')
    expect(root.getAttribute('data-line-spacing')).toBe('compact')
    settings.emit('appearanceTheme', 'red')
    expect(root.getAttribute('data-theme')).toBe('red')

    await instance.destroy()
    expect(container.childElementCount).toBe(0)
    settings.emit('appearanceTheme', 'blue')
    container.remove()
  })
})
