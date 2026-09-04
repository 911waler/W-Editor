import { describe, expect, it } from 'vitest'

import { createLayeredSettingsStore } from '../../packages/editor-vue/src/services/settingsStore'
import {
  PlaygroundCompatibilityAdapter,
  PLAYGROUND_SETTINGS_KEYS,
} from '../../apps/playground/src/services/browserCompatibilityAdapter'

describe('playground SettingsStore consumers', () => {
  it('maps the legacy theme, spacing, shortcut and recent-color keys to user overrides', () => {
    const storage = window.localStorage
    storage.setItem('w-editor:appearance-theme', 'abyss')
    storage.setItem('w-editor:line-spacing', 'double')
    storage.setItem('w-editor:v1:preferences', JSON.stringify({
      schemaVersion: 1,
      shortcutBindings: { 'text.bold': 'Mod-b' },
    }))
    storage.setItem('cherry-recent-colors', JSON.stringify(['#abcdef']))
    const compatibility = new PlaygroundCompatibilityAdapter(storage)
    const settings = createLayeredSettingsStore({
      persistence: compatibility,
      productDefaults: {
        [PLAYGROUND_SETTINGS_KEYS.appearanceTheme]: 'gray',
        [PLAYGROUND_SETTINGS_KEYS.lineSpacing]: 'standard',
        [PLAYGROUND_SETTINGS_KEYS.shortcutBindings]: {},
        [PLAYGROUND_SETTINGS_KEYS.recentColors]: [],
      },
      userOverrides: compatibility.getUserOverrides(),
    })

    expect(settings.get('appearanceTheme')).toBe('abyss')
    expect(settings.get('lineSpacing')).toBe('double')
    expect(settings.get('shortcutBindings')).toEqual({ 'text.bold': 'Mod-b' })
    expect(settings.get('recentColors')).toEqual(['#abcdef'])

    settings.clearUserOverride(PLAYGROUND_SETTINGS_KEYS.appearanceTheme)
    expect(settings.get('appearanceTheme')).toBe('gray')
  })
})
