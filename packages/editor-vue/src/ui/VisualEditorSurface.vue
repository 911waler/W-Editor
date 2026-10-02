<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch, type CSSProperties } from 'vue'

import {
  TiptapTransactionPatchPlanner,
  TiptapVisualAdapter,
  type TiptapVisualProjector,
  serializeOrdinaryTiptapPatch,
} from '../adapters'
import { createRandomId } from '../services/randomId'
import { copyText } from '../services/copyText'
import { projectOrdinaryMarkdown, type DocumentReference, type ReferenceStyle } from '@w-editor/editor-core'
import type { InlineMarkCommandId } from '@w-editor/editor-core'
import type { RichInlineMarkCommandId } from '@w-editor/editor-core'
import {
  chartTableDescriptor,
  panelDescriptor,
  mermaidDescriptor,
  parseMermaidAt,
  parseChartTableAt,
  parseColumnLayoutAt,
  parseDisclosureAt,
  parsePanelAt,
  parseTimelineAt,
  parseMediaAt,
  parseAttachmentAt,
  parseDrawioAt,
  type AlignmentCommandId,
  type ColumnLayoutKind,
  type FormulaMode,
  type MermaidDiagramType,
  type MediaKind,
  type AttachmentKind,
  type PanelVariant,
} from '@w-editor/editor-core'
import type { SemanticNodeCopyEvent, VisualRawNodeSelection, VisualSemanticBlockSelection } from '../adapters'
import type { HeadingCommandId } from '../services'
import type { ListCommandId } from '../services'
import type { UiLocalizationStore, UiMessageKey, UiMessageParams } from '../services/uiLocalization'
import type { DocumentSession, SynchronizationStateStore } from '@w-editor/editor-core'
import { createInstanceDomService, VisualSynchronizationService, type InstanceDomService } from '../services'

const props = defineProps<{
  readonly localization: UiLocalizationStore
  readonly domService?: InstanceDomService
  readonly presentationMode?: boolean
  readonly project?: TiptapVisualProjector
  readonly registerFlush: (flush: (() => Promise<void>) | null) => void
  readonly registerRecovery: (recover: (() => Promise<void>) | null) => void
  readonly registerRetry: (retry: (() => Promise<void>) | null) => void
  readonly routeShortcut: (event: KeyboardEvent) => boolean
  readonly session: DocumentSession
  readonly state: SynchronizationStateStore
  readonly toggleReadOnlyTask?: (event: Readonly<{ checked: boolean; index: number }>) => boolean
}>()
const emit = defineEmits<{
  compositionEnd: []
  compositionStart: []
  rawEdit: [event: VisualRawNodeSelection]
  selectionChange: [kind: 'node' | 'text']
  semanticCopy: [event: SemanticNodeCopyEvent]
  semanticEdit: [event: VisualSemanticBlockSelection & Readonly<{ editorId: string }>]
}>()
const host = ref<HTMLElement | null>(null)
const surface = ref<HTMLElement | null>(null)
const localizationLocale = ref(props.localization.locale)
const unsubscribeLocalization = props.localization.subscribe((locale) => {
  localizationLocale.value = locale
  void nextTick(updateEditableBoundaryLabels)
})
const blockHandleVisible = ref(false)
const blockCopyFailed = ref(false)
const blockHandleStyle = ref<CSSProperties>({})
const blockMenuStage = ref<'closed' | 'color' | 'insert' | 'root' | 'turn-into'>('closed')
const activeBlockKind = ref<'code' | 'image' | 'text'>('text')
const addBlockAction = ref<HTMLButtonElement | null>(null)
const addAboveAction = ref<HTMLButtonElement | null>(null)
const turnIntoAction = ref<HTMLButtonElement | null>(null)
const quoteAction = ref<HTMLButtonElement | null>(null)
let activeVisualBlock: HTMLElement | null = null
const visualProjector = props.project ?? projectOrdinaryMarkdown
let adapter: TiptapVisualAdapter | null = null
let instanceDomService: InstanceDomService | null = null
let ownsInstanceDomService = false
let disposeDocumentPointerDown: (() => void) | null = null
let transactionSequence = 0

type BlockColorCommandId = 'text.background' | 'text.color'
type BlockColorName = 'blue' | 'brown' | 'default' | 'gray' | 'green' | 'orange' | 'pink' | 'purple' | 'red' | 'yellow'
interface BlockColorOption {
  readonly commandId: BlockColorCommandId
  readonly id: string
  readonly name: BlockColorName
  readonly value: string | null
}

function t(key: UiMessageKey, params?: UiMessageParams): string {
  void localizationLocale.value
  return props.localization.t(key, params)
}

function updateEditableBoundaryLabels(): void {
  const editor = host.value?.querySelector<HTMLElement>('.ProseMirror')
  if (editor === null || editor === undefined) return
  editor.setAttribute('aria-label', t(props.presentationMode === true ? 'mode.surface.preview' : 'mode.surface.visual'))
  if (props.presentationMode === true) {
    delete editor.dataset['editableBoundaryStart']
    delete editor.dataset['editableBoundaryEnd']
    return
  }
  editor.dataset['editableBoundaryStart'] = t('editorBoundary.start')
  editor.dataset['editableBoundaryEnd'] = t('editorBoundary.end')
}

function colorOption(commandId: BlockColorCommandId, name: BlockColorName, value: string | null): BlockColorOption {
  const kind = commandId === 'text.color' ? 'text' : 'background'
  return Object.freeze({ commandId, id: `${kind}-${name}`, name, value })
}

function blockColorOptionLabel(option: BlockColorOption): string {
  const color = t(`blockMenu.color.${option.name}`)
  return t(option.commandId === 'text.color' ? 'blockMenu.colorText' : 'blockMenu.colorBackground', { color })
}

const TEXT_COLOR_OPTIONS = Object.freeze([
  colorOption('text.color', 'default', null),
  colorOption('text.color', 'gray', '#787774'),
  colorOption('text.color', 'brown', '#9f6b53'),
  colorOption('text.color', 'orange', '#d9730d'),
  colorOption('text.color', 'yellow', '#cb912f'),
  colorOption('text.color', 'green', '#448361'),
  colorOption('text.color', 'blue', '#337ea9'),
  colorOption('text.color', 'purple', '#9065b0'),
  colorOption('text.color', 'pink', '#c14c8a'),
  colorOption('text.color', 'red', '#d44c47'),
])
const BACKGROUND_COLOR_OPTIONS = Object.freeze([
  colorOption('text.background', 'default', null),
  colorOption('text.background', 'gray', '#f1f1ef'),
  colorOption('text.background', 'brown', '#f4eeee'),
  colorOption('text.background', 'orange', '#fbecdd'),
  colorOption('text.background', 'yellow', '#fbf3db'),
  colorOption('text.background', 'green', '#edf3ec'),
  colorOption('text.background', 'blue', '#e7f3f8'),
  colorOption('text.background', 'purple', '#f4f0f7'),
  colorOption('text.background', 'pink', '#f9eef3'),
  colorOption('text.background', 'red', '#fdebec'),
])
const recentBlockColors = ref<readonly BlockColorOption[]>(Object.freeze([
  TEXT_COLOR_OPTIONS[9]!,
  BACKGROUND_COLOR_OPTIONS[1]!,
]))

function eligibleVisualBlock(target: Node | null): HTMLElement | null {
  const editor = host.value?.querySelector<HTMLElement>('.ProseMirror') ?? null
  if (editor === null || target === null) return null
  let element = target instanceof HTMLElement ? target : target.parentElement
  while (element !== null && element.parentElement !== editor) element = element.parentElement
  if (element?.parentElement !== editor) return null
  return element
}

function visualBlockKind(block: HTMLElement): 'code' | 'image' | 'text' {
  if (block.matches('pre') || block.querySelector('pre') !== null) return 'code'
  if (
    block.matches('[data-semantic-kind="media"][data-media-kind="image"]')
    || block.querySelector('[data-semantic-kind="media"][data-media-kind="image"]') !== null
    || block.querySelector('img') !== null
  ) return 'image'
  return 'text'
}

function positionBlockHandle(block: HTMLElement): void {
  const owner = surface.value
  if (owner === null) return
  const blockBox = block.getBoundingClientRect()
  const ownerBox = owner.getBoundingClientRect()
  const menuTopBoundary = Math.max(8, ownerBox.top + 8)
  blockHandleStyle.value = Object.freeze({
    '--visual-block-menu-available-height': `${Math.max(260, window.innerHeight - blockBox.top - 20)}px`,
    '--visual-block-menu-max-height': `${Math.max(260, window.innerHeight - menuTopBoundary - 20)}px`,
    '--visual-block-menu-upward-limit': `${Math.max(0, blockBox.top - menuTopBoundary)}px`,
    left: `${Math.max(2, blockBox.left - ownerBox.left - 64)}px`,
    top: `${Math.max(4, blockBox.top - ownerBox.top)}px`,
  })
  blockHandleVisible.value = true
}

function setActiveVisualBlock(block: HTMLElement | null): void {
  if (block === null || blockMenuStage.value !== 'closed') return
  activeVisualBlock = block
  activeBlockKind.value = visualBlockKind(block)
  positionBlockHandle(block)
}

function updateVisualBlockFromSelection(): void {
  const selection = window.getSelection()
  setActiveVisualBlock(eligibleVisualBlock(selection?.anchorNode ?? null))
}

function handleVisualPointerMove(event: PointerEvent): void {
  if (props.presentationMode === true) return
  const target = event.target
  if (target instanceof Element && target.closest('.visual-block-context') !== null) return
  setActiveVisualBlock(eligibleVisualBlock(target instanceof Node ? target : null))
}

function handleVisualFocus(event: FocusEvent): void {
  if (props.presentationMode === true) return
  const target = event.target
  if (target instanceof Element && target.closest('.visual-block-context') !== null) return
  setActiveVisualBlock(eligibleVisualBlock(target instanceof Node ? target : null))
  updateVisualBlockFromSelection()
}

function closeBlockMenu(focusHandle = false): void {
  blockCopyFailed.value = false
  blockMenuStage.value = 'closed'
  if (focusHandle) void nextTick(() => surface.value?.querySelector<HTMLButtonElement>('.visual-block-handle')?.focus())
}

function openBlockMenu(): void {
  if (activeVisualBlock === null || !activeVisualBlock.isConnected) updateVisualBlockFromSelection()
  if (activeVisualBlock === null) return
  positionBlockHandle(activeVisualBlock)
  blockMenuStage.value = 'root'
  void nextTick(() => turnIntoAction.value?.focus())
}

function toggleBlockMenu(): void {
  if (blockMenuStage.value === 'root' || blockMenuStage.value === 'color' || blockMenuStage.value === 'turn-into') closeBlockMenu(true)
  else openBlockMenu()
}

function toggleAddBlockMenu(): void {
  if (blockMenuStage.value === 'insert') {
    closeBlockMenu()
    void nextTick(() => addBlockAction.value?.focus())
    return
  }
  if (activeVisualBlock === null || !activeVisualBlock.isConnected) updateVisualBlockFromSelection()
  if (activeVisualBlock === null) return
  positionBlockHandle(activeVisualBlock)
  blockMenuStage.value = 'insert'
  void nextTick(() => addAboveAction.value?.focus())
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (blockMenuStage.value === 'closed') return
  const target = event.target
  if (target instanceof Element && target.closest('.visual-block-context') !== null) return
  closeBlockMenu()
}

function openTurnIntoMenu(): void {
  blockMenuStage.value = 'turn-into'
  void nextTick(() => quoteAction.value?.focus())
}

function openColorMenu(): void {
  blockMenuStage.value = 'color'
}

function selectActiveBlock(): boolean {
  return activeVisualBlock !== null && adapter?.selectDomBlock(activeVisualBlock) === true
}

function applyQuote(): void {
  if (!selectActiveBlock()) return
  const result = adapter?.applyBlockquote() ?? Object.freeze({ active: false, changed: false })
  if (!result.active) return
  closeBlockMenu()
  void nextTick(() => {
    adapter?.focus()
    updateVisualBlockFromSelection()
  })
}

function applyHeading(commandId: HeadingCommandId): void {
  if (!selectActiveBlock()) return
  const result = adapter?.applyHeading(commandId)
  if (result?.changed !== true) return
  closeBlockMenu()
  void nextTick(() => updateVisualBlockFromSelection())
}

function resetBlockFormatting(): void {
  if (activeVisualBlock === null) return
  adapter?.resetDomBlockFormatting(activeVisualBlock)
  closeBlockMenu()
  void nextTick(() => updateVisualBlockFromSelection())
}

function insertBlock(direction: 'above' | 'below'): void {
  if (activeVisualBlock === null) return
  const result = direction === 'above'
    ? adapter?.insertParagraphBeforeDomBlock(activeVisualBlock)
    : adapter?.insertParagraphAfterDomBlock(activeVisualBlock)
  if (result?.changed !== true) return
  closeBlockMenu()
  void nextTick(() => updateVisualBlockFromSelection())
}

function duplicateBlock(): void {
  if (activeVisualBlock === null) return
  adapter?.duplicateDomBlock(activeVisualBlock)
  closeBlockMenu()
  void nextTick(() => updateVisualBlockFromSelection())
}

function deleteBlock(): void {
  if (activeVisualBlock === null) return
  adapter?.deleteDomBlock(activeVisualBlock)
  activeVisualBlock = null
  blockHandleVisible.value = false
  closeBlockMenu()
}

async function copyBlock(): Promise<void> {
  if (activeVisualBlock === null) return
  const source = adapter?.domBlockSource(activeVisualBlock)
  if (source === null || source === undefined) return
  blockCopyFailed.value = !await copyText(source, surface.value?.ownerDocument ?? document)
  if (!blockCopyFailed.value) closeBlockMenu(true)
}

async function copyBlockAnchor(): Promise<void> {
  if (activeVisualBlock === null || activeBlockKind.value === 'image') return
  const source = adapter?.domBlockSource(activeVisualBlock) ?? ''
  const anchor = source.trim().toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/\s+/gu, '-')
  blockCopyFailed.value = !await copyText(`#${anchor}`, surface.value?.ownerDocument ?? document)
  if (!blockCopyFailed.value) closeBlockMenu(true)
}

function downloadImage(): void {
  const image = activeVisualBlock?.querySelector<HTMLImageElement>('img') ?? null
  if (image === null) return
  const link = document.createElement('a')
  link.href = image.currentSrc || image.src
  link.download = image.alt.trim() || 'image'
  link.click()
  closeBlockMenu(true)
}

function applyBlockColor(option: BlockColorOption): void {
  if (!selectActiveBlock()) return
  if (option.value === null) adapter?.clearRichInlineMark(option.commandId)
  else adapter?.applyRichInlineMark(option.commandId, option.value)
  const otherRecent = recentBlockColors.value.find((candidate) => candidate.commandId !== option.commandId)
  recentBlockColors.value = Object.freeze(otherRecent === undefined ? [option] : [option, otherRecent])
  closeBlockMenu()
}

function handleVisualContextKeydown(event: KeyboardEvent): void {
  if (props.presentationMode === true) return
  if (!(event.altKey && event.shiftKey && event.key === 'Enter')) return
  event.preventDefault()
  event.stopPropagation()
  updateVisualBlockFromSelection()
  openBlockMenu()
}

function handleRootMenuKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowRight' || event.key === 'Enter') {
    event.preventDefault()
    openTurnIntoMenu()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeBlockMenu(true)
  }
}

function handleTurnIntoKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowLeft' || event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    blockMenuStage.value = 'root'
    void nextTick(() => turnIntoAction.value?.focus())
  }
}

function handleBlockMenuKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.preventDefault()
  if (blockMenuStage.value === 'root') closeBlockMenu(true)
  else if (blockMenuStage.value === 'insert') {
    closeBlockMenu()
    void nextTick(() => addBlockAction.value?.focus())
  }
  else {
    blockMenuStage.value = 'root'
    void nextTick(() => turnIntoAction.value?.focus())
  }
}

function rebuildFromAuthority(): void {
  if (adapter === null) throw new Error('The visual editor surface is not mounted.')
  adapter.rebuildFromAuthority()
}
const synchronization = new VisualSynchronizationService({
  onAcknowledgement: ({ snapshot }) => {
    const projection = visualProjector(snapshot)
    adapter?.acknowledgeSynchronization({ map: projection.map, snapshot })
  },
  session: props.session,
  state: props.state,
})

onMounted(() => {
  if (host.value === null) throw new Error('The visual editor host is unavailable.')
  const patchPlanner = new TiptapTransactionPatchPlanner({
    createTransactionId: () => `visual:${props.session.snapshot().documentId}:${++transactionSequence}`,
    serialize: serializeOrdinaryTiptapPatch,
  })
  adapter = new TiptapVisualAdapter({
    host: host.value,
    localization: props.localization,
    onCheckpointHistoryCommit: () => props.state.succeed(props.session.snapshot()),
    onCompositionEnd: () => {
      synchronization.endComposition()
      emit('compositionEnd')
    },
    onCompositionStart: () => {
      synchronization.beginComposition()
      emit('compositionStart')
    },
    onSelectionChange: (selection) => emit('selectionChange', selection.kind),
    onRawEdit: (event) => emit('rawEdit', event),
    onReadOnlyTaskToggle: (event) => props.toggleReadOnlyTask?.(event) ?? false,
    onSemanticCopy: (event) => emit('semanticCopy', event),
    onSemanticEdit: (event) => emit('semanticEdit', event),
    onShortcut: (event) => props.routeShortcut(event),
    onTransaction: ({ patchPlan }) => {
      if (patchPlan !== null) synchronization.request(patchPlan)
    },
    onTransactionFailure: ({ failure }) => {
      synchronization.rejectTransaction({
        failure,
        operationId: `visual-rejected:${props.session.snapshot().documentId}:${createRandomId()}`,
        recover: rebuildFromAuthority,
      })
    },
    patchPlanner,
    project: visualProjector,
    session: props.session,
  })
  adapter.setPresentationMode(props.presentationMode === true)
  props.registerFlush(() => synchronization.flush())
  props.registerRecovery(async () => synchronization.discard())
  props.registerRetry(() => synchronization.retry())
  instanceDomService = props.domService ?? createInstanceDomService(surface.value ?? host.value)
  ownsInstanceDomService = props.domService === undefined
  disposeDocumentPointerDown = instanceDomService.listen(document, 'pointerdown', (event) => {
    handleDocumentPointerDown(event as PointerEvent)
  }, true)
  updateEditableBoundaryLabels()
  adapter.focus()
})

watch(() => props.presentationMode === true, (enabled) => {
  closeBlockMenu()
  blockHandleVisible.value = false
  adapter?.setPresentationMode(enabled)
  void nextTick(updateEditableBoundaryLabels)
})

onBeforeUnmount(() => {
  unsubscribeLocalization()
  props.registerFlush(null)
  props.registerRecovery(null)
  props.registerRetry(null)
  synchronization.cancel()
  disposeDocumentPointerDown?.()
  disposeDocumentPointerDown = null
  if (ownsInstanceDomService) instanceDomService?.destroy()
  instanceDomService = null
  adapter?.destroy()
  adapter = null
})

defineExpose({
  applyBlockquote: () => adapter?.applyBlockquote() ?? Object.freeze({ active: false, changed: false }),
  applyRawSource: (source: string) => adapter?.applyRawSource(source)
    ?? Object.freeze({ active: false, changed: false }),
  restoreCheckpoint: (markdown: string, transactionId: string) => {
    if (adapter === null) throw new Error('The visual editor surface is not mounted.')
    return adapter.restoreCheckpoint(markdown, transactionId)
  },
  canApplyAlignment: () => adapter?.canApplyAlignment() ?? false,
  clearSearchHighlights: () => adapter?.clearSearchHighlights(),
  applyAlignment: (commandId: AlignmentCommandId) => adapter?.applyAlignment(commandId)
    ?? Object.freeze({ active: false, changed: false }),
  applyHeading: (commandId: HeadingCommandId) => adapter?.applyHeading(commandId)
    ?? Object.freeze({ active: false, changed: false }),
  applyList: (commandId: ListCommandId) => adapter?.applyList(commandId)
    ?? Object.freeze({ active: false, changed: false }),
  applyLink: (href: string) => adapter?.applyLink(href) ?? Object.freeze({ active: false, changed: false }),
  updateReference: (id: string, patch: Pick<DocumentReference, 'text' | 'metadata' | 'style'>) => adapter?.updateReference(id, patch) ?? { active: false, changed: false },
  removeReference: (id: string) => adapter?.removeReference(id) ?? { active: false, changed: false },
  setReferenceStyle: (style: ReferenceStyle) => adapter?.setReferenceStyle(style) ?? { active: false, changed: false },
  applyReference: (reference: DocumentReference) => adapter?.applyReference(reference) ?? { active: false, changed: false },
  applyFormula: (mode: FormulaMode, content: string) => adapter?.applyFormula(mode, content)
    ?? Object.freeze({ active: false, changed: false }),
  applyCodeBlock: (language: string, code: string) => adapter?.applyCodeBlock(language, code)
    ?? Object.freeze({ active: false, changed: false }),
  applyChartTable: (source: string) => {
    const parsed = parseChartTableAt(source, 0)
    const descriptor = parsed === null ? null : chartTableDescriptor(`chart.${parsed.chartType}`)
    if (parsed === null || descriptor === null || parsed.sourceSpan.to !== source.length) return Object.freeze({ active: false, changed: false })
    return adapter?.applySemanticBlock({
      chartType: parsed.chartType,
      columns: parsed.columns,
      editorId: 'chart-table-editor',
      identity: descriptor.labels.en,
      kind: 'chart-table',
      options: parsed.options,
      rows: parsed.rows,
      source,
      title: parsed.title,
    }) ?? Object.freeze({ active: false, changed: false })
  },
  applyMermaid: (source: string, fallbackType: MermaidDiagramType | null = null) => {
    const parsed = parseMermaidAt(source, 0)
    if (parsed === null || parsed.sourceSpan.to !== source.length) return Object.freeze({ active: false, changed: false })
    const diagramType = parsed.diagramType ?? fallbackType
    const descriptor = diagramType === null ? null : mermaidDescriptor(`mermaid.${diagramType}`)
    return adapter?.applySemanticBlock({
      body: parsed.code,
      code: parsed.code,
      ...(diagramType === null ? {} : { diagramType }),
      editorId: 'mermaid-editor',
      identity: descriptor === null ? 'Mermaid diagram' : `${descriptor.labels.en} Mermaid`,
      kind: 'mermaid',
      source,
    }) ?? Object.freeze({ active: false, changed: false })
  },
  applyMedia: (source: string, fallbackKind: MediaKind | null = null) => {
    const parsed = parseMediaAt(source, 0)
    if (parsed === null || parsed.sourceSpan.to !== source.length || (fallbackKind !== null && parsed.kind !== fallbackKind)) {
      return Object.freeze({ active: false, changed: false })
    }
    const label = `${parsed.kind.charAt(0).toUpperCase()}${parsed.kind.slice(1)}`
    return adapter?.applySemanticBlock({
      editorId: 'media-editor',
      identity: `${label} · ${parsed.name}`,
      kind: 'media',
      mediaKind: parsed.kind,
      name: parsed.name,
      source,
      url: parsed.url,
    }) ?? Object.freeze({ active: false, changed: false })
  },
  applyAttachment: (source: string, fallbackKind: AttachmentKind | null = null) => {
    const parsed = parseAttachmentAt(source, 0)
    if (parsed === null || parsed.sourceSpan.to !== source.length || (fallbackKind !== null && parsed.kind !== fallbackKind)) {
      return Object.freeze({ active: false, changed: false })
    }
    const label = parsed.kind === 'pdf' ? 'PDF' : parsed.kind === 'word' ? 'Word document' : 'File'
    return adapter?.applySemanticBlock({
      attachmentKind: parsed.kind,
      editorId: 'attachment-editor',
      identity: `${label} · ${parsed.name}`,
      kind: 'attachment',
      mediaType: parsed.mediaType,
      name: parsed.name,
      size: parsed.size,
      source,
      url: parsed.url,
    }) ?? Object.freeze({ active: false, changed: false })
  },
  applyDrawio: (source: string) => {
    const parsed = parseDrawioAt(source, 0)
    if (parsed === null || parsed.sourceSpan.to !== source.length) return Object.freeze({ active: false, changed: false })
    return adapter?.applySemanticBlock({
      editorId: 'drawio-editor',
      identity: `draw.io · ${parsed.name}`,
      kind: 'drawio',
      name: parsed.name,
      png: parsed.png,
      source,
      xml: parsed.xml,
    }) ?? Object.freeze({ active: false, changed: false })
  },
  applyDisclosure: (source: string) => {
    const parsed = parseDisclosureAt(source, 0)
    if (parsed === null || parsed.sourceSpan.to !== source.length) return Object.freeze({ active: false, changed: false })
    return adapter?.applySemanticBlock({
      editorId: 'disclosure-editor',
      identity: parsed.kind === 'tabs' ? 'Tabs' : 'Accordion',
      items: parsed.items,
      kind: 'disclosure',
      layoutKind: parsed.kind,
      source,
    }) ?? Object.freeze({ active: false, changed: false })
  },
  applyPanel: (source: string) => {
    const parsed = parsePanelAt(source, 0)
    const descriptor = parsed === null ? null : panelDescriptor(`panel.${parsed.variant}`)
    if (parsed === null || descriptor === null || parsed.sourceSpan.to !== source.length) return Object.freeze({ active: false, changed: false })
    return adapter?.applySemanticBlock({
      body: parsed.body,
      editorId: 'panel-editor',
      identity: `${parsed.variant.charAt(0).toUpperCase()}${parsed.variant.slice(1)} panel`,
      kind: 'panel',
      previewRole: descriptor.previewRole,
      source,
      title: parsed.title,
      variant: parsed.variant,
    }) ?? Object.freeze({ active: false, changed: false })
  },
  applyColumnLayout: (source: string) => {
    const parsed = parseColumnLayoutAt(source, 0)
    if (parsed === null || parsed.sourceSpan.to !== source.length) return Object.freeze({ active: false, changed: false })
    return adapter?.applySemanticBlock({
      editorId: 'column-layout-editor',
      identity: parsed.kind === 'two-column' ? 'Two-column layout' : 'Multi-column layout',
      items: parsed.columns,
      kind: 'column-layout',
      layoutKind: parsed.kind,
      source,
      title: parsed.title,
    }) ?? Object.freeze({ active: false, changed: false })
  },
  applyTimeline: (source: string) => {
    const parsed = parseTimelineAt(source, 0)
    if (parsed === null || parsed.sourceSpan.to !== source.length) return Object.freeze({ active: false, changed: false })
    return adapter?.applySemanticBlock({
      editorId: 'timeline-editor',
      identity: 'Timeline',
      items: parsed.items,
      kind: 'timeline',
      source,
      title: parsed.title,
    }) ?? Object.freeze({ active: false, changed: false })
  },
  applyRichInlineMark: (commandId: RichInlineMarkCommandId, value: string, bodyOverride?: string) => adapter?.applyRichInlineMark(commandId, value, bodyOverride)
    ?? Object.freeze({ active: false, changed: false, value: null }),
  clearRichInlineMark: (commandId: 'text.background' | 'text.color') => adapter?.clearRichInlineMark(commandId)
    ?? Object.freeze({ active: false, changed: false }),
  executeInlineMark: (commandId: InlineMarkCommandId) => adapter?.toggleInlineMark(commandId)
    ?? Object.freeze({ active: false, changed: false }),
  focus: () => {
    if (props.presentationMode === true) surface.value?.focus({ preventScroll: true })
    else adapter?.focus()
  },
  isInlineMarkActive: (commandId: InlineMarkCommandId) => adapter?.isInlineMarkActive(commandId) ?? false,
  isHeadingActive: (commandId: HeadingCommandId) => adapter?.isHeadingActive(commandId) ?? false,
  isAlignmentActive: (commandId: AlignmentCommandId) => adapter?.isAlignmentActive(commandId) ?? false,
  isListActive: (commandId: ListCommandId) => adapter?.isListActive(commandId) ?? false,
  navigateHeading: (anchor: string) => adapter?.navigateHeading(anchor) ?? false,
  richInlineMarkValue: (commandId: RichInlineMarkCommandId) => adapter?.richInlineMarkValue(commandId) ?? null,
  redo: () => adapter?.redo() ?? false,
  replaceSearchMatches: (matches: Parameters<TiptapVisualAdapter['replaceSearchMatches']>[0], replacement: string) => adapter?.replaceSearchMatches(matches, replacement)
    ?? Object.freeze({ active: false, changed: false }),
  search: (query: string, caseSensitive = false) => adapter?.search(query, caseSensitive) ?? Object.freeze([]),
  selection: () => adapter?.selection() ?? Object.freeze({ anchor: 0, head: 0, kind: 'text' as const }),
  setSearchHighlights: (matches: Parameters<TiptapVisualAdapter['setSearchHighlights']>[0], activeIndex: number) => adapter?.setSearchHighlights(matches, activeIndex),
  selectedText: () => adapter?.selectedText() ?? '',
  selectedSemanticBlock: () => adapter?.selectedSemanticBlock() ?? null,
  selectedFormula: () => adapter?.selectedFormula() ?? null,
  selectedFormulaSource: () => adapter?.selectedFormulaSource() ?? null,
  selectedCodeBlock: () => adapter?.selectedCodeBlock() ?? null,
  selectedMedia: () => {
    const selected = adapter?.selectedSemanticBlock()
    return selected?.kind === 'media' ? selected : null
  },
  selectedAttachment: () => {
    const selected = adapter?.selectedSemanticBlock()
    return selected?.kind === 'attachment' ? selected : null
  },
  selectedDrawio: () => {
    const selected = adapter?.selectedSemanticBlock()
    return selected?.kind === 'drawio' ? selected : null
  },
  selectedDisclosureSource: (kind: 'accordion' | 'tabs') => {
    const selected = adapter?.selectedSemanticBlock()
    return selected?.kind === 'disclosure' && selected.layoutKind === kind ? selected.source : null
  },
  selectedPanelSource: (variant: PanelVariant) => {
    const selected = adapter?.selectedSemanticBlock()
    return selected?.kind === 'panel' && selected.variant === variant ? selected.source : null
  },
  selectedColumnLayoutSource: (kind: ColumnLayoutKind) => {
    const selected = adapter?.selectedSemanticBlock()
    return selected?.kind === 'column-layout' && selected.layoutKind === kind ? selected.source : null
  },
  selectedTimelineSource: () => {
    const selected = adapter?.selectedSemanticBlock()
    return selected?.kind === 'timeline' ? selected.source : null
  },
  setSelection: (selection: Readonly<{ anchor: number; head: number }>) => adapter?.setSelection(selection),
  setSelectedSemanticLocalError: (message: string | null) => adapter?.setSelectedSemanticLocalError(message) ?? false,
  insertHardBreak: () => adapter?.insertHardBreak() ?? Object.freeze({ active: false, changed: false }),
  insertTable: (columns: number, dataRows: number) => adapter?.insertTable(columns, dataRows) ?? Object.freeze({ active: false, changed: false }),
  insertSimpleBlock: (commandId: 'insert.horizontal-rule' | 'insert.toc') => adapter?.insertSimpleBlock(commandId)
    ?? Object.freeze({ active: false, changed: false }),
  selectTocBlock: () => adapter?.selectTocBlock() ?? Object.freeze({ active: false, changed: false }),
  toggleInlineCode: () => adapter?.toggleInlineCode() ?? Object.freeze({ active: false, changed: false }),
  undo: () => adapter?.undo() ?? false,
})
</script>

<template>
  <article
    ref="surface"
    :class="['content-surface', 'visual-surface', 'continuous-canvas', { 'preview-surface': presentationMode, 'visual-surface--presentation': presentationMode }]"
    :data-mode="presentationMode ? 'preview' : 'visual'"
    :tabindex="presentationMode ? 0 : undefined"
    @focusin="handleVisualFocus"
    @keydown.capture="handleVisualContextKeydown"
    @pointermove="handleVisualPointerMove"
  >
    <div
      ref="host"
      class="visual-editor-host"
    ></div>
    <div
      v-show="presentationMode !== true && blockHandleVisible"
      class="visual-block-context"
      :style="blockHandleStyle"
    >
      <button
        ref="addBlockAction"
        aria-haspopup="menu"
        :aria-expanded="blockMenuStage === 'insert'"
        :aria-label="t('blockMenu.addBlock')"
        class="visual-block-add"
        type="button"
        @click="toggleAddBlockMenu"
      >
        <span aria-hidden="true">+</span>
      </button>
      <button
        aria-haspopup="menu"
        :aria-expanded="blockMenuStage === 'root' || blockMenuStage === 'color' || blockMenuStage === 'turn-into'"
        aria-keyshortcuts="Alt+Shift+Enter"
        :aria-label="t('blockMenu.openActions')"
        class="visual-block-handle"
        type="button"
        @click="toggleBlockMenu"
      >
        <span
          v-for="dot in 6"
          :key="dot"
          aria-hidden="true"
          class="visual-block-handle__dot"
        ></span>
      </button>
      <div
        v-if="blockMenuStage === 'root' || blockMenuStage === 'color'"
        :aria-label="t('blockMenu.actions')"
        class="visual-block-menu"
        role="menu"
        @keydown="handleBlockMenuKeydown"
      >
        <p
          v-if="blockCopyFailed"
          role="alert"
        >
          {{ t('blockMenu.copyFailed') }}
        </p>
        <p class="visual-block-menu__title">
          {{ activeBlockKind === 'code' ? t('blockMenu.codeBlock') : activeBlockKind === 'image' ? t('blockMenu.image') : t('blockMenu.text') }}
        </p>
        <template v-if="activeBlockKind === 'text'">
          <button
            aria-haspopup="menu"
            data-block-action="color"
            role="menuitem"
            type="button"
            @click="openColorMenu"
          >
            <span class="visual-block-menu__label"><span aria-hidden="true">A</span><span>{{ t('blockMenu.color') }}</span></span>
            <span aria-hidden="true">›</span>
          </button>
        </template>
        <button
          v-if="activeBlockKind !== 'image'"
          ref="turnIntoAction"
          aria-haspopup="menu"
          data-block-action="turn-into"
          role="menuitem"
          type="button"
          @click="openTurnIntoMenu"
          @keydown="handleRootMenuKeydown"
        >
          <span class="visual-block-menu__label"><span aria-hidden="true">↻</span><span>{{ t('blockMenu.turnInto') }}</span></span><span aria-hidden="true">›</span>
        </button>
        <button
          v-if="activeBlockKind === 'text'"
          data-block-action="reset"
          role="menuitem"
          type="button"
          @click="resetBlockFormatting"
        >
          <span class="visual-block-menu__label"><span aria-hidden="true">↶</span><span>{{ t('blockMenu.resetFormatting') }}</span></span>
        </button>
        <button
          v-if="activeBlockKind === 'image'"
          data-block-action="download-image"
          role="menuitem"
          type="button"
          @click="downloadImage"
        >
          <span class="visual-block-menu__label"><span aria-hidden="true">⇩</span><span>{{ t('blockMenu.downloadImage') }}</span></span>
        </button>
        <div class="visual-block-menu__divider"></div>
        <button
          data-block-action="duplicate"
          role="menuitem"
          type="button"
          @click="duplicateBlock"
        >
          <span class="visual-block-menu__label"><span aria-hidden="true">⧉</span><span>{{ t('blockMenu.duplicateNode') }}</span></span>
          <kbd>Mod D</kbd>
        </button>
        <button
          data-block-action="copy"
          role="menuitem"
          type="button"
          @click="copyBlock"
        >
          <span class="visual-block-menu__label"><span aria-hidden="true">□</span><span>{{ t('blockMenu.copyClipboard') }}</span></span>
          <kbd>Mod C</kbd>
        </button>
        <button
          :disabled="activeBlockKind === 'image'"
          data-block-action="copy-anchor"
          role="menuitem"
          type="button"
          @click="copyBlockAnchor"
        >
          <span class="visual-block-menu__label"><span aria-hidden="true">↗</span><span>{{ t('blockMenu.copyAnchor') }}</span></span>
          <kbd>Mod Ctrl L</kbd>
        </button>
        <div class="visual-block-menu__divider"></div>
        <button
          class="visual-block-menu__danger"
          data-block-action="delete"
          role="menuitem"
          type="button"
          @click="deleteBlock"
        >
          <span class="visual-block-menu__label"><span aria-hidden="true">⌫</span><span>{{ t('blockMenu.delete') }}</span></span>
          <kbd>Backspace</kbd>
        </button>
      </div>
      <div
        v-if="blockMenuStage === 'turn-into'"
        :aria-label="t('blockMenu.turnInto')"
        class="visual-block-menu"
        role="menu"
        @keydown="handleBlockMenuKeydown"
      >
        <p
          v-if="blockCopyFailed"
          role="alert"
        >
          {{ t('blockMenu.copyFailed') }}
        </p>
        <p class="visual-block-menu__title">
          {{ t('blockMenu.turnInto') }}
        </p>
        <button
          data-turn-into="text"
          role="menuitem"
          type="button"
          @click="resetBlockFormatting"
        >
          <span class="visual-block-menu__label"><span aria-hidden="true">T</span><span>{{ t('blockMenu.text') }}</span></span>
        </button>
        <button
          v-if="activeBlockKind === 'text'"
          data-turn-into="heading-1"
          role="menuitem"
          type="button"
          @click="applyHeading('block.h1')"
        >
          <span class="visual-block-menu__label"><span aria-hidden="true">H1</span><span>{{ t('blockMenu.heading1') }}</span></span>
        </button>
        <button
          v-if="activeBlockKind === 'text'"
          data-turn-into="heading-2"
          role="menuitem"
          type="button"
          @click="applyHeading('block.h2')"
        >
          <span class="visual-block-menu__label"><span aria-hidden="true">H2</span><span>{{ t('blockMenu.heading2') }}</span></span>
        </button>
        <button
          v-if="activeBlockKind === 'text'"
          data-turn-into="heading-3"
          role="menuitem"
          type="button"
          @click="applyHeading('block.h3')"
        >
          <span class="visual-block-menu__label"><span aria-hidden="true">H3</span><span>{{ t('blockMenu.heading3') }}</span></span>
        </button>
        <button
          ref="quoteAction"
          data-turn-into="quote"
          role="menuitem"
          type="button"
          @click="applyQuote"
          @keydown="handleTurnIntoKeydown"
        >
          <span class="visual-block-menu__label"><span aria-hidden="true">›</span><span>{{ t('blockMenu.quote') }}</span></span>
        </button>
      </div>
      <div
        v-if="blockMenuStage === 'color'"
        :aria-label="t('blockMenu.color')"
        class="visual-block-menu visual-block-menu--submenu visual-block-color-menu"
        role="menu"
        @keydown="handleBlockMenuKeydown"
      >
        <section data-block-color-section="recent">
          <p
            v-if="blockCopyFailed"
            role="alert"
          >
            {{ t('blockMenu.copyFailed') }}
          </p>
          <p class="visual-block-menu__title">
            {{ t('blockMenu.recentColors') }}
          </p>
          <button
            v-for="option in recentBlockColors"
            :key="`recent-${option.id}`"
            :data-block-color-option="option.id"
            role="menuitem"
            type="button"
            @click="applyBlockColor(option)"
          >
            <span class="visual-block-menu__label">
              <span
                :class="['visual-block-menu__color-icon', { 'visual-block-menu__color-icon--background': option.commandId === 'text.background' }]"
                :style="option.value === null ? undefined : option.commandId === 'text.color' ? { color: option.value } : { backgroundColor: option.value }"
                aria-hidden="true"
              >A</span>
              <span>{{ blockColorOptionLabel(option) }}</span>
            </span>
          </button>
        </section>
        <section data-block-color-section="text">
          <p
            v-if="blockCopyFailed"
            role="alert"
          >
            {{ t('blockMenu.copyFailed') }}
          </p>
          <p class="visual-block-menu__title">
            {{ t('blockMenu.textColor') }}
          </p>
          <button
            v-for="option in TEXT_COLOR_OPTIONS"
            :key="option.id"
            :data-block-color-option="option.id"
            role="menuitem"
            type="button"
            @click="applyBlockColor(option)"
          >
            <span class="visual-block-menu__label">
              <span
                class="visual-block-menu__color-icon"
                :style="option.value === null ? undefined : { color: option.value }"
                aria-hidden="true"
              >A</span>
              <span>{{ blockColorOptionLabel(option) }}</span>
            </span>
          </button>
        </section>
        <section data-block-color-section="background">
          <p
            v-if="blockCopyFailed"
            role="alert"
          >
            {{ t('blockMenu.copyFailed') }}
          </p>
          <p class="visual-block-menu__title">
            {{ t('blockMenu.backgroundColor') }}
          </p>
          <button
            v-for="option in BACKGROUND_COLOR_OPTIONS"
            :key="option.id"
            :data-block-color-option="option.id"
            role="menuitem"
            type="button"
            @click="applyBlockColor(option)"
          >
            <span class="visual-block-menu__label">
              <span
                class="visual-block-menu__color-icon visual-block-menu__color-icon--background"
                :style="option.value === null ? undefined : { backgroundColor: option.value }"
                aria-hidden="true"
              >A</span>
              <span>{{ blockColorOptionLabel(option) }}</span>
            </span>
          </button>
        </section>
      </div>
      <div
        v-if="blockMenuStage === 'insert'"
        :aria-label="t('blockMenu.addBlock')"
        class="visual-block-menu visual-block-menu--insert"
        role="menu"
        @keydown="handleBlockMenuKeydown"
      >
        <button
          ref="addAboveAction"
          data-block-insert="above"
          role="menuitem"
          type="button"
          @click="insertBlock('above')"
        >
          <span class="visual-block-menu__label">
            <span aria-hidden="true">↑</span>
            <span>{{ t('blockMenu.addAbove') }}</span>
          </span>
        </button>
        <button
          data-block-insert="below"
          role="menuitem"
          type="button"
          @click="insertBlock('below')"
        >
          <span class="visual-block-menu__label">
            <span aria-hidden="true">↓</span>
            <span>{{ t('blockMenu.addBelow') }}</span>
          </span>
        </button>
      </div>
    </div>
  </article>
</template>
