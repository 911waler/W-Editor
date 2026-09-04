import {
  BoundedScheduler,
  DocumentSession,
  createTaskItemCheckedPlan,
  mediaSource,
  projectOrdinaryMarkdown,
  SynchronizationStateStore,
  type DocumentChange,
  type MutationOrigin,
  type ResourceOptions,
  type UploadAdapter,
  type UploadFile,
} from '@w-editor/editor-core'
import {
  createInstanceDomService,
  sanitizeRendererExtensions,
  createUiLocalizationStore,
  normalizeUploadedAsset,
  serializeOrdinaryTiptapPatch,
  TiptapTransactionPatchPlanner,
  TiptapVisualAdapter,
  VisualSynchronizationService,
  type InstanceDomService,
  type RendererExtension,
  type SemanticNodeCopyEvent,
  type UiLocalizationStore,
} from '@w-editor/editor-vue/host'

import {
  createRecoveryDraft,
  createDocumentSnapshot,
  createPublicError,
  createWorkspaceExchange,
  createWorkspaceState,
  WEB_API_VERSION,
  WEB_SCHEMA_VERSION,
  type WChangeOrigin,
  type WDocumentInput,
  type WDocumentSnapshot,
  type WEditorChangeEvent,
  type WEditorError,
  type WEditorErrorEvent,
  type WEditorInstance,
  type WEditorMountOptions,
  type WEditorReadyEvent,
  type WEditorSaveStateChangeEvent,
  type WEditorSnapshot,
  type WReplaceConfirmation,
  type WReplaceDocumentOptions,
  type WReplaceDocumentResult,
  type WSaveOptions,
  type WSaveAdapter,
  type WSaveRequest,
  type WSaveResult,
  type WSaveKind,
  type WSaveOrigin,
  type WSaveState,
  type WAutosaveOptions,
  type WUploadAvailability,
  type WUploadResult,
  type WDestroyResult,
  type WDestroyOptions,
  type WRecoveryActionResult,
  type WRecoveryDraft,
  type WRecoveryDraftAdapter,
  type WRecoveryDraftKey,
  type RecoveryDraftInput,
  type WRecoveryState,
  type WRecoveryStatus,
  type WSourceAnchor,
  type WWorkspaceAdapter,
  type WWorkspaceExchange,
  type WWorkspaceState,
  type WorkspaceExchangeInput,
} from './publicContracts'
import { createSaveRequest, normalizeSaveResponse, saveFailure } from './saveAdapter'
import { resolveWebAssetUrl } from './resourceResolver'
import { checkWebHostCompatibility } from './versioning'
import { adaptRendererExtensions } from './extensionAdapter'
import { createWebSettingsController, type WebSettingsController } from './settingsController'

export class WEditorContractError extends Error {
  readonly code: WEditorError['code']
  readonly error: WEditorError

  constructor(error: WEditorError) {
    super(error.message)
    this.name = 'WEditorContractError'
    this.code = error.code
    this.error = error
  }
}

function contractError(code: 'INVALID_DOCUMENT' | 'INVALID_MOUNT', message: string): WEditorContractError {
  return new WEditorContractError(createPublicError(code, message))
}

function assertCompatibleMount(options: Pick<WEditorMountOptions, 'apiVersion' | 'hostAdapterVersion' | 'profile' | 'schemaVersion'>): void {
  const result = checkWebHostCompatibility({
    apiVersion: options.apiVersion,
    hostAdapterVersion: options.hostAdapterVersion,
    schemaVersion: options.schemaVersion,
    ...(options.profile === undefined ? {} : { usesDeprecatedFields: ['WEditorMountOptions.profile'] }),
  })
  if (!result.compatible) throw new WEditorContractError(result.error)
  if (options.profile !== undefined && options.profile !== 'editor') {
    throw new WEditorContractError(createPublicError('INCOMPATIBLE_HOST', 'WEditor mount profile must be editor.'))
  }
}

function isHtmlElement(value: unknown): value is HTMLElement {
  if (typeof value !== 'object' || value === null || !('ownerDocument' in value)) return false
  const ownerDocument = value.ownerDocument
  if (typeof ownerDocument !== 'object' || ownerDocument === null || !('defaultView' in ownerDocument)) return false
  const view = ownerDocument.defaultView as (Window & typeof globalThis) | null
  return view !== null && value instanceof view.HTMLElement
}

function isOwnedElement(value: unknown, ownerDocument: Document): value is HTMLElement {
  const view = ownerDocument.defaultView
  return view !== null && value instanceof view.HTMLElement
}

function isOwnedTextArea(value: unknown, ownerDocument: Document): value is HTMLTextAreaElement {
  const view = ownerDocument.defaultView
  return view !== null && value instanceof view.HTMLTextAreaElement
}

function normalizeDocument(input: WDocumentInput): WDocumentSnapshot {
  if (typeof input !== 'object' || input === null) {
    throw contractError('INVALID_DOCUMENT', 'A document snapshot is required.')
  }
  if (typeof input.documentId !== 'string' || input.documentId.trim().length === 0) {
    throw contractError('INVALID_DOCUMENT', 'Document snapshots require a non-empty documentId.')
  }
  if (typeof input.markdown !== 'string') {
    throw contractError('INVALID_DOCUMENT', 'Document snapshots require Markdown text.')
  }
  try {
    return createDocumentSnapshot({
      documentId: input.documentId,
      markdown: input.markdown,
      ...(input.revision === undefined ? {} : { revision: input.revision }),
      ...(input.serverRevision === undefined ? {} : { serverRevision: input.serverRevision }),
    })
  } catch (failure) {
    throw contractError('INVALID_DOCUMENT', failure instanceof Error ? failure.message : 'Invalid document snapshot.')
  }
}

function editorSnapshot(
  document: WDocumentSnapshot,
  mode: WEditorSnapshot['mode'],
  dirty: boolean,
  historyDepth: number,
  saveState: WSaveState,
): WEditorSnapshot {
  return Object.freeze({
    ...document,
    dirty,
    historyDepth,
    mode,
    saveState,
  })
}

function createAutosaveScheduler(
  options: WAutosaveOptions | undefined,
  run: (snapshot: WDocumentSnapshot) => Promise<void>,
): BoundedScheduler<WDocumentSnapshot> | null {
  if (options?.enabled !== true) return null
  return new BoundedScheduler({
    coalesce: (_pending, next) => next,
    maxWaitMs: options.maxWaitMs ?? 5_000,
    run,
    trailingDelayMs: options.trailingDelayMs ?? 1_000,
  })
}

function recoveryUserId(options: Pick<WEditorMountOptions, 'draftAdapter' | 'userId' | 'workspaceAdapter'>): string | null {
  if (options.draftAdapter === undefined && options.workspaceAdapter === undefined) return null
  if (typeof options.userId !== 'string' || options.userId.trim().length === 0) {
    throw contractError('INVALID_MOUNT', 'draftAdapter and workspaceAdapter require a non-empty userId.')
  }
  return options.userId
}

export class WEditorController implements WEditorInstance {
  readonly apiVersion = WEB_API_VERSION
  readonly instanceId: string
  readonly schemaVersion = WEB_SCHEMA_VERSION
  readonly #domService: InstanceDomService
  readonly #options: WEditorMountOptions
  readonly #root: HTMLElement
  readonly #source: HTMLTextAreaElement
  readonly #visual: HTMLDivElement
  readonly #preview: HTMLDivElement
  readonly #previewExtensions: HTMLDivElement
  readonly #rendererExtensions: readonly RendererExtension[]
  readonly #resourceOptions: ResourceOptions
  #destroyPromise: Promise<WDestroyResult> | null = null
  #destroyed = false
  #document: WDocumentSnapshot
  #composing = false
  #compositionMarkdown: { readonly markdown: string; readonly origin: 'source-edit' | 'visual-edit' } | null = null
  readonly #compositionWaiters = new Set<() => void>()
  #historyDepth = 0
  #mode: WEditorSnapshot['mode']
  #saveState: WSaveState = 'clean'
  #session: DocumentSession
  #unsubscribeSession: (() => void) | null = null
  #dirty = false
  #pendingSynchronization: Promise<void> = Promise.resolve()
  readonly #saveAdapter: WSaveAdapter | undefined
  readonly #draftAdapter: WRecoveryDraftAdapter | undefined
  readonly #workspaceAdapter: WWorkspaceAdapter | undefined
  readonly #userId: string | null
  readonly #uploadAdapter: UploadAdapter | undefined
  readonly #autosave: BoundedScheduler<WDocumentSnapshot> | null
  readonly #settings: WebSettingsController
  readonly #localization: UiLocalizationStore
  #visualState: SynchronizationStateStore
  #visualAdapter: TiptapVisualAdapter | null = null
  #visualSynchronization: VisualSynchronizationService | null = null
  #lastAutosaveResult: WSaveResult | null = null
  #lastAutosaveSnapshot: WDocumentSnapshot | null = null
  #lastSaveOptions: WSaveOptions | null = null
  #pendingPublicOrigin: WChangeOrigin | null = null
  #recoveryStatus: WRecoveryStatus = 'none'
  #recoveryDraft: WRecoveryDraft | null = null
  #recoveryWorkspace: WWorkspaceExchange | null = null
  #recoveryError: WEditorError | null = null
  #workspaceSidebar: WWorkspaceState['sidebar'] = Object.freeze({ collapsed: false, width: 252 })
  #workspaceSourceAnchor: WSourceAnchor | null = null

  constructor(container: HTMLElement, options: WEditorMountOptions) {
    const documentSnapshot = normalizeDocument(options.document)
    const initialMode = options.initialMode ?? 'source'
    if (initialMode !== 'source' && initialMode !== 'visual' && initialMode !== 'preview') {
      throw contractError('INVALID_MOUNT', 'Editor initialMode must be source, visual, or preview.')
    }
    this.#options = options
    this.#draftAdapter = options.draftAdapter
    this.#workspaceAdapter = options.workspaceAdapter
    this.#userId = recoveryUserId(options)
    if (this.#userId !== null) this.#recoveryStatus = 'loading'
    this.#saveAdapter = options.saveAdapter
    this.#uploadAdapter = options.uploadAdapter
    this.#rendererExtensions = adaptRendererExtensions(options.rendererExtensions)
    this.#resourceOptions = Object.freeze({
      ...(options.assetBaseUrl === undefined ? {} : { assetBaseUrl: options.assetBaseUrl }),
      ...(options.resourceLocator === undefined ? {} : { resourceLocator: options.resourceLocator }),
    })
    this.#localization = createUiLocalizationStore(options.locale ?? 'en')
    this.#autosave = createAutosaveScheduler(options.autosave, (snapshot) => this.#performAutosave(snapshot))
    this.#document = documentSnapshot
    this.#mode = initialMode
    this.#session = new DocumentSession(documentSnapshot)
    this.#visualState = new SynchronizationStateStore(this.#session.snapshot())
    this.#root = container.ownerDocument.createElement('div')
    this.#root.className = 'w-editor-root w-editor-instance'
    this.#root.dataset['wEditorApiVersion'] = WEB_API_VERSION
    this.#root.dataset['wEditorSchemaVersion'] = WEB_SCHEMA_VERSION
    this.#root.dataset['wEditorProfile'] = 'editor'
    this.#domService = createInstanceDomService(this.#root)
    this.instanceId = this.#domService.instanceId
    this.#root.dataset['wEditorInstance'] = this.instanceId
    this.#settings = createWebSettingsController({
      onError: (error) => this.#emitError(error),
      root: this.#root,
      ...(options.theme === undefined ? {} : { distributionTheme: options.theme }),
      ...(options.settingsStore === undefined ? {} : { settingsStore: options.settingsStore }),
    })

    const document = container.ownerDocument
    const sourceSurface = document.createElement('section')
    sourceSurface.dataset['wEditorSurface'] = 'source'
    sourceSurface.className = 'w-editor-surface w-editor-surface--source'
    const source = document.createElement('textarea')
    source.id = this.#domService.createId('source')
    source.value = documentSnapshot.markdown
    source.setAttribute('aria-label', 'Markdown source')
    source.dataset['wEditorSource'] = 'true'
    sourceSurface.append(source)

    const visualSurface = document.createElement('section')
    visualSurface.dataset['wEditorSurface'] = 'visual'
    visualSurface.className = 'w-editor-surface w-editor-surface--visual'
    const visual = document.createElement('div')
    visual.id = this.#domService.createId('visual')
    visual.contentEditable = 'true'
    visual.setAttribute('role', 'textbox')
    visual.setAttribute('aria-label', 'Visual Markdown editor')
    visual.dataset['wEditorVisual'] = 'true'
    visual.textContent = documentSnapshot.markdown
    visualSurface.append(visual)

    const previewSurface = document.createElement('section')
    previewSurface.dataset['wEditorSurface'] = 'preview'
    previewSurface.className = 'w-editor-surface w-editor-surface--preview'
    const preview = document.createElement('div')
    preview.id = this.#domService.createId('preview')
    previewSurface.append(preview)

    this.#root.append(sourceSurface, visualSurface, previewSurface)
    this.#source = source
    this.#visual = visual
    this.#preview = visual
    this.#previewExtensions = preview
    this.#setSurfaceVisibility()
    this.#renderPreviewExtensions()
    this.#unsubscribeSession = this.#session.subscribe((change) => this.#handleSessionChange(change))
    this.#domService.listen(this.#source, 'input', this.#handleSourceInput)
    this.#domService.listen(this.#source, 'compositionstart', this.#handleCompositionStart)
    this.#domService.listen(this.#source, 'compositionend', this.#handleCompositionEnd)
    this.#mountVisualRuntime()
    container.append(this.#root)
  }

  emitReady(): void {
    this.#options.onReady?.(Object.freeze({
      apiVersion: WEB_API_VERSION,
      instanceId: this.instanceId,
      schemaVersion: WEB_SCHEMA_VERSION,
      snapshot: this.snapshot(),
      type: 'ready',
    }) satisfies WEditorReadyEvent)
  }

  initializeSettings(onReady: () => void): void {
    this.#settings.initialize(() => {
      void this.#initializeRecovery(onReady)
    })
  }

  snapshot(): WEditorSnapshot {
    return editorSnapshot(this.#document, this.#mode, this.#dirty, this.#historyDepth, this.#saveState)
  }

  focus(): void {
    this.#assertActive()
    if (this.#mode === 'visual') this.#visual.focus()
    else this.#source.focus()
  }

  flush(): Promise<void> {
    this.#assertActive()
    return this.#flushAll()
  }

  async save(options: WSaveOptions = {}): Promise<WSaveResult> {
    this.#assertActive()
    this.#lastSaveOptions = Object.freeze({
      ...(options.kind === undefined ? {} : { kind: options.kind }),
      ...(options.metadata === undefined ? {} : { metadata: Object.freeze({ ...options.metadata }) }),
      ...(options.origin === undefined ? {} : { origin: options.origin }),
      ...(options.overwrite === undefined ? {} : { overwrite: options.overwrite }),
    })
    return this.#performSave({
      kind: options.kind ?? 'manual-save',
      origin: options.origin ?? (options.kind === 'publish' ? 'publish' : 'user'),
      overwrite: options.overwrite ?? false,
      ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
    })
  }

  retry(): Promise<WSaveResult> {
    if (this.#autosave?.snapshot().status === 'failed' && this.#lastAutosaveSnapshot !== null) {
      this.#autosave.request(this.#lastAutosaveSnapshot)
      return this.#flushAutosaveForRetry()
    }
    return this.#lastSaveOptions === null ? this.save() : this.save(this.#lastSaveOptions)
  }

  recoveryState(): WRecoveryState {
    return Object.freeze({
      draft: this.#recoveryDraft,
      error: this.#recoveryError,
      status: this.#recoveryStatus,
      workspace: this.#recoveryWorkspace,
    })
  }

  exportDraft(): string | null {
    this.#assertActive()
    if (this.#recoveryDraft === null) return null
    this.#recoveryStatus = 'exported'
    return this.#recoveryDraft.markdown
  }

  async recoverDraft(): Promise<WRecoveryActionResult> {
    this.#assertActive()
    const draft = this.#recoveryDraft
    if (draft === null) {
      throw new WEditorContractError(createPublicError('SAVE_FAILED', 'No recovery draft is available.'))
    }
    const replacement: WDocumentInput = {
      documentId: draft.documentId,
      markdown: draft.markdown,
      revision: draft.localRevision,
      ...(draft.baseServerRevision === null ? {} : { serverRevision: draft.baseServerRevision }),
    }
    this.#replaceDocument(normalizeDocument(replacement))
    this.#applyWorkspaceState(draft)
    this.#dirty = true
    this.#setSaveState('dirty')
    try {
      await this.#clearRecoveryDraft()
    } catch (failure) {
      const error = this.#recordRecoveryFailure(failure)
      throw new WEditorContractError(error)
    }
    this.#recoveryStatus = 'recovered'
    return Object.freeze({ snapshot: this.snapshot(), state: this.recoveryState(), status: 'recovered' as const })
  }

  async discardDraft(): Promise<WRecoveryActionResult> {
    this.#assertActive()
    if (this.#recoveryDraft !== null) {
      try {
        await this.#clearRecoveryDraft()
      } catch (failure) {
        const error = this.#recordRecoveryFailure(failure)
        throw new WEditorContractError(error)
      }
    }
    this.#recoveryDraft = null
    this.#recoveryError = null
    this.#recoveryStatus = 'discarded'
    return Object.freeze({ snapshot: this.snapshot(), state: this.recoveryState(), status: 'discarded' as const })
  }

  async saveWorkspace(): Promise<WWorkspaceExchange> {
    this.#assertActive()
    if (this.#workspaceAdapter === undefined) {
      throw new WEditorContractError(createPublicError('INCOMPATIBLE_HOST', 'The host has not configured a workspaceAdapter.'))
    }
    const exchange = this.#createWorkspaceExchange(this.#recoveryDraft)
    try {
      await this.#workspaceAdapter.save(exchange)
      this.#recoveryWorkspace = exchange
      this.#recoveryError = null
      if (this.#recoveryStatus === 'failed') this.#recoveryStatus = this.#recoveryDraft === null ? 'none' : 'available'
      return exchange
    } catch (failure) {
      const error = this.#recordRecoveryFailure(failure)
      throw new WEditorContractError(error)
    }
  }

  exportMarkdown(): string {
    this.#assertActive()
    return this.#document.markdown
  }

  async reload(): Promise<WReplaceDocumentResult> {
    this.#assertActive()
    if (this.#options.reloadDocument === undefined) {
      throw new WEditorContractError(createPublicError('INCOMPATIBLE_HOST', 'The host has not configured a reloadDocument provider.'))
    }
    const document = normalizeDocument(await this.#options.reloadDocument())
    return this.replaceDocument(document, { confirm: () => true })
  }

  uploadState(): WUploadAvailability {
    if (this.#uploadAdapter !== undefined) return Object.freeze({ status: 'configured' })
    return Object.freeze({ error: this.#uploadUnavailableError(), status: 'unavailable' as const })
  }

  insertImageUrl(url: string, name = 'Image'): WUploadResult {
    this.#assertActive()
    const resolved = resolveWebAssetUrl(url, this.#options.assetBaseUrl === undefined
      ? {}
      : { assetBaseUrl: this.#options.assetBaseUrl })
    if (!resolved.valid) {
      const error = createPublicError('INVALID_ASSET_URL', resolved.message, { actionHints: ['cancel'], retryable: false })
      this.#emitError(error)
      return Object.freeze({ error, snapshot: this.snapshot(), status: 'failed' as const })
    }
    try {
      const source = mediaSource('image', name, resolved.url)
      const markdown = this.#document.markdown.length === 0
        ? source
        : `${this.#document.markdown}\n\n${source}`
      this.#commitInput(markdown, 'insert-image-url')
      const asset = Object.freeze({ mediaType: 'image/*', name: name.trim(), size: 0, url: resolved.url })
      return Object.freeze({ asset, snapshot: this.snapshot(), status: 'inserted' as const })
    } catch (failure) {
      const error = createPublicError('INVALID_ASSET_URL', failure instanceof Error ? failure.message : 'The image URL is invalid.', {
        actionHints: ['cancel'],
        retryable: false,
      })
      this.#emitError(error)
      return Object.freeze({ error, snapshot: this.snapshot(), status: 'failed' as const })
    }
  }

  async uploadLocalFile(file: UploadFile): Promise<WUploadResult> {
    this.#assertActive()
    if (this.#uploadAdapter === undefined) {
      const error = this.#uploadUnavailableError()
      this.#emitError(error)
      return Object.freeze({ error, snapshot: this.snapshot(), status: 'unavailable' as const })
    }
    try {
      const asset = normalizeUploadedAsset(await this.#uploadAdapter.upload({ file, kind: 'image' }))
      const inserted = this.insertImageUrl(asset.url, asset.name)
      if (inserted.status !== 'inserted') return inserted
      return Object.freeze({ asset, snapshot: inserted.snapshot, status: 'inserted' as const })
    } catch (failure) {
      const error = createPublicError('UPLOAD_UNAVAILABLE', failure instanceof Error ? failure.message : 'The host upload operation failed.', {
        actionHints: ['configure-upload', 'retry'],
        retryable: true,
      })
      this.#emitError(error)
      return Object.freeze({ error, snapshot: this.snapshot(), status: 'failed' as const })
    }
  }

  setDocument(document: WDocumentInput, options: WReplaceDocumentOptions = {}): Promise<WReplaceDocumentResult> {
    return this.replaceDocument(document, options)
  }

  async replaceDocument(input: WDocumentInput, options: WReplaceDocumentOptions = {}): Promise<WReplaceDocumentResult> {
    this.#assertActive()
    const replacement = normalizeDocument(input)
    await this.#flushQuiescent()
    if (this.#dirty) {
      const confirmation: WReplaceConfirmation = Object.freeze({
        actions: Object.freeze(['save', 'export', 'cancel']) as WReplaceConfirmation['actions'],
        current: this.snapshot(),
        replacement,
      })
      if (options.confirm === undefined) {
        return Object.freeze({ actions: confirmation.actions, snapshot: this.snapshot(), status: 'blocked' as const })
      }
      if (!await options.confirm(confirmation)) {
        return Object.freeze({ snapshot: this.snapshot(), status: 'cancelled' as const })
      }
    }
    this.#replaceDocument(replacement)
    return Object.freeze({ snapshot: this.snapshot(), status: 'replaced' as const })
  }

  destroy(options: WDestroyOptions = {}): Promise<WDestroyResult> {
    if (this.#destroyPromise !== null) return this.#destroyPromise
    if (this.#destroyed) return Promise.resolve(Object.freeze({ status: 'destroyed' as const }))
    const tracked = this.#attemptDestroy(options).then((result) => {
      if (result.status === 'blocked') this.#destroyPromise = null
      return result
    })
    this.#destroyPromise = tracked
    return this.#destroyPromise
  }

  async #attemptDestroy(options: WDestroyOptions): Promise<WDestroyResult> {
    try {
      await this.#flushQuiescent()
      if (this.#autosave !== null && this.#autosave.snapshot().pending) await this.#autosave.flush()
      if (this.#dirty) {
        const confirmation = Object.freeze({
          actions: Object.freeze(['save', 'export', 'cancel']) as readonly ['save', 'export', 'cancel'],
          current: this.snapshot(),
        })
        if (options.confirm === undefined || !await options.confirm(confirmation)) {
          const error = createPublicError('DESTROY_BLOCKED', 'Unsaved Markdown must be handled before destroy.', {
            actionHints: ['save', 'export', 'cancel'],
            retryable: true,
          })
          this.#emitError(error)
          return Object.freeze({ error, status: 'blocked' as const })
        }
      }
    } catch (failure) {
      const error = createPublicError('DESTROY_BLOCKED', failure instanceof Error ? failure.message : 'Destroy is blocked while pending work is unresolved.', {
        actionHints: ['save', 'export', 'cancel'],
        retryable: true,
      })
      this.#emitError(error)
      return Object.freeze({ error, status: 'blocked' as const })
    }
    this.#destroyed = true
    this.#saveState = 'destroyed'
    this.#autosave?.cancel()
    this.#unsubscribeSession?.()
    this.#unsubscribeSession = null
    this.#visualSynchronization?.cancel()
    this.#visualSynchronization = null
    this.#visualAdapter?.destroy()
    this.#visualAdapter = null
    this.#domService.destroy()
    this.#settings.destroy()
    this.#root.remove()
    return Object.freeze({ status: 'destroyed' as const })
  }

  #handleSessionChange(change: DocumentChange): void {
    const { acknowledgement, current } = change
    this.#document = Object.freeze({
      ...this.#document,
      documentId: current.documentId,
      markdown: current.markdown,
      revision: current.revision,
    })
    this.#syncSurfaceValues()
    if (this.#destroyed) return
    this.#historyDepth += 1
    this.#dirty = true
    this.#setSaveState(this.#autosave === null ? 'dirty' : 'autosave-pending')
    this.#emitChange(this.#pendingPublicOrigin ?? this.#publicOrigin(acknowledgement.origin))
    this.#pendingSynchronization = this.#pendingSynchronization.then(() => new Promise<void>((resolve) => queueMicrotask(resolve)))
    this.#requestAutosave()
  }

  #publicOrigin(origin: MutationOrigin): WChangeOrigin {
    if (origin === 'cherry-source') return 'source-edit'
    if (origin === 'tiptap-visual' || origin === 'toolbar-command' || origin === 'search-replace') return 'visual-edit'
    return 'host-replace'
  }

  #mountVisualRuntime(): void {
    this.#visual.replaceChildren()
    const visualState = this.#visualState
    const synchronization = new VisualSynchronizationService({
      onAcknowledgement: ({ snapshot }) => {
        const projection = projectOrdinaryMarkdown(snapshot)
        this.#visualAdapter?.acknowledgeSynchronization({ map: projection.map, snapshot })
      },
      session: this.#session,
      state: visualState,
    })
    const patchPlanner = new TiptapTransactionPatchPlanner({
      createTransactionId: () => `visual:${this.#session.snapshot().documentId}:${this.#session.snapshot().revision + 1}`,
      serialize: serializeOrdinaryTiptapPatch,
    })
    const adapter = new TiptapVisualAdapter({
      host: this.#visual,
      localization: this.#localization,
      onCompositionEnd: this.#handleVisualCompositionEnd,
      onCompositionStart: this.#handleCompositionStart,
      onReadOnlyTaskToggle: ({ checked, index }) => this.#togglePreviewTask(index, checked),
      onSemanticCopy: this.#handleVisualSemanticCopy,
      onTransaction: ({ patchPlan }) => {
        if (patchPlan !== null) synchronization.request(patchPlan)
      },
      onTransactionFailure: ({ failure }) => {
        synchronization.rejectTransaction({
          failure,
          operationId: `visual-rejected:${this.#session.snapshot().documentId}:${this.#session.snapshot().revision + 1}`,
          recover: () => adapter.rebuildFromAuthority(),
        })
      },
      patchPlanner,
      project: projectOrdinaryMarkdown,
      session: this.#session,
    })
    this.#visualSynchronization = synchronization
    this.#visualAdapter = adapter
    adapter.setPresentationMode(this.#mode === 'preview')
    this.#visual.setAttribute('aria-label', 'Visual Markdown editor')
  }

  #handleVisualSemanticCopy = (event: SemanticNodeCopyEvent): void => {
    const ownerWindow = this.#root.ownerDocument.defaultView
    const clipboard = ownerWindow?.navigator.clipboard
    if (clipboard === undefined) {
      this.#emitError(createPublicError('SAVE_FAILED', 'The owning document does not provide a clipboard.', {
        actionHints: ['retry'],
        retryable: true,
      }))
      return
    }
    try {
      void clipboard.writeText(event.code).catch((failure: unknown) => {
        this.#emitError(createPublicError('SAVE_FAILED', failure instanceof Error ? failure.message : 'Clipboard write failed.', {
          actionHints: ['retry'],
          retryable: true,
        }))
      })
    } catch (failure) {
      this.#emitError(createPublicError('SAVE_FAILED', failure instanceof Error ? failure.message : 'Clipboard write failed.', {
        actionHints: ['retry'],
        retryable: true,
      }))
    }
  }

  #handleCompositionStart = (): void => {
    this.#composing = true
    this.#compositionMarkdown = null
    this.#autosave?.pause()
  }

  #handleCompositionEnd = (event: Event): void => {
    this.#finishComposition(event)
  }

  #handleVisualCompositionEnd = (): void => {
    this.#finishComposition()
  }

  #finishComposition(event?: Event): void {
    if (!this.#composing) return
    const pending = this.#compositionMarkdown
    if (pending === null) {
      const target = event?.currentTarget
      const markdown = isOwnedTextArea(target, this.#root.ownerDocument)
        ? target.value
        : isOwnedElement(target, this.#root.ownerDocument)
          ? target.textContent ?? ''
          : null
      if (markdown !== null) this.#compositionMarkdown = { markdown, origin: isOwnedTextArea(target, this.#root.ownerDocument) ? 'source-edit' : 'visual-edit' }
    }
    this.#composing = false
    const completed = this.#compositionMarkdown
    this.#compositionMarkdown = null
    if (completed !== null) this.#commitInput(completed.markdown, completed.origin)
    this.#autosave?.resume()
    for (const resolve of this.#compositionWaiters) resolve()
    this.#compositionWaiters.clear()
  }

  #handleSourceInput = (event: Event): void => {
    if (this.#destroyed) return
    const target = event.currentTarget
    if (!isOwnedTextArea(target, this.#root.ownerDocument)) return
    if (this.#composing) {
      this.#compositionMarkdown = { markdown: target.value, origin: 'source-edit' }
      return
    }
    this.#commitInput(target.value, 'source-edit')
  }

  #commitInput(markdown: string, origin: Extract<WChangeOrigin, 'source-edit' | 'visual-edit' | 'insert-image-url'>): void {
    if (markdown === this.#document.markdown) return
    const transactionId = `${this.instanceId}:${this.#document.revision + 1}`
    this.#pendingPublicOrigin = origin
    try {
      if (origin === 'source-edit') {
        this.#session.commitSource({
          markdown,
          origin: 'cherry-source',
          transactionId,
        })
      } else {
        const current = this.#session.snapshot()
        this.#session.commitPatchPlan({
          baseRevision: current.revision,
          patches: Object.freeze([Object.freeze({
            codecId: 'web-editor-visual',
            expected: current.markdown,
            from: 0,
            replacement: markdown,
            to: current.markdown.length,
          })]),
          transactionId,
        }, origin === 'visual-edit' ? 'tiptap-visual' : 'toolbar-command')
      }
    } finally {
      this.#pendingPublicOrigin = null
    }
    this.#pendingSynchronization = this.#pendingSynchronization.then(() => new Promise<void>((resolve) => queueMicrotask(resolve)))
  }

  #requestAutosave(): void {
    if (this.#autosave === null || this.#destroyed) return
    this.#lastAutosaveSnapshot = this.#document
    this.#autosave.request(this.#document)
    this.#setSaveState('autosave-pending')
  }

  async #initializeRecovery(onReady: () => void): Promise<void> {
    if (this.#userId === null) {
      onReady()
      return
    }
    const key = this.#recoveryKey()
    const [draftResult, workspaceResult] = await Promise.allSettled([
      this.#draftAdapter === undefined ? Promise.resolve(null) : Promise.resolve().then(() => this.#draftAdapter?.load(key) ?? null),
      this.#workspaceAdapter === undefined ? Promise.resolve(null) : Promise.resolve().then(() => this.#workspaceAdapter?.load(key) ?? null),
    ])
    const failures: unknown[] = []
    let loadedDraft: WRecoveryDraft | null = null
    let loadedWorkspace: WWorkspaceExchange | null = null
    if (draftResult.status === 'fulfilled') {
      try {
        loadedDraft = this.#normalizeRecoveryDraft(draftResult.value, key)
      } catch (failure) {
        failures.push(failure)
      }
    } else {
      failures.push(draftResult.reason)
    }
    if (workspaceResult.status === 'fulfilled') {
      try {
        loadedWorkspace = this.#normalizeWorkspaceExchange(workspaceResult.value, key)
      } catch (failure) {
        failures.push(failure)
      }
    } else {
      failures.push(workspaceResult.reason)
    }
    this.#recoveryWorkspace = loadedWorkspace
    if (loadedWorkspace !== null) this.#applyWorkspaceState(loadedWorkspace)
    const candidates = [loadedDraft, loadedWorkspace?.draft ?? null]
      .filter((candidate): candidate is WRecoveryDraft => candidate !== null)
      .sort((left, right) => right.localRevision - left.localRevision || right.updatedAt.localeCompare(left.updatedAt))
    this.#recoveryDraft = candidates.find((candidate) => this.#isNewerRecoveryDraft(candidate)) ?? null
    if (failures.length > 0) {
      this.#recordRecoveryFailure(new Error(`Recovery adapter load failed: ${failures.map((failure) => failure instanceof Error ? failure.message : String(failure)).join('; ')}`))
    } else {
      this.#recoveryError = null
      this.#recoveryStatus = this.#recoveryDraft === null ? 'none' : 'available'
    }
    onReady()
  }

  #recoveryKey(): WRecoveryDraftKey {
    if (this.#userId === null) throw new WEditorContractError(createPublicError('INVALID_MOUNT', 'Recovery adapters require a non-empty userId.'))
    return Object.freeze({ documentId: this.#document.documentId, userId: this.#userId })
  }

  #normalizeRecoveryDraft(value: WRecoveryDraft | null, key: WRecoveryDraftKey): WRecoveryDraft | null {
    if (value === null) return null
    const draft = createRecoveryDraft(value as RecoveryDraftInput)
    if (draft.documentId !== key.documentId || draft.userId !== key.userId) {
      throw new TypeError('Recovery draft identity does not match the requested user and document.')
    }
    return draft
  }

  #normalizeWorkspaceExchange(value: WWorkspaceExchange | null, key: WRecoveryDraftKey): WWorkspaceExchange | null {
    if (value === null) return null
    const exchange = createWorkspaceExchange(value as WorkspaceExchangeInput)
    if (exchange.documentId !== key.documentId || exchange.userId !== key.userId) {
      throw new TypeError('Workspace exchange identity does not match the requested user and document.')
    }
    return exchange
  }

  #isNewerRecoveryDraft(draft: WRecoveryDraft): boolean {
    return draft.markdown !== this.#document.markdown
      || draft.localRevision > this.#document.revision
      || draft.baseServerRevision !== (this.#document.serverRevision ?? null)
  }

  #currentWorkspaceState(): WWorkspaceState {
    const scrollHost = this.#mode === 'source' ? this.#source : this.#mode === 'visual' ? this.#visual : this.#preview
    return createWorkspaceState({
      mode: this.#mode,
      scroll: { left: scrollHost.scrollLeft, top: scrollHost.scrollTop },
      selection: { anchor: this.#source.selectionStart, head: this.#source.selectionEnd },
      sidebar: this.#workspaceSidebar,
      sourceAnchor: this.#workspaceSourceAnchor,
    })
  }

  #applyWorkspaceState(state: WWorkspaceState): void {
    this.#mode = state.mode
    this.#workspaceSidebar = state.sidebar
    this.#workspaceSourceAnchor = state.sourceAnchor
    this.#setSurfaceVisibility()
    const maximum = this.#source.value.length
    const anchor = Math.min(state.selection?.anchor ?? 0, maximum)
    const head = Math.min(state.selection?.head ?? anchor, maximum)
    this.#source.setSelectionRange(anchor, head)
    this.#source.scrollLeft = state.scroll.left
    this.#source.scrollTop = state.scroll.top
    const scrollHost = this.#mode === 'source' ? this.#source : this.#mode === 'visual' ? this.#visual : this.#preview
    scrollHost.scrollLeft = state.scroll.left
    scrollHost.scrollTop = state.scroll.top
  }

  #createWorkspaceExchange(draft: WRecoveryDraft | null): WWorkspaceExchange {
    const userId = this.#userId
    if (userId === null) throw new WEditorContractError(createPublicError('INVALID_MOUNT', 'Recovery adapters require a non-empty userId.'))
    return createWorkspaceExchange({
      ...this.#currentWorkspaceState(),
      documentId: this.#document.documentId,
      draft,
      userId,
    })
  }

  async #persistRecoveryDraft(snapshot: WDocumentSnapshot): Promise<void> {
    if (this.#userId === null) return
    const draft = createRecoveryDraft({
      ...this.#currentWorkspaceState(),
      baseServerRevision: snapshot.serverRevision ?? null,
      documentId: snapshot.documentId,
      localRevision: snapshot.revision,
      markdown: snapshot.markdown,
      updatedAt: new Date().toISOString(),
      userId: this.#userId,
    })
    if (this.#draftAdapter !== undefined) await this.#draftAdapter.save(draft)
    if (this.#workspaceAdapter !== undefined) {
      const exchange = this.#createWorkspaceExchange(draft)
      await this.#workspaceAdapter.save(exchange)
      this.#recoveryWorkspace = exchange
    }
    this.#recoveryDraft = draft
    this.#recoveryError = null
    this.#recoveryStatus = 'available'
  }

  async #clearRecoveryDraft(): Promise<void> {
    if (this.#userId === null) return
    const key = this.#recoveryKey()
    if (this.#draftAdapter !== undefined) await this.#draftAdapter.clear(key)
    if (this.#workspaceAdapter !== undefined && this.#recoveryWorkspace?.draft !== null) {
      const exchange = this.#createWorkspaceExchange(null)
      await this.#workspaceAdapter.save(exchange)
      this.#recoveryWorkspace = exchange
    }
    this.#recoveryDraft = null
    this.#recoveryError = null
    this.#recoveryStatus = 'none'
  }

  #recordRecoveryFailure(failure: unknown): WEditorError {
    const error = saveFailure(failure)
    this.#recoveryError = error
    this.#recoveryStatus = 'failed'
    this.#emitError(error)
    return error
  }

  async #performAutosave(snapshot: WDocumentSnapshot): Promise<void> {
    this.#lastAutosaveSnapshot = snapshot
    const result = await this.#performSave({
      kind: 'autosave-draft',
      origin: 'autosave',
      overwrite: false,
    }, snapshot)
    this.#lastAutosaveResult = result
    if (result.status !== 'saved') throw result.error
    try {
      await this.#persistRecoveryDraft(snapshot)
    } catch (failure) {
      const error = this.#recordRecoveryFailure(failure)
      const failed = Object.freeze({ error, snapshot: this.snapshot(), status: 'failed' as const })
      this.#lastAutosaveResult = failed
      this.#setSaveState('autosave-failed')
      throw error
    }
  }

  async #flushAll(): Promise<void> {
    await this.#flushQuiescent()
    await this.#autosave?.flush()
  }

  async #flushAutosaveForRetry(): Promise<WSaveResult> {
    try {
      await this.#autosave?.flush()
    } catch {
      // The normalized result remains available to the host and state remains failed.
    }
    return this.#lastAutosaveResult ?? Object.freeze({
      error: createPublicError('SAVE_FAILED', 'Automatic recovery save failed.'),
      snapshot: this.snapshot(),
      status: 'failed' as const,
    })
  }

  async #performSave(input: Readonly<{
    readonly kind: WSaveKind
    readonly metadata?: Readonly<Record<string, unknown>>
    readonly origin: WSaveOrigin
    readonly overwrite: boolean
  }>, requestedSnapshot: WDocumentSnapshot = this.#document): Promise<WSaveResult> {
    await this.#flushQuiescent()
    if (this.#saveAdapter === undefined) {
      const error = createPublicError('SAVE_FAILED', 'No SaveAdapter has been configured for this editor.')
      this.#setSaveState(input.kind === 'autosave-draft' ? 'autosave-failed' : 'save-failed')
      this.#emitError(error)
      return Object.freeze({ error, snapshot: this.snapshot(), status: 'failed' as const })
    }
    const request: WSaveRequest = createSaveRequest({
      ...(requestedSnapshot.serverRevision === undefined ? {} : { baseServerRevision: requestedSnapshot.serverRevision }),
      documentId: requestedSnapshot.documentId,
      localRevision: requestedSnapshot.revision,
      markdown: requestedSnapshot.markdown,
      origin: input.origin,
      overwrite: input.overwrite,
      saveKind: input.kind,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    })
    const requestRevision = request.localRevision
    const requestMarkdown = request.markdown
    this.#setSaveState('saving')
    try {
      const response = normalizeSaveResponse(await this.#saveAdapter.save(request), input.kind)
      const sameDocument = this.#document.documentId === request.documentId
      if (sameDocument && input.kind !== 'autosave-draft') {
        this.#document = Object.freeze({ ...this.#document, serverRevision: response.serverRevision })
      }
      const isCurrent = sameDocument && this.#document.revision === requestRevision && this.#document.markdown === requestMarkdown
      if (input.kind !== 'autosave-draft' && isCurrent) {
        try {
          await this.#clearRecoveryDraft()
        } catch (failure) {
          const error = this.#recordRecoveryFailure(failure)
          this.#setSaveState('save-failed')
          return Object.freeze({ error, snapshot: this.snapshot(), status: 'failed' as const })
        }
        this.#dirty = false
      }
      this.#setSaveState(input.kind === 'autosave-draft' ? 'dirty' : (isCurrent ? 'saved' : 'dirty'))
      return Object.freeze({ response, snapshot: this.snapshot(), status: 'saved' as const })
    } catch (failure) {
      const error = saveFailure(failure)
      this.#setSaveState(error.code === 'REVISION_CONFLICT'
        ? 'conflict'
        : input.kind === 'autosave-draft'
          ? 'autosave-failed'
          : 'save-failed')
      this.#emitError(error)
      if (error.code === 'REVISION_CONFLICT') {
        const conflict = createPublicError('REVISION_CONFLICT', error.message, {
          actionHints: error.actionHints,
          retryable: error.retryable,
        })
        return Object.freeze({ error: conflict, snapshot: this.snapshot(), status: 'conflict' as const })
      }
      return Object.freeze({ error, snapshot: this.snapshot(), status: 'failed' as const })
    }
  }

  async #flushQuiescent(): Promise<void> {
    while (this.#composing) {
      await new Promise<void>((resolve) => this.#compositionWaiters.add(resolve))
    }
    await this.#pendingSynchronization
    await this.#visualSynchronization?.flush()
  }

  #replaceDocument(document: WDocumentSnapshot): void {
    this.#autosave?.cancel()
    this.#lastAutosaveSnapshot = null
    this.#lastAutosaveResult = null
    this.#visualSynchronization?.cancel()
    this.#visualSynchronization = null
    this.#visualAdapter?.destroy()
    this.#visualAdapter = null
    this.#visual.replaceChildren()
    this.#unsubscribeSession?.()
    this.#session = new DocumentSession(document)
    this.#visualState = new SynchronizationStateStore(this.#session.snapshot())
    this.#document = document
    this.#historyDepth = 0
    this.#dirty = false
    this.#setSaveState('clean')
    this.#unsubscribeSession = this.#session.subscribe((change) => this.#handleSessionChange(change))
    this.#syncSurfaceValues()
    this.#mountVisualRuntime()
    this.#emitChange('host-replace')
  }

  #syncSurfaceValues(): void {
    this.#source.value = this.#document.markdown
    if (this.#visualAdapter === null) this.#visual.textContent = this.#document.markdown
    this.#renderPreviewExtensions()
  }

  #setSurfaceVisibility(): void {
    const surfaces = this.#root.querySelectorAll<HTMLElement>('[data-w-editor-surface]')
    for (const surface of surfaces) {
      const kind = surface.dataset['wEditorSurface']
      surface.hidden = this.#mode === 'preview'
        ? kind !== 'visual' && kind !== 'preview'
        : kind !== this.#mode
    }
    this.#visualAdapter?.setPresentationMode(this.#mode === 'preview')
    if (this.#mode === 'preview') this.#visual.dataset['wEditorPreview'] = 'true'
    else delete this.#visual.dataset['wEditorPreview']
    this.#renderPreviewExtensions()
  }

  #renderPreviewExtensions(): void {
    const html = this.#mode === 'preview'
      ? sanitizeRendererExtensions(
          this.#rendererExtensions,
          this.#document,
          'author-preview',
          this.#resourceOptions,
          this.#root.ownerDocument,
        )
      : ''
    const template = this.#previewExtensions.ownerDocument.createElement('template')
    template.innerHTML = html
    this.#previewExtensions.replaceChildren(template.content.cloneNode(true))
    const surface = this.#previewExtensions.parentElement
    if (surface !== null) surface.hidden = this.#mode !== 'preview' || html.length === 0
  }

  #togglePreviewTask(index: number, checked: boolean): boolean {
    if (this.#mode !== 'preview') return false
    try {
      const snapshot = this.#session.snapshot()
      const plan = createTaskItemCheckedPlan(
        snapshot,
        index,
        checked,
        `web-author-preview-task:${this.instanceId}:${snapshot.revision + 1}`,
      )
      if (plan === null) return true
      this.#session.commitPatchPlan(plan, 'toolbar-command')
      this.#visualState.succeed(this.#session.snapshot())
      return true
    } catch (failure) {
      this.#emitError(createPublicError(
        'SAVE_FAILED',
        failure instanceof Error ? failure.message : 'The author-preview task could not be updated.',
        { actionHints: ['retry'], retryable: true },
      ))
      return false
    }
  }

  #setSaveState(state: WSaveState): void {
    if (this.#saveState === state) return
    this.#saveState = state
    const event = Object.freeze({
      apiVersion: WEB_API_VERSION,
      instanceId: this.instanceId,
      snapshot: this.snapshot(),
      state,
      type: 'save-state-change',
    }) satisfies WEditorSaveStateChangeEvent
    this.#options.onSaveStateChange?.(event)
  }

  #emitChange(origin: WChangeOrigin): void {
    const event = Object.freeze({
      apiVersion: WEB_API_VERSION,
      instanceId: this.instanceId,
      origin,
      snapshot: this.snapshot(),
      type: 'change',
    }) satisfies WEditorChangeEvent
    this.#options.onChange?.(event)
  }

  #emitError(error: WEditorError): void {
    const event = Object.freeze({
      apiVersion: WEB_API_VERSION,
      error,
      instanceId: this.instanceId,
      snapshot: this.snapshot(),
      type: 'error',
    }) satisfies WEditorErrorEvent
    this.#options.onError?.(event)
  }

  #uploadUnavailableError(): WEditorError<'UPLOAD_UNAVAILABLE'> {
    return createPublicError('UPLOAD_UNAVAILABLE', 'The host has not configured a real UploadAdapter.', {
      actionHints: ['configure-upload'],
      retryable: false,
    })
  }

  #assertActive(): void {
    if (this.#destroyed) throw new WEditorContractError(createPublicError('DESTROYED', 'This W-Editor instance has been destroyed.'))
  }
}

export function mountWEditor(container: HTMLElement, options: WEditorMountOptions): WEditorInstance {
  if (!isHtmlElement(container)) {
    throw contractError('INVALID_MOUNT', 'mountWEditor requires an HTMLElement container.')
  }
  if (typeof options !== 'object' || options === null) {
    throw contractError('INVALID_MOUNT', 'mountWEditor requires mount options.')
  }
  assertCompatibleMount(options)
  let instance: WEditorController | null = null
  try {
    instance = new WEditorController(container, options)
    instance.initializeSettings(() => instance?.emitReady())
    return instance
  } catch (failure) {
    void instance?.destroy()
    if (failure instanceof WEditorContractError) throw failure
    throw contractError('INVALID_MOUNT', failure instanceof Error ? failure.message : 'The editor could not be mounted.')
  }
}
