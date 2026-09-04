import type {
  DocumentSnapshot as CoreDocumentSnapshot,
  EditorMode,
  ResourceLocator,
  ResourceOptions,
  SettingsStore,
  UploadAdapter,
} from '@w-editor/editor-core'
import type { AppearanceTheme, UiLocale } from '@w-editor/editor-vue/host'

import { RELEASE_VERSIONS } from './releaseVersions.generated'

export const WEB_API_VERSION = RELEASE_VERSIONS.webApiVersion
export const WEB_SCHEMA_VERSION = RELEASE_VERSIONS.webSchemaVersion
export const HOST_CONTRACTS_VERSION = RELEASE_VERSIONS.hostContractsVersion
export const MINIMUM_HOST_ADAPTER_VERSION = RELEASE_VERSIONS.minimumHostAdapterVersion

export const W_EDITOR_PROFILES = Object.freeze(['reader', 'author-preview'] as const)
export type WRendererProfile = (typeof W_EDITOR_PROFILES)[number]
export type WEditorProfile = 'editor'

export type WEditorActionHint =
  | 'login'
  | 'retry'
  | 'save'
  | 'reload'
  | 'export'
  | 'save-as'
  | 'authorized-overwrite'
  | 'configure-upload'
  | 'configure-host'
  | 'inspect-asset'
  | 'destroy-later'
  | 'cancel'

function actionHints(...hints: WEditorActionHint[]): readonly WEditorActionHint[] {
  return Object.freeze(hints)
}

export const PUBLIC_ERROR_CODES = Object.freeze([
  'INVALID_MOUNT',
  'INVALID_DOCUMENT',
  'AUTH_REQUIRED',
  'AUTHORIZATION_DENIED',
  'CSRF_REJECTED',
  'INVALID_ASSET_URL',
  'SAVE_FAILED',
  'REVISION_CONFLICT',
  'SETTINGS_UNAVAILABLE',
  'UPLOAD_UNAVAILABLE',
  'ASSET_MISSING',
  'INCOMPATIBLE_HOST',
  'DESTROY_BLOCKED',
  'REPLACE_BLOCKED',
  'DESTROYED',
] as const)
export type WEditorErrorCode = (typeof PUBLIC_ERROR_CODES)[number]

export interface WEditorError<Code extends WEditorErrorCode = WEditorErrorCode> {
  readonly actionHints: readonly WEditorActionHint[]
  readonly code: Code
  readonly message: string
  readonly retryable: boolean
}

const DEFAULT_ERROR_ACTIONS: Readonly<Record<WEditorErrorCode, readonly WEditorActionHint[]>> = Object.freeze({
  ASSET_MISSING: actionHints('inspect-asset'),
  AUTHORIZATION_DENIED: actionHints('cancel'),
  AUTH_REQUIRED: actionHints('login'),
  CSRF_REJECTED: actionHints('retry', 'login'),
  DESTROY_BLOCKED: actionHints('retry', 'destroy-later'),
  DESTROYED: actionHints(),
  INCOMPATIBLE_HOST: actionHints('configure-host'),
  INVALID_DOCUMENT: actionHints('cancel'),
  INVALID_ASSET_URL: actionHints('cancel'),
  INVALID_MOUNT: actionHints('cancel'),
  REPLACE_BLOCKED: actionHints('save', 'export', 'cancel'),
  REVISION_CONFLICT: actionHints('reload', 'export', 'save-as', 'authorized-overwrite'),
  SAVE_FAILED: actionHints('retry', 'export'),
  SETTINGS_UNAVAILABLE: actionHints('retry'),
  UPLOAD_UNAVAILABLE: actionHints('configure-upload'),
})

const NON_RETRYABLE_ERRORS = new Set<WEditorErrorCode>([
  'AUTH_REQUIRED',
  'AUTHORIZATION_DENIED',
  'ASSET_MISSING',
  'DESTROYED',
  'INCOMPATIBLE_HOST',
  'INVALID_ASSET_URL',
  'INVALID_DOCUMENT',
  'INVALID_MOUNT',
  'REPLACE_BLOCKED',
  'SETTINGS_UNAVAILABLE',
  'UPLOAD_UNAVAILABLE',
])

export interface PublicErrorOptions {
  readonly actionHints?: readonly WEditorActionHint[]
  readonly retryable?: boolean
}

export function createPublicError<Code extends WEditorErrorCode>(
  code: Code,
  message: string,
  options: PublicErrorOptions = {},
): WEditorError<Code> {
  const actionHints = Object.freeze([...(options.actionHints ?? DEFAULT_ERROR_ACTIONS[code])])
  return Object.freeze({
    actionHints,
    code,
    message,
    retryable: options.retryable ?? !NON_RETRYABLE_ERRORS.has(code),
  })
}

const PUBLIC_ERROR_CODE_SET = new Set<string>(PUBLIC_ERROR_CODES)

export function normalizePublicError(
  failure: unknown,
  fallbackCode: WEditorErrorCode = 'SAVE_FAILED',
): WEditorError {
  const record = typeof failure === 'object' && failure !== null ? failure as Record<string, unknown> : null
  const candidateCode = typeof record?.['code'] === 'string' ? record['code'] : null
  const code = candidateCode !== null && PUBLIC_ERROR_CODE_SET.has(candidateCode)
    ? candidateCode as WEditorErrorCode
    : fallbackCode
  const message = failure instanceof Error && failure.message.length > 0
    ? failure.message
    : typeof record?.['message'] === 'string' && record['message'].length > 0
      ? record['message']
      : 'The W-Editor host operation failed.'
  const actionHints = Array.isArray(record?.['actionHints'])
    ? record['actionHints'].filter((hint): hint is WEditorActionHint => typeof hint === 'string' && Object.values(DEFAULT_ERROR_ACTIONS).some((hints) => hints.includes(hint as WEditorActionHint)))
    : undefined
  return createPublicError(code, message, {
    ...(actionHints === undefined ? {} : { actionHints }),
    ...(typeof record?.['retryable'] === 'boolean' ? { retryable: record['retryable'] } : {}),
  })
}

export interface WDocumentInput {
  readonly documentId: string
  readonly markdown: string
  readonly revision?: number
  readonly serverRevision?: string
}

export interface WSourceAnchor {
  readonly from: number
  readonly to: number
}

export interface WSourceSelection {
  readonly anchor: number
  readonly head: number
}

export interface WWorkspaceScroll {
  readonly left: number
  readonly top: number
}

export interface WWorkspaceSidebar {
  readonly collapsed: boolean
  readonly width: number
}

export interface WWorkspaceState {
  readonly mode: EditorMode
  readonly scroll: WWorkspaceScroll
  readonly selection: WSourceSelection | null
  readonly sidebar: WWorkspaceSidebar
  readonly sourceAnchor: WSourceAnchor | null
}

export interface WRecoveryDraft extends WWorkspaceState {
  readonly baseServerRevision: string | null
  readonly documentId: string
  readonly localRevision: number
  readonly markdown: string
  readonly schemaVersion: typeof WEB_SCHEMA_VERSION
  readonly updatedAt: string
  readonly userId: string
}

export interface WWorkspaceExchange extends WWorkspaceState {
  readonly documentId: string
  readonly draft: WRecoveryDraft | null
  readonly schemaVersion: typeof WEB_SCHEMA_VERSION
  readonly userId: string
}

export type WRecoveryStatus = 'loading' | 'none' | 'available' | 'recovered' | 'discarded' | 'exported' | 'failed'

export interface WRecoveryState {
  readonly draft: WRecoveryDraft | null
  readonly error: WEditorError | null
  readonly status: WRecoveryStatus
  readonly workspace: WWorkspaceExchange | null
}

export type WRecoveryActionResult = Readonly<{
  readonly snapshot: WEditorSnapshot
  readonly state: WRecoveryState
  readonly status: Extract<WRecoveryStatus, 'recovered' | 'discarded'>
}>

function identity(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${field} must be a non-empty string.`)
  return value
}

function position(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${field} must be a non-negative safe integer.`)
  return value as number
}

function coordinate(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TypeError(`${field} must be a non-negative finite number.`)
  return value
}

function workspaceMode(value: unknown): EditorMode {
  if (value !== 'source' && value !== 'visual' && value !== 'preview') throw new TypeError('Workspace mode is invalid.')
  return value
}

export function createWorkspaceState(input: WWorkspaceState): WWorkspaceState {
  const sourceAnchor = input.sourceAnchor === null
    ? null
    : Object.freeze({ from: position(input.sourceAnchor.from, 'sourceAnchor.from'), to: position(input.sourceAnchor.to, 'sourceAnchor.to') })
  if (sourceAnchor !== null && sourceAnchor.to < sourceAnchor.from) throw new RangeError('sourceAnchor.to must not precede sourceAnchor.from.')
  const selection = input.selection === null
    ? null
    : Object.freeze({ anchor: position(input.selection.anchor, 'selection.anchor'), head: position(input.selection.head, 'selection.head') })
  return Object.freeze({
    mode: workspaceMode(input.mode),
    scroll: Object.freeze({ left: coordinate(input.scroll.left, 'scroll.left'), top: coordinate(input.scroll.top, 'scroll.top') }),
    selection,
    sidebar: Object.freeze({
      collapsed: typeof input.sidebar.collapsed === 'boolean' ? input.sidebar.collapsed : (() => { throw new TypeError('sidebar.collapsed must be a boolean.') })(),
      width: coordinate(input.sidebar.width, 'sidebar.width'),
    }),
    sourceAnchor,
  })
}

export interface RecoveryDraftInput extends WWorkspaceState {
  readonly baseServerRevision: string | null
  readonly documentId: string
  readonly localRevision: number
  readonly markdown: string
  readonly updatedAt: string
  readonly userId: string
}

export function createRecoveryDraft(input: RecoveryDraftInput): WRecoveryDraft {
  if (input.baseServerRevision !== null) identity(input.baseServerRevision, 'baseServerRevision')
  if (typeof input.markdown !== 'string') throw new TypeError('Recovery draft Markdown must be a string.')
  const localRevision = position(input.localRevision, 'localRevision')
  const state = createWorkspaceState(input)
  return Object.freeze({
    ...state,
    baseServerRevision: input.baseServerRevision,
    documentId: identity(input.documentId, 'documentId'),
    localRevision,
    markdown: input.markdown,
    schemaVersion: WEB_SCHEMA_VERSION,
    updatedAt: identity(input.updatedAt, 'updatedAt'),
    userId: identity(input.userId, 'userId'),
  })
}

export interface WorkspaceExchangeInput extends WWorkspaceState {
  readonly documentId: string
  readonly draft: WRecoveryDraft | null
  readonly userId: string
}

export function createWorkspaceExchange(input: WorkspaceExchangeInput): WWorkspaceExchange {
  const userId = identity(input.userId, 'userId')
  const documentId = identity(input.documentId, 'documentId')
  if (input.draft !== null && (input.draft.userId !== userId || input.draft.documentId !== documentId)) {
    throw new TypeError('Workspace draft identity does not match the exchange identity.')
  }
  if (input.draft !== null && input.draft.schemaVersion !== WEB_SCHEMA_VERSION) {
    throw new TypeError(`Workspace draft schema ${input.draft.schemaVersion} is incompatible with ${WEB_SCHEMA_VERSION}.`)
  }
  const draft = input.draft === null ? null : createRecoveryDraft(input.draft)
  return Object.freeze({
    ...createWorkspaceState(input),
    documentId,
    draft,
    schemaVersion: WEB_SCHEMA_VERSION,
    userId,
  })
}

export interface WRecoveryDraftKey {
  readonly documentId: string
  readonly userId: string
}

export interface WRecoveryDraftAdapter {
  readonly clear: (key: WRecoveryDraftKey) => void | Promise<void>
  readonly load: (key: WRecoveryDraftKey) => WRecoveryDraft | null | Promise<WRecoveryDraft | null>
  readonly save: (draft: WRecoveryDraft) => void | Promise<void>
}

export interface WWorkspaceAdapter {
  readonly load: (key: WRecoveryDraftKey) => WWorkspaceExchange | null | Promise<WWorkspaceExchange | null>
  readonly save: (exchange: WWorkspaceExchange) => void | Promise<void>
}

export interface WDocumentSnapshot extends CoreDocumentSnapshot {
  readonly serverRevision?: string
}

export interface WEditorSnapshot extends WDocumentSnapshot {
  readonly dirty: boolean
  readonly historyDepth: number
  readonly mode: EditorMode
  readonly saveState: WSaveState
}

export interface WRendererSnapshot extends WDocumentSnapshot {
  readonly profile: WRendererProfile
}

export type WChangeOrigin =
  | 'source-edit'
  | 'visual-edit'
  | 'insert-image-url'
  | 'host-replace'

export interface WEditorReadyEvent {
  readonly apiVersion: typeof WEB_API_VERSION
  readonly instanceId: string
  readonly schemaVersion: typeof WEB_SCHEMA_VERSION
  readonly snapshot: WEditorSnapshot
  readonly type: 'ready'
}

export interface WRendererReadyEvent {
  readonly apiVersion: typeof WEB_API_VERSION
  readonly instanceId: string
  readonly schemaVersion: typeof WEB_SCHEMA_VERSION
  readonly snapshot: WRendererSnapshot
  readonly type: 'ready'
}

export interface WEditorChangeEvent {
  readonly apiVersion: typeof WEB_API_VERSION
  readonly instanceId: string
  readonly origin: WChangeOrigin
  readonly snapshot: WEditorSnapshot
  readonly type: 'change'
}

export interface WEditorSaveStateChangeEvent {
  readonly apiVersion: typeof WEB_API_VERSION
  readonly instanceId: string
  readonly snapshot: WEditorSnapshot
  readonly state: WSaveState
  readonly type: 'save-state-change'
}

export interface WEditorErrorEvent {
  readonly apiVersion: typeof WEB_API_VERSION
  readonly error: WEditorError
  readonly instanceId: string
  readonly snapshot: WEditorSnapshot | WRendererSnapshot
  readonly type: 'error'
}

export type WEditorEvent = WEditorReadyEvent | WEditorChangeEvent | WEditorSaveStateChangeEvent | WEditorErrorEvent

export type WSaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'save-failed' | 'autosave-pending' | 'autosave-saving' | 'autosave-failed' | 'conflict' | 'destroyed'

export type WSaveKind = 'autosave-draft' | 'manual-save' | 'publish'
export type WSaveOrigin = 'autosave' | 'user' | 'publish' | 'host'

export interface WSaveRequest {
  readonly baseServerRevision: string | null
  readonly documentId: string
  readonly localRevision: number
  readonly markdown: string
  readonly metadata: Readonly<Record<string, unknown>>
  readonly origin: WSaveOrigin
  readonly overwrite: boolean
  readonly saveKind: WSaveKind
}

export interface WRecoveryDraftState {
  readonly baseServerRevision: string | null
  readonly status: 'none' | 'saved' | 'merged' | 'stale'
  readonly updatedAt?: string
}

export interface WSaveResponse {
  readonly draftState: WRecoveryDraftState
  readonly savedAt: string
  readonly serverRevision: string
  readonly versionId?: string
}

export interface WSaveAdapter {
  readonly save: (request: WSaveRequest) => Promise<WSaveResponse>
}

export type WUploadAvailability =
  | Readonly<{ status: 'configured' }>
  | Readonly<{ error: WEditorError<'UPLOAD_UNAVAILABLE'>; status: 'unavailable' }>

export type WUploadResult =
  | Readonly<{ asset: import('@w-editor/editor-core').UploadedAsset; snapshot: WEditorSnapshot; status: 'inserted' }>
  | Readonly<{ error: WEditorError; snapshot: WEditorSnapshot; status: 'failed' | 'unavailable' }>

export interface WSaveOptions {
  readonly kind?: Exclude<WSaveKind, 'autosave-draft'>
  readonly metadata?: Readonly<Record<string, unknown>>
  readonly origin?: Exclude<WSaveOrigin, 'autosave'>
  readonly overwrite?: boolean
}

export interface WAutosaveOptions {
  readonly enabled?: boolean
  readonly maxWaitMs?: number
  readonly trailingDelayMs?: number
}

export type WSaveResult =
  | Readonly<{ response: WSaveResponse; snapshot: WEditorSnapshot; status: 'saved' }>
  | Readonly<{ error: WEditorError<'REVISION_CONFLICT'>; snapshot: WEditorSnapshot; status: 'conflict' }>
  | Readonly<{ error: WEditorError; snapshot: WEditorSnapshot; status: 'failed' }>

export interface WReplaceConfirmation {
  readonly actions: readonly ['save', 'export', 'cancel']
  readonly current: WEditorSnapshot
  readonly replacement: WDocumentSnapshot
}

export interface WReplaceDocumentOptions {
  readonly confirm?: (confirmation: WReplaceConfirmation) => boolean | Promise<boolean>
}

export type WReplaceDocumentResult =
  | Readonly<{ snapshot: WEditorSnapshot; status: 'replaced' }>
  | Readonly<{ actions: readonly ['save', 'export', 'cancel']; snapshot: WEditorSnapshot; status: 'blocked' }>
  | Readonly<{ snapshot: WEditorSnapshot; status: 'cancelled' }>

export interface WDestroyResult {
  readonly status: 'destroyed' | 'blocked'
  readonly error?: WEditorError<'DESTROY_BLOCKED'>
}

export interface WDestroyConfirmation {
  readonly actions: readonly ['save', 'export', 'cancel']
  readonly current: WEditorSnapshot
}

export interface WDestroyOptions {
  readonly confirm?: (confirmation: WDestroyConfirmation) => boolean | Promise<boolean>
}

export type WRendererAuthorEvent =
  | Readonly<{
      readonly index: number
      readonly type: 'code-edit'
    }>
  | Readonly<{
      readonly checked: boolean
      readonly index: number
      readonly snapshot: WRendererSnapshot
      readonly type: 'task-toggle'
    }>

export type WRendererExtensionPermission = 'safe-fragment'

export interface WRendererExtensionContext {
  readonly profile: WRendererProfile
  readonly resourceOptions: ResourceOptions
  readonly snapshot: WDocumentSnapshot
}

export interface WRendererExtension {
  readonly id: string
  readonly permissions: readonly WRendererExtensionPermission[]
  readonly render: (context: WRendererExtensionContext) => string | null
}

export interface WEditorMountOptions {
  readonly apiVersion?: string
  readonly assetBaseUrl?: string
  readonly autosave?: WAutosaveOptions
  readonly draftAdapter?: WRecoveryDraftAdapter
  readonly document: WDocumentInput
  readonly hostAdapterVersion?: string
  readonly initialMode?: EditorMode
  readonly locale?: UiLocale
  readonly onChange?: (event: WEditorChangeEvent) => void
  readonly onError?: (event: WEditorErrorEvent) => void
  readonly onReady?: (event: WEditorReadyEvent) => void
  readonly onSaveStateChange?: (event: WEditorSaveStateChangeEvent) => void
  /** @deprecated Since 1.0.0; omit this redundant Editor profile before 2.0.0. */
  readonly profile?: WEditorProfile
  readonly reloadDocument?: () => WDocumentInput | Promise<WDocumentInput>
  readonly rendererExtensions?: readonly WRendererExtension[]
  readonly resourceLocator?: ResourceLocator
  readonly saveAdapter?: WSaveAdapter
  readonly schemaVersion?: string
  readonly settingsStore?: SettingsStore
  readonly theme?: AppearanceTheme
  readonly uploadAdapter?: UploadAdapter
  readonly userId?: string
  readonly workspaceAdapter?: WWorkspaceAdapter
}

export interface WRendererMountOptions {
  readonly apiVersion?: string
  readonly assetBaseUrl?: string
  readonly hostAdapterVersion?: string
  readonly locale?: UiLocale
  readonly markdown: string
  readonly onReady?: (event: WRendererReadyEvent) => void
  readonly onAuthorEvent?: (event: WRendererAuthorEvent) => void
  readonly onError?: (event: WEditorErrorEvent) => void
  readonly profile: WRendererProfile
  readonly rendererExtensions?: readonly WRendererExtension[]
  readonly resourceLocator?: ResourceLocator
  readonly schemaVersion?: string
  readonly settingsStore?: SettingsStore
  readonly theme?: AppearanceTheme
}

export interface WEditorInstance {
  readonly apiVersion: typeof WEB_API_VERSION
  readonly instanceId: string
  readonly schemaVersion: typeof WEB_SCHEMA_VERSION
  readonly destroy: (options?: WDestroyOptions) => Promise<WDestroyResult>
  readonly discardDraft: () => Promise<WRecoveryActionResult>
  readonly exportMarkdown: () => string
  readonly exportDraft: () => string | null
  readonly flush: () => Promise<void>
  readonly focus: () => void
  readonly insertImageUrl: (url: string, name?: string) => WUploadResult
  readonly replaceDocument: (document: WDocumentInput, options?: WReplaceDocumentOptions) => Promise<WReplaceDocumentResult>
  readonly reload: () => Promise<WReplaceDocumentResult>
  readonly retry: () => Promise<WSaveResult>
  readonly recoverDraft: () => Promise<WRecoveryActionResult>
  readonly recoveryState: () => WRecoveryState
  readonly save: (options?: WSaveOptions) => Promise<WSaveResult>
  readonly saveWorkspace: () => Promise<WWorkspaceExchange>
  readonly setDocument: (document: WDocumentInput, options?: WReplaceDocumentOptions) => Promise<WReplaceDocumentResult>
  readonly snapshot: () => WEditorSnapshot
  readonly uploadLocalFile: (file: import('@w-editor/editor-core').UploadFile) => Promise<WUploadResult>
  readonly uploadState: () => WUploadAvailability
}

export interface WRendererInstance {
  readonly apiVersion: typeof WEB_API_VERSION
  readonly instanceId: string
  readonly schemaVersion: typeof WEB_SCHEMA_VERSION
  readonly destroy: () => Promise<WDestroyResult>
  readonly setMarkdown: (markdown: string) => WRendererSnapshot
  readonly snapshot: () => WRendererSnapshot
}

export function createDocumentSnapshot(input: WDocumentInput): WDocumentSnapshot {
  if (typeof input !== 'object' || input === null) throw new TypeError('Document input must be an object.')
  const documentId = identity(input.documentId, 'documentId')
  if (typeof input.markdown !== 'string') throw new TypeError('Document Markdown must be a string.')
  const revision = input.revision ?? 0
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new TypeError('Document revision must be a non-negative safe integer.')
  }
  return Object.freeze({
    documentId,
    markdown: input.markdown,
    revision,
    ...(input.serverRevision === undefined ? {} : { serverRevision: identity(input.serverRevision, 'serverRevision') }),
  })
}
