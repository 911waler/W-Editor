import {
  APPEARANCE_THEME_STORAGE_KEY,
  LINE_SPACING_STORAGE_KEY,
  SHORTCUT_PREFERENCES_KEY,
  lineSpacingOption,
  readAppearanceTheme,
  readLineSpacing,
  isAppearanceTheme,
  isLineSpacingId,
  type AppearanceTheme,
  type LineSpacingId,
  writeAppearanceTheme,
  writeLineSpacing,
} from '@w-editor/editor-vue/services'

import type { SettingsChange, SettingsStore as SettingsPort, SettingsSubscriber } from '@w-editor/editor-core'

import {
  DOCUMENT_KEY_PREFIX,
  WORKSPACE_KEY,
} from './localDocumentRepository'
import { ShortcutPreferenceRepository } from '@w-editor/editor-vue/services'

export const CHERRY_RECENT_COLORS_KEY = 'cherry-recent-colors'
export const PLAYGROUND_COMPATIBILITY_SCHEMA_VERSION = 1 as const
export const PLAYGROUND_SETTINGS_KEYS = Object.freeze({
  appearanceTheme: 'appearanceTheme',
  lineSpacing: 'lineSpacing',
  recentColors: 'recentColors',
  shortcutBindings: 'shortcutBindings',
} as const)

export interface RawCompatibilityEntry {
  readonly key: string
  readonly value: string
}

export interface RawCompatibilityExportV1 {
  readonly entries: readonly RawCompatibilityEntry[]
  readonly schemaVersion: typeof PLAYGROUND_COMPATIBILITY_SCHEMA_VERSION
}

function compatibleKey(key: string): boolean {
  return key === CHERRY_RECENT_COLORS_KEY
    || key === APPEARANCE_THEME_STORAGE_KEY
    || key === LINE_SPACING_STORAGE_KEY
    || key === SHORTCUT_PREFERENCES_KEY
    || key === WORKSPACE_KEY
    || key.startsWith(DOCUMENT_KEY_PREFIX)
}

function recentColors(value: string | null): readonly string[] {
  if (value === null) return Object.freeze([])
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return Object.freeze([])
    return Object.freeze(parsed
      .filter((candidate): candidate is string => typeof candidate === 'string' && /^#[\da-f]{6}$/iu.test(candidate))
      .slice(0, 6))
  } catch {
    return Object.freeze([])
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class PlaygroundCompatibilityAdapter implements SettingsPort {
  readonly #storage: Storage
  readonly #subscribers = new Set<SettingsSubscriber>()

  constructor(storage: Storage = window.localStorage) {
    this.#storage = storage
  }

  get storage(): Storage {
    return this.#storage
  }

  readAppearanceTheme(): AppearanceTheme {
    return readAppearanceTheme(this.#storage)
  }

  writeAppearanceTheme(theme: AppearanceTheme): boolean {
    return writeAppearanceTheme(theme, this.#storage)
  }

  readLineSpacing(): LineSpacingId {
    return readLineSpacing(this.#storage)
  }

  writeLineSpacing(id: LineSpacingId): boolean {
    return writeLineSpacing(id, this.#storage)
  }

  lineSpacingValue(id: LineSpacingId): number {
    return lineSpacingOption(id).value
  }

  readShortcutPreferences(): Readonly<Record<string, string>> | null {
    return new ShortcutPreferenceRepository(this.#storage).read()
  }

  writeShortcutPreferences(bindings: Readonly<Record<string, string>>): void {
    new ShortcutPreferenceRepository(this.#storage).write(bindings)
  }

  readRecentColors(): readonly string[] {
    return recentColors(this.#storage.getItem(CHERRY_RECENT_COLORS_KEY))
  }

  writeRecentColors(colors: readonly string[]): void {
    this.#storage.setItem(CHERRY_RECENT_COLORS_KEY, JSON.stringify(colors))
  }

  getSiteDefaults(): Readonly<Record<string, unknown>> {
    return Object.freeze({})
  }

  getUserOverrides(): Readonly<Record<string, unknown>> {
    const overrides: Record<string, unknown> = {}
    const storedTheme = this.#storage.getItem(APPEARANCE_THEME_STORAGE_KEY)
    if (isAppearanceTheme(storedTheme)) overrides[PLAYGROUND_SETTINGS_KEYS.appearanceTheme] = storedTheme
    const storedSpacing = this.#storage.getItem(LINE_SPACING_STORAGE_KEY)
    if (isLineSpacingId(storedSpacing)) overrides[PLAYGROUND_SETTINGS_KEYS.lineSpacing] = storedSpacing
    const storedShortcuts = this.readShortcutPreferences()
    if (storedShortcuts !== null) overrides[PLAYGROUND_SETTINGS_KEYS.shortcutBindings] = storedShortcuts
    const storedColors = this.#storage.getItem(CHERRY_RECENT_COLORS_KEY)
    if (storedColors !== null) overrides[PLAYGROUND_SETTINGS_KEYS.recentColors] = recentColors(storedColors)
    return Object.freeze(overrides)
  }

  setUserOverride(key: string, value: unknown): void {
    switch (key) {
      case PLAYGROUND_SETTINGS_KEYS.appearanceTheme:
        if (!isAppearanceTheme(value) || !this.writeAppearanceTheme(value)) throw new Error('Appearance theme could not be persisted.')
        break
      case PLAYGROUND_SETTINGS_KEYS.lineSpacing:
        if (!isLineSpacingId(value) || !this.writeLineSpacing(value)) throw new Error('Line spacing could not be persisted.')
        break
      case PLAYGROUND_SETTINGS_KEYS.shortcutBindings:
        if (!isRecord(value) || !Object.values(value).every((shortcut) => typeof shortcut === 'string')) {
          throw new TypeError('Shortcut bindings are invalid.')
        }
        this.writeShortcutPreferences(value as Readonly<Record<string, string>>)
        break
      case PLAYGROUND_SETTINGS_KEYS.recentColors:
        if (!Array.isArray(value) || !value.every((color) => typeof color === 'string' && /^#[\da-f]{6}$/iu.test(color))) {
          throw new TypeError('Recent colors are invalid.')
        }
        this.writeRecentColors(value)
        break
      default:
        throw new TypeError(`Unknown playground setting: ${key}`)
    }
    this.#publish(Object.freeze({ key, value }))
  }

  clearUserOverride(key: string): void {
    const storageKey = {
      [PLAYGROUND_SETTINGS_KEYS.appearanceTheme]: APPEARANCE_THEME_STORAGE_KEY,
      [PLAYGROUND_SETTINGS_KEYS.lineSpacing]: LINE_SPACING_STORAGE_KEY,
      [PLAYGROUND_SETTINGS_KEYS.recentColors]: CHERRY_RECENT_COLORS_KEY,
      [PLAYGROUND_SETTINGS_KEYS.shortcutBindings]: SHORTCUT_PREFERENCES_KEY,
    }[key]
    if (storageKey === undefined) throw new TypeError(`Unknown playground setting: ${key}`)
    this.#storage.removeItem(storageKey)
    this.#publish(Object.freeze({ key, value: undefined }))
  }

  subscribe(subscriber: SettingsSubscriber): () => void {
    this.#subscribers.add(subscriber)
    return () => this.#subscribers.delete(subscriber)
  }

  #publish(change: SettingsChange): void {
    for (const subscriber of this.#subscribers) subscriber(change)
  }

  rawExport(): RawCompatibilityExportV1 {
    const entries: RawCompatibilityEntry[] = []
    for (let index = 0; index < this.#storage.length; index += 1) {
      const key = this.#storage.key(index)
      if (key === null || !compatibleKey(key)) continue
      const value = this.#storage.getItem(key)
      if (value !== null) entries.push(Object.freeze({ key, value }))
    }
    entries.sort((left, right) => left.key.localeCompare(right.key))
    return Object.freeze({
      entries: Object.freeze(entries),
      schemaVersion: PLAYGROUND_COMPATIBILITY_SCHEMA_VERSION,
    })
  }

  rawExportJson(): string {
    return JSON.stringify(this.rawExport())
  }

  rawExportBlob(): Blob {
    return new Blob([this.rawExportJson()], { type: 'application/json;charset=utf-8' })
  }

  migrateTo(target: Storage): number {
    const exported = this.rawExport()
    for (const entry of exported.entries) target.setItem(entry.key, entry.value)
    return exported.entries.length
  }
}
