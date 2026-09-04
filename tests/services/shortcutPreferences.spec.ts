import { describe, expect, it } from 'vitest'

import {
  SHORTCUT_PREFERENCES_KEY,
  ShortcutPreferenceRepository,
  findShortcutConflict,
  isReservedShortcut,
  migrateLegacyHeadingShortcuts,
  physicalShortcutFromKeyboardEvent,
  shortcutDisplayLabel,
  shortcutKeycaps,
} from '../../src/services/shortcutPreferences'

function keyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    key: 'k',
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as KeyboardEvent
}

describe('shortcut preferences', () => {
  it('adds the Ctrl+3, Ctrl+4, and Ctrl+5 defaults to legacy heading preferences without replacing custom bindings', () => {
    expect(migrateLegacyHeadingShortcuts({
      'block.h1': 'Mod-1',
      'block.h2': 'Mod-2',
      'text.bold': 'Mod-Alt-b',
    })).toEqual({
      'block.h1': 'Mod-1',
      'block.h2': 'Mod-2',
      'block.h3': 'Mod-3',
      'block.h4': 'Mod-4',
      'block.h5': 'Mod-5',
      'text.bold': 'Mod-Alt-b',
    })
  })

  it('normalizes physical modifiers and renders platform keycaps', () => {
    expect(physicalShortcutFromKeyboardEvent(keyEvent({ ctrlKey: true, key: 'K', shiftKey: true }))).toBe('Mod-Shift-k')
    expect(physicalShortcutFromKeyboardEvent(keyEvent({ key: 'F2' }))).toBe('F2')
    expect(physicalShortcutFromKeyboardEvent(keyEvent({ key: 'Control' }))).toBeNull()
    expect(physicalShortcutFromKeyboardEvent(keyEvent({ key: 'k' }))).toBeNull()
    expect(shortcutKeycaps('Mod-Alt-Shift-k', 'Win32')).toEqual(['Ctrl', 'Alt', 'Shift', 'K'])
    expect(shortcutKeycaps('Mod-k', 'MacIntel')).toEqual(['⌘', 'K'])
    expect(shortcutDisplayLabel('Mod-Shift-r', 'Win32')).toBe('Ctrl+Shift+R')
  })

  it('identifies reserved and duplicate combinations by stable command ID', () => {
    expect(isReservedShortcut('Mod-r')).toBe(true)
    expect(isReservedShortcut('Mod-b')).toBe(false)
    expect(findShortcutConflict({ 'text.bold': 'Mod-b', 'text.italic': 'Mod-i' }, 'text.bold', 'Mod-i')).toBe('text.italic')
    expect(findShortcutConflict({ 'text.bold': 'Mod-b' }, 'text.bold', 'Mod-b')).toBeNull()
  })

  it('round-trips a versioned application preference without touching document storage', () => {
    const repository = new ShortcutPreferenceRepository(window.localStorage)
    const documentKey = 'w-editor:v1:document:welcome'
    window.localStorage.setItem(documentKey, 'document-envelope')
    repository.write({ 'text.bold': 'Mod-Shift-k' })

    expect(repository.read()).toEqual({ 'text.bold': 'Mod-Shift-k' })
    expect(JSON.parse(window.localStorage.getItem(SHORTCUT_PREFERENCES_KEY) ?? 'null')).toEqual({
      schemaVersion: 1,
      shortcutBindings: { 'text.bold': 'Mod-Shift-k' },
    })
    expect(window.localStorage.getItem(documentKey)).toBe('document-envelope')
  })

  it('falls back cleanly when the preference envelope is malformed', () => {
    window.localStorage.setItem(SHORTCUT_PREFERENCES_KEY, '{malformed')
    expect(new ShortcutPreferenceRepository(window.localStorage).read()).toBeNull()
  })
})
