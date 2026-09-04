import type { SettingsStore } from '@w-editor/editor-core'

import { createPublicError, type WEditorError } from './publicContracts'

const DEFAULT_APPEARANCE_THEME = 'gray'
const DEFAULT_LINE_SPACING = 'standard'
const APPEARANCE_THEMES = new Set(['default', 'dark', 'gray', 'abyss', 'green', 'red', 'violet', 'blue'])
const LINE_SPACING_VALUES: Readonly<Record<string, number>> = Object.freeze({
  compact: 1.5,
  double: 2,
  single: 1.25,
  standard: 1.75,
})

interface SettingsValues {
  readonly [key: string]: unknown
}

function isRecord(value: unknown): value is SettingsValues {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function'
}

function layeredSetting(
  userOverrides: SettingsValues,
  siteDefaults: SettingsValues,
  key: string,
  alias: string,
  fallback: unknown,
): unknown {
  return userOverrides[key] ?? userOverrides[alias]
    ?? siteDefaults[key] ?? siteDefaults[alias]
    ?? fallback
}

function appearanceTheme(value: unknown, fallback: string): string {
  return typeof value === 'string' && APPEARANCE_THEMES.has(value) ? value : fallback
}

function lineSpacing(value: unknown, fallback: string): string {
  return typeof value === 'string' && Object.hasOwn(LINE_SPACING_VALUES, value) ? value : fallback
}

export interface WebSettingsControllerOptions {
  readonly distributionTheme?: string
  readonly settingsStore?: SettingsStore
  readonly onError: (error: WEditorError<'SETTINGS_UNAVAILABLE'>) => void
  readonly root: HTMLElement
}

/** Resolves host settings for one Web instance and owns its subscription lifecycle. */
export class WebSettingsController {
  readonly #distributionTheme: string
  readonly #onError: (error: WEditorError<'SETTINGS_UNAVAILABLE'>) => void
  readonly #root: HTMLElement
  readonly #settingsStore: SettingsStore | undefined
  #siteDefaults: SettingsValues = {}
  #userOverrides: SettingsValues = {}
  #unsubscribe: (() => void) | null = null
  #destroyed = false

  constructor(options: WebSettingsControllerOptions) {
    this.#distributionTheme = appearanceTheme(options.distributionTheme, DEFAULT_APPEARANCE_THEME)
    this.#onError = options.onError
    this.#root = options.root
    this.#settingsStore = options.settingsStore
    this.#apply()
  }

  initialize(onReady: () => void): void {
    if (this.#settingsStore === undefined) {
      onReady()
      return
    }

    let siteDefaults: SettingsValues | Promise<SettingsValues>
    let userOverrides: SettingsValues | Promise<SettingsValues>
    try {
      siteDefaults = this.#settingsStore.getSiteDefaults()
      userOverrides = this.#settingsStore.getUserOverrides()
    } catch (error) {
      this.#reportFailure(error)
      onReady()
      return
    }

    if (!isPromiseLike(siteDefaults) && !isPromiseLike(userOverrides)) {
      try {
        this.#acceptInitialValues(siteDefaults, userOverrides)
        this.#subscribe()
      } catch (error) {
        this.#reportFailure(error)
      }
      onReady()
      return
    }

    void Promise.all([siteDefaults, userOverrides])
      .then(([resolvedSiteDefaults, resolvedUserOverrides]) => {
        if (this.#destroyed) return
        this.#acceptInitialValues(resolvedSiteDefaults, resolvedUserOverrides)
        this.#subscribe()
      })
      .catch((error: unknown) => {
        if (!this.#destroyed) this.#reportFailure(error)
      })
      .finally(() => {
        if (!this.#destroyed) onReady()
      })
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#unsubscribe?.()
    this.#unsubscribe = null
  }

  #acceptInitialValues(siteDefaults: unknown, userOverrides: unknown): void {
    if (!isRecord(siteDefaults) || !isRecord(userOverrides)) {
      throw new TypeError('SettingsStore values must be plain records.')
    }
    this.#siteDefaults = Object.freeze({ ...siteDefaults })
    this.#userOverrides = Object.freeze({ ...userOverrides })
    this.#apply()
  }

  #subscribe(): void {
    if (this.#settingsStore === undefined || this.#destroyed) return
    try {
      this.#unsubscribe = this.#settingsStore.subscribe(({ key, value }) => {
        if (this.#destroyed) return
        const next = { ...this.#userOverrides }
        if (value === undefined) delete next[key]
        else next[key] = value
        this.#userOverrides = Object.freeze(next)
        this.#apply()
      })
    } catch (error) {
      this.#reportFailure(error)
    }
  }

  #apply(): void {
    const theme = appearanceTheme(layeredSetting(
      this.#userOverrides,
      this.#siteDefaults,
      'appearanceTheme',
      'theme',
      this.#distributionTheme,
    ), this.#distributionTheme)
    const spacing = lineSpacing(layeredSetting(
      this.#userOverrides,
      this.#siteDefaults,
      'lineSpacing',
      'spacing',
      DEFAULT_LINE_SPACING,
    ), DEFAULT_LINE_SPACING)
    this.#root.dataset['theme'] = theme
    this.#root.dataset['lineSpacing'] = spacing
    this.#root.style.setProperty('--w-editor-line-height', String(LINE_SPACING_VALUES[spacing]))
  }

  #reportFailure(cause: unknown): void {
    this.#apply()
    this.#onError(createPublicError(
      'SETTINGS_UNAVAILABLE',
      cause instanceof Error ? cause.message : 'Settings could not be loaded.',
      { actionHints: ['retry'], retryable: true },
    ))
  }
}

export function createWebSettingsController(options: WebSettingsControllerOptions): WebSettingsController {
  return new WebSettingsController(options)
}
