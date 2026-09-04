import type { SettingsChange, SettingsStore as SettingsPort, SettingsSubscriber } from '@w-editor/editor-core'

export const SETTINGS_STORE_CONTRACT_VERSION = '1.0.0' as const

export type SettingsValues = Readonly<Record<string, unknown>>

function freezeValues(values: SettingsValues): SettingsValues {
  return Object.freeze({ ...values })
}

function freezeChange(key: string, value: unknown): SettingsChange {
  return Object.freeze({ key, value })
}

export interface MemorySettingsStoreOptions {
  readonly siteDefaults?: SettingsValues
  readonly userOverrides?: SettingsValues
}

/** Session-only persistence used when a host does not provide a durable store. */
export class MemorySettingsStore implements SettingsPort {
  #siteDefaults: SettingsValues
  #userOverrides: SettingsValues
  readonly #subscribers = new Set<SettingsSubscriber>()

  constructor(options: MemorySettingsStoreOptions = {}) {
    this.#siteDefaults = freezeValues(options.siteDefaults ?? {})
    this.#userOverrides = freezeValues(options.userOverrides ?? {})
  }

  getSiteDefaults(): SettingsValues {
    return this.#siteDefaults
  }

  getUserOverrides(): SettingsValues {
    return this.#userOverrides
  }

  setUserOverride(key: string, value: unknown): void {
    this.#userOverrides = freezeValues({ ...this.#userOverrides, [key]: value })
    this.#publish(freezeChange(key, value))
  }

  clearUserOverride(key: string): void {
    if (!Object.hasOwn(this.#userOverrides, key)) return
    const next = { ...this.#userOverrides }
    delete next[key]
    this.#userOverrides = freezeValues(next)
    this.#publish(freezeChange(key, undefined))
  }

  subscribe(subscriber: SettingsSubscriber): () => void {
    this.#subscribers.add(subscriber)
    return () => this.#subscribers.delete(subscriber)
  }

  #publish(change: SettingsChange): void {
    for (const subscriber of this.#subscribers) subscriber(change)
  }
}

export function createMemorySettingsStore(options: MemorySettingsStoreOptions = {}): MemorySettingsStore {
  return new MemorySettingsStore(options)
}

export interface LayeredSettingsStoreOptions {
  readonly persistence?: SettingsPort
  readonly productDefaults: SettingsValues
  readonly siteDefaults?: SettingsValues
  readonly userOverrides?: SettingsValues
}

/**
 * Resolves settings without allowing a host persistence implementation to
 * become a second source of product defaults or content authority.
 */
export class LayeredSettingsStore implements SettingsPort {
  readonly #productDefaults: SettingsValues
  readonly #persistence: SettingsPort
  #siteDefaults: SettingsValues
  #userOverrides: SettingsValues
  readonly #subscribers = new Set<SettingsSubscriber>()

  constructor(options: LayeredSettingsStoreOptions) {
    this.#productDefaults = freezeValues(options.productDefaults)
    this.#siteDefaults = freezeValues(options.siteDefaults ?? {})
    this.#userOverrides = freezeValues(options.userOverrides ?? {})
    this.#persistence = options.persistence ?? createMemorySettingsStore({
      siteDefaults: this.#siteDefaults,
      userOverrides: this.#userOverrides,
    })
  }

  getProductDefaults(): SettingsValues {
    return this.#productDefaults
  }

  getSiteDefaults(): SettingsValues {
    return this.#siteDefaults
  }

  getUserOverrides(): SettingsValues {
    return this.#userOverrides
  }

  getResolved(): SettingsValues {
    return freezeValues({ ...this.#productDefaults, ...this.#siteDefaults, ...this.#userOverrides })
  }

  get<T = unknown>(key: string): T | undefined {
    return this.getResolved()[key] as T | undefined
  }

  setUserOverride(key: string, value: unknown): void | Promise<void> {
    this.#userOverrides = freezeValues({ ...this.#userOverrides, [key]: value })
    const change = freezeChange(key, value)
    for (const subscriber of this.#subscribers) subscriber(change)
    return this.#persistence.setUserOverride(key, value)
  }

  clearUserOverride(key: string): void | Promise<void> {
    if (!Object.hasOwn(this.#userOverrides, key)) return
    const next = { ...this.#userOverrides }
    delete next[key]
    this.#userOverrides = freezeValues(next)
    const change = freezeChange(key, undefined)
    for (const subscriber of this.#subscribers) subscriber(change)
    return this.#persistence.clearUserOverride(key)
  }

  subscribe(subscriber: SettingsSubscriber): () => void {
    this.#subscribers.add(subscriber)
    return () => this.#subscribers.delete(subscriber)
  }
}

export function createLayeredSettingsStore(options: LayeredSettingsStoreOptions): LayeredSettingsStore {
  return new LayeredSettingsStore(options)
}
