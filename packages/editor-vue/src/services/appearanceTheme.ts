export const APPEARANCE_THEME_STORAGE_KEY = 'w-editor:appearance-theme'

export const APPEARANCE_THEME_IDS = Object.freeze([
  'default',
  'dark',
  'gray',
  'abyss',
  'green',
  'red',
  'violet',
  'blue',
] as const)

export type AppearanceTheme = (typeof APPEARANCE_THEME_IDS)[number]

export function isAppearanceTheme(value: unknown): value is AppearanceTheme {
  return typeof value === 'string' && APPEARANCE_THEME_IDS.includes(value as AppearanceTheme)
}

export function readAppearanceTheme(storage: Storage = window.localStorage): AppearanceTheme {
  try {
    const stored = storage.getItem(APPEARANCE_THEME_STORAGE_KEY)
    return isAppearanceTheme(stored) ? stored : 'gray'
  } catch {
    return 'gray'
  }
}

export function writeAppearanceTheme(
  theme: AppearanceTheme,
  storage: Storage = window.localStorage,
): boolean {
  try {
    storage.setItem(APPEARANCE_THEME_STORAGE_KEY, theme)
    return true
  } catch {
    return false
  }
}
