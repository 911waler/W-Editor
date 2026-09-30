<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Component, type CSSProperties } from 'vue'
import ReferencePanel from './ReferencePanel.vue'
import { referenceRegistry, scanReferences, referenceMarkdown, updateReferencePlan, removeReferencePlan, type ReferenceStyle, type DocumentReference } from '@w-editor/editor-core'
import { createLocalReferenceServices, type ReferenceEditorServices, type ReferenceNote, publishReferenceSnapshot } from '@w-editor/editor-vue/services'
import MarkdownImportZone from './MarkdownImportZone.vue'
import { loadCapabilityProbe } from './testing/capabilityLoader'

import { createRandomId, numberOutline, activeOutlineIndex } from '@w-editor/editor-vue/services'
import { BrowserLocalUploadAdapter, CherryRenderAdapter, DrawioAdapter, hydrateCherryChartPreviews, isCherrySourceHistoryShortcutEvent, prepareTiptapVisualProjection, type DrawioAdapterPort, type DrawioSavePayload, type SemanticNodeCopyEvent, type TiptapVisualProjector, type UploadAdapter, type VisualRawNodeSelection, type VisualSearchMatch, type VisualSemanticBlockSelection } from '@w-editor/editor-vue/adapters'
import type { CommitAcknowledgement, PatchPlan } from '@w-editor/editor-core'
import { LOCAL_DRAWIO_EDITOR_PATH } from './integrations/drawioBridge'
import {
  INLINE_MARK_SPECS,
  FENCED_CODE_STARTER,
  columnLayoutStarterSource,
  chartTableDescriptor,
  chartTableSource,
  chartTableStarterSource,
  disclosureStarterSource,
  createMarkdownOutline,
  createTaskItemCheckedPlan,
  fencedCodeAtSelection,
  mermaidDescriptor,
  mermaidSource,
  mermaidStarterSource,
  mediaSource,
  attachmentSource,
  drawioSource,
  formulaAtSelection,
  panelDescriptor,
  panelStarterSource,
  projectOrdinaryMarkdown,
  parseFencedCodeAt,
  parseChartTableAt,
  timelineStarterSource,
  taskItemMarkers,
  validateColumnLayoutSource,
  validateDisclosureSource,
  validatePanelSource,
  validateTimelineSource,
  inlineMarkSpec,
  richInlineMarkAtSelection,
  richInlineMarkSpec,
  serializeFencedCode,
  type AlignmentCommandId,
  type ChartTableDraft,
  type ChartTableOptionValue,
  type ChartTableType,
  type ColumnLayoutCommandId,
  type ColumnLayoutKind,
  type DisclosureCommandId,
  type FormulaMode,
  type InlineMarkCommandId,
  type MermaidDiagramType,
  type MediaKind,
  type MarkdownOutlineItem,
  type AttachmentKind,
  type PanelCommandId,
  type PanelVariant,
  type RichInlineMarkCommandId,
} from '@w-editor/editor-core'
import { installAuthorityInspection } from './testing/e2eAuthority'
import {
  APPEARANCE_THEME_IDS,
  ArticleCatalogAdapter,
  ArticleSwitchFlushGuard,
  ArticleSwitchCoordinator,
  AutosaveCoordinator,
  BrowserFileExporter,
  BrowserRenderedExportAdapter,
  CommandRegistry,
  CompositionBarrier,
  DestructiveReplacementCoordinator,
  FullscreenController,
  InvalidReplacementInputError,
  LocalDocumentRepository,
  LocalCheckpointRepository,
  ManualCheckpointService,
  DEFAULT_SHORTCUT_BINDINGS,
  ShortcutDispatcher,
  TOOLBAR_MENU_DESCRIPTORS,
  WorkspaceModeAdapters,
  createApplicationCompositionRoot,
  createLayeredSettingsStore,
  createHtmlDerivedExportArtifacts,
  createTiptapRenderedExportDocument,
  createMarkdownExport,
  createUiLocalizationStore,
  materializeRenderedExportDocument,
  calculateDocumentStatistics,
  findShortcutConflict,
  createAlignmentCommandPlan,
  createColumnLayoutCommandPlan,
  createChartTableCommandPlan,
  createCodeBlockCommandPlan,
  createHeadingCommandPlan,
  createBlockInsertionPlan,
  createTocInsertionDecision,
  createDisclosureCommandPlan,
  createTimelineCommandPlan,
  createTableInsertionPlan,
  createHardBreakPlan,
  createFormulaCommandPlan,
  createInlineCodePlan,
  createLinkPlan,
  createListCommandPlan,
  createMermaidCommandPlan,
  createMediaCommandPlan,
  createAttachmentCommandPlan,
  createDrawioCommandPlan,
  createPanelCommandPlan,
  createInlineMarkTogglePlan,
  createRichInlineMarkPlan,
  createToolbarCommandDescriptors,
  headingLevel,
  formulaSource,
  isReservedShortcut,
  listCommandKind,
  migrateLegacyHeadingShortcuts,
  physicalShortcutFromKeyboardEvent,
  LINE_SPACING_OPTIONS,
  isAppearanceTheme,
  isLineSpacingId,
  lineSpacingOption,
  PlaygroundCompatibilityAdapter,
  PLAYGROUND_SETTINGS_KEYS,
  shortcutDisplayLabel,
  shortcutKeycaps,
  sourceHeadingLevel,
  sourceAlignmentAt,
  sourceAlignmentCompatible,
  columnLayoutAtSelection,
  disclosureAtSelection,
  panelAtSelection,
  timelineAtSelection,
  mediaAtSelection,
  attachmentAtSelection,
  drawioAtSelection,
  sourceListCommandAt,
  translateUi,
  type AppearanceTheme,
  type LineSpacingId,
  type ApplicationCompositionRoot,
  type ArticleDefinition,
  type CommandContext,
  type CommandDescriptor,
  type CommandExecutionResult,
  type CommandQuery,
  type DocumentEnvelopeV1,
  type DocumentStatistics,
  type DestructiveReplacementKind,
  type EditorMode,
  type ExportArtifact,
  type HeadingCommandId,
  type ListCommandId,
  type PreviewRenderer,
  type RenderedExportAdapter,
  type ToolbarMenuDescriptor,
  type ToolbarMenuId,
  type UiLocale,
  type UiMessageKey,
  type UiMessageParams,
  type WorkspaceEnvelopeV1,
  type WorkspaceState,
  type WorkspaceSurface,
} from './services'
import {
  ChartTableEditorHost,
  CodeMirrorSourceEditorHost,
  DetachedDraftEditorHost,
  DrawioDialog,
  FormulaPicker,
  MediaEditorHost,
  SourceEditorSurface,
  TiptapReaderPresentation,
  VisualEditorSurface,
  type AssetDraft,
} from '@w-editor/editor-vue'

const props = defineProps<{
  /** Host lifecycle policy; standalone keeps recovery-draft and export choices. */
  readonly articleSwitchPolicy?: 'draft-export' | 'save-discard'
  readonly articleModes?: Readonly<Record<string, EditorMode>>
  readonly articleGroupLabels?: readonly string[]
  readonly articleGroupOverrides?: Readonly<Record<string, string>>
  readonly articleTitles?: Readonly<Record<string, string>>
  readonly readonlyMode?: boolean
  readonly toolbarImport?: boolean
  readonly loadArticle?: (documentId: string) => Promise<ArticleDefinition>
  readonly persistDrawio?: (payload: DrawioSavePayload) => Promise<Readonly<{png: string; xml: string}>>
  readonly articleCatalog?: readonly ArticleDefinition[]
  readonly createArticle?: (input: Readonly<{ title: string }>) => ArticleDefinition | Promise<ArticleDefinition>
  readonly drawioAdapter?: DrawioAdapterPort
  readonly exportArtifact?: (artifact: ExportArtifact) => void | Promise<void>
  readonly importArticle?: (input: Readonly<{ markdown: string; title: string }>) => ArticleDefinition | Promise<ArticleDefinition>
  readonly onArticleActivity?: (input: Readonly<{ documentId: string; kind: 'created' | 'imported'; title: string }>) => void
  readonly onLocaleChange?: (locale: UiLocale) => void
  readonly onReaderPreviewClose?: () => void
  readonly showReaderPreview?: boolean
  readonly onWorkspaceStateChange?: (input: Readonly<{
    readonly autosaveStatus: string
    readonly dirty: boolean
    readonly documentId: string
    readonly errorCode: string | null
    readonly synchronizationStatus: string
    readonly title: string
  }>) => void
  readonly savedMarkdown?: (documentId: string) => string | undefined
  readonly persistence?: Readonly<{
    readonly saveAutosave?: (input: Readonly<{ documentId: string; markdown: string; revision: number }>) => void | Promise<void>
    readonly savePublish?: (input: Readonly<{ documentId: string; markdown: string; revision: number }>) => void | Promise<void>
    readonly saveManual?: (input: Readonly<{ documentId: string; markdown: string; revision: number; title: string }>) => void | Promise<void>
    readonly saveWorkspace?: (input: Readonly<{ documentId: string; mode: string; sidebar: Readonly<Record<string, unknown>> }>) => void | Promise<void>
  }>
  readonly previewRenderer?: PreviewRenderer
  readonly renderedExportAdapter?: RenderedExportAdapter
  readonly referenceServices?: ReferenceEditorServices
  readonly storage?: Storage
  readonly uploadAdapter?: UploadAdapter
  readonly visualProjector?: TiptapVisualProjector
}>()
const LARGE_IMPORT_SOURCE_MODE_BYTES = 1024 * 1024
const catalog = new ArticleCatalogAdapter(props.articleCatalog)
const compatibility = new PlaygroundCompatibilityAdapter(props.storage)
const settings = createLayeredSettingsStore({
  persistence: compatibility,
  productDefaults: Object.freeze({
    [PLAYGROUND_SETTINGS_KEYS.appearanceTheme]: 'gray',
    [PLAYGROUND_SETTINGS_KEYS.lineSpacing]: 'standard',
    [PLAYGROUND_SETTINGS_KEYS.recentColors]: Object.freeze([]),
    [PLAYGROUND_SETTINGS_KEYS.shortcutBindings]: DEFAULT_SHORTCUT_BINDINGS,
  }),
  userOverrides: compatibility.getUserOverrides(),
})
const previewRenderer = props.previewRenderer ?? new CherryRenderAdapter()
const visualProjector = props.visualProjector ?? projectOrdinaryMarkdown
const uploadAdapter = props.uploadAdapter ?? new BrowserLocalUploadAdapter()
const configuredEditorUrl = new URL(
  import.meta.env.MODE === 'e2e'
    ? '/e2e/fixtures/drawio/fake-drawio.html'
    : `${import.meta.env.BASE_URL}${LOCAL_DRAWIO_EDITOR_PATH.replace(/^\//u, '')}`,
  window.location.href,
).href
const configuredBridgeUrl = new URL(`${import.meta.env.BASE_URL}drawio-bridge.html`, window.location.href)
configuredBridgeUrl.searchParams.set('editor', configuredEditorUrl)
const ownedDrawioAdapter = props.drawioAdapter === undefined ? new DrawioAdapter({
  allowedOrigin: window.location.origin,
  editorUrl: configuredBridgeUrl.href,
}) : null
const drawioAdapter = props.drawioAdapter ?? ownedDrawioAdapter as DrawioAdapter
const documentRepository = new LocalDocumentRepository(compatibility.storage)
const browserFileExporter = new BrowserFileExporter({
  document,
  objectUrls: {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  },
})
const renderedExportAdapter = props.renderedExportAdapter ?? new BrowserRenderedExportAdapter({
  document,
  hydrateRenderedContent: (root) => hydrateCherryChartPreviews(root, { showToolbox: false, showTooltip: false }),
  window,
})
const storedWorkspace = documentRepository.readWorkspace()
const restoredInitialDefinition = storedWorkspace.status === 'valid'
  ? catalog.lookup(storedWorkspace.value.activeDocumentId)
  : null
const initialDefinition = restoredInitialDefinition ?? catalog.initial()
type StartupRecovery = Readonly<{
  documentId: string | null
  key: string
  raw: string
  reason: 'corrupt' | 'unsupported-version'
  scope: 'document' | 'workspace'
}>
const startupRecovery = ref<StartupRecovery | null>(storedWorkspace.status === 'recovery-required'
  ? Object.freeze({
      documentId: null,
      key: storedWorkspace.key,
      raw: storedWorkspace.raw,
      reason: storedWorkspace.reason,
      scope: 'workspace',
    })
  : null)
const rawRecoveryExported = ref(false)
const recoveryResetConfirmation = ref(false)
const e2eAutosaveFailure = import.meta.env.MODE === 'e2e'
  ? new URLSearchParams(window.location.search).get('autosaveFailure')
  : null
let e2eAutosaveFailureInjected = false
type DedicatedEditorFailureStage = 'planning' | 'revision' | 'stale-selection' | 'transaction'
const e2eDedicatedEditorFailure = import.meta.env.MODE === 'e2e'
  ? new URLSearchParams(window.location.search).get('dedicatedEditorFailure')
  : null
let e2eDedicatedEditorFailurePending = e2eDedicatedEditorFailure !== null

function injectDedicatedEditorFailure(stage: DedicatedEditorFailureStage): void {
  if (!e2eDedicatedEditorFailurePending || e2eDedicatedEditorFailure !== `${stage}-once`) return
  e2eDedicatedEditorFailurePending = false
  const messages: Readonly<Record<DedicatedEditorFailureStage, UiMessageKey>> = Object.freeze({
    planning: 'feedback.dedicated.planning',
    revision: 'feedback.dedicated.revision',
    'stale-selection': 'feedback.dedicated.staleSelection',
    transaction: 'feedback.dedicated.transaction',
  })
  throw Object.assign(uiError(messages[stage]), { code: `E2E_DEDICATED_${stage.toUpperCase().replace('-', '_')}` })
}

function initialDocumentEnvelope(definition: ArticleDefinition): DocumentEnvelopeV1 {
  return Object.freeze({
    autosave: Object.freeze({
      markdown: definition.initialMarkdown,
      revision: 0,
      savedAt: new Date().toISOString(),
    }),
    documentId: definition.documentId,
    manualCheckpoint: null,
    preDestructiveReplace: null,
    preModeSwitch: null,
    schemaVersion: 1,
    status: Object.freeze({ lastPersistenceFailure: null }),
  })
}

function initialWorkspaceEnvelope(): WorkspaceEnvelopeV1 {
  return Object.freeze({
    activeDocumentId: catalog.initial().documentId,
    articlePanel: Object.freeze({ collapsed: false, width: 252 }),
    catalogDocumentIds: Object.freeze(catalog.list().map((article) => article.documentId)),
    schemaVersion: 1,
  })
}

interface PreviewTaskHistoryEntry {
  readonly after: boolean
  readonly before: boolean
  readonly index: number
}

interface ArticleRuntime {
  readonly definition: ArticleDefinition
  readonly autosave: AutosaveCoordinator
  readonly checkpoints: LocalCheckpointRepository
  readonly composition: CompositionBarrier
  readonly manualCheckpoint: ManualCheckpointService
  readonly modeSurfaces: WorkspaceModeAdapters
  readonly previewTaskHistory: {
    readonly redo: PreviewTaskHistoryEntry[]
    readonly undo: PreviewTaskHistoryEntry[]
  }
  readonly root: ApplicationCompositionRoot
  readonly flushVisualSynchronization: () => Promise<void>
  readonly recoverVisualSynchronization: () => Promise<void>
  readonly registerVisualFlush: (flush: (() => Promise<void>) | null) => void
  readonly registerVisualRecovery: (recover: (() => Promise<void>) | null) => void
  readonly registerVisualRetry: (retry: (() => Promise<void>) | null) => void
  readonly retryVisualSynchronization: () => Promise<void>
  unsubscribe: readonly (() => void)[]
  lastUpdated: string | null
  state: WorkspaceState
  surface: WorkspaceSurface
}

const runtimes = new Map<string, ArticleRuntime>()
const articleTimestampVersion = ref(0)
let publishRuntime: (runtime: ArticleRuntime) => void = () => undefined

function createArticleRuntime(definition: ArticleDefinition): ArticleRuntime {
  const stored = documentRepository.readDocument(definition.documentId)
  if (stored.status === 'recovery-required' && startupRecovery.value === null) {
    startupRecovery.value = Object.freeze({
      documentId: definition.documentId,
      key: stored.key,
      raw: stored.raw,
      reason: stored.reason,
      scope: 'document',
    })
    rawRecoveryExported.value = false
    recoveryResetConfirmation.value = false
  }
  const initialDocument = stored.status === 'valid'
    ? Object.freeze({
        documentId: definition.documentId,
        markdown: stored.value.autosave.markdown,
        revision: stored.value.autosave.revision,
      })
    : Object.freeze({
        documentId: definition.documentId,
        markdown: definition.initialMarkdown,
        revision: 0,
      })
  const initialMode = props.articleModes?.[definition.documentId] ?? 'visual'
  const modeSurfaces = new WorkspaceModeAdapters(
    initialDocument,
    previewRenderer,
    initialMode,
    (snapshot) => { prepareTiptapVisualProjection(snapshot, visualProjector) },
    'visual-readonly',
  )
  const checkpoints = new LocalCheckpointRepository({
    documentId: definition.documentId,
    repository: documentRepository,
  })
  const composition = new CompositionBarrier()
  let flushRecoveryPersistence: () => void | Promise<void> = () => undefined
  let flushVisualSynchronization: () => Promise<void> = () => Promise.resolve()
  let recoverVisualSynchronization: () => Promise<void> = () => Promise.resolve()
  let retryVisualSynchronization: () => Promise<void> = () => Promise.resolve()
  let root: ApplicationCompositionRoot
  const flushComposition = async (operationId: string): Promise<void> => {
    if (!composition.active()) return
    const operation = Object.freeze({
      kind: 'persist-recovery' as const,
      operationId,
      requestedRevision: root.session.snapshot().revision,
    })
    root.synchronization.waitForComposition(operation)
    await composition.wait()
    root.synchronization.succeed(root.session.snapshot())
  }
  root = createApplicationCompositionRoot({
    adapters: modeSurfaces.adapters,
    checkpoints,
    flushRecoveryPersistence: () => flushRecoveryPersistence(),
    flushSynchronization: async () => {
      await flushComposition(`mode-lifecycle:${definition.documentId}:${createRandomId()}`)
      await flushVisualSynchronization()
    },
    initialDocument,
    initialMode,
  })
  let runtime: ArticleRuntime
  referenceRegistry(root.session)
  const autosave = new AutosaveCoordinator({
    pageLifecycle: window,
    persist: async (nextSnapshot) => {
      if (e2eAutosaveFailure === 'once' && !e2eAutosaveFailureInjected) {
        e2eAutosaveFailureInjected = true
        throw Object.assign(new Error('Injected automatic recovery persistence failure.'), {
          code: 'AUTOSAVE_FAILED',
        })
      }
      await props.persistence?.saveAutosave?.({
        documentId: definition.documentId,
        markdown: nextSnapshot.markdown,
        revision: nextSnapshot.revision,
      })
      const current = documentRepository.readDocument(definition.documentId)
      const savedAt = new Date().toISOString()
      const envelope: DocumentEnvelopeV1 = current.status === 'valid'
        ? Object.freeze({
            ...current.value,
            autosave: Object.freeze({
              markdown: nextSnapshot.markdown,
              revision: nextSnapshot.revision,
              savedAt,
            }),
            status: Object.freeze({ lastPersistenceFailure: null }),
          })
        : Object.freeze({
            autosave: Object.freeze({
              markdown: nextSnapshot.markdown,
              revision: nextSnapshot.revision,
              savedAt,
            }),
            documentId: definition.documentId,
            manualCheckpoint: null,
            preDestructiveReplace: null,
            preModeSwitch: null,
            schemaVersion: 1,
            status: Object.freeze({ lastPersistenceFailure: null }),
          })
      documentRepository.writeDocument(envelope)
      runtime.lastUpdated = savedAt
      articleTimestampVersion.value += 1
    },
  })
  flushRecoveryPersistence = () => autosave.flush()
  const manualCheckpoint = new ManualCheckpointService({
    flushPersistence: () => autosave.flush(),
    flushSynchronization: async () => {
      await flushComposition(`manual-save:${definition.documentId}:${createRandomId()}`)
      await flushVisualSynchronization()
      const synchronization = root.synchronization.snapshot()
      if (synchronization.status === 'failed') throw synchronization.failure
    },
    ...(props.savedMarkdown?.(definition.documentId) === undefined ? {} : { initialBaselineMarkdown: props.savedMarkdown!(definition.documentId)! }),
    initialCheckpoint: stored.status === 'valid' ? stored.value.manualCheckpoint : null,
    session: root.session,
    writeLatest: async (checkpoint) => {
      await props.persistence?.saveManual?.({
        documentId: definition.documentId,
        markdown: checkpoint.markdown,
        revision: checkpoint.revision,
        title: definition.title,
      })
      const current = documentRepository.readDocument(definition.documentId)
      const active = root.session.snapshot()
      const envelope: DocumentEnvelopeV1 = current.status === 'valid'
        ? Object.freeze({ ...current.value, manualCheckpoint: checkpoint })
        : Object.freeze({
            autosave: Object.freeze({
              markdown: active.markdown,
              revision: active.revision,
              savedAt: checkpoint.savedAt,
            }),
            documentId: definition.documentId,
            manualCheckpoint: checkpoint,
            preDestructiveReplace: null,
            preModeSwitch: null,
            schemaVersion: 1,
            status: Object.freeze({ lastPersistenceFailure: null }),
          })
      documentRepository.writeDocument(envelope)
    },
  })
  runtime = {
    autosave,
    checkpoints,
    composition,
    definition,
    flushVisualSynchronization: () => flushVisualSynchronization(),
    recoverVisualSynchronization: () => recoverVisualSynchronization(),
    lastUpdated: stored.status === 'valid' ? stored.value.autosave.savedAt : null,
    manualCheckpoint,
    modeSurfaces,
    previewTaskHistory: { redo: [], undo: [] },
    registerVisualFlush: (flush) => {
      flushVisualSynchronization = flush ?? (() => Promise.resolve())
    },
    registerVisualRecovery: (recover) => {
      recoverVisualSynchronization = recover ?? (() => Promise.resolve())
    },
    registerVisualRetry: (retry) => {
      retryVisualSynchronization = retry ?? (() => Promise.resolve())
    },
    retryVisualSynchronization: () => retryVisualSynchronization(),
    root,
    state: root.snapshot(),
    surface: modeSurfaces.snapshot(),
    unsubscribe: [],
  }
  runtime.unsubscribe = Object.freeze([
    root.subscribe((state) => {
      runtime.state = state
      publishRuntime(runtime)
    }),
    modeSurfaces.subscribe((nextSurface) => {
      runtime.surface = nextSurface
      publishRuntime(runtime)
    }),
    root.session.subscribe((change) => {
      autosave.request(change.current)
      if (change.acknowledgement.transactionId?.startsWith('author-preview-task:') === true) return
      runtime.previewTaskHistory.redo.length = 0
      runtime.previewTaskHistory.undo.length = 0
    }),
    autosave.subscribe((autosaveState) => {
      root.setAutosave(autosaveState)
      publishRuntime(runtime)
    }),
    manualCheckpoint.subscribe((dirty) => {
      root.setManualDirty(dirty)
      publishRuntime(runtime)
    }),
  ])
  if (stored.status === 'valid') {
    root.setAutosave({ failure: null, revision: stored.value.autosave.revision, status: 'saved' })
  }
  root.setManualDirty(manualCheckpoint.dirty())
  runtimes.set(definition.documentId, runtime)
  articleTimestampVersion.value += 1
  return runtime
}

const initialRuntime = createArticleRuntime(initialDefinition)
const activeRuntime = shallowRef(initialRuntime)
const workspace = shallowRef<WorkspaceState>(initialRuntime.state)
const surface = shallowRef<WorkspaceSurface>(initialRuntime.surface)
const catalogVersion = ref(0)
publishRuntime = (runtime) => {
  if (runtime !== activeRuntime.value) return
  workspace.value = runtime.state
  surface.value = runtime.surface
  props.onWorkspaceStateChange?.(Object.freeze({
    autosaveStatus: runtime.state.autosave.status,
    dirty: runtime.state.manualDirty,
    documentId: runtime.state.activeDocument.documentId,
    errorCode: runtime.state.error?.code ?? null,
    synchronizationStatus: runtime.state.synchronization.status,
    title: runtime.definition.title,
  }))
}
publishRuntime(initialRuntime)
const articleSwitch = new ArticleSwitchCoordinator({
  catalog,
  flushCurrent: async (article) => {
    const runtime = runtimes.get(article.definition.documentId)
    if (runtime === undefined) throw new Error('Current article runtime is unavailable.')
    const guard = new ArticleSwitchFlushGuard({
      flushComposition: async () => {
        if (!runtime.composition.active()) return
        const operation = {
          kind: 'persist-recovery' as const,
          operationId: `article-switch:composition:${article.definition.documentId}`,
          requestedRevision: article.session.snapshot().revision,
        }
        runtime.root.synchronization.waitForComposition(operation)
        await runtime.composition.wait()
        runtime.root.synchronization.succeed(article.session.snapshot())
      },
      flushConversion: () => {
        const state = runtime.root.synchronization.snapshot()
        if (state.status === 'failed' && state.operation?.kind === 'convert-mode') throw state.failure
      },
      flushPersistence: () => runtime.autosave.flush(),
      flushSynchronization: async () => {
        await runtime.flushVisualSynchronization()
        const state = runtime.root.synchronization.snapshot()
        if (state.status === 'failed' && state.operation?.kind !== 'convert-mode') throw state.failure
      },
    })
    await guard.flush(article)
  },
  initialArticle: Object.freeze({ definition: initialRuntime.definition, session: initialRuntime.root.session }),
  openArticle: async (definition) => {
    const loaded = runtimes.has(definition.documentId) ? definition : await props.loadArticle?.(definition.documentId) ?? definition
    const runtime = runtimes.get(definition.documentId) ?? createArticleRuntime(loaded)
    return Object.freeze({ definition, session: runtime.root.session })
  },
})
articleSwitch.subscribe((article) => {
  const runtime = runtimes.get(article.definition.documentId)
  if (runtime === undefined) throw new Error('Active article runtime was not prepared.')
  activeRuntime.value = runtime
  publishRuntime(runtime)
  persistWorkspaceState()
  void focusActiveSurface()
})

function persistWorkspaceState(): void {
  const current = documentRepository.readWorkspace()
  if (current.status === 'recovery-required') return
  const nextWorkspace = Object.freeze({
    activeDocumentId: activeRuntime.value.definition.documentId,
    articlePanel: Object.freeze({ collapsed: !articlePanelOpen.value, width: articlePanelWidth.value }),
    catalogDocumentIds: Object.freeze(catalog.list().map((article) => article.documentId)),
    schemaVersion: 1,
  })
  documentRepository.writeWorkspace(nextWorkspace)
  void Promise.resolve(props.persistence?.saveWorkspace?.({
    documentId: nextWorkspace.activeDocumentId,
    mode: activeRuntime.value.state.mode,
    sidebar: Object.freeze({
      collapsed: nextWorkspace.articlePanel.collapsed,
      open: !nextWorkspace.articlePanel.collapsed,
      width: nextWorkspace.articlePanel.width,
    }),
  })).catch(() => undefined)
}

const mode = computed(() => workspace.value.mode)
const actionCount = ref(0)
const articlePanelOpen = ref(storedWorkspace.status === 'valid' ? !storedWorkspace.value.articlePanel.collapsed : true)
const articlePanelWidth = ref(storedWorkspace.status === 'valid' ? storedWorkspace.value.articlePanel.width : 252)
const articlePanelView = ref<'articles' | 'outline'>(props.articleGroupLabels === undefined ? 'articles' : 'outline')
const activeOutlineAnchor = ref<string | null>(null)
const articleSwitching = ref(false)
const newArticleDialogOpen = ref(false)
const newArticleTitle = ref('')
const newArticleError = ref<UiNotice | null>(null)
const newArticleTrigger = ref<HTMLElement | null>(null)
const manualSaving = ref(false)
const capabilityProbe = shallowRef<Component | null>(null)
const modeSwitching = ref(false)
const lastRequestedMode = ref<EditorMode | null>(null)
const lastEditingMode = ref<'source' | 'visual'>('visual')
const fullscreenActive = ref(false)
const fullscreenError = ref<UiNotice | null>(null)
const exportError = ref<UiNotice | null>(null)
const workspaceShell = ref<HTMLElement | null>(null)
let fullscreenController: FullscreenController | null = null
let unsubscribeFullscreen: (() => void) | null = null
const sourceSurface = ref<{
  readonly applyPatchPlan: (plan: PatchPlan) => unknown
  readonly clearSearchHighlights: () => void
  readonly focus: () => void
  readonly flush: () => CommitAcknowledgement | null
  readonly redo: () => boolean
  readonly quoteSelectedSource: () => boolean
  readonly restoreCheckpoint: (markdown: string, transactionId: string) => CommitAcknowledgement
  readonly search: (query: string, caseSensitive?: boolean) => readonly Readonly<{ from: number; to: number }>[]
  readonly setSearchHighlights: (matches: readonly Readonly<{ from: number; to: number }>[], activeIndex: number) => void
  readonly setTheme: (theme: AppearanceTheme) => void
  readonly selection: () => Readonly<{ anchor: number; head: number }>
  readonly setSelection: (selection: Readonly<{ anchor: number; head: number }>) => void
  readonly undo: () => boolean
  readonly visibleSourceFrom: () => number | null
  readonly value: () => string
} | null>(null)
const visualSurface = ref<{
  readonly applyBlockquote: () => { readonly active: boolean; readonly changed: boolean }
  readonly applyAttachment: (source: string, fallbackKind?: AttachmentKind | null) => { readonly active: boolean; readonly changed: boolean }
  readonly applyDrawio: (source: string) => { readonly active: boolean; readonly changed: boolean }
  readonly applyChartTable: (source: string) => { readonly active: boolean; readonly changed: boolean }
  readonly applyMedia: (source: string, fallbackKind?: MediaKind | null) => { readonly active: boolean; readonly changed: boolean }
  readonly applyCodeBlock: (language: string, code: string, source: string) => { readonly active: boolean; readonly changed: boolean }
  readonly applyRawSource: (source: string) => { readonly active: boolean; readonly changed: boolean }
  readonly canApplyAlignment: () => boolean
  readonly clearSearchHighlights: () => void
  readonly applyAlignment: (commandId: AlignmentCommandId) => { readonly active: boolean; readonly changed: boolean }
  readonly applyColumnLayout: (source: string) => { readonly active: boolean; readonly changed: boolean }
  readonly applyHeading: (commandId: HeadingCommandId) => { readonly active: boolean; readonly changed: boolean }
  readonly applyList: (commandId: ListCommandId) => { readonly active: boolean; readonly changed: boolean }
  readonly updateReference: (id: string, reference: Pick<DocumentReference, 'text' | 'metadata' | 'style'>) => { readonly changed: boolean }
  readonly removeReference: (id: string) => { readonly changed: boolean }
  readonly setReferenceStyle: (style: ReferenceStyle) => { readonly changed: boolean }
  readonly applyReference: (reference: DocumentReference) => { readonly active: boolean; readonly changed: boolean }
  readonly applyLink: (href: string) => { readonly active: boolean; readonly changed: boolean }
  readonly applyMermaid: (source: string, fallbackType?: MermaidDiagramType | null) => { readonly active: boolean; readonly changed: boolean }
  readonly applyFormula: (mode: FormulaMode, content: string) => { readonly active: boolean; readonly changed: boolean }
  readonly applyDisclosure: (source: string) => { readonly active: boolean; readonly changed: boolean }
  readonly applyPanel: (source: string) => { readonly active: boolean; readonly changed: boolean }
  readonly applyTimeline: (source: string) => { readonly active: boolean; readonly changed: boolean }
  readonly applyRichInlineMark: (commandId: RichInlineMarkCommandId, value: string, bodyOverride?: string) => { readonly active: boolean; readonly changed: boolean; readonly value: string | null }
  readonly clearRichInlineMark: (commandId: 'text.background' | 'text.color') => { readonly active: boolean; readonly changed: boolean }
  readonly executeInlineMark: (commandId: InlineMarkCommandId) => { readonly active: boolean; readonly changed: boolean }
  readonly focus: () => void
  readonly isInlineMarkActive: (commandId: InlineMarkCommandId) => boolean
  readonly isHeadingActive: (commandId: HeadingCommandId) => boolean
  readonly isAlignmentActive: (commandId: AlignmentCommandId) => boolean
  readonly isListActive: (commandId: ListCommandId) => boolean
  readonly navigateHeading: (anchor: string) => boolean
  readonly richInlineMarkValue: (commandId: RichInlineMarkCommandId) => string | null
  readonly redo: () => boolean
  readonly restoreCheckpoint: (markdown: string, transactionId: string) => CommitAcknowledgement
  readonly replaceSearchMatches: (matches: readonly VisualSearchMatch[], replacement: string) => { readonly active: boolean; readonly changed: boolean }
  readonly search: (query: string, caseSensitive?: boolean) => readonly VisualSearchMatch[]
  readonly selection: () => Readonly<{ anchor: number; head: number }>
  readonly setSearchHighlights: (matches: readonly VisualSearchMatch[], activeIndex: number) => void
  readonly selectedText: () => string
  readonly selectedSemanticBlock: () => VisualSemanticBlockSelection | null
  readonly selectedFormula: () => Readonly<{ readonly content: string; readonly mode: FormulaMode; readonly source: string }> | null
  readonly selectedFormulaSource: () => string | null
  readonly selectedCodeBlock: () => VisualSemanticBlockSelection | null
  readonly selectedMedia: () => VisualSemanticBlockSelection | null
  readonly selectedAttachment: () => VisualSemanticBlockSelection | null
  readonly selectedDrawio: () => VisualSemanticBlockSelection | null
  readonly selectedDisclosureSource: (kind: 'accordion' | 'tabs') => string | null
  readonly selectedColumnLayoutSource: (kind: ColumnLayoutKind) => string | null
  readonly selectedPanelSource: (variant: PanelVariant) => string | null
  readonly selectedTimelineSource: () => string | null
  readonly setSelectedSemanticLocalError: (message: string | null) => boolean
  readonly setSelection: (selection: Readonly<{ anchor: number; head: number }>) => void
  readonly insertHardBreak: () => { readonly active: boolean; readonly changed: boolean }
  readonly insertTable: (columns: number, dataRows: number) => { readonly active: boolean; readonly changed: boolean }
  readonly insertSimpleBlock: (commandId: 'insert.horizontal-rule' | 'insert.toc') => { readonly active: boolean; readonly changed: boolean }
  readonly selectTocBlock: () => { readonly active: boolean; readonly changed: boolean }
  readonly toggleInlineCode: () => { readonly active: boolean; readonly changed: boolean }
  readonly undo: () => boolean
} | null>(null)
const previewSurface = ref<HTMLElement | null>(null)
const searchDialogOpen = ref(false)
const searchQueryInput = ref<HTMLInputElement | null>(null)
const searchReplaceExpanded = ref(false)
let previewSearchMarks: HTMLElement[] = []
interface SearchDialogMatch {
  readonly from: number
  readonly text: string
  readonly to: number
}
interface SearchSelectionBookmark {
  readonly documentId: string
  readonly mode: 'source' | 'visual'
  readonly revision: number
  readonly selection: Readonly<{ anchor: number; head: number }>
}
const searchCaseSensitive = ref(false)
const searchDocumentId = ref<string | null>(null)
const searchError = ref<UiNotice | null>(null)
const searchIndex = ref(-1)
const searchMatches = ref<readonly SearchDialogMatch[]>(Object.freeze([]))
const searchMode = ref<EditorMode | null>(null)
const searchOpeningSelection = ref<SearchSelectionBookmark | null>(null)
const searchQuery = ref('')
const searchReplacement = ref('')
const searchRevision = ref<number | null>(null)
const searchStatus = computed(() => searchMatches.value.length === 0
  ? t('search.noMatches')
  : t('search.resultCount', { current: searchIndex.value + 1, total: searchMatches.value.length }))
const searchCanReplace = computed(() => searchMode.value !== 'preview'
  && searchError.value === null
  && searchIndex.value >= 0
  && searchMatches.value.length > 0)
const shortcutBindings = ref<Readonly<Record<string, string>>>(DEFAULT_SHORTCUT_BINDINGS)
const shortcutDialog = ref<HTMLElement | null>(null)
const shortcutDialogOpen = ref(false)
const shortcutDraft = ref<Record<string, string>>({})
const shortcutError = ref<UiNotice | null>(null)
const shortcutRecordingCommandId = ref<string | null>(null)
const shortcutTrigger = ref<HTMLElement | null>(null)
const wordCountDialog = ref<HTMLElement | null>(null)
const wordCountDialogOpen = ref(false)
const wordCountError = ref<UiNotice | null>(null)
const wordCountStatistics = ref<DocumentStatistics | null>(null)
const wordCountTrigger = ref<HTMLElement | null>(null)
const wordCountPopoverStyle = ref<CSSProperties>({})
const richPickerCommand = ref<RichInlineMarkCommandId | null>(null)
const richPickerBase = ref('')
const richPickerError = ref<UiNotice | null>(null)
const richPickerPending = ref(false)
const richPickerStyle = ref<CSSProperties>({})
const richPickerValue = ref('')
const richPickerInput = ref<HTMLInputElement | HTMLSelectElement | null>(null)
const richColorHue = ref(0)
const richColorSaturation = ref(1)
const richColorBrightness = ref(1)
const richRecentColors = ref<readonly string[]>(loadRichRecentColors())
const linkDialogOpen = ref(false)
const linkUrl = ref('https://example.com')
const linkInput = ref<HTMLInputElement | null>(null)
const formulaDialogOpen = ref(false)
const formulaContent = ref('E = mc^2')
const formulaMode = ref<FormulaMode>('block')
const formulaDraftError = ref<UiNotice | null>(null)
const tablePickerOpen = ref(false)
const tablePickerColumns = ref(1)
const tablePickerDataRows = ref(1)
const tablePickerGrid = ref<HTMLElement | null>(null)
const tablePickerReturnFocus = ref<HTMLElement | null>(null)
const tablePickerStyle = ref<CSSProperties>({})
const tablePickerIndexes = Object.freeze(Array.from({ length: 9 }, (_, index) => index + 1))
const codeDialogOpen = ref(false)
const codeDraftContent = ref('')
const codeDraftLanguage = ref('javascript')
const codeDraftError = ref<UiNotice | null>(null)
type DedicatedEditorOpenContext = Readonly<{
  documentId: string
  existingSource: string | null
  mode: 'source' | 'visual'
  revision: number
  sourceSelection: Readonly<{ from: number; to: number }> | null
}>
const codeDialogContext = ref<DedicatedEditorOpenContext | null>(null)
const formulaDialogContext = ref<DedicatedEditorOpenContext | null>(null)
const formulaReturnFocus = ref<HTMLElement | null>(null)
const formulaOpenedFromNode = ref(false)
const mermaidDialogOpen = ref(false)
const mermaidDraftCode = ref('')
const mermaidDraftType = ref<MermaidDiagramType | null>(null)
const mermaidDraftError = ref<UiNotice | null>(null)
const mermaidDialogTitle = computed(() => {
  if (mermaidDraftType.value === null) return t('mermaid.diagram')
  const descriptor = mermaidDescriptor(`mermaid.${mermaidDraftType.value}`)
  return descriptor === null
    ? t('mermaid.diagram')
    : t('mermaid.typedDiagram', { type: descriptor.labels[toolbarLocale.value] })
})
const chartTableDialogOpen = ref(false)
const chartTableDraftType = ref<ChartTableType>('line')
const chartTableDraftColumns = ref<readonly string[]>(Object.freeze([]))
const chartTableDraftOptions = ref<Readonly<Record<string, ChartTableOptionValue>>>(Object.freeze({}))
const chartTableDraftRows = ref<readonly (readonly string[])[]>(Object.freeze([]))
const chartTableDraftTitle = ref('')
const chartTableDraftError = ref<UiNotice | null>(null)
const mediaDialogKind = ref<MediaKind | null>(null)
const mediaDraftName = ref('')
const mediaDraftUrl = ref('')
const attachmentDialogKind = ref<AttachmentKind | null>(null)
const attachmentDraftName = ref('')
const attachmentDraftUrl = ref('')
const attachmentDraftMediaType = ref('')
const attachmentDraftSize = ref(0)
const drawioDialogOpen = ref(false)
const drawioUploadError = ref('')
const drawioUploadBusy = ref(false)
const pendingDrawioPayload = shallowRef<DrawioSavePayload | null>(null)
const drawioInitialXml = ref('')
const drawioName = ref('draw.io diagram')
const drawioRequestId = ref('')
const disclosureDialogCommand = ref<DisclosureCommandId | null>(null)
const disclosureDraftSource = ref('')
const disclosureDraftError = ref<UiNotice | null>(null)
const panelDialogCommand = ref<PanelCommandId | null>(null)
const panelDraftSource = ref('')
const panelDraftError = ref<UiNotice | null>(null)
const panelDialogContext = ref<DedicatedEditorOpenContext | null>(null)
const columnLayoutDialogCommand = ref<ColumnLayoutCommandId | null>(null)
const columnLayoutDraftSource = ref('')
const columnLayoutDraftError = ref<UiNotice | null>(null)
const timelineDialogOpen = ref(false)
const timelineDraftSource = ref('')
const timelineDraftError = ref<UiNotice | null>(null)
const rawDialogKind = ref<VisualRawNodeSelection['kind'] | null>(null)
const rawDraftSource = ref('')
const activeCommandTrigger = ref<HTMLElement | null>(null)
const toolbarLocale = ref<UiLocale>('zh')
watch(toolbarLocale, (locale) => props.onLocaleChange?.(locale), { immediate: true })
const configuredAppearanceTheme = settings.get<unknown>(PLAYGROUND_SETTINGS_KEYS.appearanceTheme)
const appearanceTheme = ref<AppearanceTheme>(isAppearanceTheme(configuredAppearanceTheme) ? configuredAppearanceTheme : 'gray')
const uiLocalization = createUiLocalizationStore(toolbarLocale.value)
const t = (key: UiMessageKey, params?: UiMessageParams): string =>
  translateUi(toolbarLocale.value, key, params)
const configuredLineSpacing = settings.get<unknown>(PLAYGROUND_SETTINGS_KEYS.lineSpacing)
const lineSpacing = ref<LineSpacingId>(isLineSpacingId(configuredLineSpacing) ? configuredLineSpacing : 'standard')
const lineSpacingMenuOpen = ref(false)
const lineSpacingTrigger = ref<HTMLElement | null>(null)
const lineSpacingPopoverStyle = ref<CSSProperties>({})
const lineSpacingOptions = computed(() => LINE_SPACING_OPTIONS.map((option) => Object.freeze({
  ...option,
  label: t(`lineSpacing.${option.id}` as UiMessageKey),
})))
const lineSpacingValue = computed(() => lineSpacingOption(lineSpacing.value).value)
const workspaceShellStyle = computed<CSSProperties>(() => ({
  '--w-editor-line-height': String(lineSpacingValue.value),
} as CSSProperties))
const appearanceThemeOptions = computed(() => APPEARANCE_THEME_IDS.map((theme) => Object.freeze({
  id: theme,
  label: t(`theme.${theme}` as UiMessageKey),
})))
type UiNotice = Readonly<{
  commandParams?: Readonly<Record<string, string>>
  detail?: string
  key: UiMessageKey
  localizedParams?: Readonly<Record<string, UiMessageKey>>
  params?: UiMessageParams
}>
function uiNotice(key: UiMessageKey, params?: UiMessageParams): UiNotice {
  return Object.freeze(params === undefined ? { key } : { key, params })
}
function externalUiNotice(key: UiMessageKey, detail: string, params?: UiMessageParams): UiNotice {
  return Object.freeze(params === undefined ? { detail, key } : { detail, key, params })
}
function localizedUiNotice(
  key: UiMessageKey,
  params: UiMessageParams,
  localizedParams: Readonly<Record<string, UiMessageKey>>,
): UiNotice {
  return Object.freeze({ key, localizedParams: Object.freeze({ ...localizedParams }), params })
}
function commandUiNotice(
  key: UiMessageKey,
  commandId: string,
  parameter = 'command',
  params?: UiMessageParams,
): UiNotice {
  return commandParametersUiNotice(key, { [parameter]: commandId }, params)
}
function commandParametersUiNotice(
  key: UiMessageKey,
  commandParams: Readonly<Record<string, string>>,
  params?: UiMessageParams,
): UiNotice {
  return Object.freeze({
    commandParams: Object.freeze({ ...commandParams }),
    key,
    ...(params === undefined ? {} : { params }),
  })
}
function uiNoticeText(notice: UiNotice | null): string | null {
  if (notice === null) return null
  const params = { ...notice.params }
  for (const [name, key] of Object.entries(notice.localizedParams ?? {})) params[name] = t(key)
  for (const [name, commandId] of Object.entries(notice.commandParams ?? {})) {
    params[name] = commandRegistry.presentation(commandId, toolbarLocale.value).label
  }
  if (notice.detail !== undefined) params['detail'] = notice.detail
  return t(notice.key, Object.keys(params).length === 0 ? undefined : Object.freeze(params))
}
function uiFailureNotice(failure: unknown, prefix: UiMessageKey): UiNotice {
  if (isUiNoticeError(failure)) return failure.uiNotice
  return failure instanceof Error
    ? externalUiNotice(prefix, failure.message)
    : localizedUiNotice(prefix, { detail: 'failure' }, { detail: 'lifecycle.failed' })
}
type UiNoticeError = Error & Readonly<{ uiNotice: UiNotice }>
function isUiNoticeError(value: unknown): value is UiNoticeError {
  return value instanceof Error && 'uiNotice' in value
}
function uiError(key: UiMessageKey, params?: UiMessageParams): UiNoticeError {
  return Object.assign(new Error(key), { uiNotice: uiNotice(key, params) })
}
function isUiLocale(value: string): value is UiLocale {
  return value === 'zh' || value === 'en' || value === 'ru'
}
function validationUiNotice(code: string, commandId?: string): UiNotice {
  switch (code) {
    case 'INVALID_PANEL_SOURCE':
      return commandId === undefined
        ? uiNotice('validation.invalidDraft')
        : commandUiNotice('validation.panelSource', commandId, 'panel')
    case 'INVALID_PANEL_COMMAND': return uiNotice('validation.panelCommand')
    case 'INVALID_COLUMN_LAYOUT_SOURCE':
      return commandId === undefined
        ? uiNotice('validation.invalidDraft')
        : commandUiNotice('validation.columnLayoutSource', commandId, 'layout')
    case 'INVALID_DISCLOSURE_SOURCE':
      return commandId === undefined
        ? uiNotice('validation.invalidDraft')
        : commandUiNotice('validation.disclosureSource', commandId, 'layout')
    case 'INVALID_TIMELINE_SOURCE':
      return commandUiNotice('validation.timelineSource', 'layout.timeline', 'timeline')
    default: return uiNotice('validation.invalidDraft')
  }
}
const openedToolbarMenu = ref<ToolbarMenuId | null>(null)
const toolbarMenuPanelStyle = ref<CSSProperties>({})
const toolbarRegion = ref<HTMLElement | null>(null)
const toolbarTooltipCommandId = ref<string | null>(null)
const toolbarTooltipStyle = ref<CSSProperties>({})
const selectedSemanticNode = ref<string | null>(null)
type PendingVisualTocSelection = Readonly<{
  readonly documentId: string
  readonly revision: number
  readonly selection: Readonly<{ from: number; to: number }>
}>
const pendingVisualTocSelection = shallowRef<PendingVisualTocSelection | null>(null)
const commandFeedback = ref<UiNotice | null>(null)
type LifecycleConfirmation = Readonly<{
  activity: string
  body: UiNotice
  confirmLabel: UiNotice
  kind: DestructiveReplacementKind
  resolve: (confirmed: boolean) => void
  runtime: ArticleRuntime
  title: UiNotice
}>
const lifecycleConfirmation = shallowRef<LifecycleConfirmation | null>(null)
type LifecycleDecision = 'cancel' | 'draft' | 'export' | 'save' | 'discard'
type LifecycleDecisionState = Readonly<{
  body: UiNotice
  kind: 'article-switch'
  resolve: (decision: LifecycleDecision) => void
  runtime: ArticleRuntime
  title: UiNotice
}>
const lifecycleDecision = shallowRef<LifecycleDecisionState | null>(null)
const lifecycleError = ref<UiNotice | null>(null)
const lifecycleFileInput = ref<HTMLInputElement | null>(null)
const lifecycleOperation = ref(false)
const lifecycleTrigger = ref<HTMLElement | null>(null)
const activeEditorCommandIds = ref<ReadonlySet<string>>(new Set())
const liveDocumentStatistics = computed(() => calculateDocumentStatistics(workspace.value.activeDocument))

function lifecycleTriggerFrom(event: Event | HTMLElement | null): HTMLElement | null {
  if (event instanceof HTMLElement) return event
  return event?.currentTarget instanceof HTMLElement ? event.currentTarget : null
}

function requestLifecycleConfirmation(input: Omit<LifecycleConfirmation, 'resolve'>): Promise<boolean> {
  if (lifecycleConfirmation.value !== null) {
    throw uiError('lifecycle.confirmationActive')
  }
  input.runtime.root.setModalActivity(input.activity)
  return new Promise<boolean>((resolve) => {
    lifecycleConfirmation.value = Object.freeze({ ...input, resolve })
  })
}

function requestLifecycleDecision(input: Omit<LifecycleDecisionState, 'resolve'>): Promise<LifecycleDecision> {
  if (lifecycleDecision.value !== null || lifecycleConfirmation.value !== null) {
    throw uiError('lifecycle.confirmationActive')
  }
  input.runtime.root.setModalActivity(`lifecycle-decision:${input.kind}`)
  return new Promise<LifecycleDecision>((resolve) => {
    lifecycleDecision.value = Object.freeze({ ...input, resolve })
  })
}

async function settleLifecycleConfirmation(confirmed: boolean): Promise<void> {
  const confirmation = lifecycleConfirmation.value
  if (confirmation === null) return
  lifecycleConfirmation.value = null
  confirmation.runtime.root.setModalActivity(null)
  confirmation.resolve(confirmed)
  await nextTick()
  lifecycleTrigger.value?.focus()
}

async function settleLifecycleDecision(decision: LifecycleDecision): Promise<void> {
  const pending = lifecycleDecision.value
  if (pending === null) return
  lifecycleDecision.value = null
  pending.runtime.root.setModalActivity(null)
  pending.resolve(decision)
  await nextTick()
  lifecycleTrigger.value?.focus()
}

async function flushLifecycleComposition(runtime: ArticleRuntime, operationId: string): Promise<void> {
  if (!runtime.composition.active()) return
  const operation = Object.freeze({
    kind: 'persist-recovery' as const,
    operationId,
    requestedRevision: runtime.root.session.snapshot().revision,
  })
  runtime.root.synchronization.waitForComposition(operation)
  await runtime.composition.wait()
  runtime.root.synchronization.succeed(runtime.root.session.snapshot())
}

async function flushLifecycleSynchronization(runtime: ArticleRuntime): Promise<void> {
  await runtime.flushVisualSynchronization()
  const synchronization = runtime.root.synchronization.snapshot()
  if (synchronization.status === 'failed') throw synchronization.failure
}

function destructiveOperationKey(kind: DestructiveReplacementKind): UiMessageKey {
  switch (kind) {
    case 'clear': return 'lifecycle.operation.clear'
    case 'import': return 'lifecycle.operation.import'
    case 'reset': return 'lifecycle.operation.reset'
  }
}

function lifecycleFailureMessage(failure: unknown): UiNotice {
  if (failure instanceof InvalidReplacementInputError) {
    return uiNotice('lifecycle.invalidMarkdown')
  }
  return uiFailureNotice(failure, 'feedback.externalDetail')
}

async function readMarkdownFile(file: File): Promise<string> {
  let markdown: string
  try {
    markdown = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
  } catch {
    throw new InvalidReplacementInputError()
  }
  if (markdown.includes('\0')) throw new InvalidReplacementInputError()
  return markdown
}

function addArticleToCatalog(definition: ArticleDefinition): ArticleDefinition {
  const added = catalog.add(definition)
  catalogVersion.value += 1
  return added
}

async function openHostArticle(definition: ArticleDefinition, activity: 'created' | 'imported' = 'imported'): Promise<void> {
  if (catalog.lookup(definition.documentId) === null) {
    addArticleToCatalog(definition)
    props.onArticleActivity?.({ documentId: definition.documentId, kind: activity, title: definition.title })
  }
  await selectArticle(definition.documentId)
}

function openNewArticle(event: Event): void {
  if (lifecycleOperation.value || articleSwitching.value || props.createArticle === undefined) return
  newArticleTrigger.value = lifecycleTriggerFrom(event)
  newArticleTitle.value = ''
  newArticleError.value = null
  newArticleDialogOpen.value = true
  activeRuntime.value.root.setModalActivity('new-article')
  void nextTick(() => workspaceShell.value?.querySelector<HTMLInputElement>('[data-testid="new-article-title"]')?.focus())
}

async function closeNewArticle(restoreFocus = true): Promise<void> {
  newArticleDialogOpen.value = false
  newArticleError.value = null
  activeRuntime.value.root.setModalActivity(null)
  await nextTick()
  if (restoreFocus) newArticleTrigger.value?.focus()
}

async function submitNewArticle(): Promise<void> {
  if (newArticleTitle.value.trim().length === 0 || props.createArticle === undefined) {
    newArticleError.value = externalUiNotice('feedback.externalDetail', 'An article title is required.')
    return
  }
  const title = newArticleTitle.value.trim()
  try {
    const definition = await props.createArticle({ title })
    addArticleToCatalog(definition)
    props.onArticleActivity?.({ documentId: definition.documentId, kind: 'created', title: definition.title })
    await closeNewArticle(false)
    await selectArticle(definition.documentId)
    commandFeedback.value = uiNotice('workspace.articleCreated', { title: definition.title })
  } catch (error) {
    newArticleError.value = uiFailureNotice(error, 'feedback.externalDetail')
  }
}

async function runLibraryImport(file: File, eventOrTrigger: Event | HTMLElement | null): Promise<void> {
  if (lifecycleOperation.value || props.importArticle === undefined) return
  const runtime = activeRuntime.value
  lifecycleTrigger.value = lifecycleTriggerFrom(eventOrTrigger) ?? lifecycleTrigger.value
  lifecycleError.value = null
  lifecycleOperation.value = true
  try {
    if (runtime.state.manualDirty) {
      const confirmed = await requestLifecycleConfirmation({
        activity: 'destructive-replacement:import',
        body: localizedUiNotice('lifecycle.destructiveBody', {
          operation: 'import',
          revision: runtime.root.session.snapshot().revision,
          title: runtime.definition.title,
        }, { operation: 'lifecycle.operation.import' }),
        confirmLabel: uiNotice('lifecycle.operation.import'),
        kind: 'import',
        runtime,
        title: localizedUiNotice('lifecycle.destructiveTitle', { operation: 'import' }, { operation: 'lifecycle.operation.import' }),
      })
      if (!confirmed) {
        commandFeedback.value = uiNotice('lifecycle.restoreCancelled')
        return
      }
    }
    const markdown = await readMarkdownFile(file)
    await flushLifecycleComposition(runtime, `library-import:${createRandomId()}`)
    await flushLifecycleSynchronization(runtime)
    await runtime.autosave.flush()
    const title = file.name.replace(/\.(?:md|markdown|txt)$/iu, '').trim() || 'Imported Markdown'
    const definition = await props.importArticle({ markdown, title })
    addArticleToCatalog(definition)
    props.onArticleActivity?.({ documentId: definition.documentId, kind: 'imported', title: definition.title })
    await selectArticle(definition.documentId)
    commandFeedback.value = uiNotice('workspace.articleImported', { title: definition.title })
  } catch (failure) {
    lifecycleError.value = lifecycleFailureMessage(failure)
  } finally {
    lifecycleOperation.value = false
    if (lifecycleFileInput.value !== null) lifecycleFileInput.value.value = ''
    await nextTick()
    lifecycleTrigger.value?.focus()
  }
}

async function runDestructiveReplacement(
  kind: DestructiveReplacementKind,
  readReplacement: () => string | Promise<string>,
  eventOrTrigger: Event | HTMLElement | null,
  beforeCommit?: () => void | Promise<void>,
): Promise<void> {
  if (lifecycleOperation.value) return
  const runtime = activeRuntime.value
  const operationKey = destructiveOperationKey(kind)
  lifecycleTrigger.value = lifecycleTriggerFrom(eventOrTrigger) ?? lifecycleTrigger.value
  lifecycleError.value = null
  lifecycleOperation.value = true
  try {
    const coordinator = new DestructiveReplacementCoordinator({
      checkpoints: runtime.checkpoints,
      confirm: ({ current }) => requestLifecycleConfirmation({
        activity: `destructive-replacement:${kind}`,
        body: localizedUiNotice('lifecycle.destructiveBody', {
          operation: kind,
          revision: current.revision,
          title: runtime.definition.title,
        }, { operation: operationKey }),
        confirmLabel: uiNotice(operationKey),
        kind,
        runtime,
        title: localizedUiNotice('lifecycle.destructiveTitle', { operation: kind }, { operation: operationKey }),
      }),
      flushComposition: () => flushLifecycleComposition(runtime, `destructive:${kind}:${createRandomId()}`),
      flushPersistence: () => runtime.autosave.flush(),
      flushSynchronization: () => flushLifecycleSynchronization(runtime),
      session: runtime.root.session,
    })
    const result = await coordinator.execute({
      ...(beforeCommit === undefined ? {} : { beforeCommit }),
      kind,
      readReplacement,
      transactionId: `destructive:${kind}:${createRandomId()}`,
    })
    if (result.status === 'cancelled') {
      commandFeedback.value = localizedUiNotice('lifecycle.cancelled', { operation: kind }, { operation: operationKey })
      return
    }
    await runtime.autosave.flush()
    commandFeedback.value = localizedUiNotice('lifecycle.completed', {
      operation: kind,
      revision: result.acknowledgement.revision,
    }, { operation: operationKey })
  } catch (failure) {
    lifecycleError.value = lifecycleFailureMessage(failure)
  } finally {
    lifecycleOperation.value = false
    if (lifecycleFileInput.value !== null) lifecycleFileInput.value.value = ''
    await nextTick()
    lifecycleTrigger.value?.focus()
  }
}

function chooseMarkdownImport(event: Event): void {
  if (lifecycleOperation.value) return
  lifecycleTrigger.value = lifecycleTriggerFrom(event)
  lifecycleError.value = null
  lifecycleFileInput.value?.click()
}

function handleMarkdownImport(event: Event): void {
  const input = event.currentTarget as HTMLInputElement
  importMarkdownFiles(Array.from(input.files ?? []), lifecycleTrigger.value)
}

function importMarkdownFiles(files: File[], trigger: Event | HTMLElement | null): void {
  if (lifecycleOperation.value || articleSwitching.value || files.length === 0) return
  const element = lifecycleTriggerFrom(trigger)
  lifecycleTrigger.value = element?.querySelector<HTMLButtonElement>('[data-testid="import-markdown"]') ?? element
  lifecycleError.value = null
  if (files.length !== 1) {
    lifecycleError.value = uiNotice('lifecycle.oneMarkdownFile')
    if (lifecycleFileInput.value) lifecycleFileInput.value.value = ''
    return
  }
  const file = files[0]!
  if (!/\.(md|markdown)$/i.test(file.name)) {
    lifecycleError.value = uiNotice('lifecycle.markdownFileType')
    if (lifecycleFileInput.value) lifecycleFileInput.value.value = ''
    return
  }
  if (props.importArticle !== undefined) {
    void runLibraryImport(file, lifecycleTrigger.value)
    return
  }
  void runDestructiveReplacement(
    'import',
    () => readMarkdownFile(file),
    lifecycleTrigger.value,
    file.size >= LARGE_IMPORT_SOURCE_MODE_BYTES && mode.value !== 'source'
      ? () => selectMode('source')
      : undefined,
  )
}

function sourceSelection(): Readonly<{ from: number; to: number }> {
  const selection = sourceSurface.value?.selection() ?? { anchor: 0, head: 0 }
  return Object.freeze({
    from: Math.min(selection.anchor, selection.head),
    to: Math.max(selection.anchor, selection.head),
  })
}

function captureDedicatedEditorContext(existingSource: string | null): DedicatedEditorOpenContext {
  const snapshot = activeRuntime.value.root.session.snapshot()
  if (mode.value !== 'source' && mode.value !== 'visual') {
    throw uiError('feedback.dedicated.activeSurfaceRequired')
  }
  return Object.freeze({
    documentId: snapshot.documentId,
    existingSource,
    mode: mode.value,
    revision: snapshot.revision,
    sourceSelection: mode.value === 'source' ? sourceSelection() : null,
  })
}

function assertDedicatedEditorContext(context: DedicatedEditorOpenContext): void {
  injectDedicatedEditorFailure('stale-selection')
  const snapshot = activeRuntime.value.root.session.snapshot()
  const currentSourceSelection = context.mode === 'source' ? sourceSelection() : null
  const selectionChanged = context.sourceSelection !== null && currentSourceSelection !== null
    ? context.sourceSelection.from !== currentSourceSelection.from || context.sourceSelection.to !== currentSourceSelection.to
    : context.sourceSelection !== currentSourceSelection
  if (snapshot.documentId !== context.documentId || mode.value !== context.mode || selectionChanged) {
    throw uiError('feedback.dedicated.staleSelection')
  }
  injectDedicatedEditorFailure('revision')
  if (snapshot.revision !== context.revision) {
    throw uiError('feedback.dedicated.revision')
  }
}

function dedicatedEditorFailureMessage(failure: unknown): UiNotice {
  if (isUiNoticeError(failure)) return failure.uiNotice
  if (failure instanceof Error) return externalUiNotice('feedback.dedicatedEditorDetail', failure.message)
  const synchronization = activeRuntime.value.root.synchronization.snapshot()
  return synchronization.failure === null
    ? uiNotice('lifecycle.failed')
    : externalUiNotice('feedback.dedicatedEditorDetail', synchronization.failure.message)
}

async function resolveFailedVisualIntent(source: string, selectedSource: string | null): Promise<boolean> {
  const synchronization = activeRuntime.value.root.synchronization.snapshot()
  if (synchronization.status !== 'failed' || synchronization.operation?.kind !== 'synchronize-visual-patch') return false
  if (selectedSource !== source) {
    await activeRuntime.value.recoverVisualSynchronization()
    return false
  }
  await activeRuntime.value.retryVisualSynchronization()
  const retried = activeRuntime.value.root.synchronization.snapshot()
  if (retried.status === 'failed') throw retried.failure
  return true
}

function handleVisualSelectionChange(kind: 'node' | 'text'): void {
  selectedSemanticNode.value = kind === 'node' ? 'selected-node' : null
  void nextTick(refreshVisualCommandState)
}

function refreshVisualCommandState(): void {
  const visual = visualSurface.value
  if (visual === null || mode.value !== 'visual') {
    activeEditorCommandIds.value = new Set()
    return
  }
  const active: string[] = []
  active.push(...INLINE_MARK_SPECS
    .filter((spec) => visual.isInlineMarkActive(spec.commandId))
    .map((spec) => spec.commandId))
  for (const commandId of ['block.h1', 'block.h2', 'block.h3', 'block.h4', 'block.h5'] as HeadingCommandId[]) {
    if (visual.isHeadingActive(commandId)) active.push(commandId)
  }
  for (const commandId of ['list.ordered', 'list.unordered', 'list.task'] as ListCommandId[]) {
    if (visual.isListActive(commandId)) active.push(commandId)
  }
  for (const commandId of ['align.left', 'align.center', 'align.right', 'align.justify'] as AlignmentCommandId[]) {
    if (visual.isAlignmentActive(commandId)) active.push(commandId)
  }
  for (const commandId of ['text.background', 'text.color', 'text.ruby', 'text.size'] as RichInlineMarkCommandId[]) {
    if (visual.richInlineMarkValue(commandId) !== null) active.push(commandId)
  }
  activeEditorCommandIds.value = new Set(active)
}

function handleRawEdit(event: VisualRawNodeSelection): void {
  rawDialogKind.value = event.kind
  rawDraftSource.value = event.source
}

function closeRawDialog(): void {
  rawDialogKind.value = null
  rawDraftSource.value = ''
  void nextTick(() => visualSurface.value?.focus())
}

function applyRawDialog(source: string): void {
  const result = visualSurface.value?.applyRawSource(source)
  if (result?.active !== true) {
    commandFeedback.value = uiNotice('feedback.rawNodeUnavailable')
    return
  }
  closeRawDialog()
}

async function handleSemanticCopy(event: SemanticNodeCopyEvent): Promise<void> {
  try {
    await navigator.clipboard.writeText(event.code)
    commandFeedback.value = uiNotice('feedback.codeCopied')
  } catch {
    commandFeedback.value = uiNotice('feedback.codeCopyFailed')
  }
}

async function handleSemanticEdit(
  event: VisualSemanticBlockSelection & Readonly<{ editorId: string }>,
): Promise<void> {
  switch (event.editorId) {
    case 'panel-editor':
      if (event.variant !== undefined) await openPanelDialog(`panel.${event.variant}` as PanelCommandId)
      return
    case 'column-layout-editor':
      if (event.layoutKind === 'two-column' || event.layoutKind === 'multi-column') {
        await openColumnLayoutDialog(event.layoutKind === 'two-column' ? 'layout.two-column' : 'layout.multi-column')
      }
      return
    case 'disclosure-editor':
      if (event.layoutKind === 'tabs' || event.layoutKind === 'accordion') {
        await openDisclosureDialog(`layout.${event.layoutKind}`)
      }
      return
    case 'timeline-editor':
      await openTimelineDialog()
      return
    case 'formula-editor':
      await openFormulaDialog(event)
      return
    case 'code-block-editor':
      await openCodeBlockDialog()
      return
    case 'mermaid-editor':
      openMermaidDialog(event)
      return
    case 'chart-table-editor':
      openChartTableDialog(event)
      return
    case 'media-editor':
      if (event.mediaKind === 'image' || event.mediaKind === 'audio' || event.mediaKind === 'video') {
        await openMediaDialog(event.mediaKind, event)
      }
      return
    case 'attachment-editor':
      if (event.attachmentKind === 'pdf' || event.attachmentKind === 'word' || event.attachmentKind === 'file') {
        await openAttachmentDialog(event.attachmentKind, event)
      }
      return
    case 'drawio-editor':
      await openDrawioDialog(event)
  }
}

async function applySourcePlan(
  plan: PatchPlan,
  selection: Readonly<{ from: number; to: number }>,
): Promise<void> {
  sourceSurface.value?.applyPatchPlan(plan)
  await nextTick()
  sourceSurface.value?.setSelection({ anchor: selection.from, head: selection.to })
  sourceSurface.value?.focus()
}
const richPickerLabel = computed(() => {
  switch (richPickerCommand.value) {
    case 'text.background': return t('richText.backgroundColor')
    case 'text.color': return t('richText.textColor')
    case 'text.ruby': return t('richText.rubyAnnotation')
    case 'text.size': return t('richText.fontSize')
    case null: return ''
  }
  return ''
})
const surfaceLabel = computed(() => t(`mode.surface.${mode.value}` as UiMessageKey))
const contentCommandsDisabled = computed(() => mode.value === 'preview')
const contentCommandReason = computed(() => contentCommandsDisabled.value
  ? t('status.contentCommandsUnavailable')
  : '')
const synchronizationLabel = computed(() => {
  switch (workspace.value.synchronization.status) {
    case 'failed': return t('status.sync.failed')
    case 'pending': return t('status.sync.pending')
    case 'running': return t('status.sync.running')
    case 'waiting-composition': return t('status.sync.waitingComposition')
    case 'synchronized': return t('status.sync.synchronized')
  }
  return t('status.sync.unavailable')
})

function modeLabel(value: EditorMode): string {
  return t(`mode.${value}` as UiMessageKey)
}

function statusLabel(value: string): string {
  switch (value) {
    case 'idle': return t('status.idle')
    case 'pending': return t('status.pending')
    case 'saving': return t('status.saving')
    case 'saved': return t('status.saved')
    case 'failed': return t('status.failed')
    case 'synchronized': return t('status.synchronized')
    case 'dirty': return t('status.dirty')
    case 'clean': return t('status.clean')
    default: return value
  }
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function localDateLabel(key: string, todayKey: string): string {
  return key === todayKey ? t('workspace.today') : key.replaceAll('-', '/')
}

function localTimeLabel(timestamp: number): string {
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const articleGroupCollapseOverrides = ref<ReadonlyMap<string, boolean>>(new Map())
const collapsedArticleGroups = computed(() => new Set(articleGroups.value.filter(group =>
  articleGroupCollapseOverrides.value.get(group.dateKey)
    ?? !group.articles.some(article => article.definition.documentId === activeRuntime.value.definition.documentId),
).map(group => group.dateKey)))
function toggleArticleGroup(key: string): void {
  articleGroupCollapseOverrides.value = new Map(articleGroupCollapseOverrides.value).set(key, !collapsedArticleGroups.value.has(key))
}
watch(() => activeRuntime.value.definition.documentId, () => {
  articleGroupCollapseOverrides.value = new Map()
  if (props.articleGroupLabels !== undefined) articlePanelView.value = 'outline'
})

const articleGroups = computed(() => {
  void catalogVersion.value
  void articleTimestampVersion.value
  const todayKey = localDateKey(Date.now())
  const groups = new Map<string, Array<Readonly<{
    readonly definition: ArticleDefinition
    readonly lastUpdated: string | null
    readonly timeLabel: string
    readonly timestamp: number | null
  }>>>()
  catalog.list().forEach((definition) => {
    const runtime = runtimes.get(definition.documentId)
    const stored = runtime === undefined ? documentRepository.readDocument(definition.documentId) : null
    const lastUpdated = runtime?.lastUpdated
      ?? (stored?.status === 'valid' ? stored.value.autosave.savedAt : null)
    const parsed = lastUpdated === null ? Number.NaN : Date.parse(lastUpdated)
    const timestamp = Number.isFinite(parsed) ? parsed : null
    const dateKey = props.articleGroupLabels === undefined
      ? timestamp === null ? 'unupdated' : localDateKey(timestamp)
      : props.articleGroupOverrides?.[definition.documentId] ?? runtime?.definition.group ?? definition.group ?? props.articleGroupLabels.at(-1) ?? ''
    const article = Object.freeze({
      definition,
      lastUpdated,
      timeLabel: timestamp === null ? '--:--' : localTimeLabel(timestamp),
      timestamp,
    })
    const group = groups.get(dateKey) ?? []
    group.push(article)
    groups.set(dateKey, group)
  })
  return Object.freeze([...groups.entries()]
    .sort(([left], [right]) => {
      if (props.articleGroupLabels !== undefined) {
        const rank = (label: string) => {
          const index = props.articleGroupLabels?.indexOf(label) ?? -1
          return index < 0 ? Number.MAX_SAFE_INTEGER : index
        }
        return rank(left) - rank(right) || left.localeCompare(right)
      }
      if (left === 'unupdated') return 1
      if (right === 'unupdated') return -1
      return right.localeCompare(left)
    })
    .map(([dateKey, articles]) => Object.freeze({
      articles: Object.freeze(articles.sort((left, right) => {
        if (left.timestamp === null) return right.timestamp === null ? 0 : 1
        if (right.timestamp === null) return -1
        return right.timestamp - left.timestamp
      })),
      dateKey,
      label: props.articleGroupLabels !== undefined ? dateKey : dateKey === 'unupdated' ? t('workspace.notUpdated') : localDateLabel(dateKey, todayKey),
    })))
})
async function writeExportArtifact(artifact: ExportArtifact): Promise<void> {
  if (props.exportArtifact !== undefined) {
    await props.exportArtifact(artifact)
    return
  }
  browserFileExporter.download(artifact)
}
const activeArticleTitle = computed(() => props.articleTitles?.[activeRuntime.value.definition.documentId] ?? activeRuntime.value.definition.title)
const articleOutline = computed(() => numberOutline(createMarkdownOutline(workspace.value.activeDocument.markdown)))
watch(articleOutline, (items) => {
  if (!items.some((item) => item.anchor === activeOutlineAnchor.value)) {
    activeOutlineAnchor.value = items[0]?.anchor ?? null
  }
}, { immediate: true })
const workspaceBodyStyle = computed(() => ({
  '--article-panel-width': `${articlePanelOpen.value ? articlePanelWidth.value : 56}px`,
}))

interface CommandView {
  readonly descriptor: CommandDescriptor
  readonly label: string
  readonly query: CommandQuery
}

interface CommandMenuView {
  readonly descriptor: ToolbarMenuDescriptor
  readonly label: string
  readonly sections: readonly {
    readonly commands: readonly CommandView[]
    readonly id: string
    readonly label: string
  }[]
}

type ToolbarSlotDefinition =
  | Readonly<{ commandId: string; id: string; kind: 'command' }>
  | Readonly<{ commandId: string; id: string; kind: 'command-alias' }>
  | Readonly<{ id: string; kind: 'menu'; menuId: ToolbarMenuId }>
  | Readonly<{ id: string; kind: 'line-spacing' }>
  | Readonly<{ id: string; kind: 'preview-alias' | 'separator' | 'spacer' }>

type ToolbarSlotView =
  | Readonly<{ command: CommandView; id: string; kind: 'command' }>
  | Readonly<{ command: CommandView; id: string; kind: 'command-alias' }>
  | Readonly<{ id: string; kind: 'menu'; menu: CommandMenuView }>
  | Readonly<{ id: string; kind: 'line-spacing' }>
  | Readonly<{ id: string; kind: 'preview-alias' | 'separator' | 'spacer' }>

const TOOLBAR_SLOT_DEFINITIONS: readonly ToolbarSlotDefinition[] = Object.freeze([
  ...['text.bold', 'text.italic']
    .map((commandId) => Object.freeze({ commandId, id: commandId, kind: 'command' as const })),
  Object.freeze({ id: 'menu.text-style', kind: 'menu', menuId: 'text-style' }),
  Object.freeze({ commandId: 'text.size', id: 'text.size', kind: 'command' }),
  Object.freeze({ id: 'separator.text-style', kind: 'separator' }),
  Object.freeze({ id: 'menu.color', kind: 'menu', menuId: 'color' }),
  Object.freeze({ id: 'menu.heading', kind: 'menu', menuId: 'heading' }),
  Object.freeze({ id: 'separator.text', kind: 'separator' }),
  Object.freeze({ commandId: 'insert.drawio', id: 'insert.drawio', kind: 'command' }),
  Object.freeze({ id: 'separator.drawing', kind: 'separator' }),
  ...['list.ordered', 'list.unordered', 'list.task']
    .map((commandId) => Object.freeze({ commandId, id: commandId, kind: 'command' as const })),
  Object.freeze({ id: 'menu.panel', kind: 'menu', menuId: 'panel' }),
  Object.freeze({ commandId: 'layout.timeline', id: 'layout.timeline', kind: 'command' }),
  Object.freeze({ id: 'menu.alignment', kind: 'menu', menuId: 'alignment' }),
  Object.freeze({ commandId: 'layout.accordion', id: 'layout.accordion', kind: 'command' }),
  Object.freeze({ id: 'separator.structure', kind: 'separator' }),
  Object.freeze({ commandId: 'insert.formula', id: 'insert.formula.alias', kind: 'command-alias' }),
  Object.freeze({ id: 'menu.insert', kind: 'menu', menuId: 'insert' }),
  Object.freeze({ id: 'menu.mermaid', kind: 'menu', menuId: 'mermaid' }),
  Object.freeze({ id: 'menu.chart', kind: 'menu', menuId: 'chart' }),
  Object.freeze({ id: 'separator.history', kind: 'separator' }),
  ...['history.undo', 'history.redo']
    .map((commandId) => Object.freeze({ commandId, id: commandId, kind: 'command' as const })),
  Object.freeze({ id: 'separator.reference-utilities', kind: 'separator' }),
  ...['settings.shortcuts', 'search.replace']
    .map((commandId) => Object.freeze({ commandId, id: commandId, kind: 'command' as const })),
  Object.freeze({ id: 'mode.preview.alias', kind: 'preview-alias' }),
  Object.freeze({ commandId: 'document.manual-save', id: 'document.manual-save', kind: 'command' }),
  Object.freeze({ id: 'spacer', kind: 'spacer' }),
  Object.freeze({ id: 'line-spacing', kind: 'line-spacing' }),
  Object.freeze({ commandId: 'document.word-count', id: 'document.word-count', kind: 'command' }),
  Object.freeze({ id: 'separator.right', kind: 'separator' }),
  Object.freeze({ id: 'menu.theme', kind: 'menu', menuId: 'theme' }),
  Object.freeze({ id: 'menu.language', kind: 'menu', menuId: 'language' }),
  Object.freeze({ id: 'menu.export', kind: 'menu', menuId: 'export' }),
  Object.freeze({ id: 'separator.fullscreen', kind: 'separator' }),
  Object.freeze({ commandId: 'application.fullscreen', id: 'application.fullscreen', kind: 'command' }),
])

function defaultRichPickerValue(commandId: RichInlineMarkCommandId): string {
  switch (commandId) {
    case 'text.background': return '#fde68a'
    case 'text.color': return '#c2410c'
    case 'text.ruby': return ''
    case 'text.size': return '18'
  }
}

const RICH_COLOR_PRESETS = Object.freeze([
  '#e6f3ff', '#cce7ff', '#99d6ff', '#66c5ff', '#33b4ff', '#0099ff', '#0080e6', '#0066cc', '#004d99', '#003366',
  '#ffe6e6', '#ffcccc', '#ff9999', '#ff6666', '#ff3333', '#ff0000', '#e60000', '#cc0000', '#990000', '#660000',
  '#fff2e6', '#ffe6cc', '#ffcc99', '#ffb366', '#ff9933', '#ff8000', '#e6730d', '#cc6600', '#995500', '#663300',
  '#e6ffe6', '#ccffcc', '#99ff99', '#66ff66', '#33ff33', '#00ff00', '#00e600', '#00cc00', '#009900', '#006600',
  '#fafafa', '#f5f5f5', '#e5e5e5', '#d4d4d4', '#a3a3a3', '#737373', '#525252', '#404040', '#262626', '#171717',
])
const RICH_RECENT_COLOR_SLOTS = Object.freeze([0, 1, 2, 3, 4, 5])

function loadRichRecentColors(): readonly string[] {
  const configured = settings.get<unknown>(PLAYGROUND_SETTINGS_KEYS.recentColors)
  if (!Array.isArray(configured)) return Object.freeze([])
  return Object.freeze(configured
    .filter((candidate): candidate is string => typeof candidate === 'string' && /^#[\da-f]{6}$/iu.test(candidate))
    .slice(0, 6))
}

function saveRichRecentColor(value: string): void {
  const normalized = value.toLocaleLowerCase()
  richRecentColors.value = Object.freeze([
    normalized,
    ...richRecentColors.value.filter((color) => color !== normalized),
  ].slice(0, 6))
  try {
    settings.setUserOverride(PLAYGROUND_SETTINGS_KEYS.recentColors, richRecentColors.value)
  } catch {
    // Recent colors are optional; applying the document format remains authoritative.
  }
}

function hexToHsv(value: string): Readonly<{ brightness: number; hue: number; saturation: number }> {
  const normalized = /^#[\da-f]{6}$/iu.test(value) ? value.slice(1) : 'ff0000'
  const red = Number.parseInt(normalized.slice(0, 2), 16) / 255
  const green = Number.parseInt(normalized.slice(2, 4), 16) / 255
  const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255
  const maximum = Math.max(red, green, blue)
  const minimum = Math.min(red, green, blue)
  const delta = maximum - minimum
  let hue = 0
  if (delta > 0) {
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6)
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2)
    else hue = 60 * ((red - green) / delta + 4)
  }
  return Object.freeze({
    brightness: maximum,
    hue: hue < 0 ? hue + 360 : hue,
    saturation: maximum === 0 ? 0 : delta / maximum,
  })
}

function hsvToHex(hue: number, saturation: number, brightness: number): string {
  const chroma = brightness * saturation
  const section = ((hue % 360) + 360) % 360 / 60
  const intermediate = chroma * (1 - Math.abs((section % 2) - 1))
  const [red, green, blue] = section < 1 ? [chroma, intermediate, 0]
    : section < 2 ? [intermediate, chroma, 0]
      : section < 3 ? [0, chroma, intermediate]
        : section < 4 ? [0, intermediate, chroma]
          : section < 5 ? [intermediate, 0, chroma] : [chroma, 0, intermediate]
  const match = brightness - chroma
  const channel = (value: number): string => Math.round((value + match) * 255).toString(16).padStart(2, '0')
  return `#${channel(red)}${channel(green)}${channel(blue)}`
}

const richColorSaturationStyle = computed<CSSProperties>(() => ({
  backgroundColor: `hsl(${richColorHue.value} 100% 50%)`,
}))
const richColorPointerStyle = computed<CSSProperties>(() => ({
  left: `${richColorSaturation.value * 100}%`,
  top: `${(1 - richColorBrightness.value) * 100}%`,
}))

function synchronizeRichColorControls(value: string): void {
  const color = hexToHsv(value)
  richColorHue.value = color.hue
  richColorSaturation.value = color.saturation
  richColorBrightness.value = color.brightness
}

function chooseRichColor(value: string): void {
  richPickerValue.value = value.toLocaleLowerCase()
  synchronizeRichColorControls(richPickerValue.value)
  richPickerError.value = null
  richPickerPending.value = false
}

function updateRichColorFromHsv(): void {
  richPickerValue.value = hsvToHex(richColorHue.value, richColorSaturation.value, richColorBrightness.value)
  richPickerError.value = null
}

function updateRichColorFromSaturation(event: PointerEvent): void {
  if (event.type === 'pointermove' && event.buttons !== 1) return
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  const rect = target.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  richColorSaturation.value = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
  richColorBrightness.value = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
  updateRichColorFromHsv()
}

async function applyChosenRichColor(value: string | undefined): Promise<void> {
  if (value === undefined) return
  chooseRichColor(value)
  saveRichRecentColor(richPickerValue.value)
  await applyRichPicker()
}

function selectRichColorCommand(commandId: 'text.background' | 'text.color'): void {
  richPickerCommand.value = commandId
  const value = visualSurface.value?.richInlineMarkValue(commandId) ?? defaultRichPickerValue(commandId)
  chooseRichColor(value)
}

async function clearRichColor(): Promise<void> {
  const commandId = richPickerCommand.value
  if (commandId !== 'text.background' && commandId !== 'text.color') return
  if (mode.value !== 'visual') {
    richPickerError.value = uiNotice('richText.clearVisualOnly')
    return
  }
  const result = visualSurface.value?.clearRichInlineMark(commandId)
  activeEditorCommandIds.value = new Set()
  commandFeedback.value = commandUiNotice(result?.changed === true ? 'feedback.removed' : 'feedback.noChange', commandId)
  await closeRichPicker(false)
  visualSurface.value?.focus()
}

async function openRichPicker(commandId: RichInlineMarkCommandId): Promise<void> {
  const sourceRange = mode.value === 'source' ? sourceSelection() : null
  const sourceMatch = mode.value === 'source' && sourceSurface.value !== null
    ? richInlineMarkAtSelection(activeRuntime.value.root.session.snapshot().markdown, sourceRange!)
    : null
  const sourceValue = sourceMatch?.commandId === commandId
    ? sourceMatch.value
    : visualSurface.value?.richInlineMarkValue(commandId) ?? null
  richPickerBase.value = sourceRange === null
    ? visualSurface.value?.selectedText() ?? ''
    : activeRuntime.value.root.session.snapshot().markdown.slice(sourceRange.from, sourceRange.to)
  richPickerCommand.value = commandId
  richPickerError.value = null
  richPickerPending.value = false
  richPickerValue.value = sourceValue ?? defaultRichPickerValue(commandId)
  if (commandId === 'text.color' || commandId === 'text.background') {
    synchronizeRichColorControls(richPickerValue.value)
  }
  if (activeCommandTrigger.value !== null) {
    richPickerStyle.value = anchoredOverlayStyle(activeCommandTrigger.value, commandId === 'text.color' || commandId === 'text.background' ? 332 : 320)
  }
  activeRuntime.value.root.setModalActivity(`rich-picker:${commandId}`)
  await nextTick()
  richPickerInput.value?.focus()
}

async function closeRichPicker(restoreFocus = true): Promise<void> {
  richPickerCommand.value = null
  richPickerError.value = null
  richPickerPending.value = false
  activeRuntime.value.root.setModalActivity(null)
  await nextTick()
  if (restoreFocus) activeCommandTrigger.value?.focus()
}

async function applyRichPicker(): Promise<void> {
  const commandId = richPickerCommand.value
  if (commandId === null || richPickerPending.value) return
  richPickerError.value = null
  richPickerPending.value = true
  try {
    if (mode.value === 'source') {
      const selection = sourceSelection()
      if (sourceSurface.value === null || selection.from === selection.to) return
      const snapshot = activeRuntime.value.root.session.snapshot()
      const result = createRichInlineMarkPlan(
        snapshot,
        selection,
        commandId,
        richPickerValue.value,
        `source-command:${commandId}:${createRandomId()}`,
        commandId === 'text.ruby' ? richPickerBase.value : undefined,
      )
      await applySourcePlan(result.plan, result.selection)
      activeEditorCommandIds.value = new Set([commandId])
      await closeRichPicker(false)
      sourceSurface.value?.focus()
    } else if (mode.value === 'visual') {
      const result = visualSurface.value?.applyRichInlineMark(
        commandId,
        richPickerValue.value,
        commandId === 'text.ruby' ? richPickerBase.value : undefined,
      )
      activeEditorCommandIds.value = result?.active === true ? new Set([commandId]) : new Set()
      await closeRichPicker(false)
      visualSurface.value?.focus()
    }
    commandFeedback.value = commandUiNotice('feedback.applied', commandId)
  } catch (error) {
    richPickerError.value = uiFailureNotice(error, 'feedback.validationDetail')
    richPickerPending.value = false
    await nextTick()
    richPickerInput.value?.focus()
  }
}

const referencePanelOpen = ref(false)
const referenceEntries = shallowRef<readonly DocumentReference[]>([])
const referenceSelected = ref<string | null>(null)
const referenceError = ref('')
const referenceBusy = ref(false)
const referenceCounts = shallowRef<Readonly<Record<string, number>>>({})
const referenceNotes = shallowRef<Readonly<Record<string, ReferenceNote>>>({})
const referenceNotesError = ref('')
const referenceNotesBusy = ref(false)
const referenceNotesLoading = ref(false)
const referenceSavedVersion = ref(0)
const referenceServices = props.referenceServices ?? createLocalReferenceServices(props.storage ?? window.localStorage)
let notesGeneration = 0
let referenceRefreshTimer: ReturnType<typeof setTimeout> | undefined
function assignReferences(entries: readonly DocumentReference[]): void {
  const counts: Record<string, number> = Object.create(null)
  for (const entry of entries) counts[entry.id] = (counts[entry.id] ?? 0) + 1
  referenceCounts.value = counts
  referenceEntries.value = [...new Map(entries.map(item => [item.id, item])).values()].sort((a, b) => a.number - b.number)
}
async function loadReferenceNotes(): Promise<void> {
  const generation = ++notesGeneration
  const documentId = activeRuntime.value.root.session.snapshot().documentId
  referenceNotesLoading.value = true
  referenceNotesBusy.value = false
  referenceNotesError.value = ''
  try {
    const notes = await referenceServices.loadNotes(documentId)
    if (generation === notesGeneration) referenceNotes.value = notes
  } catch (error) {
    if (generation === notesGeneration) referenceNotesError.value = error instanceof Error ? error.message : String(error)
  } finally { if (generation === notesGeneration) referenceNotesLoading.value = false }
}
async function saveReferenceNote(id: string, text: string): Promise<void> {
  if (referenceNotesBusy.value || referenceNotesLoading.value || referenceNotesError.value) return
  const generation = notesGeneration
  const documentId = activeRuntime.value.root.session.snapshot().documentId
  referenceNotesBusy.value = true
  try {
    const note = await referenceServices.saveNote(documentId, id, { text, revision: referenceNotes.value[id]?.revision ?? 0 })
    if (generation === notesGeneration) referenceNotes.value = { ...referenceNotes.value, [id]: note }
  } catch (error) {
    if (generation === notesGeneration) referenceNotesError.value = error instanceof Error ? error.message : String(error)
  } finally { if (generation === notesGeneration) referenceNotesBusy.value = false }
}
const lookupReferenceDoi = referenceServices.lookupDoi
  ? (doi: string, signal: AbortSignal) => referenceServices.lookupDoi!(activeRuntime.value.root.session.snapshot().documentId, doi, signal)
  : undefined
watch(() => workspace.value.activeDocument.markdown, () => {
  if (!referencePanelOpen.value || mode.value !== 'source') return
  clearTimeout(referenceRefreshTimer)
  referenceRefreshTimer = setTimeout(refreshReferences, 180)
})
watch(referencePanelOpen, open => { if (!open) clearTimeout(referenceRefreshTimer) })
watch(() => workspace.value.activeDocument.documentId, () => {
  referencePanelOpen.value = false
  notesGeneration++
  referenceNotes.value = {}
  referenceNotesBusy.value = false
  referenceNotesLoading.value = false
})
onBeforeUnmount(() => { clearTimeout(referenceRefreshTimer); notesGeneration++ })
function onReferenceChange(event: Event): void {
  if (referencePanelOpen.value) assignReferences((event as CustomEvent<{ references: readonly DocumentReference[] }>).detail.references)
}
let referenceContext: DedicatedEditorOpenContext | null = null
function refreshReferences(): void {
  const snapshot = activeRuntime.value.root.session.snapshot()
  assignReferences(scanReferences(snapshot.markdown))
}
async function openReferences(id: string | null = null): Promise<void> {
  try {
    await flushLifecycleSynchronization(activeRuntime.value)
    referenceContext = captureDedicatedEditorContext(null)
    referenceSelected.value = id
    referenceError.value = ''
    refreshReferences()
    referencePanelOpen.value = true
    void loadReferenceNotes()
    await nextTick()
    if (!id) workspaceShell.value?.querySelector<HTMLTextAreaElement>('#reference-input')?.focus()
  } catch (error) { referenceError.value = error instanceof Error ? error.message : String(error) }
}
function onReferenceOpen(event: Event): void {
  void openReferences((event as CustomEvent<{ id: string }>).detail.id)
}
function jumpToReference(id: string): void {
  const entry = [...(workspaceShell.value?.querySelectorAll<HTMLElement>('.w-reference-list p') ?? [])].find(item => item.id === `reference-${id}`)
  entry?.scrollIntoView({ block: 'center' })
}
async function insertReference(input: Pick<DocumentReference, 'text' | 'metadata' | 'style'>): Promise<void> {
  if (!referenceContext || referenceBusy.value) return
  referenceBusy.value = true
  referenceError.value = ''
  try {
    await flushLifecycleSynchronization(activeRuntime.value)
    assertDedicatedEditorContext(referenceContext)
    const snapshot = activeRuntime.value.root.session.snapshot()
    const registry = referenceRegistry(activeRuntime.value.root.session)
    registry.observe(scanReferences(snapshot.markdown))
    const reference = registry.adopt({ ...input, id: 'id' in input ? String(input.id) : createRandomId(), number: 1 })
    if (mode.value === 'source' && referenceContext.sourceSelection) {
      const { from, to } = referenceContext.sourceSelection
      const replacement = referenceMarkdown(reference)
      await applySourcePlan({ baseRevision: snapshot.revision, transactionId: `reference:${createRandomId()}`, patches: [{ codecId: 'reference', from, to, expected: snapshot.markdown.slice(from, to), replacement }] }, { from: from + replacement.length, to: from + replacement.length })
    } else {
      if (!visualSurface.value?.applyReference(reference).changed) throw new Error('当前光标位置无法插入引用。')
      await flushLifecycleSynchronization(activeRuntime.value)
      visualSurface.value?.focus()
    }
    refreshReferences()
    referencePanelOpen.value = false
  } catch (error) { referenceError.value = error instanceof Error ? error.message : String(error) }
  finally { referenceBusy.value = false }
}

async function mutateReference(action: (snapshot: ReturnType<typeof activeRuntime.value.root.session.snapshot>) => Promise<void>, acknowledge = false): Promise<void> {
  if (referenceBusy.value || props.readonlyMode) return
  referenceBusy.value = true
  referenceError.value = ''
  const runtime = activeRuntime.value
  try {
    await flushLifecycleSynchronization(runtime)
    if (runtime !== activeRuntime.value) throw new Error('文档已切换，请重新打开参考文献。')
    await action(runtime.root.session.snapshot())
    await flushLifecycleSynchronization(runtime)
    refreshReferences()
    referenceContext = captureDedicatedEditorContext(null)
    if (acknowledge) referenceSavedVersion.value++
  } catch (error) { referenceError.value = error instanceof Error ? error.message : String(error) }
  finally { referenceBusy.value = false }
}
function referenceContent(reference: DocumentReference): string {
  return JSON.stringify([reference.text, reference.metadata, reference.style])
}
async function updateReference(original: DocumentReference, input: Pick<DocumentReference, 'text' | 'metadata' | 'style'>): Promise<void> {
  await mutateReference(async snapshot => {
    const current = scanReferences(snapshot.markdown).find(item => item.id === original.id)
    if (!current || referenceContent(current) !== referenceContent(original)) throw new Error('这条文献已变化，请重新选择“修改”后保存。')
    if (mode.value === 'source') await applySourcePlan(updateReferencePlan(snapshot, original.id, input, `reference:${createRandomId()}`), sourceSelection())
    else if (!visualSurface.value?.updateReference(original.id, input).changed) throw new Error('没有找到可修改的引用。')
    referenceRegistry(activeRuntime.value.root.session).forget(original.id)
  }, true)
}
async function removeReference(id: string): Promise<void> {
  await mutateReference(async snapshot => {
    if (mode.value === 'source') await applySourcePlan(removeReferencePlan(snapshot, id, `reference:${createRandomId()}`), { from: 0, to: 0 })
    else if (!visualSurface.value?.removeReference(id).changed) throw new Error('没有找到可删除的引用。')
    referenceRegistry(activeRuntime.value.root.session).forget(id)
  })
}
async function setReferenceStyle(style: ReferenceStyle): Promise<void> {
  await mutateReference(async snapshot => {
    if (mode.value === 'source') {
      const entries = [...new Map(scanReferences(snapshot.markdown).map(item => [item.id, item])).values()]
      const patches = entries.flatMap(entry => updateReferencePlan(snapshot, entry.id, { text: entry.text, ...(entry.metadata ? { metadata: entry.metadata } : {}), style }, 'style').patches)
      await applySourcePlan({ baseRevision: snapshot.revision, transactionId: `reference-style:${createRandomId()}`, patches: patches.sort((a, b) => a.from - b.from) }, sourceSelection())
      for (const entry of entries) referenceRegistry(activeRuntime.value.root.session).forget(entry.id)
    } else visualSurface.value?.setReferenceStyle(style)
  })
}

async function openLinkDialog(): Promise<void> {
  linkDialogOpen.value = true
  activeRuntime.value.root.setModalActivity('link-picker')
  await nextTick()
  linkInput.value?.focus()
  linkInput.value?.select()
}

async function closeLinkDialog(restoreFocus = true): Promise<void> {
  linkDialogOpen.value = false
  activeRuntime.value.root.setModalActivity(null)
  await nextTick()
  if (restoreFocus) activeCommandTrigger.value?.focus()
}

async function applyLinkDialog(): Promise<void> {
  if (mode.value === 'source') {
    const selection = sourceSelection()
    if (sourceSurface.value === null || selection.from === selection.to) return
    const result = createLinkPlan(
      activeRuntime.value.root.session.snapshot(),
      selection,
      linkUrl.value,
      `source-command:insert.link:${createRandomId()}`,
    )
    await applySourcePlan(result.plan, result.selection)
    activeEditorCommandIds.value = new Set(['insert.link'])
    await closeLinkDialog(false)
    sourceSurface.value?.focus()
  } else if (mode.value === 'visual') {
    const result = visualSurface.value?.applyLink(linkUrl.value)
    activeEditorCommandIds.value = result?.active === true ? new Set(['insert.link']) : new Set()
    await closeLinkDialog(false)
    visualSurface.value?.focus()
  }
  commandFeedback.value = commandUiNotice('feedback.applied', 'insert.link')
}

async function openFormulaDialog(event?: VisualSemanticBlockSelection): Promise<void> {
  let existingSource: string | null = null
  formulaOpenedFromNode.value = event?.kind === 'formula'
  formulaReturnFocus.value = formulaOpenedFromNode.value
    ? null
    : activeCommandTrigger.value?.closest('[data-toolbar-menu]')?.querySelector<HTMLElement>('.toolbar-menu__trigger')
      ?? activeCommandTrigger.value

  if (mode.value === 'source') {
    const snapshot = activeRuntime.value.root.session.snapshot()
    const selection = sourceSelection()
    const selected = formulaAtSelection(snapshot.markdown, selection)
    if (selected !== null) {
      formulaContent.value = selected.content
      formulaMode.value = selected.mode
      existingSource = selected.source
      sourceSurface.value?.setSelection({ anchor: selected.from, head: selected.to })
    } else {
      formulaContent.value = 'E = mc^2'
      formulaMode.value = selection.from === selection.to ? 'block' : 'inline'
    }
  } else {
    const selected = event?.kind === 'formula' && event.formulaContent !== undefined && event.formulaMode !== undefined
      ? Object.freeze({ content: event.formulaContent, mode: event.formulaMode, source: event.source })
      : visualSurface.value?.selectedFormula() ?? null
    if (selected !== null) {
      formulaContent.value = selected.content
      formulaMode.value = selected.mode
      existingSource = selected.source
    } else {
      formulaContent.value = 'E = mc^2'
      formulaMode.value = 'block'
    }
  }
  formulaDraftError.value = null
  formulaDialogContext.value = captureDedicatedEditorContext(existingSource)
  formulaDialogOpen.value = true
  activeRuntime.value.root.setModalActivity('formula-editor')
}

async function closeFormulaDialog(): Promise<void> {
  const openedFromNode = formulaOpenedFromNode.value
  const returnFocus = formulaReturnFocus.value
  formulaDialogOpen.value = false
  formulaDraftError.value = null
  formulaDialogContext.value = null
  formulaReturnFocus.value = null
  formulaOpenedFromNode.value = false
  activeRuntime.value.root.setModalActivity(null)
  await nextTick()
  if (openedFromNode) await focusActiveSurface()
  else returnFocus?.focus()
}

async function applyFormulaDialog(): Promise<void> {
  formulaDraftError.value = null
  try {
    const context = formulaDialogContext.value
    if (context === null) throw uiError('feedback.dedicated.formulaContextUnavailable')
    formulaSource(formulaContent.value, formulaMode.value)
    assertDedicatedEditorContext(context)

    if (context.mode === 'source') {
      if (sourceSurface.value === null || context.sourceSelection === null) {
        throw uiError('feedback.dedicated.sourceFormulaUnavailable')
      }
      const result = createFormulaCommandPlan(
        activeRuntime.value.root.session.snapshot(),
        context.sourceSelection,
        formulaContent.value,
        `source-command:insert.formula:${createRandomId()}`,
        formulaMode.value,
      )
      await applySourcePlan(result.plan, result.selection)
    } else {
      const visual = visualSurface.value
      if (visual === null) throw uiError('feedback.dedicated.visualFormulaUnavailable')
      const currentSource = visual.selectedFormula()?.source ?? null
      if (context.existingSource !== null && currentSource !== context.existingSource) {
        throw uiError('feedback.dedicated.staleFormulaSelection')
      }
      const result = visual.applyFormula(formulaMode.value, formulaContent.value)
      if (!result.active || !result.changed) {
        throw uiError('feedback.dedicated.formulaUnavailable')
      }
      await activeRuntime.value.flushVisualSynchronization()
      const synchronization = activeRuntime.value.root.synchronization.snapshot()
      if (synchronization.status === 'failed') throw synchronization.failure
    }
    activeEditorCommandIds.value = new Set(['insert.formula'])
    commandFeedback.value = commandUiNotice('feedback.applied', 'insert.formula')
    await closeFormulaDialog()
  } catch (failure) {
    formulaDraftError.value = dedicatedEditorFailureMessage(failure)
  }
}

async function openCodeBlockDialog(): Promise<void> {
  const starter = parseFencedCodeAt(FENCED_CODE_STARTER, 0)
  let selected = null as ReturnType<typeof fencedCodeAtSelection>
  let existingSource: string | null = null
  if (mode.value === 'source') {
    selected = fencedCodeAtSelection(activeRuntime.value.root.session.snapshot().markdown, sourceSelection())
    existingSource = selected?.source ?? null
  } else if (mode.value === 'visual') {
    const visual = visualSurface.value?.selectedCodeBlock()
    if (visual?.kind === 'code-block') {
      codeDraftContent.value = visual.code ?? ''
      codeDraftLanguage.value = visual.language ?? ''
      existingSource = visual.source
    }
  }
  if (selected !== null) {
    codeDraftContent.value = selected.code
    codeDraftLanguage.value = selected.language
  } else if (mode.value !== 'visual' || visualSurface.value?.selectedCodeBlock()?.kind !== 'code-block') {
    codeDraftContent.value = starter?.code ?? ''
    codeDraftLanguage.value = starter?.language ?? 'javascript'
  }
  codeDraftError.value = null
  codeDialogContext.value = captureDedicatedEditorContext(existingSource)
  codeDialogOpen.value = true
  activeRuntime.value.root.setModalActivity('code-block-editor')
}

async function focusPreviewTask(index: number): Promise<void> {
  await nextTick()
  const controls = workspaceShell.value
    ?.querySelectorAll<HTMLInputElement>('.visual-surface[data-mode="preview"] input[type="checkbox"]')
  controls?.item(index)?.focus()
}

function commitPreviewTaskState(
  runtime: ArticleRuntime,
  index: number,
  checked: boolean,
  transactionKind: 'redo' | 'toggle' | 'undo',
): PreviewTaskHistoryEntry | null {
  const snapshot = runtime.root.session.snapshot()
  const marker = taskItemMarkers(snapshot.markdown)[index]
  if (marker === undefined) throw new RangeError(`Preview task item ${index} is stale.`)
  const plan = createTaskItemCheckedPlan(
    snapshot,
    index,
    checked,
    `author-preview-task:${transactionKind}:${createRandomId()}`,
  )
  if (plan === null) return null
  runtime.root.session.commitPatchPlan(plan, 'toolbar-command')
  runtime.root.synchronization.succeed(runtime.root.session.snapshot())
  runtime.modeSurfaces.refreshPreview(runtime.root.session.snapshot())
  return Object.freeze({ after: checked, before: marker.checked, index })
}

function handlePreviewTaskToggle(event: Readonly<{ checked: boolean; index: number }>): boolean {
  const runtime = activeRuntime.value
  try {
    const entry = commitPreviewTaskState(runtime, event.index, event.checked, 'toggle')
    if (entry === null) return false
    runtime.previewTaskHistory.undo.push(entry)
    runtime.previewTaskHistory.redo.length = 0
    void focusPreviewTask(event.index)
    return true
  } catch (failure) {
    commandFeedback.value = uiFailureNotice(failure, 'feedback.externalDetail')
    runtime.modeSurfaces.refreshPreview(runtime.root.session.snapshot())
    return false
  }
}

async function applyPreviewTaskHistory(direction: 'redo' | 'undo'): Promise<boolean> {
  const runtime = activeRuntime.value
  const source = direction === 'undo' ? runtime.previewTaskHistory.undo : runtime.previewTaskHistory.redo
  const destination = direction === 'undo' ? runtime.previewTaskHistory.redo : runtime.previewTaskHistory.undo
  const entry = source.at(-1)
  if (entry === undefined) return false
  const expectedCurrent = direction === 'undo' ? entry.after : entry.before
  const target = direction === 'undo' ? entry.before : entry.after
  const marker = taskItemMarkers(runtime.root.session.snapshot().markdown)[entry.index]
  if (marker?.checked !== expectedCurrent) {
    runtime.previewTaskHistory.undo.length = 0
    runtime.previewTaskHistory.redo.length = 0
    return false
  }
  try {
    if (commitPreviewTaskState(runtime, entry.index, target, direction) === null) return false
    source.pop()
    destination.push(entry)
    await focusPreviewTask(entry.index)
    return true
  } catch (failure) {
    commandFeedback.value = uiFailureNotice(failure, 'feedback.externalDetail')
    return false
  }
}

async function closeCodeBlockDialog(): Promise<void> {
  codeDialogOpen.value = false
  codeDraftError.value = null
  codeDialogContext.value = null
  activeRuntime.value.root.setModalActivity(null)
  await focusActiveSurface()
}

async function applyCodeBlockDialog(code: string, language = codeDraftLanguage.value): Promise<void> {
  codeDraftError.value = null
  try {
    const context = codeDialogContext.value
    if (context === null) throw uiError('feedback.dedicated.codeContextUnavailable')
    const source = serializeFencedCode(language, code)

    if (context.mode === 'visual') {
      const visual = visualSurface.value
      if (visual === null) throw uiError('feedback.dedicated.visualDraftUnavailable')
      const selectedSource = visual.selectedCodeBlock()?.source ?? null
      if (await resolveFailedVisualIntent(source, selectedSource)) {
        activeEditorCommandIds.value = new Set(['insert.code-block'])
        commandFeedback.value = commandUiNotice('feedback.applied', 'insert.code-block')
        await closeCodeBlockDialog()
        return
      }
    }

    assertDedicatedEditorContext(context)
    if (context.mode === 'visual') {
      const visual = visualSurface.value
      if (visual === null) throw uiError('feedback.dedicated.visualDraftUnavailable')
      const currentSource = visual.selectedCodeBlock()?.source ?? null
      if (context.existingSource !== null && currentSource !== context.existingSource) {
        throw uiError('feedback.dedicated.staleSelection')
      }
    }

    injectDedicatedEditorFailure('planning')
    if (context.mode === 'source') {
      if (sourceSurface.value === null) throw uiError('feedback.dedicated.sourceDraftUnavailable')
      const result = createCodeBlockCommandPlan(
        activeRuntime.value.root.session.snapshot(),
        sourceSelection(),
        language,
        code,
        `source-command:insert.code-block:${createRandomId()}`,
      )
      injectDedicatedEditorFailure('transaction')
      await applySourcePlan(result.plan, result.selection)
    } else {
      const visual = visualSurface.value
      if (visual === null) throw uiError('feedback.dedicated.visualDraftUnavailable')
      visual.setSelectedSemanticLocalError(null)
      injectDedicatedEditorFailure('transaction')
      const result = visual.applyCodeBlock(language.trim(), code, source)
      if (!result.active || !result.changed) {
        throw uiError('feedback.dedicated.codeUnavailable')
      }
      await activeRuntime.value.flushVisualSynchronization()
      const synchronization = activeRuntime.value.root.synchronization.snapshot()
      if (synchronization.status === 'failed') throw synchronization.failure
    }
    activeEditorCommandIds.value = new Set(['insert.code-block'])
    commandFeedback.value = commandUiNotice('feedback.applied', 'insert.code-block')
    await closeCodeBlockDialog()
  } catch (failure) {
    codeDraftError.value = dedicatedEditorFailureMessage(failure)
    visualSurface.value?.setSelectedSemanticLocalError(uiNoticeText(codeDraftError.value))
  }
}

function openMermaidDialog(event: VisualSemanticBlockSelection): void {
  mermaidDraftCode.value = event.code ?? ''
  mermaidDraftType.value = typeof event.diagramType === 'string'
    ? mermaidDescriptor(`mermaid.${event.diagramType}`)?.diagramType ?? null
    : null
  mermaidDraftError.value = null
  mermaidDialogOpen.value = true
  activeRuntime.value.root.setModalActivity('mermaid-editor')
}

async function closeMermaidDialog(): Promise<void> {
  mermaidDialogOpen.value = false
  mermaidDraftError.value = null
  activeRuntime.value.root.setModalActivity(null)
  await nextTick()
  visualSurface.value?.focus()
}

async function applyMermaidDialog(code: string): Promise<void> {
  let source: string
  try {
    source = mermaidSource(code)
  } catch (error) {
    mermaidDraftError.value = uiFailureNotice(error, 'feedback.validationDetail')
    return
  }
  const result = visualSurface.value?.applyMermaid(source, mermaidDraftType.value)
  if (result?.active !== true) {
    mermaidDraftError.value = uiNotice('feedback.nodeUnavailable', { kind: 'Mermaid' })
    return
  }
  activeEditorCommandIds.value = new Set([
    mermaidDraftType.value === null ? 'mermaid.source' : `mermaid.${mermaidDraftType.value}`,
  ])
  commandFeedback.value = localizedUiNotice('feedback.applied', { command: 'mermaid' }, { command: 'mermaid.source' })
  await closeMermaidDialog()
}

function openChartTableDialog(event: VisualSemanticBlockSelection): void {
  const parsed = parseChartTableAt(event.source, 0)
  if (parsed === null || parsed.sourceSpan.to !== event.source.length) {
    commandFeedback.value = uiNotice('chart.invalidSyntax')
    return
  }
  chartTableDraftType.value = parsed.chartType
  chartTableDraftColumns.value = parsed.columns
  chartTableDraftOptions.value = parsed.options
  chartTableDraftRows.value = parsed.rows
  chartTableDraftTitle.value = parsed.title
  chartTableDraftError.value = null
  chartTableDialogOpen.value = true
  activeRuntime.value.root.setModalActivity('chart-table-editor')
}

async function closeChartTableDialog(): Promise<void> {
  chartTableDialogOpen.value = false
  chartTableDraftError.value = null
  activeRuntime.value.root.setModalActivity(null)
  await nextTick()
  visualSurface.value?.focus()
}

async function applyChartTableDialog(draft: ChartTableDraft): Promise<void> {
  let source: string
  try {
    source = chartTableSource(draft)
  } catch (error) {
    chartTableDraftError.value = uiFailureNotice(error, 'feedback.validationDetail')
    return
  }
  const parsed = parseChartTableAt(source, 0)
  if (parsed === null || parsed.sourceSpan.to !== source.length) {
    chartTableDraftError.value = uiNotice('chart.invalidSyntax')
    return
  }
  const result = visualSurface.value?.applyChartTable(source)
  if (result?.active !== true) {
    chartTableDraftError.value = uiNotice('chart.noLongerSelected')
    return
  }
  activeEditorCommandIds.value = new Set([`chart.${parsed.chartType}`])
  commandFeedback.value = commandUiNotice('feedback.applied', `chart.${parsed.chartType}`)
  await closeChartTableDialog()
}

async function openMediaDialog(kind: MediaKind, event?: VisualSemanticBlockSelection): Promise<void> {
  let selected: Readonly<{ name: string; url: string }> | null = null
  if (event?.kind === 'media' && event.mediaKind === kind && event.name !== undefined && event.url !== undefined) {
    selected = Object.freeze({ name: event.name, url: event.url })
  } else if (mode.value === 'source') {
    const candidate = mediaAtSelection(activeRuntime.value.root.session.snapshot().markdown, sourceSelection())
    if (candidate?.kind === kind) selected = candidate
  } else if (mode.value === 'visual') {
    const candidate = visualSurface.value?.selectedMedia()
    if (candidate?.mediaKind === kind && candidate.name !== undefined && candidate.url !== undefined) {
      selected = Object.freeze({ name: candidate.name, url: candidate.url })
    }
  }
  mediaDialogKind.value = kind
  mediaDraftName.value = selected?.name ?? `${kind.charAt(0).toUpperCase()} asset`
  mediaDraftUrl.value = selected?.url ?? ''
  activeRuntime.value.root.setModalActivity('media-editor')
}

async function closeMediaDialog(): Promise<void> {
  mediaDialogKind.value = null
  mediaDraftName.value = ''
  mediaDraftUrl.value = ''
  activeRuntime.value.root.setModalActivity(null)
  await nextTick()
  if (mode.value === 'source') sourceSurface.value?.focus()
  else visualSurface.value?.focus()
}

async function applyMediaDialog(draft: AssetDraft): Promise<void> {
  if ((draft.kind !== 'image' && draft.kind !== 'audio' && draft.kind !== 'video') || draft.kind !== mediaDialogKind.value) return
  if (mode.value === 'source') {
    const result = createMediaCommandPlan(
      activeRuntime.value.root.session.snapshot(),
      sourceSelection(),
      draft.kind,
      draft.name,
      draft.url,
      `source-command:insert.${draft.kind}:${createRandomId()}`,
    )
    await applySourcePlan(result.plan, result.selection)
  } else if (mode.value === 'visual') {
    const source = mediaSource(draft.kind, draft.name, draft.url)
    const result = visualSurface.value?.applyMedia(source, draft.kind)
    if (result?.active !== true) {
      commandFeedback.value = localizedUiNotice('feedback.nodeUnavailable', { kind: draft.kind }, {
        kind: `media.kind.${draft.kind}` as UiMessageKey,
      })
      return
    }
  }
  activeEditorCommandIds.value = new Set([`insert.${draft.kind}`])
  commandFeedback.value = commandUiNotice('feedback.applied', `insert.${draft.kind}`)
  await closeMediaDialog()
}

async function openAttachmentDialog(kind: AttachmentKind, event?: VisualSemanticBlockSelection): Promise<void> {
  let selected: Readonly<{ mediaType: string; name: string; size: number; url: string }> | null = null
  if (event?.kind === 'attachment'
    && event.attachmentKind === kind
    && event.mediaType !== undefined
    && event.name !== undefined
    && event.size !== undefined
    && event.url !== undefined) {
    selected = Object.freeze({ mediaType: event.mediaType, name: event.name, size: event.size, url: event.url })
  } else if (mode.value === 'source') {
    const candidate = attachmentAtSelection(activeRuntime.value.root.session.snapshot().markdown, sourceSelection())
    if (candidate?.kind === kind) selected = candidate
  } else if (mode.value === 'visual') {
    const candidate = visualSurface.value?.selectedAttachment()
    if (candidate?.attachmentKind === kind
      && candidate.mediaType !== undefined
      && candidate.name !== undefined
      && candidate.size !== undefined
      && candidate.url !== undefined) {
      selected = Object.freeze({
        mediaType: candidate.mediaType,
        name: candidate.name,
        size: candidate.size,
        url: candidate.url,
      })
    }
  }
  attachmentDialogKind.value = kind
  attachmentDraftName.value = selected?.name ?? `${kind === 'pdf' ? 'PDF' : kind === 'word' ? 'Word document' : 'File'} attachment`
  attachmentDraftUrl.value = selected?.url ?? ''
  attachmentDraftMediaType.value = selected?.mediaType ?? ''
  attachmentDraftSize.value = selected?.size ?? 0
  activeRuntime.value.root.setModalActivity('attachment-editor')
}

async function closeAttachmentDialog(): Promise<void> {
  attachmentDialogKind.value = null
  attachmentDraftName.value = ''
  attachmentDraftUrl.value = ''
  attachmentDraftMediaType.value = ''
  attachmentDraftSize.value = 0
  activeRuntime.value.root.setModalActivity(null)
  await nextTick()
  if (mode.value === 'source') sourceSurface.value?.focus()
  else visualSurface.value?.focus()
}

async function applyAttachmentDialog(draft: AssetDraft): Promise<void> {
  if ((draft.kind !== 'pdf' && draft.kind !== 'word' && draft.kind !== 'file') || draft.kind !== attachmentDialogKind.value) return
  const attachment = Object.freeze({
    kind: draft.kind,
    mediaType: draft.mediaType,
    name: draft.name,
    size: draft.size,
    url: draft.url,
  })
  if (mode.value === 'source') {
    const result = createAttachmentCommandPlan(
      activeRuntime.value.root.session.snapshot(),
      sourceSelection(),
      attachment,
      `source-command:insert.${draft.kind}:${createRandomId()}`,
    )
    await applySourcePlan(result.plan, result.selection)
  } else if (mode.value === 'visual') {
    const source = attachmentSource(attachment)
    const result = visualSurface.value?.applyAttachment(source, draft.kind)
    if (result?.active !== true) {
      commandFeedback.value = localizedUiNotice('feedback.nodeUnavailable', { kind: draft.kind }, {
        kind: `media.kind.${draft.kind}` as UiMessageKey,
      })
      return
    }
  }
  activeEditorCommandIds.value = new Set([`insert.${draft.kind}`])
  commandFeedback.value = commandUiNotice('feedback.applied', `insert.${draft.kind}`)
  await closeAttachmentDialog()
}

const EMPTY_DRAWIO_XML = '<mxfile host="W-Editor"><diagram id="page-1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>'

async function openDrawioDialog(event?: VisualSemanticBlockSelection): Promise<void> {
  let selected: Readonly<{ name: string; xml: string }> | null = null
  if (event?.kind === 'drawio' && event.name !== undefined && event.xml !== undefined) {
    selected = Object.freeze({ name: event.name, xml: event.xml })
  } else if (mode.value === 'source') {
    const candidate = drawioAtSelection(activeRuntime.value.root.session.snapshot().markdown, sourceSelection())
    if (candidate !== null) selected = candidate
  } else if (mode.value === 'visual') {
    const candidate = visualSurface.value?.selectedDrawio()
    if (candidate?.name !== undefined && candidate.xml !== undefined) {
      selected = Object.freeze({ name: candidate.name, xml: candidate.xml })
    }
  }
  drawioName.value = selected?.name ?? 'draw.io diagram'
  drawioInitialXml.value = selected?.xml ?? EMPTY_DRAWIO_XML
  drawioRequestId.value = createRandomId()
  drawioDialogOpen.value = true
  activeRuntime.value.root.setModalActivity('drawio-editor')
  await nextTick()
}

async function closeDrawioDialog(): Promise<void> {
  drawioDialogOpen.value = false
  drawioUploadError.value = ''
  pendingDrawioPayload.value = null
  drawioName.value = 'draw.io diagram'
  drawioRequestId.value = ''
  activeRuntime.value.root.setModalActivity(null)
  await nextTick()
  if (mode.value === 'source') sourceSurface.value?.focus()
  else visualSurface.value?.focus()
}

async function acceptDrawioPayload(originalPayload: DrawioSavePayload): Promise<void> {
  if(drawioUploadBusy.value) return
  pendingDrawioPayload.value = originalPayload
  drawioUploadBusy.value = true
  let payload: Readonly<{png: string; xml: string}>
  try { payload = await props.persistDrawio?.(originalPayload) ?? originalPayload }
  catch (failure) {
    drawioUploadError.value = failure instanceof Error ? failure.message : 'Upload failed'
    return
  } finally { drawioUploadBusy.value = false }
  if (mode.value === 'source') {
    const result = createDrawioCommandPlan(
      activeRuntime.value.root.session.snapshot(),
      sourceSelection(),
      drawioName.value,
      payload.png,
      payload.xml,
      `source-command:insert.drawio:${createRandomId()}`,
    )
    await applySourcePlan(result.plan, result.selection)
  } else if (mode.value === 'visual') {
    const source = drawioSource(drawioName.value, payload.png, payload.xml)
    const result = visualSurface.value?.applyDrawio(source)
    if (result?.active !== true) {
      commandFeedback.value = uiNotice('feedback.nodeUnavailable', { kind: 'draw.io' })
      return
    }
  }
  activeEditorCommandIds.value = new Set(['insert.drawio'])
  commandFeedback.value = commandUiNotice('feedback.applied', 'insert.drawio')
  await closeDrawioDialog()
}

async function openPanelDialog(commandId: PanelCommandId): Promise<void> {
  const descriptor = panelDescriptor(commandId)
  if (descriptor === null) return
  let source: string | null = null
  if (mode.value === 'source') {
    const selected = panelAtSelection(activeRuntime.value.root.session.snapshot().markdown, sourceSelection())
    source = selected?.variant === descriptor.variant ? selected.source : null
  } else if (mode.value === 'visual') {
    source = visualSurface.value?.selectedPanelSource(descriptor.variant) ?? null
  }
  panelDialogCommand.value = commandId
  panelDraftSource.value = source ?? panelStarterSource(commandId)
  panelDraftError.value = null
  panelDialogContext.value = captureDedicatedEditorContext(source)
  activeRuntime.value.root.setModalActivity(`panel-editor:${descriptor.variant}`)
}

async function closePanelDialog(): Promise<void> {
  panelDialogCommand.value = null
  panelDraftError.value = null
  panelDialogContext.value = null
  activeRuntime.value.root.setModalActivity(null)
  await focusActiveSurface()
}

async function applyPanelDialog(): Promise<void> {
  const commandId = panelDialogCommand.value
  if (commandId === null) return
  panelDraftError.value = null
  try {
    const context = panelDialogContext.value
    if (context === null) throw uiError('feedback.dedicated.panelContextUnavailable')
    const validation = validatePanelSource(commandId, panelDraftSource.value)
    if (!validation.valid) {
      panelDraftError.value = validationUiNotice(validation.code, commandId)
      return
    }

    const descriptor = panelDescriptor(commandId)
    if (descriptor === null) throw uiError('feedback.dedicated.panelCommandUnavailable')
    if (context.mode === 'visual') {
      const visual = visualSurface.value
      if (visual === null) throw uiError('feedback.dedicated.visualDraftUnavailable')
      const selectedSource = visual.selectedPanelSource(descriptor.variant)
      if (await resolveFailedVisualIntent(panelDraftSource.value, selectedSource)) {
        activeEditorCommandIds.value = new Set([commandId])
        commandFeedback.value = commandUiNotice('feedback.applied', commandId)
        await closePanelDialog()
        return
      }
    }

    assertDedicatedEditorContext(context)
    if (context.mode === 'visual') {
      const visual = visualSurface.value
      if (visual === null) throw uiError('feedback.dedicated.visualDraftUnavailable')
      const currentSource = visual.selectedPanelSource(descriptor.variant)
      if (context.existingSource !== null && currentSource !== context.existingSource) {
        throw uiError('feedback.dedicated.staleSelection')
      }
    }

    injectDedicatedEditorFailure('planning')
    if (context.mode === 'source') {
      if (sourceSurface.value === null) throw uiError('feedback.dedicated.sourceDraftUnavailable')
      const result = createPanelCommandPlan(
        activeRuntime.value.root.session.snapshot(),
        sourceSelection(),
        commandId,
        `source-command:${commandId}:${createRandomId()}`,
        panelDraftSource.value,
      )
      injectDedicatedEditorFailure('transaction')
      await applySourcePlan(result.plan, result.selection)
    } else {
      const visual = visualSurface.value
      if (visual === null) throw uiError('feedback.dedicated.visualDraftUnavailable')
      injectDedicatedEditorFailure('transaction')
      const result = visual.applyPanel(panelDraftSource.value)
      if (!result.active || !result.changed) {
        throw uiError('feedback.dedicated.panelUnavailable')
      }
      await activeRuntime.value.flushVisualSynchronization()
      const synchronization = activeRuntime.value.root.synchronization.snapshot()
      if (synchronization.status === 'failed') throw synchronization.failure
    }
    activeEditorCommandIds.value = new Set([commandId])
    commandFeedback.value = commandUiNotice('feedback.applied', commandId)
    await closePanelDialog()
  } catch (failure) {
    panelDraftError.value = dedicatedEditorFailureMessage(failure)
  }
}

async function openColumnLayoutDialog(commandId: ColumnLayoutCommandId): Promise<void> {
  const kind: ColumnLayoutKind = commandId === 'layout.two-column' ? 'two-column' : 'multi-column'
  let source: string | null = null
  if (mode.value === 'source') {
    const selected = columnLayoutAtSelection(activeRuntime.value.root.session.snapshot().markdown, sourceSelection())
    source = selected?.kind === kind ? selected.source : null
  } else if (mode.value === 'visual') {
    source = visualSurface.value?.selectedColumnLayoutSource(kind) ?? null
  }
  columnLayoutDialogCommand.value = commandId
  columnLayoutDraftSource.value = source ?? columnLayoutStarterSource(commandId)
  columnLayoutDraftError.value = null
  activeRuntime.value.root.setModalActivity(`column-layout-editor:${kind}`)
}

async function closeColumnLayoutDialog(restoreFocus = true): Promise<void> {
  columnLayoutDialogCommand.value = null
  columnLayoutDraftError.value = null
  activeRuntime.value.root.setModalActivity(null)
  await nextTick()
  if (restoreFocus) activeCommandTrigger.value?.focus()
}

async function applyColumnLayoutDialog(): Promise<void> {
  const commandId = columnLayoutDialogCommand.value
  if (commandId === null) return
  const validation = validateColumnLayoutSource(commandId, columnLayoutDraftSource.value)
  if (!validation.valid) {
    columnLayoutDraftError.value = validationUiNotice(validation.code, commandId)
    return
  }
  if (mode.value === 'source') {
    const result = createColumnLayoutCommandPlan(
      activeRuntime.value.root.session.snapshot(),
      sourceSelection(),
      commandId,
      `source-command:${commandId}:${createRandomId()}`,
      columnLayoutDraftSource.value,
    )
    await applySourcePlan(result.plan, result.selection)
  } else if (mode.value === 'visual') {
    visualSurface.value?.applyColumnLayout(columnLayoutDraftSource.value)
  }
  activeEditorCommandIds.value = new Set([commandId])
  commandFeedback.value = commandUiNotice('feedback.applied', commandId)
  await closeColumnLayoutDialog(false)
  if (mode.value === 'source') sourceSurface.value?.focus()
  else visualSurface.value?.focus()
}

async function openDisclosureDialog(commandId: DisclosureCommandId): Promise<void> {
  const kind = commandId === 'layout.tabs' ? 'tabs' : 'accordion'
  let source: string | null = null
  if (mode.value === 'source') {
    source = disclosureAtSelection(
      activeRuntime.value.root.session.snapshot().markdown,
      sourceSelection(),
    )?.source ?? null
  } else if (mode.value === 'visual') {
    source = visualSurface.value?.selectedDisclosureSource(kind) ?? null
  }
  disclosureDialogCommand.value = commandId
  disclosureDraftSource.value = source ?? disclosureStarterSource(commandId)
  disclosureDraftError.value = null
  activeRuntime.value.root.setModalActivity(`disclosure-editor:${kind}`)
}

async function closeDisclosureDialog(restoreFocus = true): Promise<void> {
  disclosureDialogCommand.value = null
  disclosureDraftError.value = null
  activeRuntime.value.root.setModalActivity(null)
  await nextTick()
  if (restoreFocus) activeCommandTrigger.value?.focus()
}

async function applyDisclosureDialog(): Promise<void> {
  const commandId = disclosureDialogCommand.value
  if (commandId === null) return
  const validation = validateDisclosureSource(commandId, disclosureDraftSource.value)
  if (!validation.valid) {
    disclosureDraftError.value = validationUiNotice(validation.code, commandId)
    return
  }
  if (mode.value === 'source') {
    const result = createDisclosureCommandPlan(
      activeRuntime.value.root.session.snapshot(),
      sourceSelection(),
      commandId,
      disclosureDraftSource.value,
      `source-command:${commandId}:${createRandomId()}`,
    )
    await applySourcePlan(result.plan, result.selection)
  } else if (mode.value === 'visual') {
    visualSurface.value?.applyDisclosure(disclosureDraftSource.value)
  }
  activeEditorCommandIds.value = new Set([commandId])
  commandFeedback.value = commandUiNotice('feedback.applied', commandId)
  await closeDisclosureDialog(false)
  if (mode.value === 'source') sourceSurface.value?.focus()
  else visualSurface.value?.focus()
}

async function openTimelineDialog(): Promise<void> {
  let source: string | null = null
  if (mode.value === 'source') {
    source = timelineAtSelection(
      activeRuntime.value.root.session.snapshot().markdown,
      sourceSelection(),
    )?.source ?? null
  } else if (mode.value === 'visual') {
    source = visualSurface.value?.selectedTimelineSource() ?? null
  }
  timelineDraftSource.value = source ?? timelineStarterSource()
  timelineDraftError.value = null
  timelineDialogOpen.value = true
  activeRuntime.value.root.setModalActivity('timeline-editor')
}

async function closeTimelineDialog(restoreFocus = true): Promise<void> {
  timelineDialogOpen.value = false
  timelineDraftError.value = null
  activeRuntime.value.root.setModalActivity(null)
  await nextTick()
  if (restoreFocus) activeCommandTrigger.value?.focus()
}

async function applyTimelineDialog(): Promise<void> {
  const validation = validateTimelineSource(timelineDraftSource.value)
  if (!validation.valid) {
    timelineDraftError.value = validationUiNotice(validation.code, 'layout.timeline')
    return
  }
  if (mode.value === 'source') {
    const result = createTimelineCommandPlan(
      activeRuntime.value.root.session.snapshot(),
      sourceSelection(),
      timelineDraftSource.value,
      `source-command:layout.timeline:${createRandomId()}`,
    )
    await applySourcePlan(result.plan, result.selection)
  } else if (mode.value === 'visual') {
    visualSurface.value?.applyTimeline(timelineDraftSource.value)
  }
  activeEditorCommandIds.value = new Set(['layout.timeline'])
  commandFeedback.value = commandUiNotice('feedback.applied', 'layout.timeline')
  await closeTimelineDialog(false)
  if (mode.value === 'source') sourceSurface.value?.focus()
  else visualSurface.value?.focus()
}

const passiveEditorDispatcher = Object.freeze({
  execute: (commandId: string) => Object.freeze({
    changed: false,
    commandId,
    detail: 'feedback.completed',
    semanticOutcome: `cherry:${commandId}`,
  }),
})

function mediaKindForCommand(commandId: string): MediaKind | null {
  if (commandId === 'insert.image') return 'image'
  if (commandId === 'insert.audio') return 'audio'
  if (commandId === 'insert.video') return 'video'
  return null
}

function attachmentKindForCommand(commandId: string): AttachmentKind | null {
  if (commandId === 'insert.pdf') return 'pdf'
  if (commandId === 'insert.word') return 'word'
  if (commandId === 'insert.file') return 'file'
  return null
}

const sourceEditorDispatcher = Object.freeze({
  execute: async (commandId: string) => {
    const source = sourceSurface.value
    if (source === null) return passiveEditorDispatcher.execute(commandId)
    if (commandId === 'history.undo' || commandId === 'history.redo') {
      const changed = commandId === 'history.undo' ? source.undo() : source.redo()
      if (changed) activeRuntime.value.root.synchronization.succeed(activeRuntime.value.root.session.snapshot())
      return Object.freeze({
        changed,
        commandId,
        detail: changed ? 'feedback.completed' : 'feedback.noChange',
        semanticOutcome: `cherry:${commandId}`,
      })
    }
    if (commandId === 'insert.drawio') {
      await openDrawioDialog()
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `cherry:${commandId}` })
    }
    const spec = inlineMarkSpec(commandId)
    const richSpec = richInlineMarkSpec(commandId)
    const level = headingLevel(commandId)
    const listKind = listCommandKind(commandId)
    const alignmentCommand = commandId.startsWith('align.') ? commandId as AlignmentCommandId : null
    const disclosureCommand = commandId === 'layout.tabs' || commandId === 'layout.accordion'
      ? commandId as DisclosureCommandId
      : null
    const panelCommand = panelDescriptor(commandId)?.commandId ?? null
    const mermaidCommand = mermaidDescriptor(commandId)?.commandId ?? null
    const chartTableCommand = chartTableDescriptor(commandId)?.commandId ?? null
    const mediaKind = mediaKindForCommand(commandId)
    const attachmentKind = attachmentKindForCommand(commandId)
    const columnLayoutCommand = commandId === 'layout.two-column' || commandId === 'layout.multi-column'
      ? commandId as ColumnLayoutCommandId
      : null
    const blockquoteCommand = commandId === 'block.quote'
    const timelineCommand = commandId === 'layout.timeline'
    const simpleInsert = commandId === 'insert.hard-break'
      || commandId === 'insert.code-block'
      || commandId === 'insert.horizontal-rule'
      || commandId === 'insert.inline-code'
      || commandId === 'insert.link'
      || commandId === 'insert.table'
      || commandId === 'insert.formula'
      || commandId === 'insert.toc'
    if (spec === null && richSpec === null && level === null && listKind === null && alignmentCommand === null && disclosureCommand === null && panelCommand === null && mermaidCommand === null && chartTableCommand === null && mediaKind === null && attachmentKind === null && columnLayoutCommand === null && !blockquoteCommand && !timelineCommand && !simpleInsert) return passiveEditorDispatcher.execute(commandId)
    const selection = sourceSelection()
    const snapshot = activeRuntime.value.root.session.snapshot()
    if (mermaidCommand !== null) {
      const result = createMermaidCommandPlan(
        snapshot,
        selection,
        mermaidCommand,
        `source-command:${commandId}:${createRandomId()}`,
      )
      await applySourcePlan(result.plan, result.selection)
      return Object.freeze({ changed: true, commandId, detail: 'feedback.inserted', semanticOutcome: `cherry:${commandId}` })
    }
    if (chartTableCommand !== null) {
      const result = createChartTableCommandPlan(
        snapshot,
        selection,
        chartTableCommand,
        `source-command:${commandId}:${createRandomId()}`,
      )
      await applySourcePlan(result.plan, result.selection)
      return Object.freeze({ changed: true, commandId, detail: 'feedback.inserted', semanticOutcome: `cherry:${commandId}` })
    }
    if (mediaKind !== null) {
      await openMediaDialog(mediaKind)
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `cherry:${commandId}` })
    }
    if (attachmentKind !== null) {
      await openAttachmentDialog(attachmentKind)
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `cherry:${commandId}` })
    }
    if (panelCommand !== null) {
      await openPanelDialog(panelCommand)
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `cherry:${commandId}` })
    }
    if (columnLayoutCommand !== null) {
      await openColumnLayoutDialog(columnLayoutCommand)
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `cherry:${commandId}` })
    }
    if (timelineCommand) {
      await openTimelineDialog()
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `cherry:${commandId}` })
    }
    if (disclosureCommand !== null) {
      await openDisclosureDialog(disclosureCommand)
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `cherry:${commandId}` })
    }
    if (alignmentCommand !== null) {
      if (!sourceAlignmentCompatible(snapshot.markdown, selection)) {
        return Object.freeze({
          changed: false,
          commandId,
          detail: 'status.alignmentUnavailable',
          semanticOutcome: `cherry:${commandId}`,
        })
      }
      const result = createAlignmentCommandPlan(
        snapshot,
        selection,
        alignmentCommand,
        `source-command:${commandId}:${createRandomId()}`,
      )
      await applySourcePlan(result.plan, result.selection)
      activeEditorCommandIds.value = new Set([commandId])
      return Object.freeze({
        changed: true,
        commandId,
        detail: 'feedback.applied',
        semanticOutcome: `cherry:${commandId}`,
      })
    }
    if (blockquoteCommand) {
      const changed = source.quoteSelectedSource()
      return Object.freeze({
        changed,
        commandId,
        detail: changed ? 'feedback.applied' : 'status.selectSourceText',
        semanticOutcome: `cherry:${commandId}`,
      })
    }
    if (commandId === 'insert.formula') {
      await openFormulaDialog()
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `cherry:${commandId}` })
    }
    if (commandId === 'insert.code-block') {
      await openCodeBlockDialog()
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `cherry:${commandId}` })
    }
    if (commandId === 'insert.hard-break') {
      const result = createHardBreakPlan(snapshot, selection.from, `source-command:${commandId}:${createRandomId()}`)
      await applySourcePlan(result.plan, result.selection)
      return Object.freeze({ changed: true, commandId, detail: 'feedback.inserted', semanticOutcome: `cherry:${commandId}` })
    }
    if (commandId === 'insert.horizontal-rule') {
      const result = createBlockInsertionPlan(snapshot, selection.from, commandId, `source-command:${commandId}:${createRandomId()}`)
      await applySourcePlan(result.plan, result.selection)
      return Object.freeze({ changed: true, commandId, detail: 'feedback.inserted', semanticOutcome: `cherry:${commandId}` })
    }
    if (commandId === 'insert.toc') {
      const decision = createTocInsertionDecision(snapshot, selection.from, `source-command:${commandId}:${createRandomId()}`)
      if (decision.kind === 'existing') {
        sourceSurface.value?.setSelection({ anchor: decision.selection.from, head: decision.selection.to })
        sourceSurface.value?.focus()
        pendingVisualTocSelection.value = Object.freeze({
          documentId: snapshot.documentId,
          revision: snapshot.revision,
          selection: Object.freeze({
            from: decision.selection.from,
            to: decision.selection.to,
          }),
        })
        return Object.freeze({ changed: false, commandId, detail: 'toc.alreadyExists', semanticOutcome: `cherry:${commandId}` })
      }
      await applySourcePlan(decision.plan, decision.selection)
      return Object.freeze({ changed: true, commandId, detail: 'toc.inserted', semanticOutcome: `cherry:${commandId}` })
    }
    if (commandId === 'insert.table') {
      await openTableDimensionPicker()
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `cherry:${commandId}` })
    }
    if (listKind !== null) {
      const result = createListCommandPlan(
        snapshot,
        selection,
        listKind,
        `source-command:${commandId}:${createRandomId()}`,
      )
      await applySourcePlan(result.plan, result.selection)
      activeEditorCommandIds.value = new Set([commandId])
      return Object.freeze({
        changed: true,
        commandId,
        detail: 'feedback.applied',
        semanticOutcome: `cherry:${commandId}`,
      })
    }
    if (level !== null) {
      const result = createHeadingCommandPlan(
        snapshot,
        selection,
        commandId as HeadingCommandId,
        `source-command:${commandId}:${createRandomId()}`,
      )
      await applySourcePlan(result.plan, result.selection)
      activeEditorCommandIds.value = result.active ? new Set([commandId]) : new Set()
      return Object.freeze({
        changed: true,
        commandId,
        detail: result.active ? 'feedback.applied' : 'feedback.removed',
        semanticOutcome: `cherry:${commandId}`,
      })
    }
    if (selection.from === selection.to) {
      return Object.freeze({
        changed: false,
        commandId,
        detail: 'status.selectSourceText',
        semanticOutcome: `cherry:${commandId}`,
      })
    }
    if (commandId === 'insert.link') {
      await openLinkDialog()
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `cherry:${commandId}` })
    }
    if (commandId === 'insert.inline-code') {
      const result = createInlineCodePlan(
        snapshot,
        selection,
        `source-command:${commandId}:${createRandomId()}`,
      )
      await applySourcePlan(result.plan, result.selection)
      activeEditorCommandIds.value = new Set([commandId])
      return Object.freeze({ changed: true, commandId, detail: 'feedback.applied', semanticOutcome: `cherry:${commandId}` })
    }
    if (richSpec !== null) {
      await openRichPicker(richSpec.commandId)
      return Object.freeze({
        changed: false,
        commandId,
        detail: 'feedback.editorOpened',
        semanticOutcome: `cherry:${commandId}`,
      })
    }
    if (spec === null) return passiveEditorDispatcher.execute(commandId)
    const toggle = createInlineMarkTogglePlan(
      snapshot,
      selection,
      spec.commandId,
      `source-command:${commandId}:${createRandomId()}`,
    )
    await applySourcePlan(toggle.plan, toggle.selection)
    activeEditorCommandIds.value = toggle.active ? new Set([commandId]) : new Set()
    return Object.freeze({
      changed: true,
      commandId,
      detail: toggle.active ? 'feedback.applied' : 'feedback.removed',
      semanticOutcome: `cherry:${commandId}`,
    })
  },
})

const visualEditorDispatcher = Object.freeze({
  execute: async (commandId: string) => {
    const visual = visualSurface.value
    if (visual === null) return passiveEditorDispatcher.execute(commandId)
    if (commandId === 'history.undo' || commandId === 'history.redo') {
      await activeRuntime.value.flushVisualSynchronization()
      const changed = commandId === 'history.undo' ? visual.undo() : visual.redo()
      if (changed) await activeRuntime.value.flushVisualSynchronization()
      return Object.freeze({
        changed,
        commandId,
        detail: changed ? 'feedback.completed' : 'feedback.noChange',
        semanticOutcome: `cherry:${commandId}`,
      })
    }
    if (commandId === 'insert.drawio') {
      await openDrawioDialog()
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `cherry:${commandId}` })
    }
    const spec = inlineMarkSpec(commandId)
    const richSpec = richInlineMarkSpec(commandId)
    const level = headingLevel(commandId)
    const listKind = listCommandKind(commandId)
    const alignmentCommand = commandId.startsWith('align.') ? commandId as AlignmentCommandId : null
    const disclosureCommand = commandId === 'layout.tabs' || commandId === 'layout.accordion'
      ? commandId as DisclosureCommandId
      : null
    const panelCommand = panelDescriptor(commandId)?.commandId ?? null
    const mermaidCommand = mermaidDescriptor(commandId)?.commandId ?? null
    const chartTableCommand = chartTableDescriptor(commandId)?.commandId ?? null
    const mediaKind = mediaKindForCommand(commandId)
    const attachmentKind = attachmentKindForCommand(commandId)
    const columnLayoutCommand = commandId === 'layout.two-column' || commandId === 'layout.multi-column'
      ? commandId as ColumnLayoutCommandId
      : null
    if (mermaidCommand !== null) {
      const result = visual.applyMermaid(mermaidStarterSource(mermaidCommand))
      return Object.freeze({
        changed: result.changed,
        commandId,
        detail: 'feedback.inserted',
        semanticOutcome: `cherry:${commandId}`,
      })
    }
    if (chartTableCommand !== null) {
      const result = visual.applyChartTable(chartTableStarterSource(chartTableCommand))
      return Object.freeze({
        changed: result.changed,
        commandId,
        detail: 'feedback.inserted',
        semanticOutcome: `cherry:${commandId}`,
      })
    }
    if (mediaKind !== null) {
      await openMediaDialog(mediaKind)
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `cherry:${commandId}` })
    }
    if (attachmentKind !== null) {
      await openAttachmentDialog(attachmentKind)
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `cherry:${commandId}` })
    }
    if (panelCommand !== null) {
      await openPanelDialog(panelCommand)
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `cherry:${commandId}` })
    }
    if (columnLayoutCommand !== null) {
      await openColumnLayoutDialog(columnLayoutCommand)
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `cherry:${commandId}` })
    }
    if (disclosureCommand !== null) {
      await openDisclosureDialog(disclosureCommand)
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `cherry:${commandId}` })
    }
    if (commandId === 'layout.timeline') {
      await openTimelineDialog()
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `cherry:${commandId}` })
    }
    if (alignmentCommand !== null) {
      const result = visual.applyAlignment(alignmentCommand)
      activeEditorCommandIds.value = result.active ? new Set([commandId]) : new Set()
      return Object.freeze({
        changed: result.changed,
        commandId,
        detail: result.changed ? 'feedback.applied' : 'status.alignmentUnavailable',
        semanticOutcome: `cherry:${commandId}`,
      })
    }
    if (commandId === 'insert.formula') {
      await openFormulaDialog()
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `cherry:${commandId}` })
    }
    if (commandId === 'insert.code-block') {
      await openCodeBlockDialog()
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `cherry:${commandId}` })
    }
    if (commandId === 'insert.link') {
      await openLinkDialog()
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `cherry:${commandId}` })
    }
    if (commandId === 'insert.inline-code') {
      const result = visual.toggleInlineCode()
      activeEditorCommandIds.value = result.active ? new Set([commandId]) : new Set()
      return Object.freeze({ changed: result.changed, commandId, detail: 'feedback.applied', semanticOutcome: `cherry:${commandId}` })
    }
    if (commandId === 'insert.hard-break') {
      const result = visual.insertHardBreak()
      return Object.freeze({ changed: result.changed, commandId, detail: 'feedback.inserted', semanticOutcome: `cherry:${commandId}` })
    }
    if (commandId === 'insert.horizontal-rule' || commandId === 'insert.toc') {
      const result = visual.insertSimpleBlock(commandId)
      return Object.freeze({
        changed: result.changed,
        commandId,
        detail: commandId === 'insert.toc'
          ? result.changed ? 'toc.inserted' : 'toc.alreadyExists'
          : 'feedback.inserted',
        semanticOutcome: `cherry:${commandId}`,
      })
    }
    if (commandId === 'insert.table') {
      await openTableDimensionPicker()
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `cherry:${commandId}` })
    }
    if (commandId === 'block.quote') {
      const result = visual.applyBlockquote()
      return Object.freeze({
        changed: result.changed,
        commandId,
        detail: result.changed ? 'feedback.applied' : 'feedback.noChange',
        semanticOutcome: `cherry:${commandId}`,
      })
    }
    if (listKind !== null) {
      const result = visual.applyList(listKind)
      activeEditorCommandIds.value = result.active ? new Set([commandId]) : new Set()
      return Object.freeze({
        changed: result.changed,
        commandId,
        detail: 'feedback.applied',
        semanticOutcome: `cherry:${commandId}`,
      })
    }
    if (level !== null) {
      const result = visual.applyHeading(commandId as HeadingCommandId)
      activeEditorCommandIds.value = result.active ? new Set([commandId]) : new Set()
      return Object.freeze({
        changed: result.changed,
        commandId,
        detail: result.active ? 'feedback.applied' : 'feedback.removed',
        semanticOutcome: `cherry:${commandId}`,
      })
    }
    if (richSpec !== null) {
      await openRichPicker(richSpec.commandId)
      return Object.freeze({
        changed: false,
        commandId,
        detail: 'feedback.editorOpened',
        semanticOutcome: `cherry:${commandId}`,
      })
    }
    if (spec === null) return passiveEditorDispatcher.execute(commandId)
    const result = visual.executeInlineMark(spec.commandId)
    activeEditorCommandIds.value = result.active ? new Set([commandId]) : new Set()
    return Object.freeze({
      changed: result.changed,
      commandId,
      detail: result.changed
        ? result.active ? 'feedback.applied' : 'feedback.removed'
        : 'feedback.noChange',
      semanticOutcome: `cherry:${commandId}`,
    })
  },
})

const applicationDispatcher = Object.freeze({
  execute: async (commandId: string): Promise<Readonly<{ changed: boolean; commandId: string; detail?: string; semanticOutcome: string }>> => {
    if (commandId === 'document.manual-save') {
      await saveManualVersion()
      commandFeedback.value = commandUiNotice('feedback.completed', commandId)
      return Object.freeze({ changed: false, commandId, detail: uiNoticeText(commandFeedback.value)!, semanticOutcome: `application:${commandId}` })
    }
    if (commandId === 'search.replace') {
      await openSearch()
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `application:${commandId}` })
    }
    if (commandId === 'settings.shortcuts') {
      await openShortcutSettings()
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `application:${commandId}` })
    }
    if (commandId === 'application.fullscreen') {
      if (fullscreenController === null) {
        fullscreenError.value = uiNotice('status.fullscreenUnavailable')
        commandFeedback.value = fullscreenError.value
        return Object.freeze({ changed: false, commandId, detail: uiNoticeText(fullscreenError.value)!, semanticOutcome: `application:${commandId}` })
      }
      try {
        const state = await fullscreenController.toggle()
        fullscreenError.value = null
        commandFeedback.value = uiNotice(state.active ? 'feedback.fullscreenEntered' : 'feedback.fullscreenExited')
        return Object.freeze({
          changed: false,
          commandId,
          detail: uiNoticeText(commandFeedback.value)!,
          semanticOutcome: `application:${commandId}`,
        })
      } catch (error) {
        fullscreenError.value = uiFailureNotice(error, 'feedback.fullscreenDetail')
        commandFeedback.value = fullscreenError.value
        return Object.freeze({ changed: false, commandId, detail: uiNoticeText(fullscreenError.value)!, semanticOutcome: `application:${commandId}` })
      }
    }
    if (commandId === 'document.word-count') {
      await openWordCount()
      return Object.freeze({ changed: false, commandId, detail: 'feedback.editorOpened', semanticOutcome: `application:${commandId}` })
    }
    if (commandId === 'export.markdown') {
      try {
        const snapshot = await flushAuthoritativeSnapshotForUtility()
        await writeExportArtifact(createMarkdownExport(snapshot))
        exportError.value = null
        commandFeedback.value = uiNotice('export.markdownDownloaded', { revision: snapshot.revision })
        return Object.freeze({
          changed: false,
          commandId,
          detail: uiNoticeText(commandFeedback.value)!,
          semanticOutcome: `application:${commandId}`,
        })
      } catch (error) {
        exportError.value = uiFailureNotice(error, 'feedback.exportDetail')
        commandFeedback.value = exportError.value
        return Object.freeze({ changed: false, commandId, detail: uiNoticeText(exportError.value)!, semanticOutcome: `application:${commandId}` })
      }
    }
    if (commandId === 'export.html' || commandId === 'export.word') {
      try {
        const snapshot = await flushAuthoritativeSnapshotForUtility()
        const rendered = createTiptapRenderedExportDocument(snapshot, {
          lineHeight: lineSpacingValue.value,
          locale: toolbarLocale.value,
          localization: uiLocalization,
          theme: appearanceTheme.value,
        })
        const materialized = await materializeRenderedExportDocument(
          rendered,
          workspaceShell.value?.ownerDocument ?? document,
        )
        const artifacts = createHtmlDerivedExportArtifacts(materialized)
        await writeExportArtifact(commandId === 'export.html' ? artifacts.html : artifacts.word)
        exportError.value = null
        commandFeedback.value = uiNotice('export.renderedDownloaded', {
          format: commandId === 'export.html' ? 'HTML' : 'Word',
          revision: snapshot.revision,
        })
        return Object.freeze({
          changed: false,
          commandId,
          detail: uiNoticeText(commandFeedback.value)!,
          semanticOutcome: `application:${commandId}`,
        })
      } catch (error) {
        exportError.value = uiFailureNotice(error, 'feedback.exportDetail')
        commandFeedback.value = exportError.value
        return Object.freeze({ changed: false, commandId, detail: uiNoticeText(exportError.value)!, semanticOutcome: `application:${commandId}` })
      }
    }
    if (commandId === 'export.pdf') {
      try {
        const snapshot = await flushAuthoritativeSnapshotForUtility()
        const rendered = createTiptapRenderedExportDocument(snapshot, {
          lineHeight: lineSpacingValue.value,
          locale: toolbarLocale.value,
          localization: uiLocalization,
          theme: appearanceTheme.value,
        })
        const artifact = await renderedExportAdapter.capturePdf(rendered)
        await writeExportArtifact(artifact)
        exportError.value = null
        commandFeedback.value = artifact.omittedRemoteImageCount > 0
          ? uiNotice('export.pdfDownloadedWithOmittedRemoteImages', {
              count: artifact.omittedRemoteImageCount,
              revision: snapshot.revision,
            })
          : uiNotice('export.pdfDownloaded', { revision: snapshot.revision })
        return Object.freeze({
          changed: false,
          commandId,
          detail: uiNoticeText(commandFeedback.value)!,
          semanticOutcome: `application:${commandId}`,
        })
      } catch (error) {
        exportError.value = uiFailureNotice(error, 'feedback.exportDetail')
        commandFeedback.value = exportError.value
        return Object.freeze({ changed: false, commandId, detail: uiNoticeText(exportError.value)!, semanticOutcome: `application:${commandId}` })
      }
    }
    if (commandId === 'export.screenshot') {
      try {
        const snapshot = await flushAuthoritativeSnapshotForUtility()
        const rendered = createTiptapRenderedExportDocument(snapshot, {
          lineHeight: lineSpacingValue.value,
          locale: toolbarLocale.value,
          localization: uiLocalization,
          theme: appearanceTheme.value,
        })
        const artifact = await renderedExportAdapter.captureLongScreenshot(rendered)
        await writeExportArtifact(artifact)
        exportError.value = null
        commandFeedback.value = artifact.omittedRemoteImageCount > 0
          ? uiNotice('export.screenshotDownloadedWithOmittedRemoteImages', {
              count: artifact.omittedRemoteImageCount,
              revision: snapshot.revision,
            })
          : uiNotice('export.screenshotDownloaded', { revision: snapshot.revision })
        return Object.freeze({
          changed: false,
          commandId,
          detail: uiNoticeText(commandFeedback.value)!,
          semanticOutcome: `application:${commandId}`,
        })
      } catch (error) {
        exportError.value = uiFailureNotice(error, 'feedback.exportDetail')
        commandFeedback.value = exportError.value
        return Object.freeze({ changed: false, commandId, detail: uiNoticeText(exportError.value)!, semanticOutcome: `application:${commandId}` })
      }
    }
    if (commandId.startsWith('mode.')) {
      const nextMode = commandId.slice('mode.'.length) as EditorMode
      await selectMode(nextMode, activeCommandTrigger.value)
      commandFeedback.value = localizedUiNotice('feedback.modeChanged', { mode: mode.value }, {
        mode: `mode.${mode.value}` as UiMessageKey,
      })
      return Object.freeze({ changed: false, commandId, detail: uiNoticeText(commandFeedback.value)!, semanticOutcome: `application:${commandId}` })
    }
    if (commandId.startsWith('language.')) {
      const candidate = commandId.slice('language.'.length)
      if (!isUiLocale(candidate)) {
        return Object.freeze({ changed: false, commandId, detail: 'status.unavailableCurrentMode', semanticOutcome: `application:${commandId}` })
      }
      toolbarLocale.value = candidate
      uiLocalization.setLocale(candidate)
      if (codeDraftError.value !== null) {
        visualSurface.value?.setSelectedSemanticLocalError(uiNoticeText(codeDraftError.value))
      }
      if (commandFeedback.value === null) {
        commandFeedback.value = localizedUiNotice('feedback.languageChanged', { language: candidate }, {
          language: `language.${candidate}` as UiMessageKey,
        })
      }
      return Object.freeze({ changed: false, commandId, detail: 'feedback.languageChanged', semanticOutcome: `application:${commandId}` })
    }
    return Object.freeze({ changed: false, commandId, detail: 'feedback.completed', semanticOutcome: `application:${commandId}` })
  },
})

const commandRegistry = new CommandRegistry(createToolbarCommandDescriptors(), {
  application: applicationDispatcher,
  source: sourceEditorDispatcher,
  visual: visualEditorDispatcher,
})
function commandExecutionNotice(result: CommandExecutionResult): UiNotice {
  if (result.status === 'disabled') {
    return uiNotice(mode.value === 'preview' ? 'status.unavailableFinalPreview' : 'status.unavailableCurrentMode')
  }
  switch (result.detail) {
    case 'toc.inserted': return uiNotice('toc.inserted')
    case 'toc.alreadyExists': return uiNotice('toc.alreadyExists')
    case 'feedback.editorOpened': return commandUiNotice('feedback.editorOpened', result.commandId, 'editor')
    case 'feedback.applied': return commandUiNotice('feedback.applied', result.commandId)
    case 'feedback.removed': return commandUiNotice('feedback.removed', result.commandId)
    case 'feedback.inserted': return commandUiNotice('feedback.inserted', result.commandId)
    case 'feedback.noChange': return commandUiNotice('feedback.noChange', result.commandId)
    case 'feedback.completed': return commandUiNotice('feedback.completed', result.commandId)
    case 'status.alignmentUnavailable': return uiNotice('status.alignmentUnavailable')
    case 'status.selectSourceText': return uiNotice('status.selectSourceText')
    case 'status.unavailableCurrentMode': return uiNotice('status.unavailableCurrentMode')
    default:
      return commandUiNotice(result.changed ? 'feedback.applied' : 'feedback.completed', result.commandId)
  }
}
const shortcutConfigurableCommands = computed(() => commandRegistry.list())

function shortcutMapByKeystroke(bindings: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(Object.entries(bindings)
    .filter(([, shortcut]) => shortcut.length > 0)
    .map(([commandId, shortcut]) => [shortcut, commandId])))
}

function restoreShortcutBindings(): Readonly<Record<string, string>> {
  const configured = settings.get<unknown>(PLAYGROUND_SETTINGS_KEYS.shortcutBindings)
  const persisted = typeof configured === 'object' && configured !== null && !Array.isArray(configured)
    && Object.entries(configured).every(([commandId, shortcut]) => commandId.length > 0 && typeof shortcut === 'string')
    ? Object.freeze({ ...(configured as Readonly<Record<string, string>>) })
    : null
  if (persisted === null) return DEFAULT_SHORTCUT_BINDINGS
  const migrated = migrateLegacyHeadingShortcuts(persisted)
  const commandIds = new Set(commandRegistry.list().map(({ id }) => id))
  const restored: Record<string, string> = {}
  const assigned = new Set<string>()
  for (const [commandId, shortcut] of Object.entries(migrated)) {
    if (!commandIds.has(commandId) || shortcut.length === 0) continue
    if (isReservedShortcut(shortcut) || assigned.has(shortcut)) return DEFAULT_SHORTCUT_BINDINGS
    assigned.add(shortcut)
    restored[commandId] = shortcut
  }
  return Object.freeze(restored)
}

const restoredShortcutBindings = restoreShortcutBindings()
shortcutBindings.value = restoredShortcutBindings
const shortcutDispatcher = new ShortcutDispatcher(commandRegistry, shortcutMapByKeystroke(restoredShortcutBindings))

function currentCommandContext(): CommandContext {
  const semanticVisualSelection = mode.value === 'visual'
    && (selectedSemanticNode.value !== null || visualSurface.value?.selectedSemanticBlock() !== null)
  const activeCommandIds = new Set<string>([
    ...activeEditorCommandIds.value,
    `language.${toolbarLocale.value}`,
    `mode.${mode.value}`,
    ...(fullscreenActive.value ? ['application.fullscreen'] : []),
  ])
  return Object.freeze({
    activeCommandIds,
    mode: mode.value,
    selectionKind: mode.value === 'preview'
      ? 'none'
      : semanticVisualSelection ? 'semantic-node' : 'text',
  })
}

function toCommandView(descriptor: CommandDescriptor): CommandView {
  return Object.freeze({
    descriptor,
    label: descriptor.labels[toolbarLocale.value],
    query: commandRegistry.query(descriptor.id, currentCommandContext()),
  })
}

function buildMenuView(menu: ToolbarMenuDescriptor): CommandMenuView {
  const commands = commandRegistry.list()
    .filter((command) => command.surface.menuId === menu.id)
    .map(toCommandView)
  const sections = new Map<string, { commands: CommandView[]; id: string; label: string; order: number }>()
  for (const command of commands) {
    const existing = sections.get(command.descriptor.group.id)
    if (existing !== undefined) {
      existing.commands.push(command)
      continue
    }
    sections.set(command.descriptor.group.id, {
      commands: [command],
      id: command.descriptor.group.id,
      label: command.descriptor.group.labels[toolbarLocale.value],
      order: command.descriptor.group.order,
    })
  }
  return Object.freeze({
    descriptor: menu,
    label: menu.labels[toolbarLocale.value],
    sections: Object.freeze([...sections.values()]
      .sort((left, right) => left.order - right.order)
      .map((section) => Object.freeze({
        commands: Object.freeze(section.commands),
        id: section.id,
        label: section.label,
      }))),
  })
}

function toolbarCommandText(command: CommandView): string {
  if (command.descriptor.id === 'insert.drawio') return 'draw.io'
  if (command.descriptor.id === 'document.word-count') return command.label
  return command.descriptor.icon
}

function toolbarMenuText(menu: CommandMenuView): string {
  if (menu.descriptor.id === 'language') {
    if (toolbarLocale.value === 'zh') return '中文'
    return toolbarLocale.value.toUpperCase()
  }
  return menu.label
}

function selectAppearanceTheme(theme: AppearanceTheme, event: Event): void {
  const trigger = (event.currentTarget as HTMLElement)
    .closest<HTMLElement>('[data-toolbar-menu="theme"]')
    ?.querySelector<HTMLButtonElement>('.toolbar-menu__trigger') ?? null
  const changed = appearanceTheme.value !== theme
  appearanceTheme.value = theme
  let persisted = true
  try {
    settings.setUserOverride(PLAYGROUND_SETTINGS_KEYS.appearanceTheme, theme)
  } catch {
    persisted = false
  }
  sourceSurface.value?.setTheme(theme)
  if (changed) {
    commandFeedback.value = localizedUiNotice(
      persisted ? 'feedback.themeChanged' : 'feedback.themeChangedSessionOnly',
      { theme },
      { theme: `theme.${theme}` as UiMessageKey },
    )
  }
  closeToolbarMenu()
  void nextTick(() => trigger?.focus())
}

const modeCommands = computed(() => commandRegistry.list()
  .filter((command) => command.surface.region === 'mode')
  .map(toCommandView))
const previewToggleCommand = computed(() => toCommandView(commandRegistry.get('mode.preview')))
const toolbarSlots = computed<readonly ToolbarSlotView[]>(() => {
  const menuViews = new Map(TOOLBAR_MENU_DESCRIPTORS.map((menu) => [menu.id, buildMenuView(menu)]))
  return Object.freeze(TOOLBAR_SLOT_DEFINITIONS.map((slot): ToolbarSlotView => {
    if (slot.kind === 'command' || slot.kind === 'command-alias') {
      return Object.freeze({ command: toCommandView(commandRegistry.get(slot.commandId)), id: slot.id, kind: slot.kind })
    }
    if (slot.kind === 'menu') {
      const menu = menuViews.get(slot.menuId)
      if (menu === undefined) throw new RangeError(`Toolbar menu ${slot.menuId} is not registered.`)
      return Object.freeze({ id: slot.id, kind: slot.kind, menu })
    }
    return slot
  }))
})

if (storedWorkspace.status === 'missing') persistWorkspaceState()

async function selectMode(nextMode: EditorMode, eventOrTrigger?: Event | HTMLElement | null): Promise<void> {
  if (mode.value === nextMode || modeSwitching.value) return
  const previousMode = mode.value
  const trigger = eventOrTrigger instanceof HTMLElement
    ? eventOrTrigger
    : eventOrTrigger?.currentTarget instanceof HTMLElement ? eventOrTrigger.currentTarget : null
  let failedTrigger: HTMLElement | null = null
  lastRequestedMode.value = nextMode
  modeSwitching.value = true
  try {
    if (previousMode === 'source') sourceSurface.value?.flush()
    const result = await activeRuntime.value.root.modeCoordinator.request(nextMode)
    if (result.changed) {
      actionCount.value += 1
      if (nextMode === 'preview' && previousMode !== 'preview') lastEditingMode.value = previousMode
      if (nextMode !== 'preview') lastEditingMode.value = nextMode
      persistWorkspaceState()
    }
    await focusActiveSurface()
  } catch {
    // ModeCoordinator publishes the actionable failure while preserving the active surface.
    failedTrigger = trigger
  } finally {
    modeSwitching.value = false
    if (failedTrigger !== null) {
      await nextTick()
      failedTrigger.focus()
    }
  }
}

async function toggleFinalPreview(event: Event): Promise<void> {
  activeCommandTrigger.value = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  const nextMode = mode.value === 'preview' ? lastEditingMode.value : 'preview'
  await selectMode(nextMode, event)
  commandFeedback.value = mode.value === 'preview'
    ? uiNotice('feedback.modePreviewOpened')
    : localizedUiNotice('feedback.modeReturned', { mode: mode.value }, { mode: `mode.${mode.value}` as UiMessageKey })
}

async function focusActiveSurface(): Promise<void> {
  await nextTick()
  if (mode.value === 'source') sourceSurface.value?.focus()
  if (mode.value === 'visual') {
    visualSurface.value?.focus()
    const pending = pendingVisualTocSelection.value
    pendingVisualTocSelection.value = null
    if (pending !== null) {
      const snapshot = activeRuntime.value.root.session.snapshot()
      if (snapshot.documentId === pending.documentId && snapshot.revision === pending.revision) {
        const decision = createTocInsertionDecision(
          snapshot,
          pending.selection.from,
          `visual-toc-selection:${createRandomId()}`,
        )
        if (
          decision.kind === 'existing'
          && decision.selection.from === pending.selection.from
          && decision.selection.to === pending.selection.to
        ) {
          visualSurface.value?.selectTocBlock()
        }
      }
    }
  }
  if (mode.value === 'preview') visualSurface.value?.focus()
}

function anchoredOverlayStyle(trigger: HTMLElement, width: number): CSSProperties {
  const rect = trigger.getBoundingClientRect()
  const availableWidth = Math.max(0, window.innerWidth - 16)
  const overlayWidth = Math.min(width, availableWidth)
  return Object.freeze({
    left: `${Math.max(8, Math.min(rect.left, window.innerWidth - overlayWidth - 8))}px`,
    position: 'fixed',
    top: `${rect.bottom + 4}px`,
  })
}

function tablePickerCellLabel(columns: number, dataRows: number): string {
  const key = `tablePicker.cell.${columns === 1 ? 'one' : 'many'}${dataRows === 1 ? 'One' : 'Many'}` as UiMessageKey
  return t(key, { columns, rows: dataRows })
}

function tablePickerStatusLabel(): string {
  const key = `tablePicker.status.${tablePickerColumns.value === 1 ? 'one' : 'many'}${tablePickerDataRows.value === 1 ? 'One' : 'Many'}` as UiMessageKey
  return t(key, { columns: tablePickerColumns.value, rows: tablePickerDataRows.value })
}

function closeTableDimensionPicker(restoreFocus: boolean): void {
  const returnFocus = tablePickerReturnFocus.value
  tablePickerOpen.value = false
  tablePickerReturnFocus.value = null
  if (restoreFocus) void nextTick(() => returnFocus?.focus())
}

async function focusTablePickerCell(columns: number, dataRows: number): Promise<void> {
  await nextTick()
  tablePickerGrid.value?.querySelector<HTMLButtonElement>(
    `[data-table-picker-columns="${columns}"][data-table-picker-rows="${dataRows}"]`,
  )?.focus()
}

async function openTableDimensionPicker(): Promise<void> {
  const trigger = activeCommandTrigger.value
    ?? toolbarRegion.value?.querySelector<HTMLElement>('[data-toolbar-slot="insert.table"] button')
    ?? null
  tablePickerColumns.value = 1
  tablePickerDataRows.value = 1
  tablePickerReturnFocus.value = trigger
  tablePickerOpen.value = true
  toolbarTooltipCommandId.value = null
  if (trigger !== null) tablePickerStyle.value = anchoredOverlayStyle(trigger, 220)
  await focusTablePickerCell(1, 1)
}

function activateTablePickerCell(columns: number, dataRows: number): void {
  tablePickerColumns.value = columns
  tablePickerDataRows.value = dataRows
}

function handleTablePickerKeydown(event: KeyboardEvent, columns: number, dataRows: number): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeTableDimensionPicker(true)
    return
  }
  let nextColumns = columns
  let nextRows = dataRows
  if (event.key === 'ArrowLeft') nextColumns = Math.max(1, columns - 1)
  else if (event.key === 'ArrowRight') nextColumns = Math.min(9, columns + 1)
  else if (event.key === 'ArrowUp') nextRows = Math.max(1, dataRows - 1)
  else if (event.key === 'ArrowDown') nextRows = Math.min(9, dataRows + 1)
  else if (event.key === 'Home') nextColumns = 1
  else if (event.key === 'End') nextColumns = 9
  else return
  event.preventDefault()
  event.stopPropagation()
  if (nextColumns === columns && nextRows === dataRows) return
  activateTablePickerCell(nextColumns, nextRows)
  void focusTablePickerCell(nextColumns, nextRows)
}

async function applyTableDimensions(columns: number, dataRows: number): Promise<void> {
  const editorScroller = document.querySelector<HTMLElement>('.editor-surface')
  const scrollPosition = editorScroller === null ? null : Object.freeze({ left: editorScroller.scrollLeft, top: editorScroller.scrollTop })
  activateTablePickerCell(columns, dataRows)
  closeTableDimensionPicker(false)
  let changed = false
  if (mode.value === 'source') {
    const snapshot = activeRuntime.value.root.session.snapshot()
    const selection = sourceSelection()
    const result = createTableInsertionPlan(
      snapshot,
      selection.from,
      `source-command:insert.table:${createRandomId()}`,
      { columns, dataRows },
    )
    await applySourcePlan(result.plan, result.selection)
    changed = true
  } else if (mode.value === 'visual') {
    changed = visualSurface.value?.insertTable(columns, dataRows).changed ?? false
  }
  commandFeedback.value = changed
    ? commandUiNotice('feedback.inserted', 'insert.table')
    : uiNotice('feedback.tableUnavailable')
  if (changed) {
    await focusActiveSurface()
    if (editorScroller !== null && scrollPosition !== null) {
      editorScroller.scrollLeft = scrollPosition.left
      editorScroller.scrollTop = scrollPosition.top
      requestAnimationFrame(() => {
        editorScroller.scrollLeft = scrollPosition.left
        editorScroller.scrollTop = scrollPosition.top
      })
    }
  }
}

function positionOpenToolbarOverlays(): void {
  if (openedToolbarMenu.value !== null) {
    const trigger = toolbarRegion.value?.querySelector<HTMLElement>(
      `[data-toolbar-menu="${openedToolbarMenu.value}"] .toolbar-menu__trigger`,
    )
    if (trigger !== null && trigger !== undefined) toolbarMenuPanelStyle.value = anchoredOverlayStyle(trigger, 360)
  }
  if (wordCountDialogOpen.value && wordCountTrigger.value !== null) {
    wordCountPopoverStyle.value = anchoredOverlayStyle(wordCountTrigger.value, 360)
  }
  if (lineSpacingMenuOpen.value && lineSpacingTrigger.value !== null) {
    lineSpacingPopoverStyle.value = anchoredOverlayStyle(lineSpacingTrigger.value, 240)
  }
  if (tablePickerOpen.value && tablePickerReturnFocus.value !== null) {
    tablePickerStyle.value = anchoredOverlayStyle(tablePickerReturnFocus.value, 220)
  }
  const tooltipTrigger = document.activeElement instanceof HTMLElement
    && document.activeElement.closest('[role="toolbar"]') === toolbarRegion.value
    ? document.activeElement
    : null
  if (tooltipTrigger !== null && toolbarTooltipCommandId.value !== null) {
    toolbarTooltipStyle.value = anchoredOverlayStyle(tooltipTrigger, 180)
  }
}

function toggleToolbarMenu(menuId: ToolbarMenuId, event?: Event): void {
  closeLineSpacingMenu()
  if (openedToolbarMenu.value === menuId) {
    closeToolbarMenu()
    return
  }
  const trigger = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null
  openedToolbarMenu.value = menuId
  toolbarTooltipCommandId.value = null
  if (trigger !== null) toolbarMenuPanelStyle.value = anchoredOverlayStyle(trigger, 360)
}

function focusLineSpacingOption(): void {
  void nextTick(() => toolbarRegion.value
    ?.querySelector<HTMLElement>('[data-testid="line-spacing-menu"]')
    ?.querySelector<HTMLButtonElement>(`[data-line-spacing-option="${lineSpacing.value}"]`)
    ?.focus())
}

function closeLineSpacingMenu(restoreFocus = false): void {
  const trigger = lineSpacingTrigger.value
  lineSpacingMenuOpen.value = false
  lineSpacingTrigger.value = null
  if (restoreFocus) void nextTick(() => trigger?.focus())
}

function toggleLineSpacingMenu(event?: Event): void {
  if (lineSpacingMenuOpen.value) {
    closeLineSpacingMenu(true)
    return
  }
  closeToolbarMenu()
  const trigger = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null
  lineSpacingTrigger.value = trigger
  lineSpacingMenuOpen.value = true
  toolbarTooltipCommandId.value = null
  if (trigger !== null) lineSpacingPopoverStyle.value = anchoredOverlayStyle(trigger, 240)
  focusLineSpacingOption()
}

function chooseLineSpacing(id: LineSpacingId): void {
  const option = lineSpacingOption(id)
  const changed = lineSpacing.value !== id
  lineSpacing.value = id
  let persisted = true
  try {
    settings.setUserOverride(PLAYGROUND_SETTINGS_KEYS.lineSpacing, id)
  } catch {
    persisted = false
  }
  if (changed) {
    commandFeedback.value = localizedUiNotice(
      persisted ? 'feedback.lineSpacingChanged' : 'feedback.lineSpacingChangedSessionOnly',
      { value: option.value.toFixed(2) },
      { value: `lineSpacing.${id}` as UiMessageKey },
    )
  }
  closeLineSpacingMenu(true)
}

function handleLineSpacingMenuKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeLineSpacingMenu(true)
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  const items = [...(toolbarRegion.value
    ?.querySelector<HTMLElement>('[data-testid="line-spacing-menu"]')
    ?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)') ?? [])]
  if (items.length === 0) return
  event.preventDefault()
  const current = items.indexOf(event.target as HTMLButtonElement)
  const next = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? items.length - 1
      : event.key === 'ArrowDown'
        ? (current + 1) % items.length
        : (current <= 0 ? items.length - 1 : current - 1)
  items[next]?.focus()
}

async function activateToolbarMenu(menu: CommandMenuView, event: Event): Promise<void> {
  if (menu.descriptor.id !== 'color') {
    toggleToolbarMenu(menu.descriptor.id, event)
    return
  }
  const textColorCommand = menu.sections
    .flatMap((section) => section.commands)
    .find((command) => command.descriptor.id === 'text.color')
  if (textColorCommand !== undefined) await executeToolbarCommand(textColorCommand, event)
}

function closeToolbarMenu(): void {
  openedToolbarMenu.value = null
}

function showToolbarTooltip(view: CommandView, event: FocusEvent | MouseEvent): void {
  const trigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  if (trigger === null || openedToolbarMenu.value !== null || lineSpacingMenuOpen.value) return
  toolbarTooltipCommandId.value = view.descriptor.id
  toolbarTooltipStyle.value = anchoredOverlayStyle(trigger, 180)
}

function toolbarTooltipText(commandId: string): string {
  return commandLabel(commandId)
}

function commandLabel(commandId: string): string {
  return commandRegistry.presentation(commandId, toolbarLocale.value).label
}
const shortcutRecordingCommandLabel = computed(() => shortcutRecordingCommandId.value === null
  ? ''
  : commandLabel(shortcutRecordingCommandId.value))

function hideToolbarTooltip(event: FocusEvent | MouseEvent): void {
  if (event instanceof FocusEvent && event.relatedTarget instanceof Element
    && event.relatedTarget.closest('[role="tooltip"]') !== null) return
  toolbarTooltipCommandId.value = null
}

function commandDisabled(view: CommandView): boolean {
  return !view.query.enabled
    || alignmentCommandDisabled(view.descriptor.id)
    || (view.descriptor.id === 'document.manual-save' && manualSaving.value)
    || (view.descriptor.id.startsWith('mode.') && (modeSwitching.value || lifecycleOperation.value))
}

function commandDisabledReason(view: CommandView): string | undefined {
  if (view.query.disabledReason !== null) {
    return mode.value === 'preview' ? t('status.unavailableFinalPreview') : t('status.unavailableCurrentMode')
  }
  if (alignmentCommandDisabled(view.descriptor.id)) return t('status.alignmentUnavailable')
  if (view.descriptor.id === 'document.manual-save' && manualSaving.value) return t('status.manualSaveInProgress')
  if (view.descriptor.id.startsWith('mode.') && modeSwitching.value) return t('status.modeChangeInProgress')
  if (view.descriptor.id.startsWith('mode.') && lifecycleOperation.value) return t('status.lifecycleInProgress')
  return undefined
}

function alignmentCommandDisabled(commandId: string): boolean {
  if (!commandId.startsWith('align.')) return false
  if (mode.value === 'source') {
    return !sourceAlignmentCompatible(activeRuntime.value.root.session.snapshot().markdown, sourceSelection())
  }
  if (mode.value === 'visual') return !(visualSurface.value?.canApplyAlignment() ?? false)
  return true
}

function commandButtonClasses(view: CommandView): Readonly<Record<string, boolean>> {
  return Object.freeze({
    'primary-action': view.descriptor.id === 'document.manual-save',
    'tool-button': view.descriptor.id !== 'document.manual-save',
    'tool-button--active': view.query.active,
    'tool-button--italic': view.descriptor.id === 'text.italic',
    'tool-button--strong': view.descriptor.id === 'text.bold',
  })
}

async function closeMatchingCommandOverlay(commandId: string): Promise<boolean> {
  const richPickerMatches = richPickerCommand.value === commandId
    || (commandId === 'text.color'
      && (richPickerCommand.value === 'text.color' || richPickerCommand.value === 'text.background'))
  if (richPickerMatches) {
    await closeRichPicker()
    return true
  }
  if (commandId === 'layout.timeline' && timelineDialogOpen.value) {
    await closeTimelineDialog()
    return true
  }
  if (commandId === disclosureDialogCommand.value) {
    await closeDisclosureDialog()
    return true
  }
  if (commandId === 'insert.formula' && formulaDialogOpen.value) {
    await closeFormulaDialog()
    return true
  }
  if (commandId === 'settings.shortcuts' && shortcutDialogOpen.value) {
    await closeShortcutSettings()
    return true
  }
  if (commandId === 'search.replace' && searchDialogOpen.value) {
    await closeSearch()
    return true
  }
  return false
}

async function executeToolbarCommand(view: CommandView, event?: Event): Promise<void> {
  const invokedControl = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null
  activeCommandTrigger.value = invokedControl?.closest('[data-toolbar-menu]')
    ?.querySelector<HTMLElement>('.toolbar-menu__trigger')
    ?? invokedControl
  if (await closeMatchingCommandOverlay(view.descriptor.id)) {
    closeToolbarMenu()
    closeLineSpacingMenu()
    return
  }
  if (commandDisabled(view)) return
  if (view.descriptor.id !== 'insert.table' && !view.descriptor.id.startsWith('language.') && tablePickerOpen.value) {
    closeTableDimensionPicker(false)
  }
  closeToolbarMenu()
  closeLineSpacingMenu()
  if (!view.descriptor.id.startsWith('language.')) commandFeedback.value = null
  const result: CommandExecutionResult = await commandRegistry.execute(view.descriptor.id, currentCommandContext())
  if (commandFeedback.value === null) {
    commandFeedback.value = commandExecutionNotice(result)
  }
  if (result.changed) await focusActiveSurface()
}

function handleToolbarKeydown(event: KeyboardEvent): void {
  const target = event.target instanceof HTMLElement ? event.target : null
  if (event.key === 'Escape' && lineSpacingMenuOpen.value) {
    event.preventDefault()
    closeLineSpacingMenu(true)
    return
  }
  if (event.key === 'Escape' && openedToolbarMenu.value !== null) {
    event.preventDefault()
    const menu = target?.closest<HTMLElement>('[data-toolbar-menu]')
      ?? toolbarRegion.value?.querySelector<HTMLElement>(`[data-toolbar-menu="${openedToolbarMenu.value}"]`)
    closeToolbarMenu()
    void nextTick(() => menu?.querySelector<HTMLButtonElement>('.toolbar-menu__trigger')?.focus())
    return
  }
  if (openedToolbarMenu.value !== null && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    const menu = toolbarRegion.value?.querySelector<HTMLElement>(`[data-toolbar-menu="${openedToolbarMenu.value}"]`)
    const items = [...(menu?.querySelectorAll<HTMLButtonElement>('[role="menu"] button:not(:disabled)') ?? [])]
    if (items.length === 0) return
    event.preventDefault()
    const currentIndex = target === null ? -1 : items.indexOf(target as HTMLButtonElement)
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : event.key === 'ArrowDown'
          ? (currentIndex + 1) % items.length
          : (currentIndex <= 0 ? items.length - 1 : currentIndex - 1)
    items[nextIndex]?.focus()
    return
  }
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
    || target?.closest('[role="menu"]') !== null) return
  const controls = [...(toolbarRegion.value?.querySelectorAll<HTMLButtonElement>('[data-toolbar-slot] > button:not(:disabled), [data-toolbar-slot] > .toolbar-menu__trigger:not(:disabled)') ?? [])]
  if (controls.length === 0) return
  const currentIndex = target === null ? -1 : controls.indexOf(target as HTMLButtonElement)
  let nextIndex: number
  if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = controls.length - 1
  else if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % controls.length
  else nextIndex = currentIndex <= 0 ? controls.length - 1 : currentIndex - 1
  event.preventDefault()
  controls[nextIndex]?.focus()
}

function handleDocumentPointerDown(event: PointerEvent): void {
  const target = event.target
  if (tablePickerOpen.value && target instanceof Element
    && target.closest('[data-table-dimension-picker]') === null
    && target.closest('[data-command-id="insert.table"]') === null
    && target.closest('[data-toolbar-menu="language"]') === null) closeTableDimensionPicker(false)
  if (!(target instanceof Element) || target.closest('[data-toolbar-menu]') === null) closeToolbarMenu()
  if (!(target instanceof Element) || target.closest('[data-toolbar-menu="line-spacing"]') === null) closeLineSpacingMenu()
}

function clearPreviewSearchHighlights(): void {
  const parents = new Set<Node>()
  for (const mark of previewSearchMarks) {
    const parent = mark.parentNode
    if (parent !== null) parents.add(parent)
    mark.replaceWith(document.createTextNode(mark.textContent ?? ''))
  }
  for (const parent of parents) parent.normalize()
  previewSearchMarks = []
}

function previewTextMatches(query: string, caseSensitive: boolean): readonly SearchDialogMatch[] {
  clearPreviewSearchHighlights()
  const root = previewSurface.value?.querySelector<HTMLElement>('.preview-rendered-content')
  if (root === null || root === undefined || query.length === 0) return Object.freeze([])
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => node.parentElement?.closest('button, script, style, [aria-hidden="true"]') === null
      ? NodeFilter.FILTER_ACCEPT
      : NodeFilter.FILTER_REJECT,
  })
  const matches: SearchDialogMatch[] = []
  const textNodes: Text[] = []
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text)
  let documentOffset = 0
  for (const textNode of textNodes) {
    const source = textNode.data
    const haystack = caseSensitive ? source : source.toLocaleLowerCase()
    const needle = caseSensitive ? query : query.toLocaleLowerCase()
    const localMatches: Readonly<{ readonly from: number; readonly to: number }>[] = []
    let offset = 0
    while (offset <= haystack.length - needle.length) {
      const from = haystack.indexOf(needle, offset)
      if (from === -1) break
      localMatches.push(Object.freeze({ from, to: from + needle.length }))
      offset = from + Math.max(1, needle.length)
    }
    if (localMatches.length > 0) {
      const fragment = document.createDocumentFragment()
      let cursor = 0
      for (const local of localMatches) {
        fragment.append(document.createTextNode(source.slice(cursor, local.from)))
        const mark = document.createElement('mark')
        mark.className = 'w-editor-search-match'
        mark.dataset['searchActive'] = 'false'
        mark.dataset['searchMatch'] = ''
        mark.textContent = source.slice(local.from, local.to)
        fragment.append(mark)
        previewSearchMarks.push(mark)
        matches.push(Object.freeze({
          from: documentOffset + local.from,
          text: source.slice(local.from, local.to),
          to: documentOffset + local.to,
        }))
        cursor = local.to
      }
      fragment.append(document.createTextNode(source.slice(cursor)))
      textNode.replaceWith(fragment)
    }
    documentOffset += source.length
  }
  return Object.freeze(matches)
}

function clearSearchHighlights(): void {
  sourceSurface.value?.clearSearchHighlights()
  visualSurface.value?.clearSearchHighlights()
  clearPreviewSearchHighlights()
}

function renderSearchHighlights(): void {
  if (searchMode.value === 'source') sourceSurface.value?.setSearchHighlights(searchMatches.value, searchIndex.value)
  else if (searchMode.value === 'visual' || searchMode.value === 'preview') {
    visualSurface.value?.setSearchHighlights(searchMatches.value, searchIndex.value)
  }
}

async function openSearch(): Promise<void> {
  const openingMode = mode.value
  const openingSelection = openingMode === 'source'
    ? sourceSurface.value?.selection() ?? null
    : openingMode === 'visual'
      ? visualSurface.value?.selection() ?? null
      : null
  clearSearchHighlights()
  searchQuery.value = ''
  searchReplacement.value = ''
  searchReplaceExpanded.value = false
  searchCaseSensitive.value = false
  searchMatches.value = Object.freeze([])
  searchIndex.value = -1
  searchError.value = null
  if (mode.value === 'visual') {
    try {
      await activeRuntime.value.flushVisualSynchronization()
      const synchronization = activeRuntime.value.root.synchronization.snapshot()
      if (synchronization.status === 'failed') throw synchronization.failure
    } catch (error) {
      searchError.value = uiFailureNotice(error, 'feedback.searchDetail')
    }
  }
  const snapshot = activeRuntime.value.root.session.snapshot()
  searchOpeningSelection.value = openingSelection === null || (openingMode !== 'source' && openingMode !== 'visual')
    ? null
    : Object.freeze({
        documentId: snapshot.documentId,
        mode: openingMode,
        revision: snapshot.revision,
        selection: Object.freeze({ ...openingSelection }),
      })
  searchDocumentId.value = snapshot.documentId
  searchRevision.value = snapshot.revision
  searchMode.value = mode.value
  searchDialogOpen.value = true
  await nextTick()
  searchQueryInput.value?.focus()
}

async function closeSearch(): Promise<void> {
  const snapshot = activeRuntime.value.root.session.snapshot()
  const bookmark = searchOpeningSelection.value
  const restoreOpeningSelection = searchMatches.value.length === 0
    && bookmark !== null
    && bookmark.documentId === snapshot.documentId
    && bookmark.mode === mode.value
    && bookmark.revision === snapshot.revision
  clearSearchHighlights()
  searchDialogOpen.value = false
  await nextTick()
  if (restoreOpeningSelection) {
    if (bookmark.mode === 'source') sourceSurface.value?.setSelection(bookmark.selection)
    else visualSurface.value?.setSelection(bookmark.selection)
  }
  searchOpeningSelection.value = null
  await focusActiveSurface()
}

function searchScopeIsCurrent(): boolean {
  const snapshot = activeRuntime.value.root.session.snapshot()
  if (searchDocumentId.value === snapshot.documentId && searchMode.value === mode.value) return true
  searchError.value = uiNotice('search.scopeChanged')
  return false
}

function selectSearchMatch(): void {
  const match = searchMatches.value[searchIndex.value]
  if (match === undefined || !searchScopeIsCurrent()) {
    clearSearchHighlights()
    return
  }
  renderSearchHighlights()
}

function runSearch(): void {
  searchError.value = null
  if (!searchScopeIsCurrent()) return
  const query = searchQuery.value
  let matches: readonly SearchDialogMatch[]
  if (searchMode.value === 'source') {
    const markdown = activeRuntime.value.root.session.snapshot().markdown
    matches = (sourceSurface.value?.search(query, searchCaseSensitive.value) ?? Object.freeze([]))
      .map((match) => Object.freeze({ ...match, text: markdown.slice(match.from, match.to) }))
  } else if (searchMode.value === 'visual' || searchMode.value === 'preview') {
    matches = visualSurface.value?.search(query, searchCaseSensitive.value) ?? Object.freeze([])
  } else {
    matches = previewTextMatches(query, searchCaseSensitive.value)
  }
  searchMatches.value = Object.freeze([...matches])
  searchIndex.value = matches.length === 0 ? -1 : 0
  searchRevision.value = activeRuntime.value.root.session.snapshot().revision
  selectSearchMatch()
}

function clearSearchQuery(): void {
  searchQuery.value = ''
  runSearch()
}

function toggleSearchCase(): void {
  searchCaseSensitive.value = !searchCaseSensitive.value
  runSearch()
}

function navigateSearch(direction: -1 | 1): void {
  if (searchMatches.value.length === 0 || !searchScopeIsCurrent()) return
  searchIndex.value = (searchIndex.value + direction + searchMatches.value.length) % searchMatches.value.length
  selectSearchMatch()
}

async function replaceSearchMatches(replaceAll: boolean): Promise<void> {
  searchError.value = null
  if (!searchCanReplace.value || !searchScopeIsCurrent()) return
  const snapshot = activeRuntime.value.root.session.snapshot()
  if (snapshot.revision !== searchRevision.value) {
    searchError.value = uiNotice('search.revisionChanged')
    return
  }
  const current = searchMatches.value[searchIndex.value]
  if (current === undefined) return
  const matches = replaceAll ? searchMatches.value : Object.freeze([current])
  try {
    if (searchMode.value === 'source') {
      sourceSurface.value?.applyPatchPlan(Object.freeze({
        baseRevision: snapshot.revision,
        patches: Object.freeze(matches.map((match) => Object.freeze({
          codecId: 'search-replace',
          expected: match.text,
          from: match.from,
          replacement: searchReplacement.value,
          to: match.to,
        }))),
        transactionId: `search-replace:${createRandomId()}`,
      }))
    } else if (searchMode.value === 'visual') {
      const result = visualSurface.value?.replaceSearchMatches(matches, searchReplacement.value)
      if (result?.changed !== true) throw uiError('search.visualNoChange')
      await activeRuntime.value.flushVisualSynchronization()
      const synchronization = activeRuntime.value.root.synchronization.snapshot()
      if (synchronization.status === 'failed') throw synchronization.failure
    }
    await nextTick()
    searchRevision.value = activeRuntime.value.root.session.snapshot().revision
    runSearch()
  } catch (error) {
    searchError.value = uiFailureNotice(error, 'feedback.searchDetail')
  }
}

function shortcutFromKeyboardEvent(event: KeyboardEvent): string | null {
  const shortcut = physicalShortcutFromKeyboardEvent(event)
  if (shortcut === null) return null
  return shortcutDispatcher.commandId(shortcut) === null ? null : shortcut
}

function shortcutKeycapLabels(shortcut: string): readonly string[] {
  return shortcutKeycaps(shortcut)
}

function toggleShortcutRecorder(commandId: string): void {
  shortcutError.value = null
  shortcutRecordingCommandId.value = shortcutRecordingCommandId.value === commandId ? null : commandId
}

function resetShortcutSettings(): void {
  shortcutDraft.value = { ...DEFAULT_SHORTCUT_BINDINGS }
  shortcutError.value = null
  shortcutRecordingCommandId.value = null
}

function captureShortcutKeydown(event: KeyboardEvent): boolean {
  const commandId = shortcutRecordingCommandId.value
  if (commandId === null) return false
  event.preventDefault()
  event.stopPropagation()
  if (event.repeat) return true
  const shortcut = physicalShortcutFromKeyboardEvent(event)
  if (shortcut === null) {
    if (['Alt', 'AltGraph', 'Control', 'Meta', 'Shift'].includes(event.key)) return true
    shortcutRecordingCommandId.value = null
    shortcutError.value = uiNotice('shortcuts.invalidCombination')
    return true
  }
  shortcutRecordingCommandId.value = null
  const label = shortcutDisplayLabel(shortcut)
  if (isReservedShortcut(shortcut)) {
    shortcutError.value = uiNotice('shortcuts.reserved', { shortcut: label })
    return true
  }
  const conflict = findShortcutConflict(shortcutDraft.value, commandId, shortcut)
  if (conflict !== null) {
    shortcutError.value = commandParametersUiNotice('shortcuts.conflict', {
      command: commandId,
      existing: conflict,
    }, { shortcut: label })
    return true
  }
  shortcutDraft.value = { ...shortcutDraft.value, [commandId]: shortcut }
  shortcutError.value = null
  return true
}

async function openShortcutSettings(): Promise<void> {
  shortcutTrigger.value = activeCommandTrigger.value
  shortcutDraft.value = Object.fromEntries(commandRegistry.list().map((descriptor) => [
    descriptor.id,
    shortcutBindings.value[descriptor.id] ?? '',
  ]))
  shortcutError.value = null
  shortcutRecordingCommandId.value = null
  shortcutDialogOpen.value = true
  activeRuntime.value.root.setModalActivity('shortcut-settings')
  await nextTick()
  shortcutDialog.value?.querySelector<HTMLButtonElement>('[data-shortcut-recorder]')?.focus()
}

async function closeShortcutSettings(): Promise<void> {
  shortcutDialogOpen.value = false
  shortcutError.value = null
  shortcutRecordingCommandId.value = null
  activeRuntime.value.root.setModalActivity(null)
  await nextTick()
  shortcutTrigger.value?.focus()
}

async function applyShortcutSettings(): Promise<void> {
  shortcutError.value = null
  const nextByCommand: Record<string, string> = {}
  const commandByShortcut = new Map<string, string>()
  try {
    for (const descriptor of commandRegistry.list()) {
      const shortcut = shortcutDraft.value[descriptor.id] ?? ''
      nextByCommand[descriptor.id] = shortcut
      if (shortcut.length === 0) continue
      if (isReservedShortcut(shortcut)) {
        shortcutError.value = uiNotice('shortcuts.reserved', { shortcut: shortcutDisplayLabel(shortcut) })
        return
      }
      const duplicate = commandByShortcut.get(shortcut)
      if (duplicate !== undefined) {
        shortcutError.value = commandParametersUiNotice('shortcuts.duplicate', {
          first: duplicate,
          second: descriptor.id,
        }, { shortcut: shortcutDisplayLabel(shortcut) })
        return
      }
      commandByShortcut.set(shortcut, descriptor.id)
    }
    const frozen = Object.freeze({ ...nextByCommand })
    settings.setUserOverride(PLAYGROUND_SETTINGS_KEYS.shortcutBindings, frozen)
    shortcutDispatcher.configure(shortcutMapByKeystroke(frozen))
    shortcutBindings.value = frozen
    commandFeedback.value = uiNotice('feedback.shortcutsUpdated')
    await closeShortcutSettings()
  } catch (error) {
    shortcutError.value = uiFailureNotice(error, 'feedback.shortcutDetail')
  }
}

function handleShortcutDialogKeydown(event: KeyboardEvent): void {
  if (captureShortcutKeydown(event)) return
  if (event.key === 'Escape') {
    event.preventDefault()
    void closeShortcutSettings()
    return
  }
  if (event.key !== 'Tab' || shortcutDialog.value === null) return
  const focusable = [...shortcutDialog.value.querySelectorAll<HTMLElement>('button')]
    .filter((element) => !('disabled' in element) || !(element as HTMLButtonElement).disabled)
  const first = focusable[0]
  const last = focusable.at(-1)
  if (first === undefined || last === undefined) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function dispatchRegisteredShortcut(event: KeyboardEvent): boolean {
  if (event.repeat || workspace.value.modalActivity !== null) return false
  const shortcut = shortcutFromKeyboardEvent(event)
  if (shortcut === null) return false
  event.preventDefault()
  const feedbackBeforeDispatch = commandFeedback.value
  void shortcutDispatcher.dispatch(shortcut, currentCommandContext()).then((result) => {
    if (result !== null && commandFeedback.value === feedbackBeforeDispatch) {
      commandFeedback.value = commandExecutionNotice(result)
    }
  }).catch((error: unknown) => {
    commandFeedback.value = uiFailureNotice(error, 'feedback.externalDetail')
  })
  return true
}

function handleVisualShortcut(event: KeyboardEvent): boolean {
  return dispatchRegisteredShortcut(event)
}

function previewTaskHistoryDirection(event: KeyboardEvent): 'redo' | 'undo' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null
  const key = event.key.toLocaleLowerCase()
  if (key === 'y' && !event.shiftKey) return 'redo'
  if (key !== 'z') return null
  return event.shiftKey ? 'redo' : 'undo'
}

function handleApplicationShortcut(event: KeyboardEvent): void {
  if (props.readonlyMode) return
  if (mode.value !== 'preview' && (event.target as Element | null)?.closest('.ProseMirror') !== null) return
  if (isCherrySourceHistoryShortcutEvent(event)) return
  const previewHistory = mode.value === 'preview' ? previewTaskHistoryDirection(event) : null
  if (previewHistory !== null) {
    event.preventDefault()
    event.stopPropagation()
    void applyPreviewTaskHistory(previewHistory)
    return
  }
  if (dispatchRegisteredShortcut(event)) event.stopPropagation()
}

async function flushAuthoritativeSnapshotForUtility() {
  if (mode.value === 'visual') {
    await activeRuntime.value.flushVisualSynchronization()
    const synchronization = activeRuntime.value.root.synchronization.snapshot()
    if (synchronization.status === 'failed') throw synchronization.failure
  }
  return activeRuntime.value.root.session.snapshot()
}

async function flushForLifecycle(): Promise<void> {
  const runtime = activeRuntime.value
  await flushLifecycleComposition(runtime, `lifecycle:${runtime.definition.documentId}:${createRandomId()}`)
  await flushLifecycleSynchronization(runtime)
  await runtime.autosave.flush()
}

async function publishForLifecycle(persist = props.persistence?.savePublish): Promise<void> {
  if (!persist) return
  const runtime = activeRuntime.value
  const flush = async () => {
    await flushLifecycleComposition(runtime, `publish:${runtime.definition.documentId}:${createRandomId()}`)
    await flushLifecycleSynchronization(runtime)
    await runtime.autosave.flush()
  }
  try {
    const published = await publishReferenceSnapshot(runtime.root.session, async snapshot => { await persist(snapshot) }, flush)
    runtime.manualCheckpoint.acceptSavedMarkdown(published.markdown)
  } catch (failure) {
    // A host may have saved a normalized candidate before a second publish request failed.
    // Restore the latest draft to both host recovery storage and private draft persistence.
    try {
      await flushLifecycleComposition(runtime, `publish-recovery:${createRandomId()}`)
      await flushLifecycleSynchronization(runtime)
      await props.persistence?.saveAutosave?.(runtime.root.session.snapshot())
    } catch { /* Host save adapters retain a local recovery record even when offline. */ }
    throw failure
  }
}

async function saveForLifecycle(): Promise<void> {
  await activeRuntime.value.manualCheckpoint.save()
  activeRuntime.value.root.clearError()
}

async function exportForLifecycle(): Promise<void> {
  const snapshot = await flushAuthoritativeSnapshotForUtility()
  await writeExportArtifact(createMarkdownExport(snapshot))
}

async function focusForLifecycle(): Promise<void> {
  await focusActiveSurface()
}

async function openWordCount(): Promise<void> {
  wordCountTrigger.value = activeCommandTrigger.value
  wordCountError.value = null
  wordCountStatistics.value = null
  try {
    wordCountStatistics.value = calculateDocumentStatistics(await flushAuthoritativeSnapshotForUtility())
  } catch (error) {
    wordCountError.value = uiFailureNotice(error, 'feedback.statisticsDetail')
  }
  if (wordCountTrigger.value !== null) {
    wordCountPopoverStyle.value = anchoredOverlayStyle(wordCountTrigger.value, 360)
  }
  wordCountDialogOpen.value = true
  await nextTick()
  wordCountDialog.value?.querySelector<HTMLButtonElement>('button')?.focus()
}

async function closeWordCount(): Promise<void> {
  wordCountDialogOpen.value = false
  await nextTick()
  wordCountTrigger.value?.focus()
}

function handleSearchDockKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    void closeSearch()
  }
}

async function downloadRawMarkdown(): Promise<void> {
  try {
    await writeExportArtifact(createMarkdownExport(workspace.value.activeDocument))
    exportError.value = null
  } catch (error) {
    exportError.value = uiFailureNotice(error, 'feedback.exportDetail')
  }
}

async function runRecoveryAction(action: 'locate-source' | 'raw-export' | 'recover' | 'retry'): Promise<void> {
  if (action === 'retry') {
    if (workspace.value.autosave.status === 'failed') {
      try {
        await activeRuntime.value.autosave.retry()
      } catch {
        // AutosaveCoordinator keeps the repeated failure visible and the authority in memory.
      }
      return
    }
    if (
      workspace.value.synchronization.status === 'failed'
      && workspace.value.synchronization.operation?.kind === 'synchronize-visual-patch'
    ) {
      try {
        await activeRuntime.value.retryVisualSynchronization()
      } catch {
        // The synchronization service keeps the failed intent and actionable failure visible.
      }
      return
    }
    if (lastRequestedMode.value !== null) await selectMode(lastRequestedMode.value)
    return
  }
  if (action === 'locate-source') {
    if (
      workspace.value.synchronization.status === 'failed'
      && workspace.value.synchronization.operation?.kind === 'synchronize-visual-patch'
    ) {
      try {
        await activeRuntime.value.recoverVisualSynchronization()
      } catch {
        return
      }
    }
    if (mode.value !== 'source') await selectMode('source')
    await focusActiveSurface()
    return
  }
  if (action === 'raw-export') {
    await downloadRawMarkdown()
    return
  }
  activeRuntime.value.root.clearError()
}

async function downloadStartupRecovery(): Promise<void> {
  const recovery = startupRecovery.value
  if (recovery === null) return
  try {
    const download = documentRepository.createRawRecoveryDownload(recovery.key)
    if (download === null) throw uiError('lifecycle.recoveryEnvelopeUnavailable')
    await writeExportArtifact(Object.freeze({
      blob: download.blob,
      filename: download.filename,
      mediaType: download.blob.type,
      revision: 0,
    }))
    rawRecoveryExported.value = true
    exportError.value = null
  } catch (error) {
    exportError.value = uiFailureNotice(error, 'feedback.exportDetail')
  }
}

function requestStartupRecoveryReset(): void {
  if (!rawRecoveryExported.value) return
  recoveryResetConfirmation.value = true
}

function cancelStartupRecoveryReset(): void {
  recoveryResetConfirmation.value = false
}

function confirmStartupRecoveryReset(): void {
  const recovery = startupRecovery.value
  if (recovery === null || !rawRecoveryExported.value) return
  if (recovery.scope === 'workspace') {
    documentRepository.clearAndResetWorkspace(initialWorkspaceEnvelope())
  } else {
    const definition = recovery.documentId === null ? null : catalog.lookup(recovery.documentId)
    if (definition === null) throw uiError('lifecycle.recoveryDocumentUnknown')
    documentRepository.clearAndResetDocument(definition.documentId, initialDocumentEnvelope(definition))
    const runtime = runtimes.get(definition.documentId)
    runtime?.root.setAutosave({ failure: null, revision: 0, status: 'saved' })
  }
  startupRecovery.value = null
  rawRecoveryExported.value = false
  recoveryResetConfirmation.value = false
}

function recoveryActionLabel(action: 'locate-source' | 'raw-export' | 'recover' | 'retry'): string {
  switch (action) {
    case 'locate-source': return t('lifecycle.openSource')
    case 'raw-export': return t('lifecycle.exportRawMarkdown')
    case 'recover': return t('lifecycle.recover')
    case 'retry': return t('common.retry')
  }
}

async function selectArticle(documentId: string, eventOrTrigger: Event | HTMLElement | null = null): Promise<void> {
  if (articleSwitching.value || workspace.value.activeDocument.documentId === documentId) return
  lifecycleTrigger.value = lifecycleTriggerFrom(eventOrTrigger) ?? lifecycleTrigger.value
  articleSwitching.value = true
  try {
    const runtime = activeRuntime.value
    await flushLifecycleComposition(runtime, `article-switch:composition:${runtime.definition.documentId}:${createRandomId()}`)
    if (runtime.state.manualDirty) {
      const decision = await requestLifecycleDecision({
        body: uiNotice(props.articleSwitchPolicy === 'save-discard' ? 'lifecycle.unsavedDiscardBody' : 'lifecycle.unsavedBody', {
          revision: runtime.root.session.snapshot().revision,
          title: runtime.definition.title,
        }),
        kind: 'article-switch',
        runtime,
        title: uiNotice('lifecycle.unsavedTitle'),
      })
      if (decision === 'cancel') return
      if (decision === 'save') {
        await runtime.manualCheckpoint.save()
        runtime.root.clearError()
      } else if (decision === 'draft') {
        await runtime.autosave.flush()
      } else if (decision === 'export') {
        await runtime.autosave.flush()
        await downloadRawMarkdown()
      } else if (decision === 'discard') {
        await runtime.manualCheckpoint.discard(async (snapshot) => {
          await props.persistence?.saveAutosave?.(snapshot)
        })
      }
    }
    await articleSwitch.request(documentId)
  } catch (failure) {
    lifecycleError.value = lifecycleFailureMessage(failure)
  } finally {
    articleSwitching.value = false
    await nextTick()
    lifecycleTrigger.value?.focus()
  }
}

function closeReaderPreview(): void {
  props.onReaderPreviewClose?.()
}

let resizeStartX = 0
let resizeStartWidth = 0

function startArticleResize(event: PointerEvent): void {
  resizeStartX = event.clientX
  resizeStartWidth = articlePanelWidth.value
  document.addEventListener('pointermove', resizeArticlePanel)
  document.addEventListener('pointerup', stopArticleResize, { once: true })
}

function resizeArticlePanel(event: PointerEvent): void {
  articlePanelWidth.value = Math.max(200, Math.min(360, resizeStartWidth + event.clientX - resizeStartX))
}

function stopArticleResize(): void {
  document.removeEventListener('pointermove', resizeArticlePanel)
  persistWorkspaceState()
}

function resizeArticlePanelWithKeyboard(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const delta = event.key === 'ArrowLeft' ? -16 : 16
  articlePanelWidth.value = Math.max(200, Math.min(360, articlePanelWidth.value + delta))
  persistWorkspaceState()
}

function toggleArticlePanel(): void {
  articlePanelOpen.value = !articlePanelOpen.value
  persistWorkspaceState()
}

function selectArticlePanelView(view: 'articles' | 'outline', focusTab = false): void {
  articlePanelView.value = view
  if (focusTab) {
    void nextTick(() => workspaceShell.value
      ?.querySelector<HTMLButtonElement>(`[data-article-panel-tab="${view}"]`)
      ?.focus())
  }
}

function handleArticlePanelTabKeydown(event: KeyboardEvent): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  selectArticlePanelView(event.key === 'ArrowLeft' || event.key === 'Home' ? 'articles' : 'outline', true)
}

let outlineFrame = 0
function updateOutlineFromScroll(): void {
  outlineFrame = 0
  const surface = workspaceShell.value?.querySelector<HTMLElement>('.editor-surface')
  if (!surface) return
  if (mode.value === 'source') {
    const from = sourceSurface.value?.visibleSourceFrom()
    if (from == null) return
    activeOutlineAnchor.value = articleOutline.value.filter(item => item.sourceFrom <= from).at(-1)?.anchor ?? articleOutline.value[0]?.anchor ?? null
    return
  }
  const visibleHeadings = [...surface.querySelectorAll<HTMLElement>('h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]')]
    .filter(h => articleOutline.value.some(item => item.anchor === h.id))
  const index = activeOutlineIndex(visibleHeadings.map(h => h.getBoundingClientRect().top), surface.getBoundingClientRect().top + 32,
    surface.scrollTop > 0 && surface.scrollTop + surface.clientHeight >= surface.scrollHeight - 2)
  activeOutlineAnchor.value = visibleHeadings[index]?.id ?? articleOutline.value[0]?.anchor ?? null
}
function scheduleOutlineFromScroll(): void { if (!outlineFrame) outlineFrame = requestAnimationFrame(updateOutlineFromScroll) }
watch([mode, articleOutline], () => { void nextTick(scheduleOutlineFromScroll) })

function outlineHeadingElement(root: HTMLElement, anchor: string): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5')]
    .find((heading) => heading.id === anchor) ?? null
}

function updateOutlineLocation(anchor: string): void {
  activeOutlineAnchor.value = anchor
  if (anchor.length > 0) window.history.replaceState(null, '', `#${anchor}`)
}

function navigateArticleOutline(item: MarkdownOutlineItem): void {
  if (mode.value === 'source') {
    sourceSurface.value?.setSelection({ anchor: item.sourceFrom, head: item.sourceFrom })
    sourceSurface.value?.focus()
    updateOutlineLocation(item.anchor)
    return
  }
  if (mode.value === 'visual' || mode.value === 'preview') {
    if (visualSurface.value?.navigateHeading(item.anchor) === true) activeOutlineAnchor.value = item.anchor
    return
  }
  if (previewSurface.value === null) return
  const heading = outlineHeadingElement(previewSurface.value, item.anchor)
  if (heading === null) return
  heading.scrollIntoView({ block: 'start' })
  heading.tabIndex = -1
  heading.focus({ preventScroll: true })
  updateOutlineLocation(item.anchor)
}

async function saveManualVersion(): Promise<void> {
  if (manualSaving.value) return
  manualSaving.value = true
  try {
    await activeRuntime.value.manualCheckpoint.save()
  } finally {
    manualSaving.value = false
  }
}

function refreshSourceCommandState(): void {
  if (sourceSurface.value === null) {
    activeEditorCommandIds.value = new Set()
    return
  }
  const selection = sourceSelection()
  const source = activeRuntime.value.root.session.snapshot().markdown
  const level = sourceHeadingLevel(source, selection.from)
  const active: string[] = level === null ? [] : [`block.h${level}`]
  const listKind = sourceListCommandAt(source, selection.from)
  if (listKind !== null) active.push(listKind)
  const alignment = sourceAlignmentAt(source, selection)
  if (alignment !== null) active.push(alignment)
  if (selection.from !== selection.to) {
    active.push(...INLINE_MARK_SPECS
      .filter((spec) => (
        source.slice(selection.from - spec.open.length, selection.from) === spec.open
        && source.slice(selection.to, selection.to + spec.close.length) === spec.close
      ))
      .map((spec) => spec.commandId))
    const rich = richInlineMarkAtSelection(source, {
      from: selection.from,
      to: selection.to,
    })
    if (rich !== null) active.push(rich.commandId)
  }
  activeEditorCommandIds.value = new Set(active)
}

onMounted(async () => {
  document.addEventListener('pointerdown', handleDocumentPointerDown)
  window.addEventListener('keydown', handleApplicationShortcut, true)
  window.addEventListener('resize', positionOpenToolbarOverlays)
  window.addEventListener('scroll', positionOpenToolbarOverlays, true)
  if (workspaceShell.value !== null) {
    fullscreenController = new FullscreenController({
      document,
      target: workspaceShell.value,
    })
    unsubscribeFullscreen = fullscreenController.subscribe((state) => {
      fullscreenActive.value = state.active
      fullscreenError.value = state.failure === null ? null : externalUiNotice('feedback.fullscreenDetail', state.failure.message)
    })
  }
  if (import.meta.env.MODE === 'e2e') {
    installAuthorityInspection(() => {
      const snapshot = activeRuntime.value.root.session.snapshot()
      return {
        actionCount: actionCount.value,
        autosaveStatus: workspace.value.autosave.status,
        documentId: snapshot.documentId,
        markdown: snapshot.markdown,
        mode: mode.value,
        revision: snapshot.revision,
        synchronizationStatus: workspace.value.synchronization.status,
      }
    })
    capabilityProbe.value = await loadCapabilityProbe(new URLSearchParams(window.location.search).get('capability'))
  }
})

onBeforeUnmount(() => {
  cancelAnimationFrame(outlineFrame)
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  window.removeEventListener('keydown', handleApplicationShortcut, true)
  window.removeEventListener('resize', positionOpenToolbarOverlays)
  window.removeEventListener('scroll', positionOpenToolbarOverlays, true)
  unsubscribeFullscreen?.()
  unsubscribeFullscreen = null
  fullscreenController?.destroy()
  fullscreenController = null
  document.removeEventListener('pointermove', resizeArticlePanel)
  ownedDrawioAdapter?.destroy()
  for (const runtime of runtimes.values()) {
    for (const unsubscribe of runtime.unsubscribe) unsubscribe()
    runtime.autosave.destroy()
    runtime.manualCheckpoint.destroy()
    runtime.root.destroy()
    runtime.modeSurfaces.destroy()
  }
})

defineExpose({
  exportForLifecycle,
  focusForLifecycle,
  flushForLifecycle,
  openHostArticle,
  saveForLifecycle,
  publishForLifecycle,
})
</script>

<template>
  <main
    ref="workspaceShell"
    class="workspace-shell w-editor-instance"
    :class="`theme__${appearanceTheme}`"
    data-app-state="bootstrapped"
    :data-document-id="workspace.activeDocument.documentId"
    :data-document-title="activeArticleTitle"
    :data-dirty="workspace.manualDirty ? 'true' : 'false'"
    :data-autosave-status="workspace.autosave.status"
    :data-error-code="workspace.error?.code ?? undefined"
    :data-theme="appearanceTheme"
    :style="workspaceShellStyle"
    @w-reference-open="onReferenceOpen"
    @w-reference-change="onReferenceChange"
  >
    <ReferencePanel
      v-if="referencePanelOpen"
      :entries="referenceEntries"
      :selected="referenceSelected"
      :error="referenceError"
      :busy="referenceBusy"
      :counts="referenceCounts"
      :notes="referenceNotes"
      :notes-error="referenceNotesError"
      :notes-busy="referenceNotesBusy"
      :notes-loading="referenceNotesLoading"
      :saved-version="referenceSavedVersion"
      :lookup-doi="lookupReferenceDoi"
      @update="updateReference"
      @remove="removeReference"
      @style="setReferenceStyle"
      @save-note="saveReferenceNote"
      @reload-notes="loadReferenceNotes"
      @close="referencePanelOpen = false"
      @insert="insertReference"
      @jump="jumpToReference"
    />
    <input
      ref="lifecycleFileInput"
      accept=".md,.markdown,text/markdown,text/plain"
      :aria-label="t('workspace.importMarkdown')"
      class="visually-hidden"
      data-testid="import-markdown-input"
      type="file"
      @change="handleMarkdownImport"
    />
    <div
      v-if="startupRecovery === null && !props.readonlyMode"
      class="workspace-body"
      :style="workspaceBodyStyle"
    >
      <aside
        class="article-panel"
        :class="{ 'article-panel--collapsed': !articlePanelOpen }"
        data-testid="desktop-library-sidebar"
        :aria-label="t('workspace.articles')"
      >
        <div class="article-panel__header">
          <div v-if="articlePanelOpen">
            <p class="section-kicker">
              {{ t('workspace.workspace') }}
            </p>
            <h2>{{ articlePanelView === 'articles' ? t('workspace.articles') : t('workspace.outline') }}</h2>
          </div>
          <button
            :aria-expanded="articlePanelOpen"
            :aria-label="t('workspace.toggleArticlePanel')"
            class="icon-button"
            :disabled="lifecycleOperation"
            type="button"
            @click="toggleArticlePanel"
          >
            <span aria-hidden="true">{{ articlePanelOpen ? '‹' : '›' }}</span>
          </button>
        </div>
        <div
          v-if="articlePanelOpen"
          :aria-label="t('workspace.sidebarViews')"
          class="article-panel__tabs"
          role="tablist"
          @keydown="handleArticlePanelTabKeydown"
        >
          <button
            id="article-panel-tab-articles"
            aria-controls="article-panel-view-articles"
            :aria-selected="articlePanelView === 'articles'"
            data-article-panel-tab="articles"
            role="tab"
            :tabindex="articlePanelView === 'articles' ? 0 : -1"
            type="button"
            @click="selectArticlePanelView('articles')"
          >
            {{ t('workspace.articles') }}
          </button>
          <button
            id="article-panel-tab-outline"
            aria-controls="article-panel-view-outline"
            :aria-selected="articlePanelView === 'outline'"
            data-article-panel-tab="outline"
            role="tab"
            :tabindex="articlePanelView === 'outline' ? 0 : -1"
            type="button"
            @click="selectArticlePanelView('outline')"
          >
            {{ t('workspace.outline') }}
          </button>
        </div>
        <div
          v-if="articlePanelOpen && articlePanelView === 'articles'"
          id="article-panel-view-articles"
          aria-labelledby="article-panel-tab-articles"
          class="article-panel__view"
          role="tabpanel"
          tabindex="0"
        >
          <nav
            :aria-label="t('workspace.articleCatalog')"
            class="article-list"
          >
            <section
              v-for="group in articleGroups"
              :key="group.dateKey"
              class="article-date-group"
              :data-testid="props.articleGroupLabels ? 'article-category-group' : 'article-date-group'"
            >
              <h3
                v-if="props.articleGroupLabels"
                class="article-category-heading"
              >
                <button
                  class="article-category-toggle"
                  data-testid="article-category-toggle"
                  type="button"
                  :aria-expanded="!collapsedArticleGroups.has(group.dateKey)"
                  :aria-controls="`article-group-${encodeURIComponent(group.dateKey)}`"
                  @click="toggleArticleGroup(group.dateKey)"
                >
                  <svg
                    class="article-category-chevron"
                    aria-hidden="true"
                    viewBox="0 0 16 16"
                  ><path d="m6 3 5 5-5 5" /></svg>
                  <span
                    class="article-category-label"
                    data-testid="article-category-heading"
                  >{{ group.label }}</span>
                  <span class="article-category-count">{{ group.articles.length }}</span>
                </button>
              </h3>
              <h3
                v-else
                class="article-date-group__heading"
                data-testid="article-date-heading"
              >
                {{ group.label }}
              </h3>
              <div
                :id="`article-group-${encodeURIComponent(group.dateKey)}`"
                class="article-group-items"
                :class="{ 'article-group-items--category': props.articleGroupLabels }"
                :hidden="props.articleGroupLabels !== undefined && collapsedArticleGroups.has(group.dateKey)"
              >
                <button
                  v-for="article in group.articles"
                  :key="article.definition.documentId"
                  :aria-current="workspace.activeDocument.documentId === article.definition.documentId ? 'page' : undefined"
                  class="article-card"
                  :class="{ 'article-card--active': workspace.activeDocument.documentId === article.definition.documentId }"
                  :data-document-id="article.definition.documentId"
                  data-testid="desktop-library-article"
                  :disabled="articleSwitching || modeSwitching || lifecycleOperation"
                  type="button"
                  @click="selectArticle(article.definition.documentId, $event)"
                >
                  <span class="article-card__title">{{ props.articleTitles?.[article.definition.documentId] ?? article.definition.title }}</span>
                  <time
                    class="article-card__time"
                    :datetime="article.lastUpdated ?? undefined"
                  >
                    {{ article.timeLabel }}
                  </time>
                </button>
              </div>
            </section>
          </nav>
          <section
            class="article-lifecycle"
            :aria-label="t('workspace.recoveryActions')"
          >
            <p class="section-kicker">
              {{ t('workspace.articleActions') }}
            </p>
            <div class="article-lifecycle__actions">
              <button
                v-if="props.createArticle"
                data-testid="desktop-new-article"
                :disabled="lifecycleOperation || articleSwitching"
                type="button"
                @click="openNewArticle"
              >
                {{ t('workspace.newArticle') }}
              </button>
              <MarkdownImportZone
                v-if="!props.toolbarImport"
                :label="t('workspace.importMarkdown')"
                :hint="t('workspace.dropMarkdown')"
                :choose-label="t('workspace.chooseMarkdown')"
                :library="Boolean(props.importArticle)"
                :disabled="lifecycleOperation || articleSwitching"
                @choose="chooseMarkdownImport"
                @files="importMarkdownFiles"
              />
            </div>
            <p
              v-if="lifecycleError && !props.toolbarImport"
              class="article-lifecycle__error"
              data-testid="document-lifecycle-error"
              role="alert"
            >
              {{ uiNoticeText(lifecycleError) }}
            </p>
          </section>
        </div>
        <nav
          v-else-if="articlePanelOpen"
          id="article-panel-view-outline"
          :aria-label="t('workspace.outlineFor', { title: activeArticleTitle })"
          aria-labelledby="article-panel-tab-outline"
          class="article-panel__view article-outline"
          role="tabpanel"
          tabindex="0"
        >
          <div class="article-outline__heading">
            <strong>{{ t('workspace.documentOutline') }}</strong><span>{{ t('workspace.outlineChapters', { count: articleOutline.filter(item => item.depth === 0).length }) }}</span>
          </div>
          <p class="article-outline__article">
            {{ activeArticleTitle }}
          </p>
          <ol
            v-if="articleOutline.length > 0"
            class="article-outline__list"
          >
            <li
              v-for="(item,index) in articleOutline"
              :key="`${item.anchor}:${item.sourceFrom}`"
              :data-outline-level="item.level"
              :data-outline-depth="item.depth"
              :style="{ '--outline-depth': item.depth }"
            >
              <span
                v-for="guideDepth in item.depth"
                :key="guideDepth"
                class="article-outline__guide"
                :class="{'article-outline__guide--end': (articleOutline[index + 1]?.depth ?? 0) < guideDepth}"
                :style="{'--guide-depth':guideDepth}"
                aria-hidden="true"
              ></span>
              <button
                :aria-current="activeOutlineAnchor === item.anchor ? 'location' : undefined"
                :aria-label="t('workspace.outlineHeading', { level: item.level, title: item.text })"
                class="article-outline__item"
                :class="{ 'article-outline__item--active': activeOutlineAnchor === item.anchor }"
                :data-outline-anchor="item.anchor"
                :disabled="modeSwitching || lifecycleOperation"
                type="button"
                @click="navigateArticleOutline(item)"
              >
                <span class="article-outline__number">{{ item.number }}</span><span class="article-outline__text">{{ item.text }}</span>
              </button>
            </li>
          </ol>
          <p
            v-else
            class="article-outline__empty"
            data-testid="article-outline-empty"
          >
            {{ t('workspace.noHeadings') }}
          </p>
        </nav>
        <button
          v-if="articlePanelOpen"
          :aria-valuenow="articlePanelWidth"
          :aria-label="t('workspace.resizeArticlePanel')"
          aria-orientation="vertical"
          aria-valuemax="360"
          aria-valuemin="200"
          class="article-panel__resize"
          role="separator"
          type="button"
          @keydown="resizeArticlePanelWithKeyboard"
          @pointerdown="startArticleResize"
        ></button>
      </aside>

      <section
        class="editor-workspace"
        :aria-label="t('workspace.editor')"
      >
        <div
          v-if="!props.readonlyMode"
          class="toolbar-region"
          aria-label="文档操作"
        >
          <slot name="document-actions"></slot>
          <button
            type="button"
            data-testid="insert-reference"
            class="reference-toolbar-button"
            :disabled="mode === 'preview' || lifecycleOperation || articleSwitching"
            @mousedown.prevent
            @click="openReferences()"
          >
            参考文献 [n]
          </button>
          <MarkdownImportZone
            v-if="props.toolbarImport"
            class="announcement-import-button"
            :label="t('workspace.importMarkdown')"
            :hint="t('workspace.dropMarkdown')"
            :choose-label="t('workspace.chooseMarkdown')"
            :disabled="lifecycleOperation || articleSwitching"
            @choose="chooseMarkdownImport"
            @files="importMarkdownFiles"
          />
          <p
            v-if="props.toolbarImport && lifecycleError"
            class="article-lifecycle__error"
            data-testid="document-lifecycle-error"
            role="alert"
          >
            {{ uiNoticeText(lifecycleError) }}
          </p>
        </div>
        <div
          ref="toolbarRegion"
          class="toolbar-region"
          role="toolbar"
          :aria-label="t('workspace.toolbar')"
          @keydown="handleToolbarKeydown"
        >
          <template
            v-for="slot in toolbarSlots"
            :key="slot.id"
          >
            <span
              v-if="slot.kind === 'separator'"
              aria-hidden="true"
              class="toolbar-divider"
              :data-toolbar-slot="slot.id"
            ></span>
            <span
              v-else-if="slot.kind === 'spacer'"
              class="toolbar-spacer"
              :data-toolbar-slot="slot.id"
            ></span>
            <div
              v-else-if="slot.kind === 'line-spacing'"
              class="toolbar-menu line-spacing-menu"
              data-toolbar-menu="line-spacing"
              :data-toolbar-slot="slot.id"
            >
              <button
                :aria-expanded="lineSpacingMenuOpen"
                :aria-label="t('lineSpacing.title')"
                aria-haspopup="menu"
                class="tool-button toolbar-menu__trigger"
                data-line-spacing-trigger
                :data-line-spacing-value="lineSpacingValue"
                type="button"
                @click="toggleLineSpacingMenu($event)"
              >
                <span
                  aria-hidden="true"
                  class="tool-button__text line-spacing-trigger__icon"
                >↕</span>
                <span class="tool-button__label">{{ t('lineSpacing.title') }}</span>
              </button>
              <div
                v-show="lineSpacingMenuOpen"
                :aria-label="t('lineSpacing.title')"
                class="toolbar-menu__panel line-spacing-menu__panel"
                data-testid="line-spacing-menu"
                role="menu"
                :style="lineSpacingPopoverStyle"
                @keydown="handleLineSpacingMenuKeydown"
              >
                <p>{{ t('lineSpacing.title') }}</p>
                <button
                  v-for="option in lineSpacingOptions"
                  :key="option.id"
                  :aria-checked="lineSpacing === option.id"
                  :data-line-spacing-option="option.id"
                  role="menuitemradio"
                  type="button"
                  @click="chooseLineSpacing(option.id)"
                >
                  <span>{{ option.label }}</span>
                  <span
                    aria-hidden="true"
                    class="line-spacing-menu__check"
                  >{{ lineSpacing === option.id ? '✓' : '' }}</span>
                </button>
              </div>
            </div>
            <div
              v-else-if="slot.kind === 'command' || slot.kind === 'command-alias'"
              class="toolbar-command"
              :data-toolbar-slot="slot.id"
            >
              <button
                :aria-describedby="commandDisabledReason(slot.command) ? 'content-command-reason' : undefined"
                :aria-label="slot.command.label"
                :aria-pressed="slot.command.query.active"
                :class="commandButtonClasses(slot.command)"
                :data-command-alias="slot.kind === 'command-alias' ? slot.command.descriptor.id : undefined"
                :data-command-id="slot.kind === 'command' ? slot.command.descriptor.id : undefined"
                :disabled="commandDisabled(slot.command)"
                type="button"
                :title="commandDisabledReason(slot.command) ?? slot.command.label"
                @blur="hideToolbarTooltip"
                @click="executeToolbarCommand(slot.command, $event)"
                @focus="showToolbarTooltip(slot.command, $event)"
                @mouseenter="showToolbarTooltip(slot.command, $event)"
                @mouseleave="hideToolbarTooltip"
              >
                <i
                  v-if="slot.command.descriptor.iconClass"
                  class="ch-icon tool-button__icon"
                  :class="slot.command.descriptor.iconClass"
                  aria-hidden="true"
                ></i>
                <span
                  v-else
                  class="tool-button__text"
                  aria-hidden="true"
                >{{ toolbarCommandText(slot.command) }}</span>
                <span class="tool-button__label">{{ slot.command.descriptor.id === 'document.manual-save' && manualSaving ? t('workspace.savingVersion') : slot.command.label }}</span>
              </button>
            </div>
            <div
              v-else-if="slot.kind === 'menu'"
              class="toolbar-menu"
              :data-toolbar-menu="slot.menu.descriptor.id"
              :data-toolbar-slot="slot.id"
            >
              <button
                :aria-controls="slot.menu.descriptor.id === 'color' ? 'rich-picker-title' : `toolbar-menu-${slot.menu.descriptor.id}`"
                :aria-expanded="slot.menu.descriptor.id === 'color'
                  ? richPickerCommand === 'text.color' || richPickerCommand === 'text.background'
                  : openedToolbarMenu === slot.menu.descriptor.id"
                :aria-haspopup="slot.menu.descriptor.id === 'color' ? 'dialog' : 'menu'"
                :aria-label="slot.menu.label"
                class="tool-button toolbar-menu__trigger"
                type="button"
                @click="activateToolbarMenu(slot.menu, $event)"
              >
                <i
                  v-if="slot.menu.descriptor.iconClass"
                  class="ch-icon tool-button__icon"
                  :class="slot.menu.descriptor.iconClass"
                  aria-hidden="true"
                ></i>
                <span
                  v-else
                  class="tool-button__text"
                  aria-hidden="true"
                >{{ toolbarMenuText(slot.menu) }}</span>
                <span class="tool-button__label">{{ slot.menu.label }}</span>
              </button>
              <div
                v-show="slot.menu.descriptor.id !== 'color' && openedToolbarMenu === slot.menu.descriptor.id"
                :id="`toolbar-menu-${slot.menu.descriptor.id}`"
                :aria-label="slot.menu.label"
                class="toolbar-menu__panel"
                role="menu"
                :style="toolbarMenuPanelStyle"
              >
                <section
                  v-if="slot.menu.descriptor.id === 'theme'"
                  class="toolbar-menu__section toolbar-theme-menu"
                >
                  <p>{{ slot.menu.label }}</p>
                  <button
                    v-for="theme in appearanceThemeOptions"
                    :key="theme.id"
                    :aria-checked="appearanceTheme === theme.id"
                    :data-theme-option="theme.id"
                    role="menuitemradio"
                    type="button"
                    @click="selectAppearanceTheme(theme.id, $event)"
                  >
                    <span
                      aria-hidden="true"
                      class="theme-swatch"
                      :data-theme-swatch="theme.id"
                    ></span>
                    <span>{{ theme.label }}</span>
                  </button>
                </section>
                <section
                  v-for="section in slot.menu.sections"
                  :key="section.id"
                  class="toolbar-menu__section"
                >
                  <p>{{ section.label }}</p>
                  <button
                    v-for="command in section.commands"
                    :key="command.descriptor.id"
                    :aria-checked="command.query.active"
                    :aria-describedby="commandDisabledReason(command) ? `command-reason-${command.descriptor.id}` : undefined"
                    :data-command-id="command.descriptor.id"
                    :disabled="commandDisabled(command)"
                    role="menuitemcheckbox"
                    type="button"
                    :title="commandDisabledReason(command) ?? command.label"
                    @click="executeToolbarCommand(command, $event)"
                  >
                    <i
                      v-if="command.descriptor.iconClass"
                      class="ch-icon toolbar-menu__icon"
                      :class="command.descriptor.iconClass"
                      aria-hidden="true"
                    ></i>
                    <span
                      v-else
                      class="toolbar-menu__icon"
                      aria-hidden="true"
                    >{{ command.descriptor.icon }}</span>
                    <span>{{ command.label }}</span>
                    <small
                      v-if="commandDisabledReason(command)"
                      :id="`command-reason-${command.descriptor.id}`"
                    >{{ commandDisabledReason(command) }}</small>
                  </button>
                </section>
              </div>
            </div>
            <div
              v-else-if="slot.kind === 'preview-alias'"
              class="toolbar-command"
              :data-toolbar-slot="slot.id"
            >
              <button
                :aria-label="previewToggleCommand.label"
                :aria-pressed="mode === 'preview'"
                :class="commandButtonClasses(previewToggleCommand)"
                data-command-alias="mode.preview"
                data-testid="toolbar-preview-toggle"
                :disabled="commandDisabled(previewToggleCommand)"
                type="button"
                :title="commandDisabledReason(previewToggleCommand) ?? previewToggleCommand.label"
                @blur="hideToolbarTooltip"
                @click="toggleFinalPreview"
                @focus="showToolbarTooltip(previewToggleCommand, $event)"
                @mouseenter="showToolbarTooltip(previewToggleCommand, $event)"
                @mouseleave="hideToolbarTooltip"
              >
                <i
                  v-if="previewToggleCommand.descriptor.iconClass"
                  class="ch-icon tool-button__icon"
                  :class="previewToggleCommand.descriptor.iconClass"
                  aria-hidden="true"
                ></i>
                <span
                  v-else
                  class="tool-button__text"
                  aria-hidden="true"
                >{{ toolbarCommandText(previewToggleCommand) }}</span>
                <span class="tool-button__label">{{ previewToggleCommand.label }}</span>
              </button>
            </div>
            <template v-if="slot.id === 'menu.export'">
              <slot name="toolbar-after-export"></slot>
            </template>
          </template>
          <div
            v-if="toolbarTooltipCommandId"
            class="toolbar-tooltip"
            role="tooltip"
            :style="toolbarTooltipStyle"
          >
            {{ toolbarTooltipText(toolbarTooltipCommandId) }}
          </div>
          <section
            v-if="tablePickerOpen"
            :aria-label="t('tablePicker.chooseSize')"
            class="table-dimension-picker"
            data-table-dimension-picker
            role="dialog"
            :style="tablePickerStyle"
          >
            <div
              ref="tablePickerGrid"
              aria-colcount="9"
              :aria-label="t('tablePicker.tableSize')"
              aria-rowcount="9"
              class="table-dimension-picker__grid"
              role="grid"
            >
              <div
                v-for="dataRows in tablePickerIndexes"
                :key="`table-row-${dataRows}`"
                class="table-dimension-picker__row"
                role="row"
              >
                <button
                  v-for="columns in tablePickerIndexes"
                  :key="`table-${columns}-${dataRows}`"
                  :aria-colindex="columns"
                  :aria-label="tablePickerCellLabel(columns, dataRows)"
                  :aria-rowindex="dataRows"
                  :aria-selected="dataRows <= tablePickerDataRows && columns <= tablePickerColumns"
                  class="table-dimension-picker__cell"
                  :data-table-picker-columns="columns"
                  :data-table-picker-rows="dataRows"
                  role="gridcell"
                  :tabindex="columns === tablePickerColumns && dataRows === tablePickerDataRows ? 0 : -1"
                  type="button"
                  @click="applyTableDimensions(columns, dataRows)"
                  @focus="activateTablePickerCell(columns, dataRows)"
                  @keydown="handleTablePickerKeydown($event, columns, dataRows)"
                  @mouseenter="activateTablePickerCell(columns, dataRows)"
                ></button>
              </div>
              <span
                aria-live="polite"
                class="table-dimension-picker__status"
                role="status"
              >{{ tablePickerStatusLabel() }}</span>
            </div>
            <p class="field-note">
              {{ t('tablePicker.instructions') }}
            </p>
            <div class="dialog-panel__actions">
              <button
                type="button"
                @click="closeTableDimensionPicker(true)"
              >
                {{ t('tablePicker.cancel') }}
              </button>
              <button
                class="primary-action"
                type="button"
                @click="applyTableDimensions(tablePickerColumns, tablePickerDataRows)"
              >
                {{ t('tablePicker.insert') }}
              </button>
            </div>
          </section>
        </div>

        <div class="workspace-controls">
          <div
            class="mode-control"
            role="group"
            :aria-label="t('mode.group')"
            :aria-busy="modeSwitching"
          >
            <button
              v-for="command in modeCommands"
              :key="command.descriptor.id"
              :aria-label="command.label"
              :aria-pressed="command.query.active"
              :data-command-id="command.descriptor.id"
              :disabled="commandDisabled(command)"
              type="button"
              :title="commandDisabledReason(command) ?? command.label"
              @click="executeToolbarCommand(command, $event)"
            >
              {{ command.label }}
            </button>
          </div>
          <div class="workspace-controls__meta">
            <span>{{ activeArticleTitle }}</span><span aria-hidden="true">·</span><span>{{ t('workspace.words', { count: liveDocumentStatistics.words }) }}</span>
          </div>
        </div>

        <section
          v-if="searchDialogOpen"
          :aria-label="t('search.title')"
          class="search-dock"
          role="search"
          @keydown="handleSearchDockKeydown"
        >
          <div class="search-dock__main">
            <button
              :aria-expanded="searchReplaceExpanded"
              :aria-label="t(searchReplaceExpanded ? 'search.collapseReplace' : 'search.expandReplace')"
              class="search-dock__icon-button search-dock__expand"
              type="button"
              @pointerdown.prevent
              @click="searchReplaceExpanded = !searchReplaceExpanded"
            >
              <span
                aria-hidden="true"
                class="search-dock__chevron"
              ></span>
            </button>
            <span
              aria-hidden="true"
              class="ch-icon ch-icon-search search-dock__search-icon"
            ></span>
            <label
              class="visually-hidden"
              for="workspace-search"
            >{{ t('search.query') }}</label>
            <input
              id="workspace-search"
              ref="searchQueryInput"
              v-model="searchQuery"
              autocomplete="off"
              :placeholder="t('search.query')"
              type="search"
              @input="runSearch"
              @keydown.enter.prevent="runSearch"
            />
            <button
              :aria-label="t('search.clear')"
              class="search-dock__icon-button search-dock__clear"
              :disabled="searchQuery.length === 0"
              type="button"
              @pointerdown.prevent
              @click="clearSearchQuery"
            ></button>
            <button
              :aria-label="t('search.matchCase')"
              :aria-pressed="searchCaseSensitive"
              class="search-dock__toggle"
              type="button"
              @pointerdown.prevent
              @click="toggleSearchCase"
            >
              Aa
            </button>
            <output
              class="search-dock__status"
              data-testid="search-status"
            >{{ searchStatus }}</output>
            <button
              :aria-label="t('search.previous')"
              class="search-dock__icon-button search-dock__previous"
              :disabled="searchMatches.length === 0"
              type="button"
              @pointerdown.prevent
              @click="navigateSearch(-1)"
            >
              <span
                aria-hidden="true"
                class="search-dock__chevron"
              ></span>
            </button>
            <button
              :aria-label="t('search.next')"
              class="search-dock__icon-button search-dock__next"
              :disabled="searchMatches.length === 0"
              type="button"
              @pointerdown.prevent
              @click="navigateSearch(1)"
            >
              <span
                aria-hidden="true"
                class="search-dock__chevron"
              ></span>
            </button>
            <button
              :aria-label="t('common.close')"
              class="search-dock__icon-button search-dock__close"
              type="button"
              @pointerdown.prevent
              @click="closeSearch"
            ></button>
          </div>
          <div
            v-if="searchReplaceExpanded"
            class="search-dock__replace"
          >
            <label
              class="visually-hidden"
              for="workspace-replacement"
            >{{ t('search.replacement') }}</label>
            <input
              id="workspace-replacement"
              v-model="searchReplacement"
              autocomplete="off"
              :placeholder="t('search.replacement')"
              type="text"
            />
            <button
              class="search-dock__replace-button"
              :disabled="!searchCanReplace"
              type="button"
              @pointerdown.prevent
              @click="replaceSearchMatches(false)"
            >
              {{ t('search.replace') }}
            </button>
            <button
              class="search-dock__replace-button"
              :disabled="!searchCanReplace"
              type="button"
              @pointerdown.prevent
              @click="replaceSearchMatches(true)"
            >
              {{ t('search.replaceAll') }}
            </button>
          </div>
          <p
            v-if="searchMode === 'preview'"
            class="search-dock__notice"
          >
            {{ t('search.readOnly') }}
          </p>
          <p
            v-if="searchError"
            class="search-dock__notice search-dock__notice--error"
            role="alert"
          >
            {{ uiNoticeText(searchError) }}
          </p>
        </section>

        <aside
          v-if="workspace.error"
          class="workspace-error"
          role="alert"
        >
          <div>
            <strong>{{ workspace.error.code }}</strong>
            <p>{{ t('feedback.externalDetail', { detail: workspace.error.message }) }}</p>
          </div>
          <div class="workspace-error__actions">
            <button
              v-for="action in workspace.error.actions"
              :key="action"
              type="button"
              @click="runRecoveryAction(action)"
            >
              {{ recoveryActionLabel(action) }}
            </button>
          </div>
        </aside>

        <section
          :aria-label="surfaceLabel"
          class="editor-surface"
          :class="{ 'editor-surface--preview': mode === 'preview' && !modeSwitching }"
          :data-mode="mode"
          data-testid="editor-surface"
          @scroll.capture.passive="scheduleOutlineFromScroll"
        >
          <span
            v-if="contentCommandsDisabled"
            id="content-command-reason"
            class="visually-hidden"
          >{{ contentCommandReason }}</span>
          <SourceEditorSurface
            v-if="mode === 'source'"
            :key="workspace.activeDocument.documentId"
            ref="sourceSurface"
            :locale="toolbarLocale"
            :session="activeRuntime.root.session"
            :state="activeRuntime.root.synchronization"
            :theme="appearanceTheme"
            @composition-end="activeRuntime.composition.end()"
            @composition-start="activeRuntime.composition.begin()"
            @selection-change="refreshSourceCommandState"
          />
          <VisualEditorSurface
            v-else
            :key="workspace.activeDocument.documentId"
            ref="visualSurface"
            :localization="uiLocalization"
            :presentation-mode="mode === 'preview'"
            :project="visualProjector"
            :session="activeRuntime.root.session"
            :state="activeRuntime.root.synchronization"
            :toggle-read-only-task="handlePreviewTaskToggle"
            :register-flush="activeRuntime.registerVisualFlush"
            :register-recovery="activeRuntime.registerVisualRecovery"
            :register-retry="activeRuntime.registerVisualRetry"
            :route-shortcut="handleVisualShortcut"
            @composition-end="activeRuntime.composition.end()"
            @composition-start="activeRuntime.composition.begin()"
            @selection-change="handleVisualSelectionChange"
            @raw-edit="handleRawEdit"
            @semantic-copy="handleSemanticCopy"
            @semantic-edit="handleSemanticEdit"
          />
        </section>

        <footer
          class="status-region"
          :aria-label="t('workspace.status')"
        >
          <span><span
            class="status-dot"
            aria-hidden="true"
          ></span> {{ synchronizationLabel }}</span><span>{{ t('status.autosave', { status: statusLabel(workspace.autosave.status) }) }}</span><span>{{ t('status.manualCheckpoint', { status: statusLabel(workspace.manualDirty ? 'dirty' : 'clean') }) }}</span><span class="status-region__mode">{{ t('status.currentMode', { mode: modeLabel(mode) }) }}</span>
          <span
            v-if="commandFeedback"
            class="status-region__command"
            role="status"
          >{{ uiNoticeText(commandFeedback) }}</span>
          <span
            v-if="fullscreenError"
            class="status-region__command"
            data-testid="fullscreen-error"
            role="alert"
          >{{ uiNoticeText(fullscreenError) }}</span>
          <span
            v-if="exportError"
            class="status-region__command"
            data-testid="export-error"
            role="alert"
          >{{ uiNoticeText(exportError) }}</span>
        </footer>
      </section>
    </div>

    <slot name="document-dialogs"></slot>
    <section
      v-if="props.showReaderPreview === true && startupRecovery === null"
      aria-labelledby="desktop-reader-preview-title"
      aria-modal="false"
      class="desktop-reader-preview"
      data-testid="desktop-reader-parity"
      role="dialog"
    >
      <div class="desktop-reader-preview__panel">
        <header class="desktop-reader-preview__header">
          <div>
            <p class="section-kicker">
              {{ t('reader.profile') }}
            </p>
            <h2 id="desktop-reader-preview-title">
              {{ t('reader.readOnlyPreview') }}
            </h2>
          </div>
          <button
            data-testid="desktop-reader-preview-close"
            type="button"
            @click="closeReaderPreview"
          >
            {{ t('common.close') }}
          </button>
        </header>
        <TiptapReaderPresentation
          :document-id="workspace.activeDocument.documentId"
          :locale="toolbarLocale"
          :markdown="workspace.activeDocument.markdown"
          :revision="workspace.activeDocument.revision"
          :theme="appearanceTheme"
          @error="commandFeedback = uiFailureNotice($event, 'feedback.externalDetail')"
        />
      </div>
    </section>

    <section
      v-if="startupRecovery !== null"
      class="startup-recovery"
      data-testid="startup-recovery"
      role="alert"
    >
      <p class="section-kicker">
        {{ t('workspace.localRecoveryRequired') }}
      </p>
      <h2>
        {{ t('workspace.storedDataUnsafe', {
          scope: t(`workspace.scope.${startupRecovery.scope}` as UiMessageKey),
        }) }}
      </h2>
      <p>
        {{ t('workspace.envelopeReason', {
          reason: t(startupRecovery.reason === 'unsupported-version'
            ? 'workspace.reason.unsupported'
            : 'workspace.reason.corrupt'),
        }) }}
      </p>
      <p class="startup-recovery__key">
        {{ startupRecovery.key }}
      </p>
      <div class="startup-recovery__actions">
        <button
          class="primary-action"
          type="button"
          @click="downloadStartupRecovery"
        >
          {{ t('workspace.exportRawEnvelope') }}
        </button>
        <button
          :disabled="!rawRecoveryExported"
          :title="rawRecoveryExported ? t('workspace.resetEnabledHint') : t('workspace.resetRequiresExportHint')"
          type="button"
          @click="requestStartupRecoveryReset"
        >
          {{ t('workspace.clearAndReset') }}
        </button>
      </div>
      <p
        v-if="rawRecoveryExported"
        data-testid="raw-recovery-exported"
        role="status"
      >
        {{ t('workspace.resetAvailable') }}
      </p>
      <p
        v-if="exportError"
        data-testid="startup-recovery-error"
        role="alert"
      >
        {{ uiNoticeText(exportError) }}
      </p>
      <div
        v-if="recoveryResetConfirmation"
        class="startup-recovery__confirmation"
        data-testid="startup-recovery-confirmation"
      >
        <p>{{ t('workspace.resetConfirmation') }}</p>
        <div class="startup-recovery__actions">
          <button
            type="button"
            @click="cancelStartupRecoveryReset"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="primary-action"
            type="button"
            @click="confirmStartupRecoveryReset"
          >
            {{ t('workspace.confirmReset') }}
          </button>
        </div>
      </div>
    </section>

    <div
      v-if="newArticleDialogOpen"
      class="dialog-backdrop"
      data-testid="new-article-dialog-backdrop"
      @mousedown.self="closeNewArticle()"
    >
      <section
        aria-labelledby="new-article-title-heading"
        aria-modal="true"
        class="dialog-panel"
        data-testid="new-article-dialog"
        role="dialog"
        @keydown.esc.prevent="closeNewArticle()"
      >
        <p class="section-kicker">
          Library
        </p>
        <h2 id="new-article-title-heading">
          New article
        </h2>
        <label for="new-article-title">Title</label>
        <input
          id="new-article-title"
          v-model="newArticleTitle"
          data-testid="new-article-title"
          autocomplete="off"
          type="text"
          @keydown.enter.prevent="submitNewArticle"
        />
        <p
          v-if="newArticleError"
          class="field-error"
          role="alert"
        >
          {{ uiNoticeText(newArticleError) }}
        </p>
        <div class="dialog-panel__actions">
          <button
            type="button"
            @click="closeNewArticle()"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="primary-action"
            data-testid="new-article-create"
            type="button"
            @click="submitNewArticle"
          >
            Create
          </button>
        </div>
      </section>
    </div>

    <div
      v-if="lifecycleDecision"
      class="dialog-backdrop"
      data-testid="article-switch-decision-backdrop"
    >
      <section
        aria-labelledby="article-switch-decision-title"
        aria-modal="true"
        class="dialog-panel lifecycle-decision-panel"
        data-testid="article-switch-decision"
        role="dialog"
      >
        <p class="section-kicker">
          {{ t('workspace.protectedOperation') }}
        </p>
        <h2 id="article-switch-decision-title">
          {{ uiNoticeText(lifecycleDecision.title) }}
        </h2>
        <p>
          {{ uiNoticeText(lifecycleDecision.body) }}
        </p>
        <div class="dialog-panel__actions">
          <button
            data-testid="article-switch-cancel"
            type="button"
            @click="settleLifecycleDecision('cancel')"
          >
            {{ t('lifecycle.cancel') }}
          </button>
          <button
            v-if="props.articleSwitchPolicy !== 'save-discard'"
            data-testid="article-switch-draft"
            type="button"
            @click="settleLifecycleDecision('draft')"
          >
            {{ t('lifecycle.keepDraft') }}
          </button>
          <button
            v-if="props.articleSwitchPolicy !== 'save-discard'"
            data-testid="article-switch-export"
            type="button"
            @click="settleLifecycleDecision('export')"
          >
            {{ t('lifecycle.exportAndContinue') }}
          </button>
          <button
            v-if="props.articleSwitchPolicy === 'save-discard'"
            data-testid="article-switch-discard"
            type="button"
            @click="settleLifecycleDecision('discard')"
          >
            {{ t('lifecycle.discardAndContinue') }}
          </button>
          <button
            class="primary-action"
            data-testid="article-switch-save"
            type="button"
            @click="settleLifecycleDecision('save')"
          >
            {{ t('lifecycle.saveAndContinue') }}
          </button>
        </div>
      </section>
    </div>

    <div
      v-if="lifecycleConfirmation"
      class="dialog-backdrop"
    >
      <section
        aria-labelledby="document-lifecycle-confirmation-title"
        aria-modal="true"
        class="dialog-panel"
        :data-confirmation-kind="lifecycleConfirmation.kind"
        data-testid="document-lifecycle-confirmation"
        role="dialog"
      >
        <p class="section-kicker">
          {{ t('workspace.protectedOperation') }}
        </p>
        <h2 id="document-lifecycle-confirmation-title">
          {{ uiNoticeText(lifecycleConfirmation.title) }}
        </h2>
        <p>{{ uiNoticeText(lifecycleConfirmation.body) }}</p>
        <div class="dialog-panel__actions">
          <button
            data-testid="document-lifecycle-cancel"
            type="button"
            @click="settleLifecycleConfirmation(false)"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="danger-action"
            data-testid="document-lifecycle-confirm"
            type="button"
            @click="settleLifecycleConfirmation(true)"
          >
            {{ uiNoticeText(lifecycleConfirmation.confirmLabel) }}
          </button>
        </div>
      </section>
    </div>

    <section
      v-if="wordCountDialogOpen"
      ref="wordCountDialog"
      aria-labelledby="word-count-title"
      class="dialog-panel toolbar-popover"
      data-toolbar-popover="word-count"
      data-testid="word-count-dialog"
      role="dialog"
      :style="wordCountPopoverStyle"
      @keydown.esc.prevent="closeWordCount"
    >
      <p class="section-kicker">
        {{ t('document.authoritativeRevision') }}
      </p>
      <h2 id="word-count-title">
        {{ t('document.statistics') }}
      </h2>
      <dl
        v-if="wordCountStatistics"
        class="document-statistics"
      >
        <div>
          <dt>{{ t('document.revision') }}</dt><dd data-statistic="revision">
            {{ wordCountStatistics.revision }}
          </dd>
        </div>
        <div>
          <dt>{{ t('document.words') }}</dt><dd data-statistic="words">
            {{ wordCountStatistics.words }}
          </dd>
        </div>
        <div>
          <dt>{{ t('document.characters') }}</dt><dd data-statistic="characters">
            {{ wordCountStatistics.characters }}
          </dd>
        </div>
        <div>
          <dt>{{ t('document.charactersWithoutWhitespace') }}</dt><dd data-statistic="characters-without-whitespace">
            {{ wordCountStatistics.charactersWithoutWhitespace }}
          </dd>
        </div>
        <div>
          <dt>{{ t('document.lines') }}</dt><dd data-statistic="lines">
            {{ wordCountStatistics.lines }}
          </dd>
        </div>
        <div>
          <dt>{{ t('document.paragraphs') }}</dt><dd data-statistic="paragraphs">
            {{ wordCountStatistics.paragraphs }}
          </dd>
        </div>
        <div>
          <dt>{{ t('document.utf8Bytes') }}</dt><dd data-statistic="bytes">
            {{ wordCountStatistics.bytes }}
          </dd>
        </div>
      </dl>
      <p
        v-if="wordCountError"
        class="field-error"
        role="alert"
      >
        {{ uiNoticeText(wordCountError) }}
      </p>
      <div class="dialog-panel__actions">
        <button
          class="primary-action"
          type="button"
          @click="closeWordCount"
        >
          {{ t('common.close') }}
        </button>
      </div>
    </section>

    <div
      v-if="shortcutDialogOpen"
      class="dialog-backdrop"
      @mousedown.self="closeShortcutSettings"
    >
      <section
        ref="shortcutDialog"
        aria-labelledby="shortcut-settings-title"
        aria-modal="true"
        class="dialog-panel shortcut-settings-dialog"
        data-testid="shortcut-settings"
        role="dialog"
        @keydown="handleShortcutDialogKeydown"
      >
        <p class="section-kicker">
          {{ t('shortcuts.applicationSettings') }}
        </p>
        <h2 id="shortcut-settings-title">
          {{ t('shortcuts.title') }}
        </h2>
        <p class="field-note">
          {{ t('shortcuts.help') }}
        </p>
        <div class="shortcut-settings-list">
          <div
            v-for="descriptor in shortcutConfigurableCommands"
            :key="descriptor.id"
            class="shortcut-setting-row"
            :data-shortcut-command="descriptor.id"
          >
            <span class="shortcut-setting-row__identity">
              {{ commandLabel(descriptor.id) }}
              <code>{{ descriptor.id }}</code>
            </span>
            <button
              :aria-label="t('shortcuts.recordFor', { command: commandLabel(descriptor.id) })"
              :aria-pressed="shortcutRecordingCommandId === descriptor.id"
              class="shortcut-recorder"
              :data-shortcut-state="shortcutRecordingCommandId === descriptor.id ? 'armed' : 'idle'"
              :data-shortcut-value="shortcutDraft[descriptor.id] ?? ''"
              data-shortcut-recorder
              type="button"
              @click="toggleShortcutRecorder(descriptor.id)"
            >
              <span
                v-if="shortcutKeycapLabels(shortcutDraft[descriptor.id] ?? '').length > 0"
                class="shortcut-keycaps"
              >
                <kbd
                  v-for="keycap in shortcutKeycapLabels(shortcutDraft[descriptor.id] ?? '')"
                  :key="keycap"
                >{{ keycap }}</kbd>
              </span>
              <span
                v-else
                class="shortcut-recorder__unassigned"
              >{{ t('shortcuts.unassigned') }}</span>
              <span class="shortcut-recorder__action">
                {{ shortcutRecordingCommandId === descriptor.id ? t('shortcuts.pressShortcut') : t('shortcuts.record') }}
              </span>
            </button>
          </div>
        </div>
        <p
          v-if="shortcutRecordingCommandId"
          class="field-note shortcut-recording-status"
          role="status"
        >
          {{ t('shortcuts.recording', { command: shortcutRecordingCommandLabel }) }}
        </p>
        <p
          v-if="shortcutError"
          class="field-error"
          role="alert"
        >
          {{ uiNoticeText(shortcutError) }}
        </p>
        <div class="dialog-panel__actions">
          <button
            type="button"
            @click="resetShortcutSettings"
          >
            {{ t('shortcuts.resetDefaults') }}
          </button>
          <button
            type="button"
            @click="closeShortcutSettings"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="primary-action"
            type="button"
            @click="applyShortcutSettings"
          >
            {{ t('shortcuts.apply') }}
          </button>
        </div>
      </section>
    </div>

    <div
      v-if="richPickerCommand"
      class="dialog-backdrop dialog-backdrop--picker"
      @mousedown.self="closeRichPicker()"
    >
      <section
        :data-picker-command="richPickerCommand"
        aria-labelledby="rich-picker-title"
        aria-modal="false"
        class="dialog-panel toolbar-popover rich-text-picker"
        role="dialog"
        :style="richPickerStyle"
        @keydown.esc.prevent="closeRichPicker()"
      >
        <template v-if="richPickerCommand === 'text.color' || richPickerCommand === 'text.background'">
          <h2
            id="rich-picker-title"
            class="visually-hidden"
          >
            {{ t('color.title') }}
          </h2>
          <div
            :aria-label="t('color.type')"
            class="rich-color-picker__tabs"
            role="tablist"
          >
            <button
              :aria-selected="richPickerCommand === 'text.color'"
              role="tab"
              type="button"
              @click="selectRichColorCommand('text.color')"
            >
              {{ t('color.text') }}
            </button>
            <button
              :aria-selected="richPickerCommand === 'text.background'"
              role="tab"
              type="button"
              @click="selectRichColorCommand('text.background')"
            >
              {{ t('color.background') }}
            </button>
          </div>
          <button
            class="rich-color-picker__clear"
            data-color-action="clear"
            type="button"
            @click="clearRichColor"
          >
            <span
              aria-hidden="true"
              class="rich-color-picker__clear-icon"
            ></span>
            {{ t('color.clear') }}
          </button>
          <div class="rich-color-picker__main">
            <div
              :aria-label="t('color.saturationBrightness')"
              class="rich-color-picker__saturation"
              role="application"
              :style="richColorSaturationStyle"
              tabindex="0"
              @pointerdown.prevent="updateRichColorFromSaturation"
              @pointermove.prevent="updateRichColorFromSaturation"
            >
              <span
                aria-hidden="true"
                class="rich-color-picker__pointer"
                :style="richColorPointerStyle"
              ></span>
            </div>
            <div class="rich-color-picker__controls">
              <input
                v-model.number="richColorHue"
                :aria-label="t('color.hue')"
                class="rich-color-picker__hue"
                max="360"
                min="0"
                type="range"
                @input="updateRichColorFromHsv"
              />
              <input
                id="rich-picker-value"
                ref="richPickerInput"
                v-model="richPickerValue"
                :aria-label="t('color.current')"
                class="rich-color-picker__preview"
                type="color"
                @change="applyChosenRichColor(richPickerValue)"
              />
            </div>
          </div>
          <section class="rich-color-picker__section">
            <h3>{{ t('color.recent') }}</h3>
            <div
              :aria-label="t('color.recent')"
              class="rich-color-picker__recent"
              role="listbox"
            >
              <template
                v-for="index in RICH_RECENT_COLOR_SLOTS"
                :key="index"
              >
                <button
                  v-if="richRecentColors[index]"
                  :aria-label="t('color.recentValue', { color: richRecentColors[index] })"
                  class="rich-color-picker__swatch"
                  role="option"
                  :style="{ backgroundColor: richRecentColors[index] }"
                  type="button"
                  @click="applyChosenRichColor(richRecentColors[index])"
                ></button>
                <span
                  v-else
                  aria-hidden="true"
                  class="rich-color-picker__swatch rich-color-picker__swatch--empty"
                ></span>
              </template>
            </div>
          </section>
          <section class="rich-color-picker__section">
            <h3>{{ t('color.presets') }}</h3>
            <div
              :aria-label="t('color.presets')"
              class="rich-color-picker__presets"
              role="listbox"
            >
              <button
                v-for="color in RICH_COLOR_PRESETS"
                :key="color"
                :aria-label="color"
                :aria-selected="richPickerValue.toLocaleLowerCase() === color"
                class="rich-color-picker__preset rich-color-picker__swatch"
                role="option"
                :style="{ backgroundColor: color }"
                type="button"
                @click="applyChosenRichColor(color)"
              ></button>
            </div>
          </section>
        </template>
        <template v-else>
          <p class="section-kicker">
            {{ t('richText.formatting') }}
          </p>
          <h2 id="rich-picker-title">
            {{ richPickerLabel }}
          </h2>
          <template v-if="richPickerCommand === 'text.ruby'">
            <label for="rich-picker-base">{{ t('richText.baseText') }}</label>
            <input
              id="rich-picker-base"
              v-model="richPickerBase"
              autocomplete="off"
              type="text"
              @input="richPickerError = null; richPickerPending = false"
            />
            <label for="rich-picker-value">{{ t('richText.rubyOrPinyin') }}</label>
          </template>
          <label
            v-else
            for="rich-picker-value"
          >{{ richPickerLabel }}</label>
          <select
            v-if="richPickerCommand === 'text.size'"
            id="rich-picker-value"
            ref="richPickerInput"
            v-model="richPickerValue"
            :aria-label="t('richText.fontSize')"
            role="listbox"
            size="6"
            @change="richPickerError = null; richPickerPending = false"
          >
            <option
              v-for="size in ['12', '14', '16', '18', '24', '32']"
              :key="size"
              :value="size"
            >
              {{ size }} px
            </option>
          </select>
          <input
            v-else
            id="rich-picker-value"
            ref="richPickerInput"
            v-model="richPickerValue"
            autocomplete="off"
            type="text"
            @input="richPickerError = null; richPickerPending = false"
          />
        </template>
        <p
          v-if="richPickerError"
          class="dialog-panel__error"
          role="alert"
        >
          {{ uiNoticeText(richPickerError) }}
        </p>
        <div
          v-if="richPickerCommand !== 'text.color' && richPickerCommand !== 'text.background'"
          class="dialog-panel__actions"
        >
          <button
            type="button"
            @click="closeRichPicker()"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="primary-action"
            :disabled="richPickerPending"
            type="button"
            @click="applyRichPicker"
          >
            {{ t('common.apply') }}
          </button>
        </div>
      </section>
    </div>

    <div
      v-if="linkDialogOpen"
      class="dialog-backdrop"
      @mousedown.self="closeLinkDialog()"
    >
      <section
        data-picker-command="insert.link"
        aria-labelledby="link-dialog-title"
        aria-modal="true"
        class="dialog-panel"
        role="dialog"
        @keydown.esc.prevent="closeLinkDialog()"
      >
        <p class="section-kicker">
          {{ t('link.kicker') }}
        </p>
        <h2 id="link-dialog-title">
          {{ t('link.destination') }}
        </h2>
        <label for="link-url">{{ t('link.url') }}</label>
        <input
          id="link-url"
          ref="linkInput"
          v-model="linkUrl"
          autocomplete="url"
          type="url"
        />
        <div class="dialog-panel__actions">
          <button
            type="button"
            @click="closeLinkDialog()"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="primary-action"
            type="button"
            @click="applyLinkDialog"
          >
            {{ t('common.apply') }}
          </button>
        </div>
      </section>
    </div>

    <CodeMirrorSourceEditorHost
      v-if="rawDialogKind"
      :key="rawDialogKind"
      command-id="raw.source"
      input-id="raw-source"
      :label="t('rawNode.editSource')"
      :locale="toolbarLocale"
      :model-value="rawDraftSource"
      :title="t(rawDialogKind === 'rawInline' ? 'rawNode.unknownInline' : 'rawNode.unknownBlock')"
      @apply="applyRawDialog"
      @cancel="closeRawDialog()"
      @update:model-value="rawDraftSource = $event"
    />

    <CodeMirrorSourceEditorHost
      v-if="codeDialogOpen"
      command-id="insert.code-block"
      :error="uiNoticeText(codeDraftError)"
      input-id="code-block-source"
      :label="t('codeEditor.source')"
      language-input-id="code-block-language"
      :language-label="t('codeEditor.language')"
      :language-value="codeDraftLanguage"
      :locale="toolbarLocale"
      :model-value="codeDraftContent"
      source-mode="code"
      :title="t('codeEditor.title')"
      @apply="applyCodeBlockDialog"
      @cancel="closeCodeBlockDialog()"
      @update:language-value="codeDraftLanguage = $event; codeDraftError = null"
      @update:model-value="codeDraftContent = $event; codeDraftError = null"
    />

    <CodeMirrorSourceEditorHost
      v-if="mermaidDialogOpen"
      command-id="mermaid.source"
      :error="uiNoticeText(mermaidDraftError)"
      input-id="mermaid-source"
      :label="t('mermaid.source')"
      :locale="toolbarLocale"
      :model-value="mermaidDraftCode"
      source-mode="code"
      :title="mermaidDialogTitle"
      :title-override="mermaidDialogTitle"
      @apply="applyMermaidDialog"
      @cancel="closeMermaidDialog()"
      @update:model-value="mermaidDraftCode = $event; mermaidDraftError = null"
    />

    <ChartTableEditorHost
      v-if="chartTableDialogOpen"
      :chart-type="chartTableDraftType"
      :columns="chartTableDraftColumns"
      :error="uiNoticeText(chartTableDraftError)"
      :locale="toolbarLocale"
      :options="chartTableDraftOptions"
      :rows="chartTableDraftRows"
      :title="chartTableDraftTitle"
      @apply="applyChartTableDialog"
      @cancel="closeChartTableDialog()"
    />

    <MediaEditorHost
      v-if="mediaDialogKind"
      :key="mediaDialogKind"
      :initial-name="mediaDraftName"
      :initial-url="mediaDraftUrl"
      :kind="mediaDialogKind"
      :locale="toolbarLocale"
      :upload-adapter="uploadAdapter"
      @apply="applyMediaDialog"
      @cancel="closeMediaDialog()"
    />

    <MediaEditorHost
      v-if="attachmentDialogKind"
      :key="attachmentDialogKind"
      :initial-media-type="attachmentDraftMediaType"
      :initial-name="attachmentDraftName"
      :initial-size="attachmentDraftSize"
      :initial-url="attachmentDraftUrl"
      :kind="attachmentDialogKind"
      :locale="toolbarLocale"
      :upload-adapter="uploadAdapter"
      @apply="applyAttachmentDialog"
      @cancel="closeAttachmentDialog()"
    />

    <DrawioDialog
      v-if="drawioDialogOpen"
      :adapter="drawioAdapter"
      :initial-xml="drawioInitialXml"
      :locale="toolbarLocale"
      :request-id="drawioRequestId"
      :upload-error="drawioUploadError"
      :upload-busy="drawioUploadBusy"
      @retry-upload="pendingDrawioPayload && acceptDrawioPayload(pendingDrawioPayload)"
      @apply="acceptDrawioPayload"
      @cancel="closeDrawioDialog()"
    />

    <FormulaPicker
      v-if="formulaDialogOpen"
      :error="uiNoticeText(formulaDraftError)"
      :locale="toolbarLocale"
      :mode="formulaMode"
      :model-value="formulaContent"
      @apply="applyFormulaDialog"
      @cancel="closeFormulaDialog()"
      @update:mode="formulaMode = $event; formulaDraftError = null"
      @update:model-value="formulaContent = $event; formulaDraftError = null"
    />

    <DetachedDraftEditorHost
      v-if="panelDialogCommand"
      :key="panelDialogCommand"
      :command-id="panelDialogCommand"
      :error="uiNoticeText(panelDraftError)"
      input-id="panel-source"
      :label="t('layout.cherryStructure')"
      :locale="toolbarLocale"
      :model-value="panelDraftSource"
      :rows="9"
      :title="t('panel.source')"
      @apply="applyPanelDialog"
      @cancel="closePanelDialog()"
      @update:model-value="panelDraftSource = $event; panelDraftError = null"
    />

    <DetachedDraftEditorHost
      v-if="columnLayoutDialogCommand"
      :key="columnLayoutDialogCommand"
      :command-id="columnLayoutDialogCommand"
      :error="uiNoticeText(columnLayoutDraftError)"
      input-id="column-layout-source"
      :label="t('layout.cherryStructure')"
      :locale="toolbarLocale"
      :model-value="columnLayoutDraftSource"
      :rows="11"
      :title="t('layout.columnSource')"
      @apply="applyColumnLayoutDialog"
      @cancel="closeColumnLayoutDialog()"
      @update:model-value="columnLayoutDraftSource = $event; columnLayoutDraftError = null"
    />

    <DetachedDraftEditorHost
      v-if="disclosureDialogCommand"
      :key="disclosureDialogCommand"
      :command-id="disclosureDialogCommand"
      :error="uiNoticeText(disclosureDraftError)"
      input-id="disclosure-source"
      :label="t('layout.cherryStructure')"
      :locale="toolbarLocale"
      :model-value="disclosureDraftSource"
      :title="t(disclosureDialogCommand === 'layout.tabs' ? 'layout.tabsSource' : 'layout.accordionSource')"
      @apply="applyDisclosureDialog"
      @cancel="closeDisclosureDialog()"
      @update:model-value="disclosureDraftSource = $event; disclosureDraftError = null"
    />

    <DetachedDraftEditorHost
      v-if="timelineDialogOpen"
      command-id="layout.timeline"
      :error="uiNoticeText(timelineDraftError)"
      input-id="timeline-source"
      :label="t('layout.cherryStructure')"
      :locale="toolbarLocale"
      :model-value="timelineDraftSource"
      :rows="12"
      :title="t('layout.timelineSource')"
      @apply="applyTimelineDialog"
      @cancel="closeTimelineDialog()"
      @update:model-value="timelineDraftSource = $event; timelineDraftError = null"
    />

    <component :is="capabilityProbe" />
  </main>
</template>
