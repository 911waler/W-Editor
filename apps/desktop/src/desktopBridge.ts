import { invoke } from '@tauri-apps/api/core'

const WORKSPACE_KEY = 'w-editor:v1:workspace'
const DOCUMENT_KEY_PREFIX = 'w-editor:v1:document:'
const APPEARANCE_THEME_KEY = 'w-editor:appearance-theme'
const LINE_SPACING_KEY = 'w-editor:line-spacing'
const SHORTCUTS_KEY = 'w-editor:v1:preferences'
const RECENT_COLORS_KEY = 'cherry-recent-colors'

export interface DesktopDataRootStatus {
  readonly state: 'unconfigured' | 'ready' | 'unavailable' | 'read_only' | string
  readonly root: string | null
  readonly message: string | null
  readonly librarySchemaVersion: number
  readonly writeProbe: boolean
}

export interface DesktopLibraryArticle {
  readonly createdAt: string
  readonly deletedAt: string | null
  readonly documentId: string
  readonly markdown: string
  readonly revision: number
  readonly seedKey: string | null
  readonly title: string
  readonly updatedAt: string
}

interface DesktopSeedInfo {
  readonly seedKey: string
  readonly title: string
  readonly markdownBytes: number
}

interface DesktopSeedDocument {
  readonly seedKey: string
  readonly title: string
  readonly markdown: string
}

interface DesktopRecoveryDraft {
  readonly baseRevision: number
  readonly markdown: string
  readonly newerThanArticle: boolean
  readonly updatedAt: string
}

interface DesktopWorkspaceState {
  readonly documentId: string
  readonly mode: string
  readonly scroll: unknown
  readonly sidebar: unknown
  readonly updatedAt: string
}

export interface DesktopSettings {
  readonly resolved: Record<string, unknown>
}

export interface DesktopReleaseInfo {
  readonly automaticUpdate: boolean
  readonly downloadUrl: string | null
  readonly productName: string
  readonly signed: boolean
  readonly updateMode: string
  readonly version: string
}

export interface DesktopUninstallPreview {
  readonly confirmationToken: string
  readonly preview: Readonly<{
    readonly durableBytes: number
    readonly manifestValid: boolean
    readonly markerValid: boolean
    readonly root: string
    readonly rootId: string | null
    readonly temporaryBytes: number
    readonly totalBytes: number
  }>
}

export type DesktopUninstallScope = 'keep' | 'tmp' | 'durable'

interface DesktopLibrarySaveResult {
  readonly documentId: string
  readonly revision: number
  readonly versionId: string
}

export interface DesktopArticleDefinition {
  readonly documentId: string
  readonly initialMarkdown: string
  readonly title: string
}

export interface DesktopPersistedSnapshot {
  readonly markdown: string
  readonly revision: number
}

export interface DesktopWorkspacePersistence {
  readonly saveAutosave: (input: Readonly<{
    readonly documentId: string
    readonly markdown: string
    readonly revision: number
  }>) => Promise<void>
  readonly saveManual: (input: Readonly<{
    readonly documentId: string
    readonly markdown: string
    readonly revision: number
    readonly title: string
  }>) => Promise<void>
  readonly saveWorkspace: (input: Readonly<{
    readonly documentId: string
    readonly mode: string
    readonly sidebar: Readonly<Record<string, unknown>>
  }>) => Promise<void>
}

export type DesktopStorageMutation = (input: Readonly<{
  readonly key: string
  readonly next: string | null
  readonly previous: string | null
}>) => void | Promise<void>

/**
 * A synchronous session cache whose durable writes are owned by the Tauri bridge.
 * The shared playground editor only sees the standard Storage contract; it never
 * receives a second document, command, codec, or renderer implementation.
 */
export class DesktopStorage implements Storage {
  readonly #entries = new Map<string, string>()
  readonly #onMutation: DesktopStorageMutation | undefined
  readonly #onError: ((error: unknown) => void) | undefined

  constructor(
    entries: Readonly<Record<string, string>> = {},
    options: Readonly<{
      readonly onError?: (error: unknown) => void
      readonly onMutation?: DesktopStorageMutation
    }> = {},
  ) {
    for (const [key, value] of Object.entries(entries)) this.#entries.set(key, value)
    this.#onMutation = options.onMutation
    this.#onError = options.onError
  }

  get length(): number {
    return this.#entries.size
  }

  clear(): void {
    for (const key of [...this.#entries.keys()]) this.removeItem(key)
  }

  getItem(key: string): string | null {
    return this.#entries.get(String(key)) ?? null
  }

  key(index: number): string | null {
    return [...this.#entries.keys()][index] ?? null
  }

  removeItem(key: string): void {
    const normalized = String(key)
    const previous = this.#entries.get(normalized) ?? null
    if (previous === null) return
    this.#entries.delete(normalized)
    this.#notify({ key: normalized, next: null, previous })
  }

  setItem(key: string, value: string): void {
    const normalized = String(key)
    const next = String(value)
    const previous = this.#entries.get(normalized) ?? null
    this.#entries.set(normalized, next)
    this.#notify({ key: normalized, next, previous })
  }

  #notify(input: Readonly<{ key: string; next: string | null; previous: string | null }>): void {
    if (this.#onMutation === undefined) return
    try {
      const result = this.#onMutation(input)
      if (result !== undefined) void Promise.resolve(result).catch((error: unknown) => this.#onError?.(error))
    } catch (error) {
      this.#onError?.(error)
    }
  }
}

function documentKey(documentId: string): string {
  return `${DOCUMENT_KEY_PREFIX}${encodeURIComponent(documentId)}`
}

function importedTitle(path: string): string {
  const name = path.split(/[\\/]/u).at(-1) ?? 'Imported Markdown'
  return name.replace(/\.(?:md|markdown|txt)$/iu, '').trim() || 'Imported Markdown'
}

function timestamp(value: string): string {
  const milliseconds = Number(value)
  return Number.isFinite(milliseconds) && milliseconds > 0
    ? new Date(milliseconds).toISOString()
    : value
}

function snapshot(markdown: string, revision: number, savedAt: string): Record<string, unknown> {
  return { markdown, revision, savedAt }
}

function documentEnvelope(
  article: DesktopLibraryArticle,
  draft: DesktopRecoveryDraft | null,
): Record<string, unknown> {
  const savedAt = timestamp(article.updatedAt)
  const formal = snapshot(article.markdown, article.revision, savedAt)
  const autosave = draft?.newerThanArticle === true
    ? snapshot(draft.markdown, Math.max(article.revision + 1, draft.baseRevision + 1), timestamp(draft.updatedAt))
    : formal
  return {
    autosave,
    documentId: article.documentId,
    manualCheckpoint: formal,
    preDestructiveReplace: null,
    preModeSwitch: null,
    schemaVersion: 1,
    status: { lastPersistenceFailure: null },
  }
}

function workspaceEnvelope(
  activeDocumentId: string,
  documentIds: readonly string[],
  state: DesktopWorkspaceState | null,
): Record<string, unknown> {
  const sidebar = typeof state?.sidebar === 'object' && state.sidebar !== null
    ? state.sidebar as Record<string, unknown>
    : {}
  const width = typeof sidebar['width'] === 'number' && Number.isFinite(sidebar['width'])
    ? sidebar['width']
    : 252
  const collapsed = sidebar['open'] === false
  return {
    activeDocumentId: state?.documentId ?? activeDocumentId,
    articlePanel: { collapsed, width },
    catalogDocumentIds: [...documentIds],
    schemaVersion: 1,
  }
}

function settingsEntries(settings: DesktopSettings | null): Record<string, string> {
  const resolved = settings?.resolved ?? {}
  const entries: Record<string, string> = {}
  if (typeof resolved['theme'] === 'string') entries[APPEARANCE_THEME_KEY] = resolved['theme']
  if (typeof resolved['lineSpacing'] === 'string') {
    entries[LINE_SPACING_KEY] = resolved['lineSpacing'] === 'normal' ? 'standard' : resolved['lineSpacing']
  }
  const shortcuts = resolved['shortcuts']
  if (typeof shortcuts === 'object' && shortcuts !== null && !Array.isArray(shortcuts)) {
    entries[SHORTCUTS_KEY] = JSON.stringify({ schemaVersion: 1, shortcutBindings: shortcuts })
  }
  if (Array.isArray(resolved['recentColors'])) entries[RECENT_COLORS_KEY] = JSON.stringify(resolved['recentColors'])
  return entries
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class DesktopLibraryBridge {
  readonly #onError: (error: unknown) => void
  #articles = new Map<string, DesktopLibraryArticle>()
  #revisions = new Map<string, number>()
  #storage: DesktopStorage | null = null

  constructor(onError: (error: unknown) => void = () => undefined) {
    this.#onError = onError
  }

  async dataRootStatus(): Promise<DesktopDataRootStatus> {
    return invoke<DesktopDataRootStatus>('data_root_status')
  }

  async selectDataRoot(parentPath: string): Promise<DesktopDataRootStatus> {
    return invoke<DesktopDataRootStatus>('select_data_root', { parentPath })
  }

  async settings(): Promise<DesktopSettings> {
    return invoke<DesktopSettings>('settings_get')
  }

  async releaseInfo(): Promise<DesktopReleaseInfo> {
    return invoke<DesktopReleaseInfo>('desktop_release_info')
  }

  async resetSettings(): Promise<DesktopSettings> {
    return invoke<DesktopSettings>('settings_reset')
  }

  async migrateDataRoot(destinationParent: string): Promise<void> {
    await invoke('data_root_migrate', { destinationParent })
  }

  async setWindowDirty(dirty: boolean): Promise<void> {
    await invoke('set_window_dirty', { dirty })
  }

  async writeExportFile(destinationPath: string, bytes: Uint8Array): Promise<void> {
    await invoke('export_write_file', { bytes: Array.from(bytes), destinationPath })
  }

  async requestWindowClose(): Promise<{ readonly state: string; readonly dirty: boolean }> {
    return invoke<{ readonly state: string; readonly dirty: boolean }>('request_window_close')
  }

  async uninstallPreview(): Promise<DesktopUninstallPreview> {
    return invoke<DesktopUninstallPreview>('uninstall_data_preview')
  }

  async uninstallCleanup(scope: DesktopUninstallScope, confirmationToken: string): Promise<Readonly<{ durableDeleted: boolean; locatorCleared: boolean; releasedBytes: number; root: string; scope: string }>> {
    return invoke('uninstall_data_cleanup', { scope, confirmationToken })
  }

  async takeStartupFileRequests(): Promise<readonly string[]> {
    return invoke<readonly string[]>('startup_file_requests')
  }

  async bootstrap(): Promise<Readonly<{
    readonly definitions: readonly DesktopArticleDefinition[]
    readonly initialDocumentId: string
    readonly storage: DesktopStorage
    readonly status: DesktopDataRootStatus
  }>> {
    const status = await this.dataRootStatus()
    if (status.state !== 'ready') throw new Error(status.message ?? `Data Root is ${status.state}.`)

    const seedCatalog = await invoke<readonly DesktopSeedInfo[]>('library_seed_catalog')
    let articles: readonly DesktopLibraryArticle[] = []
    try {
      articles = await invoke<readonly DesktopLibraryArticle[]>('library_list_articles')
    } catch (error) {
      if (!String(error).includes('LIBRARY_UNINITIALIZED')) throw error
    }
    const existingSeeds = new Set(articles.flatMap((article) => article.seedKey === null ? [] : [article.seedKey]))
    for (const seed of seedCatalog) {
      if (existingSeeds.has(seed.seedKey)) continue
      await invoke('library_seed_materialize', { seedKey: seed.seedKey })
    }
    articles = await invoke<readonly DesktopLibraryArticle[]>('library_list_articles')
    this.#articles = new Map(articles.map((article) => [article.documentId, article]))
    this.#revisions = new Map(articles.map((article) => [article.documentId, article.revision]))

    const seedDocuments = new Map<string, DesktopSeedDocument>()
    for (const seed of seedCatalog) {
      const document = await invoke<DesktopSeedDocument>('library_seed_get', { seedKey: seed.seedKey })
      seedDocuments.set(seed.seedKey, document)
    }
    const drafts = new Map<string, DesktopRecoveryDraft | null>()
    const workspaceStates: DesktopWorkspaceState[] = []
    for (const article of articles) {
      drafts.set(article.documentId, await invoke<DesktopRecoveryDraft | null>('recovery_load_draft', { documentId: article.documentId }))
      const workspace = await invoke<DesktopWorkspaceState | null>('workspace_load_state', { documentId: article.documentId })
      if (workspace !== null) workspaceStates.push(workspace)
    }
    const settings = await invoke<DesktopSettings>('settings_get')
    const latestWorkspace = workspaceStates.sort((left, right) => timestamp(right.updatedAt).localeCompare(timestamp(left.updatedAt)))[0] ?? null
    const documentIds = articles.map((article) => article.documentId)
    const entries: Record<string, string> = {
      [WORKSPACE_KEY]: JSON.stringify(workspaceEnvelope(documentIds[0] ?? '', documentIds, latestWorkspace)),
      ...settingsEntries(settings),
    }
    for (const article of articles) {
      entries[documentKey(article.documentId)] = JSON.stringify(documentEnvelope(article, drafts.get(article.documentId) ?? null))
    }
    this.#storage = new DesktopStorage(entries, {
      onError: this.#onError,
      onMutation: (input) => this.#persistStorageMutation(input),
    })
    const definitions = articles.map((article) => Object.freeze({
      documentId: article.documentId,
      initialMarkdown: article.seedKey === null
        ? article.markdown
        : seedDocuments.get(article.seedKey)?.markdown ?? article.markdown,
      title: article.title,
    }))
    const initialDocumentId = latestWorkspace?.documentId !== undefined && this.#articles.has(latestWorkspace.documentId)
      ? latestWorkspace.documentId
      : definitions[0]?.documentId ?? ''
    return Object.freeze({ definitions: Object.freeze(definitions), initialDocumentId, storage: this.#storage, status })
  }

  persistence(): DesktopWorkspacePersistence {
    return Object.freeze({
      saveAutosave: (input: Parameters<DesktopWorkspacePersistence['saveAutosave']>[0]) => this.saveAutosave(input),
      saveManual: async (input: Parameters<DesktopWorkspacePersistence['saveManual']>[0]) => { await this.saveManual(input) },
      saveWorkspace: (input: Parameters<DesktopWorkspacePersistence['saveWorkspace']>[0]) => this.saveWorkspace(input),
    })
  }

  async createArticle(title: string, markdown = ''): Promise<DesktopArticleDefinition> {
    const normalizedTitle = title.trim()
    if (normalizedTitle.length === 0) throw new Error('Article title cannot be empty.')
    const initialMarkdown = markdown.length > 0 ? markdown : `# ${normalizedTitle}\n\n`
    const article = await invoke<DesktopLibraryArticle>('library_create_article', {
      title: normalizedTitle,
      markdown: initialMarkdown,
    })
    this.#articles.set(article.documentId, article)
    this.#revisions.set(article.documentId, article.revision)
    return Object.freeze({ documentId: article.documentId, initialMarkdown, title: article.title })
  }

  async importArticle(markdown: string, title: string): Promise<DesktopArticleDefinition> {
    return this.createArticle(title, markdown)
  }

  async importArticleFromPath(path: string): Promise<DesktopArticleDefinition> {
    const session = await invoke<Readonly<{ markdown: string; sessionId: string }>>('import_markdown_start', { path })
    const title = importedTitle(path)
    const committed = await invoke<Readonly<{ documentId: string; versionId: string }>>('import_markdown_commit', {
      sessionId: session.sessionId,
      title,
      markdown: session.markdown,
      save: true,
    })
    const article = await invoke<DesktopLibraryArticle>('library_load_markdown', { documentId: committed.documentId })
    this.#articles.set(article.documentId, article)
    this.#revisions.set(article.documentId, article.revision)
    return Object.freeze({ documentId: article.documentId, initialMarkdown: article.markdown, title: article.title })
  }

  async saveAutosave(input: Readonly<{ documentId: string; markdown: string; revision: number }>): Promise<void> {
    const baseRevision = this.#revisions.get(input.documentId) ?? 0
    await invoke('recovery_save_draft', {
      documentId: input.documentId,
      baseRevision,
      markdown: input.markdown,
    })
  }

  async saveManual(input: Readonly<{ documentId: string; markdown: string; revision: number; title: string }>): Promise<DesktopLibrarySaveResult> {
    const currentRevision = this.#revisions.get(input.documentId)
    const requestedRevision = currentRevision === undefined ? undefined : currentRevision + 1
    const result = await invoke<DesktopLibrarySaveResult>('library_save_version', {
      documentId: input.documentId,
      title: input.title,
      markdown: input.markdown,
      requestedRevision,
      kind: 'manual-save',
    })
    this.#revisions.set(input.documentId, result.revision)
    return result
  }

  async saveWorkspace(input: Readonly<{ documentId: string; mode: string; sidebar: Readonly<Record<string, unknown>> }>): Promise<void> {
    await invoke('workspace_save_state', {
      documentId: input.documentId,
      mode: input.mode,
      sourceAnchor: null,
      selection: null,
      scroll: null,
      sidebar: input.sidebar,
    })
  }

  async #persistStorageMutation(input: Readonly<{ key: string; next: string | null; previous: string | null }>): Promise<void> {
    if (input.next === null) {
      if (input.key === APPEARANCE_THEME_KEY) await invoke('settings_clear_user_override', { key: 'theme' })
      else if (input.key === LINE_SPACING_KEY) await invoke('settings_clear_user_override', { key: 'lineSpacing' })
      else if (input.key === SHORTCUTS_KEY) await invoke('settings_clear_user_override', { key: 'shortcuts' })
      else if (input.key === RECENT_COLORS_KEY) await invoke('settings_clear_user_override', { key: 'recentColors' })
      return
    }
    if (input.key === APPEARANCE_THEME_KEY) {
      await invoke('settings_set_user_override', { key: 'theme', value: input.next })
    } else if (input.key === LINE_SPACING_KEY) {
      await invoke('settings_set_user_override', { key: 'lineSpacing', value: input.next === 'standard' ? 'normal' : input.next })
    } else if (input.key === SHORTCUTS_KEY) {
      const parsed = JSON.parse(input.next) as Record<string, unknown>
      if (isRecord(parsed['shortcutBindings'])) await invoke('settings_set_user_override', { key: 'shortcuts', value: parsed['shortcutBindings'] })
    } else if (input.key === RECENT_COLORS_KEY) {
      await invoke('settings_set_user_override', { key: 'recentColors', value: JSON.parse(input.next) as unknown })
    } else if (input.key === WORKSPACE_KEY) {
      const workspace = JSON.parse(input.next) as Record<string, unknown>
      if (typeof workspace['activeDocumentId'] === 'string') {
        await this.saveWorkspace({
          documentId: workspace['activeDocumentId'],
          mode: 'visual',
          sidebar: isRecord(workspace['articlePanel']) ? workspace['articlePanel'] : {},
        })
      }
    }
  }
}

export function desktopDocumentStorageKey(documentId: string): string {
  return documentKey(documentId)
}
