import { describe, expect, it, vi } from 'vitest'

import {
  createLayeredSettingsStore,
  createMemorySettingsStore,
} from '../../packages/editor-vue/src/services/settingsStore'

describe('layered SettingsStore', () => {
  it('resolves product < site < user and restores the site default', () => {
    const store = createLayeredSettingsStore({
      productDefaults: { theme: 'gray', lineSpacing: 'standard', language: 'en' },
      siteDefaults: { theme: 'blue', language: 'zh' },
      userOverrides: { theme: 'dark' },
    })

    expect(store.getResolved()).toEqual({ theme: 'dark', lineSpacing: 'standard', language: 'zh' })
    store.clearUserOverride('theme')
    expect(store.getResolved()).toEqual({ theme: 'blue', lineSpacing: 'standard', language: 'zh' })
    store.setUserOverride('lineSpacing', 'double')
    expect(store.get('lineSpacing')).toBe('double')
  })

  it('emits immutable user override changes and offers a session-memory adapter', () => {
    const store = createLayeredSettingsStore({ productDefaults: { theme: 'gray' } })
    const subscriber = vi.fn()
    const unsubscribe = store.subscribe(subscriber)

    store.setUserOverride('theme', 'abyss')
    expect(subscriber).toHaveBeenCalledWith({ key: 'theme', value: 'abyss' })
    const change = subscriber.mock.calls[0]?.[0] as { key: string; value: unknown }
    expect(Object.isFrozen(change)).toBe(true)
    unsubscribe()
    store.clearUserOverride('theme')
    expect(subscriber).toHaveBeenCalledTimes(1)

    const memory = createMemorySettingsStore({ siteDefaults: { theme: 'blue' } })
    expect(memory.getSiteDefaults()).toEqual({ theme: 'blue' })
    memory.setUserOverride('theme', 'red')
    expect(memory.getUserOverrides()).toEqual({ theme: 'red' })
  })
})
