import { mountWEditor, mountWRenderer } from '@w-editor/editor-web'
import type {
  WDocumentInput,
  WEditorInstance,
  WEditorMountOptions,
  WRecoveryDraft,
  WRecoveryDraftAdapter,
  WRecoveryDraftKey,
  WRendererExtension,
  WRendererInstance,
  WRendererMountOptions,
  WSaveAdapter,
  WSaveRequest,
  WSaveResponse,
  WWorkspaceAdapter,
  WWorkspaceExchange,
} from '@w-editor/editor-web'
interface NwuSettingsChange {
  readonly key: string
  readonly value: unknown | undefined
}

type NwuSettingsSubscriber = (change: NwuSettingsChange) => void

interface NwuSettingsStore {
  readonly clearUserOverride: (key: string) => void | Promise<void>
  readonly getSiteDefaults: () => Readonly<Record<string, unknown>> | Promise<Readonly<Record<string, unknown>>>
  readonly getUserOverrides: () => Readonly<Record<string, unknown>> | Promise<Readonly<Record<string, unknown>>>
  readonly setUserOverride: (key: string, value: unknown) => void | Promise<void>
  readonly subscribe: (subscriber: NwuSettingsSubscriber) => () => void
}

export type NwuTransport = 'form-data' | 'json'
export type NwuVisibility = 'private' | 'public' | 'selected'

export interface NwuMockHostOptions {
  readonly authorUserId?: string
  readonly documentId?: string
  readonly initialMarkdown?: string
  readonly isAdmin?: boolean
  readonly publicScriptNames?: readonly string[]
  readonly scriptDownloadsAuthorized?: boolean
  readonly selectedUserIds?: readonly string[]
  readonly serverRevision?: string
  readonly siteDefaults?: Readonly<Record<string, unknown>>
  readonly transport?: NwuTransport
  readonly userId?: string
  readonly userOverrides?: Readonly<Record<string, unknown>>
  readonly visibility?: NwuVisibility
}

export interface NwuSession {
  readonly authenticated: boolean
  readonly csrfToken: string
  readonly userId: string
  expireAuth(): void
  refreshCsrf(): void
  restoreAuth(): void
  rotateCsrf(): void
}

export interface NwuHttpRequest {
  readonly body?: FormData | string
  readonly credentials?: 'include' | 'omit' | 'same-origin'
  readonly headers?: Readonly<Record<string, string>>
  readonly method?: string
}

export interface NwuHttpResponse {
  readonly json: () => Promise<unknown>
  readonly ok: boolean
  readonly status: number
}

export interface NwuRequestRecord {
  readonly body: Readonly<Record<string, string>>
  readonly credentials: 'include' | 'omit' | 'same-origin'
  readonly headers: Readonly<Record<string, string>>
  readonly method: string
  readonly path: string
  readonly transport: NwuTransport
}

export interface NwuMockHost {
  readonly document: WDocumentInput
  readonly draftAdapter: WRecoveryDraftAdapter
  readonly initialJinjaMarkup: string
  readonly saveAdapter: WSaveAdapter
  readonly session: NwuSession
  readonly settingsStore: NwuSettingsStore
  readonly userId: string
  readonly workspaceAdapter: WWorkspaceAdapter
  readonly requests: readonly NwuRequestRecord[]
  failNextSave(message?: string): void
  mountEditor(container: HTMLElement, options?: Partial<WEditorMountOptions>): WEditorInstance
  mountReader(container: HTMLElement, options?: Partial<WRendererMountOptions>): WRendererInstance
  forceServerUpdate(markdown: string, documentId?: string): void
  readServerDocument(documentId?: string): WDocumentInput
  renderJinjaMarkup(): string
  request(path: string, init?: NwuHttpRequest): Promise<NwuHttpResponse>
  setTransport(transport: NwuTransport): void
}

type ServerDocument = {
  canonicalMarkdown: string
  nextVersion: number
  revisionCounter: number
  serverRevision: string
}

class MockNwuSession implements NwuSession {
  readonly userId: string
  #authenticated = true
  #csrfToken = 'csrf-nwu-1'
  #serverCsrfToken = 'csrf-nwu-1'

  constructor(userId: string) {
    this.userId = userId
  }

  get authenticated(): boolean {
    return this.#authenticated
  }

  get csrfToken(): string {
    return this.#csrfToken
  }

  expireAuth(): void {
    this.#authenticated = false
  }

  restoreAuth(): void {
    this.#authenticated = true
  }

  rotateCsrf(): void {
    const suffix = Number(this.#serverCsrfToken.split('-').at(-1) ?? '1') + 1
    this.#serverCsrfToken = `csrf-nwu-${suffix}`
  }

  refreshCsrf(): void {
    this.#csrfToken = this.#serverCsrfToken
  }

  expectedCsrfToken(): string {
    return this.#serverCsrfToken
  }
}

class MockSettingsStore implements NwuSettingsStore {
  readonly #host: MockNwuHostImpl
  readonly #subscribers = new Set<NwuSettingsSubscriber>()

  constructor(host: MockNwuHostImpl) {
    this.#host = host
  }

  clearUserOverride(key: string): void {
    this.#host.userSettings.delete(key)
    this.#emit({ key, value: undefined })
  }

  getSiteDefaults(): Readonly<Record<string, unknown>> {
    return Object.freeze(Object.fromEntries(this.#host.siteSettings.entries()))
  }

  getUserOverrides(): Readonly<Record<string, unknown>> {
    return Object.freeze(Object.fromEntries(this.#host.userSettings.entries()))
  }

  setUserOverride(key: string, value: unknown): void {
    this.#host.userSettings.set(key, value)
    this.#emit({ key, value })
  }

  subscribe(subscriber: NwuSettingsSubscriber): () => void {
    this.#subscribers.add(subscriber)
    return () => this.#subscribers.delete(subscriber)
  }

  #emit(change: NwuSettingsChange): void {
    const immutable = Object.freeze({ key: change.key, value: change.value })
    for (const subscriber of this.#subscribers) subscriber(immutable)
  }
}

class MockNwuHostImpl implements NwuMockHost {
  readonly authorUserId: string
  readonly document: WDocumentInput
  readonly initialJinjaMarkup: string
  readonly session: MockNwuSession
  readonly userId: string
  readonly requests: NwuRequestRecord[] = []
  readonly siteSettings: Map<string, unknown>
  readonly userSettings: Map<string, unknown>
  readonly visibility: NwuVisibility
  readonly #isAdmin: boolean
  readonly #selectedUserIds: ReadonlySet<string>
  readonly #documents = new Map<string, ServerDocument>()
  readonly #drafts = new Map<string, WRecoveryDraft>()
  readonly #workspaces = new Map<string, WWorkspaceExchange>()
  #transport: NwuTransport
  #nextSaveFailure: string | null = null
  readonly #publicScriptNames: ReadonlyMap<string, string>
  readonly #scriptDownloadsAuthorized: boolean
  readonly #rendererExtensions: readonly WRendererExtension[]

  readonly draftAdapter: WRecoveryDraftAdapter = Object.freeze({
    clear: async (key: WRecoveryDraftKey) => {
      this.#drafts.delete(this.#key(key))
    },
    load: async (key: WRecoveryDraftKey) => this.#drafts.get(this.#key(key)) ?? null,
    save: async (draft: WRecoveryDraft) => {
      this.#drafts.set(this.#key({ documentId: draft.documentId, userId: draft.userId }), draft)
    },
  })

  readonly workspaceAdapter: WWorkspaceAdapter = Object.freeze({
    load: async (key: WRecoveryDraftKey) => this.#workspaces.get(this.#key(key)) ?? null,
    save: async (exchange: WWorkspaceExchange) => {
      this.#workspaces.set(this.#key({ documentId: exchange.documentId, userId: exchange.userId }), exchange)
    },
  })

  readonly saveAdapter: WSaveAdapter = Object.freeze({
    save: (request: WSaveRequest) => this.#save(request),
  })

  readonly settingsStore: NwuSettingsStore

  constructor(options: NwuMockHostOptions = {}) {
    this.userId = options.userId ?? 'nwu-user-1'
    this.authorUserId = options.authorUserId ?? this.userId
    const documentId = options.documentId ?? 'nwu-article-1'
    const markdown = options.initialMarkdown ?? '# Jinja initial Markdown\n\nServer content.'
    const serverRevision = options.serverRevision ?? 'server-1'
    this.document = Object.freeze({ documentId, markdown, serverRevision })
    this.session = new MockNwuSession(this.userId)
    this.#transport = options.transport ?? 'json'
    this.visibility = options.visibility ?? 'private'
    this.#isAdmin = options.isAdmin ?? false
    this.#selectedUserIds = new Set(options.selectedUserIds ?? [])
    this.#publicScriptNames = new Map((options.publicScriptNames ?? []).map((name) => [name.toLocaleLowerCase(), name]))
    this.#scriptDownloadsAuthorized = options.scriptDownloadsAuthorized ?? false
    this.#rendererExtensions = Object.freeze([this.#createScriptDownloadsExtension()])
    this.siteSettings = new Map(Object.entries(options.siteDefaults ?? { appearanceTheme: 'blue', lineSpacing: 'compact' }))
    this.userSettings = new Map(Object.entries(options.userOverrides ?? {}))
    this.settingsStore = new MockSettingsStore(this)
    this.#documents.set(documentId, {
      canonicalMarkdown: markdown,
      nextVersion: 1,
      revisionCounter: 1,
      serverRevision,
    })
    this.initialJinjaMarkup = this.renderJinjaMarkup()
  }

  setTransport(transport: NwuTransport): void {
    this.#transport = transport
  }

  failNextSave(message = 'The mock NWU save endpoint is temporarily unavailable.'): void {
    this.#nextSaveFailure = message
  }

  renderJinjaMarkup(): string {
    const bootstrap = JSON.stringify({
      csrfToken: this.session.csrfToken,
      documentId: this.document.documentId,
      markdown: this.document.markdown,
      serverRevision: this.document.serverRevision,
      userId: this.userId,
      visibility: this.visibility,
    }).replaceAll('<', '\\u003c')
    return `<main data-nwu-host="reference" data-nwu-document-id="${escapeAttribute(this.document.documentId)}" data-nwu-user-id="${escapeAttribute(this.userId)}" data-nwu-visibility="${this.visibility}"><script type="application/json" data-nwu-bootstrap>${bootstrap}</script></main>`
  }

  mountEditor(container: HTMLElement, options: Partial<WEditorMountOptions> = {}): WEditorInstance {
    this.#requireAuthenticated()
    if (!this.#canEdit()) throw hostError('AUTHORIZATION_DENIED', 'The mock NWU user cannot edit this article.')
    return mountWEditor(container, {
      autosave: { enabled: true, maxWaitMs: 5_000, trailingDelayMs: 1_000 },
      document: this.document,
      draftAdapter: this.draftAdapter,
      hostAdapterVersion: '1.0.0',
      rendererExtensions: this.#rendererExtensions,
      saveAdapter: this.saveAdapter,
      settingsStore: this.settingsStore,
      userId: this.userId,
      workspaceAdapter: this.workspaceAdapter,
      ...options,
    })
  }

  mountReader(container: HTMLElement, options: Partial<WRendererMountOptions> = {}): WRendererInstance {
    this.#requireAuthenticated()
    if (!this.#canView()) throw hostError('AUTHORIZATION_DENIED', 'The mock NWU user cannot view this article.')
    return mountWRenderer(container, {
      hostAdapterVersion: '1.0.0',
      markdown: this.document.markdown,
      profile: 'reader',
      rendererExtensions: this.#rendererExtensions,
      settingsStore: this.settingsStore,
      ...options,
    })
  }

  forceServerUpdate(markdown: string, documentId = this.document.documentId): void {
    const document = this.#document(documentId)
    document.revisionCounter += 1
    document.serverRevision = `server-${document.revisionCounter}`
    document.canonicalMarkdown = markdown
  }

  readServerDocument(documentId = this.document.documentId): WDocumentInput {
    const document = this.#document(documentId)
    return Object.freeze({
      documentId,
      markdown: document.canonicalMarkdown,
      serverRevision: document.serverRevision,
    })
  }

  async request(path: string, init: NwuHttpRequest = {}): Promise<NwuHttpResponse> {
    const method = (init.method ?? 'GET').toUpperCase()
    const headers = normalizeHeaders(init.headers ?? {})
    const body = parseBody(init.body)
    this.requests.push(Object.freeze({
      body: Object.freeze({ ...body.fields }),
      credentials: init.credentials ?? 'omit',
      headers: Object.freeze({ ...headers }),
      method,
      path,
      transport: body.transport,
    }))
    if (path !== '/api/nwu/documents/save' || method !== 'POST') {
      throw hostError('SAVE_FAILED', 'The mock NWU route does not exist.')
    }
    if (init.credentials !== 'same-origin') throw hostError('AUTH_REQUIRED', 'The mock NWU request did not include its same-origin session.')
    if (!this.session.authenticated) throw hostError('AUTH_REQUIRED', 'The mock NWU session has expired.')
    if (headers['x-requested-with'] !== 'XMLHttpRequest') {
      throw hostError('INCOMPATIBLE_HOST', 'The mock NWU route requires X-Requested-With: XMLHttpRequest.')
    }
    if (headers['x-csrftoken'] !== this.session.expectedCsrfToken() || body.fields['_csrf'] !== this.session.expectedCsrfToken()) {
      throw hostError('CSRF_REJECTED', 'The mock NWU CSRF token is invalid.')
    }
    if (!this.#canEdit()) throw hostError('AUTHORIZATION_DENIED', 'The mock NWU user cannot save this article.')
    const result = this.#handleSave(body.fields)
    return Object.freeze({
      json: async () => result,
      ok: true,
      status: 200,
    })
  }

  #key(key: WRecoveryDraftKey): string {
    return `${key.userId}\u0000${key.documentId}`
  }

  #requireAuthenticated(): void {
    if (!this.session.authenticated) throw hostError('AUTH_REQUIRED', 'The mock NWU session has expired.')
  }

  #canEdit(): boolean {
    return this.#isAdmin || this.userId === this.authorUserId
  }

  #canView(): boolean {
    if (this.#canEdit()) return true
    if (this.visibility === 'public') return true
    return this.visibility === 'selected' && this.#selectedUserIds.has(this.userId)
  }

  #document(documentId: string): ServerDocument {
    const existing = this.#documents.get(documentId)
    if (existing !== undefined) return existing
    const created: ServerDocument = {
      canonicalMarkdown: '',
      nextVersion: 1,
      revisionCounter: 1,
      serverRevision: 'server-1',
    }
    this.#documents.set(documentId, created)
    return created
  }

  async #save(request: WSaveRequest): Promise<WSaveResponse> {
    if (this.#nextSaveFailure !== null) {
      const message = this.#nextSaveFailure
      this.#nextSaveFailure = null
      throw hostError('SAVE_FAILED', message)
    }
    const csrf = this.session.csrfToken
    const fields: Record<string, string> = {
      _csrf: csrf,
      baseServerRevision: request.baseServerRevision ?? '',
      documentId: request.documentId,
      localRevision: String(request.localRevision),
      markdown: request.markdown,
      metadata: JSON.stringify(request.metadata),
      origin: request.origin,
      overwrite: String(request.overwrite),
      saveKind: request.saveKind,
      visibility: normalizeVisibility(request.metadata['visibility'], this.visibility),
    }
    const body = this.#transport === 'json'
      ? JSON.stringify(fields)
      : (() => {
          const form = new FormData()
          for (const [key, value] of Object.entries(fields)) form.append(key, value)
          return form
        })()
    const response = await this.request('/api/nwu/documents/save', {
      body,
      headers: {
        ...(this.#transport === 'json' ? { 'Content-Type': 'application/json' } : {}),
        'X-CSRFToken': csrf,
        'X-Requested-With': 'XMLHttpRequest',
      },
      credentials: 'same-origin',
      method: 'POST',
    })
    return response.json() as Promise<WSaveResponse>
  }

  #handleSave(fields: Readonly<Record<string, string>>): WSaveResponse {
    const documentId = fields['documentId'] ?? ''
    const markdown = fields['markdown'] ?? ''
    const saveKind = fields['saveKind']
    const document = this.#document(documentId)
    const baseServerRevision = fields['baseServerRevision'] === '' ? null : fields['baseServerRevision'] ?? null
    const overwrite = fields['overwrite'] === 'true'
    if (baseServerRevision !== document.serverRevision && !overwrite) {
      throw hostError('REVISION_CONFLICT', `The mock NWU document is at ${document.serverRevision}.`)
    }
    const savedAt = new Date().toISOString()
    if (saveKind === 'autosave-draft') {
      return Object.freeze({
        draftState: Object.freeze({ baseServerRevision: document.serverRevision, status: 'saved' as const, updatedAt: savedAt }),
        savedAt,
        serverRevision: document.serverRevision,
      })
    }
    if (saveKind !== 'manual-save' && saveKind !== 'publish') throw hostError('SAVE_FAILED', 'The mock NWU save kind is invalid.')
    document.revisionCounter += 1
    document.serverRevision = `server-${document.revisionCounter}`
    document.canonicalMarkdown = markdown
    const versionId = `version-${document.nextVersion}`
    document.nextVersion += 1
    return Object.freeze({
      draftState: Object.freeze({ baseServerRevision: document.serverRevision, status: 'none' as const, updatedAt: savedAt }),
      savedAt,
      serverRevision: document.serverRevision,
      versionId,
    })
  }

  #createScriptDownloadsExtension(): WRendererExtension {
    const extension: WRendererExtension = {
      id: 'nwu-script-downloads',
      permissions: Object.freeze(['safe-fragment'] as const),
      render: ({ snapshot }) => {
        if (!this.session.authenticated || !this.#scriptDownloadsAuthorized) return null
        const links: string[] = []
        const seen = new Set<string>()
        const pattern = /^<!--\s*script\s*:\s*([^>]+?)\s*-->$/gimu
        for (const match of snapshot.markdown.matchAll(pattern)) {
          const mentioned = match[1]?.trim()
          if (mentioned === undefined) continue
          const actual = this.#publicScriptNames.get(mentioned.toLocaleLowerCase())
          if (actual === undefined || seen.has(actual)) continue
          seen.add(actual)
          links.push(`<a href="/resources/scripts/${encodeURIComponent(actual)}/download">下载脚本：${escapeHtml(actual)}</a>`)
        }
        return links.length === 0 ? null : `<nav aria-label="NWU script downloads">${links.join('')}</nav>`
      },
    }
    return Object.freeze(extension)
  }
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function hostError(code: string, message: string): Error & { readonly code: string } {
  return Object.assign(new Error(message), { code })
}

function normalizeHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
}

function normalizeVisibility(value: unknown, fallback: NwuVisibility): NwuVisibility {
  return value === 'public' || value === 'selected' || value === 'private' ? value : fallback
}

function parseBody(body: FormData | string | undefined): Readonly<{
  readonly fields: Readonly<Record<string, string>>
  readonly transport: NwuTransport
}> {
  if (typeof body === 'string') {
    const parsed = JSON.parse(body) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw hostError('SAVE_FAILED', 'The mock NWU JSON body is invalid.')
    return Object.freeze({ fields: Object.freeze(Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]))), transport: 'json' })
  }
  if (body === undefined) return Object.freeze({ fields: Object.freeze({}), transport: 'json' })
  const fields: Record<string, string> = {}
  for (const [key, value] of body.entries()) {
    if (typeof value !== 'string') throw hostError('SAVE_FAILED', 'The mock NWU FormData body does not accept files for save.')
    fields[key] = value
  }
  return Object.freeze({ fields: Object.freeze(fields), transport: 'form-data' })
}

export function createNwuMockHost(options: NwuMockHostOptions = {}): NwuMockHost {
  return new MockNwuHostImpl(options)
}
