export const SHORTCUT_PREFERENCES_KEY = 'w-editor:v1:preferences'

export const DEFAULT_SHORTCUT_BINDINGS = Object.freeze<Readonly<Record<string, string>>>({
  'block.h1': 'Mod-1',
  'block.h2': 'Mod-2',
  'block.h3': 'Mod-3',
  'block.h4': 'Mod-4',
  'block.h5': 'Mod-5',
  'document.manual-save': 'Mod-s',
  'history.redo': 'Mod-Shift-z',
  'history.undo': 'Mod-z',
  'search.replace': 'Mod-f',
  'text.bold': 'Mod-b',
  'text.italic': 'Mod-i',
})

export interface ShortcutKeyboardEvent {
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly key: string
  readonly metaKey: boolean
  readonly shiftKey: boolean
}

export interface ShortcutPreferencesEnvelopeV1 {
  readonly schemaVersion: 1
  readonly shortcutBindings: Readonly<Record<string, string>>
}

const MODIFIER_KEYS = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'Shift'])
const RESERVED_SHORTCUTS = new Set([
  'Mod-l',
  'Mod-n',
  'Mod-o',
  'Mod-q',
  'Mod-r',
  'Mod-Shift-r',
  'Mod-t',
  'Mod-u',
  'Mod-w',
  'Mod-Shift-w',
  'F1',
  'F5',
  'F6',
  'F11',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function frozenBindings(bindings: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.freeze({ ...bindings })
}

function canonicalKey(key: string): string {
  if (key === ' ') return 'Space'
  if (key === '-') return 'Minus'
  if (key === '+') return 'Plus'
  if (key.length === 1) return key.toLocaleLowerCase()
  if (/^f(?:[1-9]|1[0-2])$/iu.test(key)) return key.toLocaleUpperCase()
  return `${key.charAt(0).toLocaleUpperCase()}${key.slice(1)}`
}

export function physicalShortcutFromKeyboardEvent(event: ShortcutKeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null
  const key = canonicalKey(event.key)
  const modifiers = [
    ...((event.ctrlKey || event.metaKey) ? ['Mod'] : []),
    ...(event.altKey ? ['Alt'] : []),
    ...(event.shiftKey ? ['Shift'] : []),
  ]
  if (modifiers.length === 0 && !/^F(?:[1-9]|1[0-2])$/u.test(key)) return null
  return [...modifiers, key].join('-')
}

export function shortcutKeycaps(shortcut: string, platform = globalThis.navigator?.platform ?? ''): readonly string[] {
  if (shortcut.length === 0) return Object.freeze([])
  const mac = /Mac|iPhone|iPad|iPod/iu.test(platform)
  return Object.freeze(shortcut.split('-').map((part) => {
    if (part === 'Mod') return mac ? '⌘' : 'Ctrl'
    if (part === 'Alt') return mac ? 'Option' : 'Alt'
    if (part === 'Shift') return 'Shift'
    if (part === 'Space') return 'Space'
    if (part === 'Minus') return '-'
    if (part === 'Plus') return '+'
    return part.length === 1 ? part.toLocaleUpperCase() : part
  }))
}

export function shortcutDisplayLabel(shortcut: string, platform = globalThis.navigator?.platform ?? ''): string {
  return shortcutKeycaps(shortcut, platform).join('+')
}

export function isReservedShortcut(shortcut: string): boolean {
  return RESERVED_SHORTCUTS.has(shortcut)
}

export function findShortcutConflict(
  bindings: Readonly<Record<string, string>>,
  commandId: string,
  shortcut: string,
): string | null {
  for (const [candidateCommandId, candidateShortcut] of Object.entries(bindings)) {
    if (candidateCommandId !== commandId && candidateShortcut === shortcut) return candidateCommandId
  }
  return null
}

const LEGACY_HEADING_DEFAULTS = Object.freeze<Readonly<Record<string, string>>>({
  'block.h3': 'Mod-3',
  'block.h4': 'Mod-4',
  'block.h5': 'Mod-5',
})

export function migrateLegacyHeadingShortcuts(
  bindings: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  if (bindings['block.h1'] !== 'Mod-1' || bindings['block.h2'] !== 'Mod-2') return frozenBindings(bindings)
  const migrated = { ...bindings }
  const assigned = new Set(Object.values(bindings).filter(Boolean))
  for (const [commandId, shortcut] of Object.entries(LEGACY_HEADING_DEFAULTS)) {
    if (Object.hasOwn(bindings, commandId) || assigned.has(shortcut)) continue
    migrated[commandId] = shortcut
    assigned.add(shortcut)
  }
  return frozenBindings(migrated)
}

export class ShortcutPreferenceRepository {
  readonly #storage: Storage

  constructor(storage: Storage = window.localStorage) {
    this.#storage = storage
  }

  read(): Readonly<Record<string, string>> | null {
    const raw = this.#storage.getItem(SHORTCUT_PREFERENCES_KEY)
    if (raw === null) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      return null
    }
    if (!isRecord(parsed) || parsed['schemaVersion'] !== 1 || !isRecord(parsed['shortcutBindings'])) return null
    const entries = Object.entries(parsed['shortcutBindings'])
    if (!entries.every(([commandId, shortcut]) => commandId.length > 0 && typeof shortcut === 'string')) return null
    return frozenBindings(Object.fromEntries(entries) as Record<string, string>)
  }

  write(bindings: Readonly<Record<string, string>>): void {
    const envelope: ShortcutPreferencesEnvelopeV1 = Object.freeze({
      schemaVersion: 1,
      shortcutBindings: frozenBindings(bindings),
    })
    this.#storage.setItem(SHORTCUT_PREFERENCES_KEY, JSON.stringify(envelope))
  }
}
