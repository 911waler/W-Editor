import { describe, expect, it } from 'vitest'

import {
  APPEARANCE_THEME_IDS,
  APPEARANCE_THEME_STORAGE_KEY,
  isAppearanceTheme,
  readAppearanceTheme,
  writeAppearanceTheme,
} from '../../src/services/appearanceTheme'

describe('appearance theme preference', () => {
  it('exposes the Cherry 0.11.9 theme inventory in stable order', () => {
    expect(APPEARANCE_THEME_IDS).toEqual([
      'default',
      'dark',
      'gray',
      'abyss',
      'green',
      'red',
      'violet',
      'blue',
    ])
    for (const theme of APPEARANCE_THEME_IDS) expect(isAppearanceTheme(theme)).toBe(true)
    expect(isAppearanceTheme('light')).toBe(false)
  })

  it('persists a valid theme and falls back from missing or invalid data', () => {
    const storage = window.localStorage
    expect(readAppearanceTheme(storage)).toBe('gray')
    expect(writeAppearanceTheme('abyss', storage)).toBe(true)
    expect(storage.getItem(APPEARANCE_THEME_STORAGE_KEY)).toBe('abyss')
    expect(readAppearanceTheme(storage)).toBe('abyss')

    storage.setItem(APPEARANCE_THEME_STORAGE_KEY, 'unsupported')
    expect(readAppearanceTheme(storage)).toBe('gray')
  })

  it('keeps the in-session fallback observable when storage is unavailable', () => {
    const unavailable = {
      getItem: () => { throw new Error('storage unavailable') },
      setItem: () => { throw new Error('storage unavailable') },
    } as unknown as Storage
    expect(readAppearanceTheme(unavailable)).toBe('gray')
    expect(writeAppearanceTheme('dark', unavailable)).toBe(false)
  })
})
