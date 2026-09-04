export const WORKSPACE_KEY = 'w-editor:v1:workspace'
export const DOCUMENT_KEY_PREFIX = 'w-editor:v1:document:'

export interface PersistedSnapshotV1 {
  readonly markdown: string
  readonly revision: number
  readonly savedAt: string
}

export interface WorkspaceEnvelopeV1 {
  readonly activeDocumentId: string
  readonly articlePanel: {
    readonly collapsed: boolean
    readonly width: number
  }
  readonly catalogDocumentIds: readonly string[]
  readonly schemaVersion: 1
}

export interface DocumentEnvelopeV1 {
  readonly autosave: PersistedSnapshotV1
  readonly documentId: string
  readonly manualCheckpoint: PersistedSnapshotV1 | null
  readonly preDestructiveReplace: PersistedSnapshotV1 | null
  readonly preModeSwitch: PersistedSnapshotV1 | null
  readonly schemaVersion: 1
  readonly status: {
    readonly lastPersistenceFailure: string | null
  }
}

export type EnvelopeRecoveryReason = 'corrupt' | 'unsupported-version'

export type EnvelopeReadResult<T> =
  | { readonly status: 'missing' }
  | { readonly status: 'valid'; readonly value: T }
  | {
      readonly key: string
      readonly raw: string
      readonly reason: EnvelopeRecoveryReason
      readonly status: 'recovery-required'
    }

export interface RawRecoveryPayload {
  readonly filename: string
  readonly key: string
  readonly raw: string
}

export class RawEnvelopeRecoveryRequiredError extends Error {
  readonly code = 'RAW_ENVELOPE_RECOVERY_REQUIRED'
  readonly key: string

  constructor(key: string) {
    super(`Stored value ${key} requires raw recovery before it can be replaced.`)
    this.name = 'RawEnvelopeRecoveryRequiredError'
    this.key = key
  }
}

export class LocalPersistenceQuotaError extends Error {
  readonly code = 'LOCAL_PERSISTENCE_QUOTA_EXCEEDED'

  constructor() {
    super('Local storage quota was exceeded. Your current Markdown remains in memory; export raw Markdown before closing this page.')
    this.name = 'LocalPersistenceQuotaError'
  }
}

function isQuotaFailure(failure: unknown): boolean {
  if (typeof failure !== 'object' || failure === null) return false
  const name = 'name' in failure ? failure.name : null
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
}

function writeStorage(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value)
  } catch (failure) {
    if (isQuotaFailure(failure)) throw new LocalPersistenceQuotaError()
    throw failure
  }
}

export function documentStorageKey(documentId: string): string {
  if (documentId.length === 0) throw new TypeError('Document ID cannot be empty.')
  return `${DOCUMENT_KEY_PREFIX}${encodeURIComponent(documentId)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSnapshot(value: unknown): value is PersistedSnapshotV1 {
  return isRecord(value)
    && typeof value['markdown'] === 'string'
    && Number.isInteger(value['revision'])
    && (value['revision'] as number) >= 0
    && typeof value['savedAt'] === 'string'
}

function isNullableSnapshot(value: unknown): value is PersistedSnapshotV1 | null {
  return value === null || isSnapshot(value)
}

function isWorkspaceEnvelope(value: unknown): value is WorkspaceEnvelopeV1 {
  return isRecord(value)
    && value['schemaVersion'] === 1
    && typeof value['activeDocumentId'] === 'string'
    && Array.isArray(value['catalogDocumentIds'])
    && value['catalogDocumentIds'].every((documentId) => typeof documentId === 'string')
    && isRecord(value['articlePanel'])
    && typeof value['articlePanel']['collapsed'] === 'boolean'
    && typeof value['articlePanel']['width'] === 'number'
    && Number.isFinite(value['articlePanel']['width'])
}

function isDocumentEnvelope(value: unknown, documentId?: string): value is DocumentEnvelopeV1 {
  return isRecord(value)
    && value['schemaVersion'] === 1
    && typeof value['documentId'] === 'string'
    && (documentId === undefined || value['documentId'] === documentId)
    && isSnapshot(value['autosave'])
    && isNullableSnapshot(value['manualCheckpoint'])
    && isNullableSnapshot(value['preDestructiveReplace'])
    && isNullableSnapshot(value['preModeSwitch'])
    && isRecord(value['status'])
    && (value['status']['lastPersistenceFailure'] === null || typeof value['status']['lastPersistenceFailure'] === 'string')
}

function snapshot(value: PersistedSnapshotV1): PersistedSnapshotV1 {
  return Object.freeze({ markdown: value.markdown, revision: value.revision, savedAt: value.savedAt })
}

function optionalSnapshot(value: PersistedSnapshotV1 | null): PersistedSnapshotV1 | null {
  return value === null ? null : snapshot(value)
}

function workspaceEnvelope(value: WorkspaceEnvelopeV1): WorkspaceEnvelopeV1 {
  return Object.freeze({
    activeDocumentId: value.activeDocumentId,
    articlePanel: Object.freeze({ collapsed: value.articlePanel.collapsed, width: value.articlePanel.width }),
    catalogDocumentIds: Object.freeze([...value.catalogDocumentIds]),
    schemaVersion: 1,
  })
}

function documentEnvelope(value: DocumentEnvelopeV1): DocumentEnvelopeV1 {
  return Object.freeze({
    autosave: snapshot(value.autosave),
    documentId: value.documentId,
    manualCheckpoint: optionalSnapshot(value.manualCheckpoint),
    preDestructiveReplace: optionalSnapshot(value.preDestructiveReplace),
    preModeSwitch: optionalSnapshot(value.preModeSwitch),
    schemaVersion: 1,
    status: Object.freeze({ lastPersistenceFailure: value.status.lastPersistenceFailure }),
  })
}

function parseEnvelope<T>(
  key: string,
  raw: string | null,
  validate: (value: unknown) => value is T,
  freeze: (value: T) => T,
): EnvelopeReadResult<T> {
  if (raw === null) return Object.freeze({ status: 'missing' })
  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    return Object.freeze({ key, raw, reason: 'corrupt', status: 'recovery-required' })
  }
  if (isRecord(value) && value['schemaVersion'] !== 1) {
    return Object.freeze({ key, raw, reason: 'unsupported-version', status: 'recovery-required' })
  }
  if (!validate(value)) {
    return Object.freeze({ key, raw, reason: 'corrupt', status: 'recovery-required' })
  }
  return Object.freeze({ status: 'valid', value: freeze(value) })
}

export class LocalDocumentRepository {
  readonly #storage: Storage

  constructor(storage: Storage = window.localStorage) {
    this.#storage = storage
  }

  readWorkspace(): EnvelopeReadResult<WorkspaceEnvelopeV1> {
    return parseEnvelope(WORKSPACE_KEY, this.#storage.getItem(WORKSPACE_KEY), isWorkspaceEnvelope, workspaceEnvelope)
  }

  readDocument(documentId: string): EnvelopeReadResult<DocumentEnvelopeV1> {
    const key = documentStorageKey(documentId)
    return parseEnvelope(
      key,
      this.#storage.getItem(key),
      (value): value is DocumentEnvelopeV1 => isDocumentEnvelope(value, documentId),
      documentEnvelope,
    )
  }

  writeWorkspace(next: WorkspaceEnvelopeV1): void {
    if (!isWorkspaceEnvelope(next)) throw new TypeError('Invalid version-1 workspace envelope.')
    this.#assertWritable(this.readWorkspace(), WORKSPACE_KEY)
    const complete = workspaceEnvelope(next)
    writeStorage(this.#storage, WORKSPACE_KEY, JSON.stringify(complete))
  }

  writeDocument(next: DocumentEnvelopeV1): void {
    if (!isDocumentEnvelope(next)) throw new TypeError('Invalid version-1 document envelope.')
    const key = documentStorageKey(next.documentId)
    this.#assertWritable(this.readDocument(next.documentId), key)
    const complete = documentEnvelope(next)
    writeStorage(this.#storage, key, JSON.stringify(complete))
  }

  rawRecovery(key: string): RawRecoveryPayload | null {
    const raw = this.#storage.getItem(key)
    if (raw === null) return null
    const name = key === WORKSPACE_KEY
      ? 'workspace'
      : key.startsWith(DOCUMENT_KEY_PREFIX)
        ? `document-${decodeURIComponent(key.slice(DOCUMENT_KEY_PREFIX.length))}`
        : 'unknown'
    return Object.freeze({ filename: `w-editor-recovery-${name}.json`, key, raw })
  }

  createRawRecoveryDownload(key: string): { readonly blob: Blob; readonly filename: string } | null {
    const payload = this.rawRecovery(key)
    if (payload === null) return null
    return Object.freeze({
      blob: new Blob([payload.raw], { type: 'application/json;charset=utf-8' }),
      filename: payload.filename,
    })
  }

  clearAndResetWorkspace(next: WorkspaceEnvelopeV1): void {
    this.#storage.removeItem(WORKSPACE_KEY)
    this.writeWorkspace(next)
  }

  clearAndResetDocument(documentId: string, next: DocumentEnvelopeV1): void {
    if (next.documentId !== documentId) throw new TypeError('Reset envelope document ID does not match its storage key.')
    this.#storage.removeItem(documentStorageKey(documentId))
    this.writeDocument(next)
  }

  #assertWritable(result: EnvelopeReadResult<unknown>, key: string): void {
    if (result.status === 'recovery-required') throw new RawEnvelopeRecoveryRequiredError(key)
  }
}
