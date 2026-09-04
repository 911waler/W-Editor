import { describe, expect, it } from 'vitest'

import {
  CHERRY_RECENT_COLORS_KEY,
  PlaygroundCompatibilityAdapter,
  type RawCompatibilityExportV1,
} from '../../apps/playground/src/services/browserCompatibilityAdapter'

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>()

  get length(): number {
    return this.#values.size
  }

  clear(): void {
    this.#values.clear()
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.#values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value)
  }
}

describe('playground localStorage compatibility adapter', () => {
  it('exports and copies exact legacy values without deleting the source keys', () => {
    const source = new MemoryStorage()
    const target = new MemoryStorage()
    source.setItem('w-editor:v1:workspace', '{"schemaVersion":1}')
    source.setItem('w-editor:v1:document:welcome', '{"schemaVersion":1,"markdown":"raw"}')
    source.setItem('w-editor:v1:preferences', '{"schemaVersion":1,"shortcutBindings":{}}')
    source.setItem('w-editor:appearance-theme', 'blue')
    source.setItem('w-editor:line-spacing', 'double')
    source.setItem(CHERRY_RECENT_COLORS_KEY, '["#abcdef"]')
    source.setItem('unrelated-key', 'leave-out')
    const adapter = new PlaygroundCompatibilityAdapter(source)

    const exported: RawCompatibilityExportV1 = adapter.rawExport()
    expect(exported).toEqual({
      entries: [
        { key: 'cherry-recent-colors', value: '["#abcdef"]' },
        { key: 'w-editor:appearance-theme', value: 'blue' },
        { key: 'w-editor:line-spacing', value: 'double' },
        { key: 'w-editor:v1:document:welcome', value: '{"schemaVersion":1,"markdown":"raw"}' },
        { key: 'w-editor:v1:preferences', value: '{"schemaVersion":1,"shortcutBindings":{}}' },
        { key: 'w-editor:v1:workspace', value: '{"schemaVersion":1}' },
      ],
      schemaVersion: 1,
    })
    expect(adapter.migrateTo(target)).toBe(exported.entries.length)
    expect(adapter.rawExport()).toEqual(exported)
    expect(target.getItem('w-editor:v1:document:welcome')).toBe('{"schemaVersion":1,"markdown":"raw"}')
    expect(source.getItem('w-editor:v1:document:welcome')).toBe('{"schemaVersion":1,"markdown":"raw"}')
    expect(source.getItem('unrelated-key')).toBe('leave-out')
  })

  it('routes theme, line spacing, and recent color values through the legacy storage keys', () => {
    const storage = new MemoryStorage()
    const adapter = new PlaygroundCompatibilityAdapter(storage)

    expect(adapter.readAppearanceTheme()).toBe('gray')
    expect(adapter.readLineSpacing()).toBe('standard')
    expect(adapter.readRecentColors()).toEqual([])
    expect(adapter.writeAppearanceTheme('violet')).toBe(true)
    expect(adapter.writeLineSpacing('double')).toBe(true)
    adapter.writeRecentColors(['#abcdef'])
    expect(storage.getItem('w-editor:appearance-theme')).toBe('violet')
    expect(storage.getItem('w-editor:line-spacing')).toBe('double')
    expect(storage.getItem(CHERRY_RECENT_COLORS_KEY)).toBe('["#abcdef"]')
    expect(adapter.readRecentColors()).toEqual(['#abcdef'])
  })
})
