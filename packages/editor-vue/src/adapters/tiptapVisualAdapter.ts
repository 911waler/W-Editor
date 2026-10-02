import { referenceFromAttributes } from './referenceNode'
import { referenceRegistry, parseReferenceStyle, referenceMarkdown, type DocumentReference, type ReferenceStyle } from '@w-editor/editor-core'
import { parseInlineImageAt } from '@w-editor/editor-core'
import { imageAttributes, imageMarkdown } from './imageNode'
import { Editor, getSchema, type JSONContent } from '@tiptap/core'
import { joinBackward, joinForward, selectNodeBackward, selectNodeForward } from '@tiptap/pm/commands'
import { closeHistory, undoDepth } from '@tiptap/pm/history'
import { Fragment, type Node as ProseMirrorNode, type Schema } from '@tiptap/pm/model'
import { NodeSelection, Selection, TextSelection, type Transaction } from '@tiptap/pm/state'
import { findWrapping } from '@tiptap/pm/transform'

import {
  inlineMarkSpec,
  parseBlockFormulaAt,
  parseInlineFormulaAt,
  richInlineMarkSpec,
  alignmentValue,
  serializeFencedCode,
  serializeFormula,
  type AlignmentCommandId,
  type FormulaMode,
  type InlineMarkCommandId,
  type ProjectionMap,
  type ProjectionMapEntry,
  type RichInlineMarkCommandId,
} from '@w-editor/editor-core'
import { headingLevel, type HeadingCommandId } from '@w-editor/editor-core'
import { listCommandKind, type ListCommandId } from '@w-editor/editor-core'
import { validateRichInlineMarkValue } from '@w-editor/editor-core'
import { createUiLocalizationStore, type UiLocalizationStore } from '../services/uiLocalization'
import { createRandomId } from '../services/randomId'
import {
  type CommitAcknowledgement,
  type DocumentSession,
  type DocumentSnapshot,
  ProjectionRevisionGate,
} from '@w-editor/editor-core'
import {
  TIPTAP_EXTERNAL_HYDRATION_META,
  type TiptapTransactionPatchPlanner,
} from './tiptapPatchPlanner'
import { serializeOrdinaryTiptapDocument } from './ordinaryBlockSerialization'
import {
  createTiptapVisualExtensions,
  positionedTocHeadings,
  scrollTocHeadingIntoView,
  VISUAL_SEARCH_HIGHLIGHT_META,
} from './tiptapVisualSchema'
import type { SemanticNodeCopyEvent } from './tiptapVisualSchema'
import { revealSearchCoordinates } from './searchViewport'
import {
  defaultMermaidPreviewRenderer,
  type MermaidPreviewRendererContract,
} from './mermaidPreviewRenderer'
import {
  defaultCherryChartPreviewRenderer,
  type ChartPreviewRendererContract,
} from './cherryChartPreviewRenderer'

export { TIPTAP_EXTERNAL_HYDRATION_META } from './tiptapPatchPlanner'

export interface TiptapVisualProjection {
  readonly content: JSONContent
  readonly map: ProjectionMap
  readonly revision: number
  readonly source?: string
}

export type TiptapVisualProjector = (snapshot: DocumentSnapshot) => TiptapVisualProjection

export interface TiptapVisualTransactionEvent {
  readonly external: boolean
  readonly patchPlan: ReturnType<TiptapTransactionPatchPlanner['plan']>
  readonly projection: TiptapVisualProjection
  readonly transaction: Transaction
}

export interface TiptapVisualTransactionFailureEvent {
  readonly failure: unknown
  readonly projection: TiptapVisualProjection
  readonly transaction: Transaction
}

export interface TiptapVisualAdapterOptions {
  readonly allowReadOnlySemanticEdit?: boolean
  readonly chartRenderer?: ChartPreviewRendererContract
  readonly host: HTMLElement
  readonly localization?: UiLocalizationStore
  readonly mermaidRenderer?: MermaidPreviewRendererContract
  readonly onCheckpointHistoryCommit?: (acknowledgement: CommitAcknowledgement) => void
  readonly onCompositionEnd?: () => void
  readonly onCompositionStart?: () => void
  readonly onSelectionChange?: (selection: VisualSelection) => void
  readonly onRawEdit?: (event: VisualRawNodeSelection) => void
  readonly onReadOnlyTaskToggle?: (event: Readonly<{ checked: boolean; index: number }>) => boolean
  readonly onSemanticCopy?: (event: SemanticNodeCopyEvent) => void
  readonly onSemanticEdit?: (event: VisualSemanticBlockSelection & Readonly<{ editorId: string }>) => void
  readonly onShortcut?: (event: KeyboardEvent) => boolean
  readonly onTransaction?: (event: TiptapVisualTransactionEvent) => void
  readonly onTransactionFailure?: (event: TiptapVisualTransactionFailureEvent) => void
  readonly patchPlanner?: Pick<TiptapTransactionPatchPlanner, 'plan'>
  readonly project: (snapshot: DocumentSnapshot) => TiptapVisualProjection
  readonly session: DocumentSession
}

export interface VisualSelection {
  readonly anchor: number
  readonly head: number
  readonly kind: 'node' | 'text'
}

export interface VisualCommandResult {
  readonly active: boolean
  readonly changed: boolean
}

export interface VisualSearchMatch {
  readonly from: number
  readonly text: string
  readonly to: number
}

export interface VisualRichCommandResult extends VisualCommandResult {
  readonly value: string | null
}

interface VisualDomBlock {
  readonly node: ProseMirrorNode
  readonly position: number
}

export interface VisualSemanticBlockInput {
  readonly attachmentKind?: string
  readonly body?: string
  readonly chartType?: string
  readonly code?: string
  readonly columns?: readonly string[]
  readonly diagramType?: string
  readonly editorId?: string
  readonly identity?: string
  readonly items?: readonly unknown[]
  readonly kind: string
  readonly language?: string
  readonly layoutKind?: string
  readonly mediaKind?: string
  readonly mediaType?: string
  readonly name?: string
  readonly options?: Readonly<Record<string, unknown>>
  readonly previewRole?: string
  readonly png?: string
  readonly rows?: readonly (readonly string[])[]
  readonly size?: number
  readonly source: string
  readonly title?: string
  readonly url?: string
  readonly variant?: string
  readonly xml?: string
}

interface CheckpointRestoreHistoryEntry {
  applied: boolean
  readonly beforeDocument: ProseMirrorNode
  readonly beforeMarkdown: string
  readonly restoredDocument: ProseMirrorNode
  readonly restoredMarkdown: string
}

export interface VisualSemanticBlockSelection {
  readonly attachmentKind?: string
  readonly chartType?: string
  readonly code?: string
  readonly columns?: readonly string[]
  readonly diagramType?: string
  readonly formulaContent?: string
  readonly formulaMode?: FormulaMode
  readonly kind: string
  readonly language?: string
  readonly layoutKind: string | null
  readonly mediaKind?: string
  readonly mediaType?: string
  readonly name?: string
  readonly options?: Readonly<Record<string, unknown>>
  readonly png?: string
  readonly rows?: readonly (readonly string[])[]
  readonly size?: number
  readonly source: string
  readonly title?: string
  readonly url?: string
  readonly variant?: string
  readonly xml?: string
}

function firstTocBlockPosition(document: ProseMirrorNode): number | null {
  let position: number | null = null
  document.descendants((node, nodePosition) => {
    if (position !== null) return false
    if (node.type.name !== 'tocBlock') return true
    position = nodePosition
    return false
  })
  return position
}

export interface VisualFormulaSelection {
  readonly content: string
  readonly mode: FormulaMode
  readonly source: string
}

export interface VisualRawNodeSelection {
  readonly kind: 'rawBlock' | 'rawInline'
  readonly source: string
}

interface SelectedCodeBlock {
  readonly node: ProseMirrorNode
  readonly position: number
}

function selectedCodeBlockAt(selection: Selection): SelectedCodeBlock | null {
  if (selection instanceof NodeSelection && selection.node.type.name === 'codeBlock') {
    return Object.freeze({ node: selection.node, position: selection.from })
  }
  for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
    const node = selection.$from.node(depth)
    if (node.type.name !== 'codeBlock') continue
    const position = selection.$from.before(depth)
    if (selection.to > position + node.nodeSize) return null
    return Object.freeze({ node, position })
  }
  return null
}

interface SelectionPointBookmark {
  readonly fallbackPosition: number
  readonly offset: number
  readonly projectionId: string | null
}

type VisualSelectionBookmark =
  | {
      readonly anchor: SelectionPointBookmark
      readonly head: SelectionPointBookmark
      readonly kind: 'text'
    }
  | {
      readonly fallbackPosition: number
      readonly kind: 'node'
      readonly projectionId: string | null
    }

export class InvalidTiptapVisualProjectionError extends Error {
  readonly code = 'INVALID_TIPTAP_VISUAL_PROJECTION'

  constructor(message: string) {
    super(message)
    this.name = 'InvalidTiptapVisualProjectionError'
  }
}

export class InvalidTiptapSchemaProjectionError extends Error {
  readonly code = 'INVALID_TIPTAP_SCHEMA'

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'InvalidTiptapSchemaProjectionError'
  }
}

function assertProjection(snapshot: DocumentSnapshot, projection: TiptapVisualProjection): void {
  if (projection.revision !== snapshot.revision || projection.map.revision !== snapshot.revision) {
    throw new InvalidTiptapVisualProjectionError('Visual projection revision does not match the document snapshot.')
  }
  if (projection.map.documentLength !== snapshot.markdown.length) {
    throw new InvalidTiptapVisualProjectionError('Visual projection length does not match the document snapshot.')
  }
}

let visualPreflightSchema: Schema | null = null

export function prepareTiptapVisualProjection(
  snapshot: DocumentSnapshot,
  project: TiptapVisualProjector,
): TiptapVisualProjection {
  const projection = project(snapshot)
  assertProjection(snapshot, projection)
  visualPreflightSchema ??= getSchema(createTiptapVisualExtensions())
  try {
    visualPreflightSchema.nodeFromJSON(projection.content)
  } catch (cause) {
    throw new InvalidTiptapSchemaProjectionError('Visual projection does not satisfy the active Tiptap schema.', { cause })
  }
  return projection
}

function projectionId(node: ProseMirrorNode): string | null {
  const value = node.attrs['projectionId']
  return typeof value === 'string' && value.length > 0 ? value : null
}

function topLevelProjectionIds(document: ProseMirrorNode): readonly string[] {
  const ids: string[] = []
  document.forEach((node) => {
    const id = projectionId(node)
    if (id !== null) ids.push(id)
  })
  return Object.freeze(ids)
}

function clearProjectionMetadata(node: ProseMirrorNode, projectionIdValue: string | null): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...node.attrs,
    codecId: null,
    originalSource: null,
    projectionId: projectionIdValue,
    revision: null,
    sourceFrom: null,
    sourceTo: null,
  })
}

function withTextAlignment(node: ProseMirrorNode, textAlign: string | null): ProseMirrorNode {
  return node.type.create({ ...node.attrs, textAlign }, node.content, node.marks)
}

const PROJECTION_METADATA_ATTRIBUTES = new Set([
  'codecId',
  'ordinaryClass',
  'originalSource',
  'projectionId',
  'revision',
  'sourceFrom',
  'sourceTo',
])

function meaningfulNodeAttributes(node: ProseMirrorNode, withinAlignmentBlock: boolean): string {
  return JSON.stringify(Object.fromEntries(
    Object.entries(node.attrs).filter(([key]) => (
      !PROJECTION_METADATA_ATTRIBUTES.has(key)
      && !(withinAlignmentBlock && key === 'textAlign')
    )),
  ))
}

function equivalentVisualNodes(
  left: ProseMirrorNode,
  right: ProseMirrorNode,
  withinAlignmentBlock = false,
): boolean {
  if (
    left.type.name !== right.type.name
    || left.textContent !== right.textContent
    || left.childCount !== right.childCount
    || meaningfulNodeAttributes(left, withinAlignmentBlock) !== meaningfulNodeAttributes(right, withinAlignmentBlock)
    || left.marks.length !== right.marks.length
  ) return false
  for (let index = 0; index < left.marks.length; index += 1) {
    const leftMark = left.marks[index]
    const rightMark = right.marks[index]
    if (leftMark === undefined || rightMark === undefined || !leftMark.eq(rightMark)) return false
  }
  const descendantsWithinAlignmentBlock = withinAlignmentBlock || left.type.name === 'alignmentBlock'
  for (let index = 0; index < left.childCount; index += 1) {
    if (!equivalentVisualNodes(left.child(index), right.child(index), descendantsWithinAlignmentBlock)) return false
  }
  return true
}

function widenOptimisticTrailingParagraph(
  markdown: string,
  entries: readonly ProjectionMapEntry[],
): readonly ProjectionMapEntry[] {
  const last = entries.at(-1)
  if (
    last === undefined
    || last.codecId !== 'paragraph'
    || last.sourceSpan.to >= markdown.length
    || markdown.slice(last.sourceSpan.to) !== '\n'
  ) return entries
  const sourceSpan = Object.freeze({ from: last.sourceSpan.from, to: markdown.length })
  const expectedSource = markdown.slice(sourceSpan.from, sourceSpan.to)
  return Object.freeze([
    ...entries.slice(0, -1),
    Object.freeze({
      ...last,
      originalSource: expectedSource,
      safePatchUnit: Object.freeze({
        ...last.safePatchUnit,
        expectedSource,
        sourceSpan,
      }),
      sourceSpan,
    }),
  ])
}

function pointBookmark(doc: ProseMirrorNode, position: number): SelectionPointBookmark {
  const resolved = doc.resolve(position)
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    const id = projectionId(resolved.node(depth))
    if (id !== null) {
      return Object.freeze({
        fallbackPosition: position,
        offset: position - resolved.start(depth),
        projectionId: id,
      })
    }
  }
  return Object.freeze({ fallbackPosition: position, offset: 0, projectionId: null })
}

function captureSelection(doc: ProseMirrorNode, selection: Selection): VisualSelectionBookmark {
  if (selection instanceof NodeSelection) {
    return Object.freeze({
      fallbackPosition: selection.from,
      kind: 'node' as const,
      projectionId: projectionId(selection.node),
    })
  }
  return Object.freeze({
    anchor: pointBookmark(doc, selection.anchor),
    head: pointBookmark(doc, selection.head),
    kind: 'text' as const,
  })
}

function findProjectionNode(doc: ProseMirrorNode, id: string): { readonly node: ProseMirrorNode; readonly position: number } | null {
  let match: { readonly node: ProseMirrorNode; readonly position: number } | null = null
  doc.descendants((node, position) => {
    if (projectionId(node) !== id) return true
    match = { node, position }
    return false
  })
  return match
}

function remapAcknowledgedProjection(
  document: ProseMirrorNode,
  map: ProjectionMap,
  snapshot: DocumentSnapshot,
): TiptapVisualProjection {
  const currentIds: string[] = []
  document.descendants((node) => {
    const id = projectionId(node)
    if (id !== null && !currentIds.includes(id)) currentIds.push(id)
    return true
  })
  if (currentIds.length !== map.entries.length) {
    throw new InvalidTiptapVisualProjectionError('Acknowledged projection structure does not match the visual document.')
  }
  const entries = map.entries.map((entry, index) => {
    const currentId = currentIds[index]
    if (currentId === undefined) {
      throw new InvalidTiptapVisualProjectionError('Acknowledged projection entry has no visual node identity.')
    }
    return Object.freeze({
      ...entry,
      projectionId: currentId,
      safePatchUnit: Object.freeze({ ...entry.safePatchUnit, unitId: currentId }),
    })
  })
  return Object.freeze({
    content: document.toJSON(),
    map: Object.freeze({ ...map, entries: Object.freeze(entries) }),
    revision: snapshot.revision,
    source: snapshot.markdown,
  })
}

function clampPosition(doc: ProseMirrorNode, position: number): number {
  return Math.max(0, Math.min(position, doc.content.size))
}

function restorePoint(doc: ProseMirrorNode, bookmark: SelectionPointBookmark): number {
  if (bookmark.projectionId !== null) {
    const match = findProjectionNode(doc, bookmark.projectionId)
    if (match !== null) {
      const contentStart = match.position + 1
      return Math.max(contentStart, Math.min(contentStart + bookmark.offset, match.position + match.node.nodeSize - 1))
    }
  }
  return clampPosition(doc, bookmark.fallbackPosition)
}

function restoreSelection(doc: ProseMirrorNode, bookmark: VisualSelectionBookmark): Selection {
  if (bookmark.kind === 'node' && bookmark.projectionId !== null) {
    const match = findProjectionNode(doc, bookmark.projectionId)
    if (match !== null && NodeSelection.isSelectable(match.node)) {
      return NodeSelection.create(doc, match.position)
    }
  }
  if (bookmark.kind === 'text') {
    const anchor = restorePoint(doc, bookmark.anchor)
    const head = restorePoint(doc, bookmark.head)
    return TextSelection.between(doc.resolve(anchor), doc.resolve(head))
  }
  return TextSelection.near(doc.resolve(clampPosition(doc, bookmark.fallbackPosition)))
}

export class TiptapVisualAdapter {
  readonly #editor: Editor
  readonly #onCheckpointHistoryCommit: ((acknowledgement: CommitAcknowledgement) => void) | undefined
  readonly #onTransaction: ((event: TiptapVisualTransactionEvent) => void) | undefined
  readonly #onTransactionFailure: ((event: TiptapVisualTransactionFailureEvent) => void) | undefined
  readonly #onCompositionEnd: (() => void) | undefined
  readonly #onCompositionStart: (() => void) | undefined
  readonly #onSelectionChange: TiptapVisualAdapterOptions['onSelectionChange']
  readonly #onRawEdit: TiptapVisualAdapterOptions['onRawEdit']
  readonly #onSemanticCopy: TiptapVisualAdapterOptions['onSemanticCopy']
  readonly #onSemanticEdit: TiptapVisualAdapterOptions['onSemanticEdit']
  readonly #onShortcut: TiptapVisualAdapterOptions['onShortcut']
  readonly #patchPlanner: Pick<TiptapTransactionPatchPlanner, 'plan'> | undefined
  readonly #project: (snapshot: DocumentSnapshot) => TiptapVisualProjection
  readonly #session: DocumentSession
  readonly #unsubscribe: () => void
  #destroyed = false
  #composing = false
  #checkpointRestoreHistory: CheckpointRestoreHistoryEntry[] = []
  #historyDirection: 'redo' | 'undo' | null = null
  #historySelections: VisualSelectionBookmark[] = []
  #projectionIdentitySequence = 0
  #projection: TiptapVisualProjection

  constructor(options: TiptapVisualAdapterOptions) {
    this.#project = options.project
    this.#onCheckpointHistoryCommit = options.onCheckpointHistoryCommit
    this.#onTransaction = options.onTransaction
    this.#onTransactionFailure = options.onTransactionFailure
    this.#onCompositionEnd = options.onCompositionEnd
    this.#onCompositionStart = options.onCompositionStart
    this.#onSelectionChange = options.onSelectionChange
    this.#onRawEdit = options.onRawEdit
    this.#onSemanticCopy = options.onSemanticCopy
    this.#onSemanticEdit = options.onSemanticEdit
    this.#onShortcut = options.onShortcut
    this.#patchPlanner = options.patchPlanner
    this.#session = options.session
    const initial = options.session.snapshot()
    this.#projection = options.project(initial)
    assertProjection(initial, this.#projection)
    const localization = options.localization ?? createUiLocalizationStore('en')
    this.#editor = new Editor({
      content: this.#projection.content,
      element: options.host,
      extensions: createTiptapVisualExtensions({
        referenceRegistry: referenceRegistry(options.session),
        localization,
        mountChart: (target, source) => (
          options.chartRenderer ?? defaultCherryChartPreviewRenderer
        ).mount(target, source),
        ...(this.#onRawEdit === undefined
          ? {}
          : { onRawEdit: (event) => { if (this.#editor.isEditable) this.#onRawEdit?.(event) } }),
        ...(options.onReadOnlyTaskToggle === undefined
          ? {}
          : {
              onReadOnlyTaskChecked: (node, checked) => {
                const index = this.#taskItemIndex(node)
                return index !== null && options.onReadOnlyTaskToggle?.(Object.freeze({ checked, index })) === true
              },
            }),
        ...(this.#onSemanticCopy === undefined
          ? {}
          : { onSemanticCopy: (event) => this.#onSemanticCopy?.(event) }),
        ...(this.#onSemanticEdit === undefined
          ? {}
          : {
              onSemanticEdit: (event) => {
                if (this.#editor.isEditable || options.allowReadOnlySemanticEdit === true) this.#onSemanticEdit?.(event)
              },
            }),
        renderMermaid: (source) => (options.mermaidRenderer ?? defaultMermaidPreviewRenderer).render(source),
      }),
      editorProps: {
        handleDOMEvents: {
          beforeinput: (_view, event) => {
            const composing = event instanceof InputEvent && event.isComposing
            if (!composing && !this.#composing) this.#synchronizeBrowserSelection()
            return false
          },
        },
        handleKeyDown: (view, event) => {
          if (!this.#editor.isEditable) return false
          const composing = event.isComposing || this.#composing
          if (!composing) this.#synchronizeBrowserSelection()
          if (
            !composing
            && event.key === 'Enter'
            && !event.altKey
            && !event.ctrlKey
            && !event.metaKey
          ) {
            view.dispatch(closeHistory(view.state.tr).setMeta('addToHistory', false))
          }
          if (!composing && (event.key === 'Backspace' || event.key === 'Delete')) {
            this.#closeHistoryForAlignmentBoundaryEdit(view.state.selection)
          }
          if (this.#onShortcut?.(event) === true) return true
          return false
        },
      },
      injectCSS: false,
      onSelectionUpdate: () => this.#onSelectionChange?.(this.selection()),
      onTransaction: ({ transaction }) => this.#observeTransaction(transaction),
    })
    this.#editor.view.dom.setAttribute('aria-label', localization.t('mode.surface.visual'))
    this.#editor.view.dom.addEventListener('compositionstart', this.#handleCompositionStart)
    this.#editor.view.dom.addEventListener('compositionend', this.#handleCompositionEnd)
    this.#editor.view.dom.addEventListener('keydown', this.#handleKeydown)
    const gate = new ProjectionRevisionGate('tiptap-visual', ({ addToHistory, snapshot }) => {
      this.#hydrate(snapshot, addToHistory)
    })
    this.#unsubscribe = options.session.subscribe((change) => {
      gate.receive(change)
    })
  }

  projection(): TiptapVisualProjection {
    return this.#projection
  }

  acknowledgeSynchronization(update: { readonly map: ProjectionMap; readonly snapshot: DocumentSnapshot }): void {
    this.#assertAlive()
    if (update.map.revision !== update.snapshot.revision) {
      throw new InvalidTiptapVisualProjectionError('Acknowledged projection-map revision does not match the document snapshot.')
    }
    if (update.map.documentLength !== update.snapshot.markdown.length) {
      throw new InvalidTiptapVisualProjectionError('Acknowledged projection-map length does not match the document snapshot.')
    }
    const currentProjectionIds = new Set<string>()
    this.#editor.state.doc.descendants((node) => {
      const id = projectionId(node)
      if (id !== null) currentProjectionIds.add(id)
      return true
    })
    if (currentProjectionIds.size !== update.map.entries.length) {
      if (!this.#reconcileMissingProjectionIds(update.snapshot, update.map)) {
        this.#hydrate(update.snapshot, false)
        return
      }
    }
    this.#projection = remapAcknowledgedProjection(this.#editor.state.doc, update.map, update.snapshot)
    if (this.#promoteNestedProjectionIds()) {
      this.#projection = remapAcknowledgedProjection(this.#editor.state.doc, update.map, update.snapshot)
    }
  }

  rebuildFromAuthority(): void {
    this.#assertAlive()
    this.#hydrate(this.#session.snapshot(), false)
  }

  schema(): Schema {
    this.#assertAlive()
    return this.#editor.schema
  }

  documentJSON(): JSONContent {
    this.#assertAlive()
    return this.#editor.getJSON()
  }

  text(): string {
    this.#assertAlive()
    return this.#editor.state.doc.textContent
  }

  composing(): boolean {
    return this.#composing
  }

  selectedText(): string {
    this.#assertAlive()
    this.#synchronizeBrowserSelection()
    const { from, to } = this.#editor.state.selection
    return this.#editor.state.doc.textBetween(from, to)
  }

  copyText(): string {
    this.#assertAlive()
    const { from, to } = this.#editor.state.selection
    return this.#editor.state.doc.textBetween(from, to, '\n')
  }

  selection(): VisualSelection {
    this.#assertAlive()
    const selection = this.#editor.state.selection
    return Object.freeze({
      anchor: selection.anchor,
      head: selection.head,
      kind: selection instanceof NodeSelection ? 'node' : 'text',
    })
  }

  setSelection(selection: Pick<VisualSelection, 'anchor' | 'head'>): void {
    this.#assertAlive()
    const doc = this.#editor.state.doc
    const anchor = clampPosition(doc, selection.anchor)
    const head = clampPosition(doc, selection.head)
    this.#editor.view.dispatch(this.#editor.state.tr.setSelection(
      TextSelection.between(doc.resolve(anchor), doc.resolve(head)),
    ))
  }

  navigateHeading(anchor: string): boolean {
    this.#assertAlive()
    const heading = positionedTocHeadings(this.#editor.state.doc)
      .find((candidate) => candidate.anchor === anchor)
    if (heading === undefined) return false
    scrollTocHeadingIntoView(this.#editor.view.dom, heading.anchor)
    if (this.#editor.isEditable) this.#editor.commands.focus(heading.position + 1, { scrollIntoView: false })
    else {
      const element = [...this.#editor.view.dom.querySelectorAll<HTMLElement>('[data-toc-heading]')]
        .find((candidate) => candidate.id === heading.anchor)
      if (element !== undefined) {
        element.tabIndex = -1
        element.focus({ preventScroll: true })
      }
    }
    window.history.replaceState(null, '', `#${heading.anchor}`)
    return true
  }

  search(query: string, caseSensitive = false): readonly VisualSearchMatch[] {
    this.#assertAlive()
    if (query.length === 0 || query.includes('\0')) return Object.freeze([])
    const matches: VisualSearchMatch[] = []
    this.#editor.state.doc.descendants((node, position) => {
      if (!node.isTextblock) return true
      let text = ''
      const documentPositions: (number | null)[] = []
      node.descendants((child, offset) => {
        if (child.isText) {
          const value = child.text ?? ''
          text += value
          for (let index = 0; index < value.length; index += 1) {
            documentPositions.push(position + 1 + offset + index)
          }
          return false
        }
        if (child.isLeaf) {
          text += '\0'
          documentPositions.push(null)
        }
        return true
      })
      const haystack = caseSensitive ? text : text.toLocaleLowerCase()
      const needle = caseSensitive ? query : query.toLocaleLowerCase()
      let offset = 0
      while (offset <= haystack.length - needle.length) {
        const fromOffset = haystack.indexOf(needle, offset)
        if (fromOffset === -1) break
        const positions = documentPositions.slice(fromOffset, fromOffset + needle.length)
        const from = positions[0]
        const last = positions.at(-1)
        if (from !== null && from !== undefined && last !== null && last !== undefined
          && positions.every((value, index) => value === from + index)) {
          matches.push(Object.freeze({ from, text: text.slice(fromOffset, fromOffset + needle.length), to: last + 1 }))
        }
        offset = fromOffset + Math.max(1, needle.length)
      }
      return false
    })
    return Object.freeze(matches)
  }

  setSearchHighlights(matches: readonly VisualSearchMatch[], activeIndex: number): void {
    this.#assertAlive()
    this.#editor.view.dispatch(this.#editor.state.tr
      .setMeta(VISUAL_SEARCH_HIGHLIGHT_META, Object.freeze({ activeIndex, matches: Object.freeze([...matches]) }))
      .setMeta('addToHistory', false))
    const active = matches[activeIndex]
    if (active === undefined
      || this.#editor.view.dom.closest('.editor-surface') === null
      || typeof document.createRange().getClientRects !== 'function') return
    revealSearchCoordinates(
      this.#editor.view.dom,
      this.#editor.view.coordsAtPos(active.from),
      this.#editor.view.coordsAtPos(active.to),
    )
  }

  clearSearchHighlights(): void {
    this.setSearchHighlights(Object.freeze([]), -1)
  }

  replaceSearchMatches(matches: readonly VisualSearchMatch[], replacement: string): VisualCommandResult {
    this.#assertAlive()
    if (matches.length === 0) return Object.freeze({ active: false, changed: false })
    const ordered = [...matches].sort((left, right) => right.from - left.from)
    const doc = this.#editor.state.doc
    for (const match of ordered) {
      if (doc.textBetween(match.from, match.to, '\n', '\0') !== match.text) {
        throw new RangeError('The visual search match is stale and cannot be replaced.')
      }
    }
    let transaction = this.#editor.state.tr
    for (const match of ordered) transaction = transaction.insertText(replacement, match.from, match.to)
    this.#editor.view.dispatch(transaction)
    return Object.freeze({ active: true, changed: transaction.docChanged })
  }

  insertText(text: string): void {
    this.#assertAlive()
    const { from, to } = this.#editor.state.selection
    this.#editor.view.dispatch(this.#editor.state.tr.insertText(text, from, to))
  }

  dispatchKey(key: 'ArrowLeft' | 'ArrowRight' | 'Backspace' | 'Delete' | 'Enter'): boolean {
    this.#assertAlive()
    if (key === 'Enter') return this.#splitActiveListItem()
    return key === 'ArrowLeft' || key === 'ArrowRight'
      ? this.#moveHorizontal(key)
      : this.#joinOrSelect(key)
  }

  undo(): boolean {
    this.#assertAlive()
    return this.#runHistoryCommand('undo')
  }

  redo(): boolean {
    this.#assertAlive()
    return this.#runHistoryCommand('redo')
  }

  restoreCheckpoint(markdown: string, transactionId: string): CommitAcknowledgement {
    this.#assertAlive()
    const current = this.#session.snapshot()
    if (current.markdown === markdown) {
      return this.#session.commitSource({ markdown, origin: 'checkpoint-restore', transactionId })
    }
    const projectedSnapshot = Object.freeze({
      documentId: current.documentId,
      markdown,
      revision: current.revision + 1,
    })
    const projection = this.#project(projectedSnapshot)
    assertProjection(projectedSnapshot, projection)
    const projectedDocument = this.#editor.schema.nodeFromJSON(projection.content)
    const bookmark = captureSelection(this.#editor.state.doc, this.#editor.state.selection)
    this.#checkpointRestoreHistory = this.#checkpointRestoreHistory.filter((entry) => entry.applied)
    const beforeDocument = this.#editor.state.doc
    const transaction = closeHistory(this.#editor.state.tr
      .replaceWith(0, this.#editor.state.doc.content.size, projectedDocument.content)
      .setMeta(TIPTAP_EXTERNAL_HYDRATION_META, Object.freeze({
        addToHistory: true,
        reason: 'checkpoint-restore',
      })))
    transaction.setSelection(restoreSelection(transaction.doc, bookmark))
    this.#editor.view.dispatch(transaction)
    this.#checkpointRestoreHistory.push({
      applied: true,
      beforeDocument,
      beforeMarkdown: current.markdown,
      restoredDocument: transaction.doc,
      restoredMarkdown: markdown,
    })
    return this.#session.commitSource({ markdown, origin: 'checkpoint-restore', transactionId })
  }

  toggleInlineMark(commandId: InlineMarkCommandId): VisualCommandResult {
    this.#assertAlive()
    const spec = inlineMarkSpec(commandId)
    if (spec === null) throw new RangeError(`Unknown inline mark command: ${commandId}.`)
    this.#synchronizeBrowserSelection()
    const before = this.#editor.state.doc.toJSON()
    const accepted = this.#editor.chain().focus().toggleMark(spec.markType).run()
    return Object.freeze({
      active: this.#editor.isActive(spec.markType),
      changed: accepted && JSON.stringify(before) !== JSON.stringify(this.#editor.state.doc.toJSON()),
    })
  }

  isInlineMarkActive(commandId: InlineMarkCommandId): boolean {
    this.#assertAlive()
    const spec = inlineMarkSpec(commandId)
    if (spec === null) return false
    return this.#editor.isActive(spec.markType)
  }

  applyRichInlineMark(commandId: RichInlineMarkCommandId, value: string, bodyOverride?: string): VisualRichCommandResult {
    this.#assertAlive()
    const spec = richInlineMarkSpec(commandId)
    if (spec === null) throw new RangeError(`Unknown rich inline command: ${commandId}.`)
    this.#synchronizeBrowserSelection()
    const normalizedValue = validateRichInlineMarkValue(commandId, value)
    const selection = this.#editor.state.selection
    const selectedText = this.#editor.state.doc.textBetween(selection.from, selection.to, '\n', '\n')
    const body = bodyOverride?.trim() ?? selectedText
    const storesTypingAttribute = selection.empty
      && bodyOverride === undefined
      && (commandId === 'text.color' || commandId === 'text.background')
    if ((!storesTypingAttribute && body.length === 0) || body.includes('\0') || body.includes('\n')) {
      throw new RangeError('Rich inline content must be non-empty and cannot contain NUL or line breaks.')
    }
    const attrs = commandId === 'text.ruby'
      ? { annotation: normalizedValue }
      : commandId === 'text.size' ? { fontSize: `${normalizedValue}px` } : { color: normalizedValue }
    const before = this.#editor.state.doc.toJSON()
    const chain = this.#editor.chain().focus()
    const accepted = body !== selectedText
      ? chain
          .insertContentAt({ from: selection.from, to: selection.to }, body)
          .setTextSelection({ from: selection.from, to: selection.from + body.length })
          .setMark(spec.mark.type, attrs)
          .run()
      : chain.setMark(spec.mark.type, attrs).run()
    return Object.freeze({
      active: this.#editor.isActive(spec.mark.type, attrs),
      changed: accepted && (storesTypingAttribute || JSON.stringify(before) !== JSON.stringify(this.#editor.state.doc.toJSON())),
      value: normalizedValue,
    })
  }

  richInlineMarkValue(commandId: RichInlineMarkCommandId): string | null {
    this.#assertAlive()
    const spec = richInlineMarkSpec(commandId)
    if (spec === null || !this.#editor.isActive(spec.mark.type)) return null
    const attributes = this.#editor.getAttributes(spec.mark.type)
    const raw = commandId === 'text.ruby'
      ? attributes['annotation']
      : commandId === 'text.size' ? attributes['fontSize'] : attributes['color']
    if (typeof raw !== 'string' || raw.length === 0) return null
    return commandId === 'text.size' && raw.endsWith('px') ? raw.slice(0, -2) : raw
  }

  clearRichInlineMark(commandId: 'text.background' | 'text.color'): VisualCommandResult {
    this.#assertAlive()
    this.#synchronizeBrowserSelection()
    const before = this.#editor.state.doc.toJSON()
    const selectionWasEmpty = this.#editor.state.selection.empty
    const chain = this.#editor.chain().focus()
    const accepted = commandId === 'text.color'
      ? chain.unsetColor().run()
      : chain.unsetHighlight().run()
    return Object.freeze({
      active: false,
      changed: accepted && (selectionWasEmpty || JSON.stringify(before) !== JSON.stringify(this.#editor.state.doc.toJSON())),
    })
  }

  applyHeading(commandId: HeadingCommandId): VisualCommandResult {
    this.#assertAlive()
    const level = headingLevel(commandId)
    if (level === null) throw new RangeError(`Unknown heading command: ${commandId}.`)
    const before = this.#editor.state.doc.toJSON()
    const accepted = this.#editor.chain().focus().toggleHeading({ level }).run()
    return Object.freeze({
      active: this.#editor.isActive('heading', { level }),
      changed: accepted && JSON.stringify(before) !== JSON.stringify(this.#editor.state.doc.toJSON()),
    })
  }

  isHeadingActive(commandId: HeadingCommandId): boolean {
    this.#assertAlive()
    const level = headingLevel(commandId)
    return level !== null && this.#editor.isActive('heading', { level })
  }

  applyList(commandId: ListCommandId): VisualCommandResult {
    this.#assertAlive()
    const kind = listCommandKind(commandId)
    if (kind === null) throw new RangeError(`Unknown list command: ${commandId}.`)
    this.#synchronizeBrowserSelection()
    const before = this.#editor.state.doc.toJSON()
    const chain = this.#editor.chain().focus()
    const accepted = kind === 'list.ordered'
      ? chain.toggleOrderedList().run()
      : kind === 'list.task' ? chain.toggleTaskList().run() : chain.toggleBulletList().run()
    return Object.freeze({
      active: this.isListActive(commandId),
      changed: accepted && JSON.stringify(before) !== JSON.stringify(this.#editor.state.doc.toJSON()),
    })
  }

  isListActive(commandId: ListCommandId): boolean {
    this.#assertAlive()
    const kind = listCommandKind(commandId)
    const nodeType = kind === 'list.ordered' ? 'orderedList' : kind === 'list.task' ? 'taskList' : 'bulletList'
    return kind !== null && this.#editor.isActive(nodeType)
  }

  applyBlockquote(): VisualCommandResult {
    this.#assertAlive()
    this.#synchronizeBrowserSelection()
    const before = this.#editor.state.doc.toJSON()
    const accepted = this.#editor.chain().focus().setBlockquote().run()
    return Object.freeze({
      active: this.#editor.isActive('blockquote'),
      changed: accepted && JSON.stringify(before) !== JSON.stringify(this.#editor.state.doc.toJSON()),
    })
  }

  canApplyBlockquote(): boolean {
    this.#assertAlive()
    this.#synchronizeBrowserSelection()
    return this.#editor.can().setBlockquote()
  }

  selectDomBlock(block: HTMLElement): boolean {
    this.#assertAlive()
    const located = this.#domBlock(block)
    if (located === null) return false
    const from = located.position + 1
    const to = Math.max(from, located.position + located.node.nodeSize - 1)
    const selection = located.node.isAtom
      ? NodeSelection.create(this.#editor.state.doc, located.position)
      : TextSelection.create(this.#editor.state.doc, from, to)
    this.#editor.view.dispatch(this.#editor.state.tr.setSelection(selection))
    this.#editor.view.focus()
    return true
  }

  insertParagraphAfterDomBlock(block: HTMLElement): VisualCommandResult {
    this.#assertAlive()
    const located = this.#domBlock(block)
    const paragraphType = this.#editor.schema.nodes['paragraph']
    if (located === null || paragraphType === undefined) return Object.freeze({ active: false, changed: false })
    const insertAt = located.position + located.node.nodeSize
    const paragraph = paragraphType.create()
    const transaction = this.#editor.state.tr.insert(insertAt, paragraph)
    transaction.setMeta(TIPTAP_EXTERNAL_HYDRATION_META, Object.freeze({
      addToHistory: true,
      reason: 'insert-empty-block-scaffold',
      revision: this.#projection.revision,
    }))
    transaction.setSelection(TextSelection.create(transaction.doc, insertAt + 1))
    this.#editor.view.dispatch(transaction)
    this.#editor.view.focus()
    return Object.freeze({ active: true, changed: true })
  }

  insertParagraphBeforeDomBlock(block: HTMLElement): VisualCommandResult {
    this.#assertAlive()
    const located = this.#domBlock(block)
    const paragraphType = this.#editor.schema.nodes['paragraph']
    if (located === null || paragraphType === undefined) return Object.freeze({ active: false, changed: false })
    const insertAt = located.position
    const paragraph = paragraphType.create()
    const transaction = this.#editor.state.tr.insert(insertAt, paragraph)
    transaction.setMeta(TIPTAP_EXTERNAL_HYDRATION_META, Object.freeze({
      addToHistory: true,
      reason: 'insert-empty-block-scaffold',
      revision: this.#projection.revision,
    }))
    transaction.setSelection(TextSelection.create(transaction.doc, insertAt + 1))
    this.#editor.view.dispatch(transaction)
    this.#editor.view.focus()
    return Object.freeze({ active: true, changed: true })
  }

  duplicateDomBlock(block: HTMLElement): VisualCommandResult {
    this.#assertAlive()
    const located = this.#domBlock(block)
    if (located === null) return Object.freeze({ active: false, changed: false })
    // Keep the projection identity through planning so the serializer treats the
    // original and its new sibling as one split family. The post-transaction
    // identity cleanup detaches the inserted sibling after the patch is planned.
    const clone = located.node.copy(located.node.content)
    const insertAt = located.position + located.node.nodeSize
    const transaction = this.#editor.state.tr.insert(insertAt, clone)
    transaction.setSelection(Selection.near(transaction.doc.resolve(insertAt + 1)))
    this.#editor.view.dispatch(transaction)
    this.#editor.view.focus()
    return Object.freeze({ active: true, changed: true })
  }

  deleteDomBlock(block: HTMLElement): VisualCommandResult {
    this.#assertAlive()
    const located = this.#domBlock(block)
    if (located === null) return Object.freeze({ active: false, changed: false })
    const transaction = this.#editor.state.tr.delete(located.position, located.position + located.node.nodeSize)
    transaction.setSelection(Selection.near(transaction.doc.resolve(Math.min(located.position, transaction.doc.content.size))))
    this.#editor.view.dispatch(transaction)
    this.#editor.view.focus()
    return Object.freeze({ active: true, changed: true })
  }

  resetDomBlockFormatting(block: HTMLElement): VisualCommandResult {
    this.#assertAlive()
    if (!this.selectDomBlock(block)) return Object.freeze({ active: false, changed: false })
    const before = this.#editor.state.doc.toJSON()
    const accepted = this.#editor.chain().focus().unsetAllMarks().clearNodes().run()
    return Object.freeze({
      active: accepted,
      changed: accepted && JSON.stringify(before) !== JSON.stringify(this.#editor.state.doc.toJSON()),
    })
  }

  domBlockSource(block: HTMLElement): string | null {
    this.#assertAlive()
    const located = this.#domBlock(block)
    if (located === null) return null
    const source = located.node.attrs['source'] ?? located.node.attrs['originalSource']
    return typeof source === 'string' ? source : located.node.textContent
  }

  canApplyAlignment(): boolean {
    this.#assertAlive()
    const selection = this.#editor.state.selection
    if (selection instanceof NodeSelection && selection.node.type.name !== 'inlineImage') return false
    const alignmentDepth = this.#alignmentAncestorDepth(selection.$head)
    if (alignmentDepth !== null) {
      return this.#alignmentAncestorDepth(selection.$anchor) === alignmentDepth
    }
    const range = selection.$from.blockRange(selection.$to)
    if (range === null || range.parent.type.name !== 'doc') return false
    for (let index = range.startIndex; index < range.endIndex; index += 1) {
      const name = range.parent.child(index).type.name
      if (name !== 'paragraph' && name !== 'heading') return false
    }
    return range.startIndex < range.endIndex
  }

  applyAlignment(commandId: AlignmentCommandId): VisualCommandResult {
    this.#assertAlive()
    const alignment = alignmentValue(commandId)
    if (alignment === null) throw new RangeError(`Unknown alignment command: ${commandId}.`)
    if (!this.canApplyAlignment()) return Object.freeze({ active: false, changed: false })
    const selection = this.#editor.state.selection
    const alignmentDepth = this.#alignmentAncestorDepth(selection.$head)
    const transaction = this.#editor.state.tr
    if (alignmentDepth !== null) {
      const wrapper = selection.$head.node(alignmentDepth)
      const wrapperPosition = selection.$head.before(alignmentDepth)
      if (wrapper.attrs['alignment'] === alignment) {
        const children = Fragment.fromArray(Array.from({ length: wrapper.childCount }, (_, index) => (
          withTextAlignment(wrapper.child(index), null)
        )))
        transaction.replaceWith(wrapperPosition, wrapperPosition + wrapper.nodeSize, children)
      } else {
        let childPosition = wrapperPosition + 1
        for (let index = 0; index < wrapper.childCount; index += 1) {
          const child = wrapper.child(index)
          transaction.setNodeMarkup(childPosition, undefined, {
            ...child.attrs,
            textAlign: alignment,
          })
          childPosition += child.nodeSize
        }
        transaction.setNodeMarkup(wrapperPosition, undefined, {
          ...wrapper.attrs,
          alignment,
        })
      }
    } else {
      const range = selection.$from.blockRange(selection.$to)
      const type = this.#editor.schema.nodes['alignmentBlock']
      if (range === null || type === undefined) return Object.freeze({ active: false, changed: false })
      const wrapping = findWrapping(range, type, { alignment })
      if (wrapping === null) return Object.freeze({ active: false, changed: false })
      transaction.wrap(range, wrapping)
    }
    this.#editor.view.dispatch(closeHistory(transaction))
    this.#editor.view.dispatch(closeHistory(this.#editor.state.tr).setMeta('addToHistory', false))
    return Object.freeze({ active: this.isAlignmentActive(commandId), changed: transaction.docChanged })
  }

  isAlignmentActive(commandId: AlignmentCommandId): boolean {
    this.#assertAlive()
    const alignment = alignmentValue(commandId)
    if (alignment === null) return false
    const selection = this.#editor.state.selection
    const depth = this.#alignmentAncestorDepth(selection.$head)
    return depth !== null
      && this.#alignmentAncestorDepth(selection.$anchor) === depth
      && selection.$head.node(depth).attrs['alignment'] === alignment
  }

  toggleTaskItemChecked(): VisualCommandResult {
    this.#assertAlive()
    const selection = this.#editor.state.selection
    for (let depth = selection.$head.depth; depth > 0; depth -= 1) {
      const node = selection.$head.node(depth)
      if (node.type.name !== 'taskItem') continue
      const checked = node.attrs['checked'] !== true
      const transaction = this.#editor.state.tr.setNodeMarkup(selection.$head.before(depth), undefined, {
        ...node.attrs,
        checked,
      })
      this.#editor.view.dispatch(transaction)
      return Object.freeze({ active: checked, changed: true })
    }
    return Object.freeze({ active: false, changed: false })
  }

  #taskItemIndex(target: ProseMirrorNode): number | null {
    const targetProjectionId = projectionId(target)
    let index = 0
    let match: number | null = null
    this.#editor.state.doc.descendants((node) => {
      if (node.type.name !== 'taskItem') return true
      if (
        match === null
        && (node === target || (targetProjectionId !== null && projectionId(node) === targetProjectionId))
      ) match = index
      index += 1
      return true
    })
    return match
  }

  applyLink(href: string): VisualCommandResult {
    this.#assertAlive()
    const before = this.#editor.state.doc.toJSON()
    const accepted = this.#editor.chain().focus().setLink({ href }).run()
    return Object.freeze({
      active: this.#editor.isActive('link', { href }),
      changed: accepted && JSON.stringify(before) !== JSON.stringify(this.#editor.state.doc.toJSON()),
    })
  }

  toggleInlineCode(): VisualCommandResult {
    this.#assertAlive()
    const before = this.#editor.state.doc.toJSON()
    const accepted = this.#editor.chain().focus().toggleCode().run()
    return Object.freeze({
      active: this.#editor.isActive('code'),
      changed: accepted && JSON.stringify(before) !== JSON.stringify(this.#editor.state.doc.toJSON()),
    })
  }

  insertHardBreak(): VisualCommandResult {
    this.#assertAlive()
    const before = this.#editor.state.doc.toJSON()
    const accepted = this.#editor.chain().focus().setHardBreak().run()
    return Object.freeze({ active: false, changed: accepted && JSON.stringify(before) !== JSON.stringify(this.#editor.state.doc.toJSON()) })
  }

  insertTable(columns: number, dataRows: number): VisualCommandResult {
    this.#assertAlive()
    this.#synchronizeBrowserSelection()
    if (!Number.isInteger(columns) || columns < 1 || columns > 9
      || !Number.isInteger(dataRows) || dataRows < 1 || dataRows > 9) {
      return Object.freeze({ active: false, changed: false })
    }
    const before = this.#editor.state.doc.toJSON()
    const paragraph = this.#editor.schema.nodes['paragraph']
    const table = this.#editor.schema.nodes['table']
    const tableRow = this.#editor.schema.nodes['tableRow']
    const tableHeader = this.#editor.schema.nodes['tableHeader']
    const tableCell = this.#editor.schema.nodes['tableCell']
    if (paragraph === undefined || table === undefined || tableRow === undefined || tableHeader === undefined || tableCell === undefined) {
      return Object.freeze({ active: false, changed: false })
    }
    const header = tableRow.create(null, Array.from(
      { length: columns },
      () => tableHeader.create({ align: null }, paragraph.create(null, this.#editor.schema.text('Header'))),
    ))
    const body = () => tableRow.create(null, Array.from(
      { length: columns },
      () => tableCell.create({ align: null }, paragraph.create(null, this.#editor.schema.text('Sample'))),
    ))
    const node = table.create(null, [header, ...Array.from({ length: dataRows }, body)])
    const selection = this.#editor.state.selection
    const selectedBlock = selection.$head.depth > 0 ? selection.$head.node(1) : null
    const replaceEmptyBlock = selectedBlock?.isTextblock === true && selectedBlock.content.size === 0
    const insertPosition = selection.$head.depth > 0
      ? replaceEmptyBlock ? selection.$head.before(1) : selection.$head.before(1) + selectedBlock!.nodeSize
      : this.#editor.state.doc.content.size
    const transaction = replaceEmptyBlock
      ? this.#editor.state.tr.replaceWith(insertPosition, selection.$head.after(1), node)
      : this.#editor.state.tr.insert(insertPosition, node)
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(insertPosition + 3)))
    this.#editor.view.dispatch(transaction)
    return Object.freeze({
      active: this.#editor.isActive('table'),
      changed: JSON.stringify(before) !== JSON.stringify(this.#editor.state.doc.toJSON()),
    })
  }

  insertSimpleBlock(commandId: 'insert.horizontal-rule' | 'insert.toc'): VisualCommandResult {
    this.#assertAlive()
    if (commandId === 'insert.toc') {
      const existing = this.selectTocBlock()
      if (existing.active) return existing
    }
    const before = this.#editor.state.doc.toJSON()
    const selection = this.#editor.state.selection
    const insertPosition = selection.$head.depth > 0
      ? selection.$head.before(1) + selection.$head.node(1).nodeSize
      : this.#editor.state.doc.content.size
    const node = commandId === 'insert.horizontal-rule'
      ? this.#editor.schema.nodes['horizontalRule']?.create()
      : this.#editor.schema.nodes['tocBlock']?.create({ source: '[[toc]]' })
    if (node === undefined) return Object.freeze({ active: false, changed: false })
    const transaction = this.#editor.state.tr.insert(insertPosition, node)
    if (commandId === 'insert.toc') {
      transaction
        .setSelection(NodeSelection.create(transaction.doc, insertPosition))
        .scrollIntoView()
    }
    this.#editor.view.dispatch(transaction)
    if (commandId === 'insert.toc') this.focus()
    return Object.freeze({
      active: commandId === 'insert.toc',
      changed: JSON.stringify(before) !== JSON.stringify(this.#editor.state.doc.toJSON()),
    })
  }

  selectTocBlock(): VisualCommandResult {
    this.#assertAlive()
    const existingPosition = firstTocBlockPosition(this.#editor.state.doc)
    if (existingPosition === null) return Object.freeze({ active: false, changed: false })
    const transaction = this.#editor.state.tr
      .setSelection(NodeSelection.create(this.#editor.state.doc, existingPosition))
      .scrollIntoView()
    this.#editor.view.dispatch(transaction)
    this.focus()
    return Object.freeze({ active: true, changed: false })
  }

  selectedFormula(): VisualFormulaSelection | null {
    this.#assertAlive()
    const selection = this.#editor.state.selection
    if (!(selection instanceof NodeSelection)) return null
    const mode: FormulaMode | null = selection.node.type.name === 'inlineFormula'
      ? 'inline'
      : selection.node.type.name === 'formulaBlock'
        ? 'block'
        : null
    if (mode === null) return null
    const content = String(selection.node.attrs['content'] ?? '')
    return Object.freeze({ content, mode, source: serializeFormula(mode, content) })
  }

  selectedFormulaSource(): string | null {
    return this.selectedFormula()?.source ?? null
  }

  applyReference(reference: DocumentReference): VisualCommandResult {
    this.#assertAlive()
    referenceMarkdown(reference)
    const node = this.#editor.schema.nodes['citation']?.create(reference)
    if (!node || !this.#editor.isEditable) return { active: false, changed: false }
    this.#editor.view.dispatch(closeHistory(this.#editor.state.tr.replaceSelectionWith(node)))
    return { active: true, changed: true }
  }

  updateReference(id: string, patch: Pick<DocumentReference, 'text' | 'metadata' | 'style'>): VisualCommandResult {
    return this.#changeReferences(reference => reference.id === id ? { id: reference.id, number: reference.number, ...patch } : reference)
  }

  removeReference(id: string): VisualCommandResult {
    const result = this.#changeReferences(reference => reference.id === id ? null : reference)
    if (result.changed) referenceRegistry(this.#session).forget(id)
    return result
  }

  setReferenceStyle(style: ReferenceStyle): VisualCommandResult {
    return this.#changeReferences(reference => ({ ...reference, style }), parseReferenceStyle(style))
  }

  #changeReferences(change: (reference: DocumentReference) => DocumentReference | null, documentStyle?: ReferenceStyle): VisualCommandResult {
    this.#assertAlive()
    if (!this.#editor.isEditable) return { active: false, changed: false }
    const transaction = this.#editor.state.tr
    this.#editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'citation') return
      const previous = referenceFromAttributes(node.attrs)
      const next = change(previous)
      if (next === null) transaction.delete(transaction.mapping.map(pos), transaction.mapping.map(pos + node.nodeSize))
      else if (referenceMarkdown(previous) !== referenceMarkdown(next)) transaction.setNodeMarkup(transaction.mapping.map(pos), undefined, { ...next })
    })
    if (documentStyle !== undefined) {
      const first = transaction.doc.firstChild
      if (first?.type.name === 'referenceDocumentStyle') {
        if (first.attrs['style'] !== documentStyle) transaction.setNodeMarkup(0, undefined, { ...first.attrs, style: documentStyle })
      } else {
        transaction.insert(0, this.#editor.schema.nodes['referenceDocumentStyle']!.create({ style: documentStyle }))
      }
    }
    if (!transaction.docChanged) return { active: false, changed: false }
    this.#editor.view.dispatch(closeHistory(transaction))
    this.#editor.view.dispatch(closeHistory(this.#editor.state.tr).setMeta('addToHistory', false))
    return { active: true, changed: true }
  }

  applyFormula(source: string): VisualCommandResult
  applyFormula(mode: FormulaMode, content: string): VisualCommandResult
  applyFormula(modeOrSource: FormulaMode | string, content?: string): VisualCommandResult {
    this.#assertAlive()
    let mode: FormulaMode
    let formulaContent: string
    if (content !== undefined && (modeOrSource === 'inline' || modeOrSource === 'block')) {
      mode = modeOrSource
      formulaContent = content
      serializeFormula(mode, formulaContent)
    } else {
      const source = modeOrSource
      const block = parseBlockFormulaAt(source, 0)
      const inline = parseInlineFormulaAt(source, 0)
      const parsed = block?.to === source.length ? block : inline?.to === source.length ? inline : null
      if (parsed === null) throw new RangeError('Formula source must be one complete inline or block formula.')
      mode = parsed.mode
      formulaContent = parsed.content
    }
    const before = this.#editor.state.doc.toJSON()
    const selection = this.#editor.state.selection
    const selectedMode: FormulaMode | null = selection instanceof NodeSelection
      ? selection.node.type.name === 'inlineFormula'
        ? 'inline'
        : selection.node.type.name === 'formulaBlock'
          ? 'block'
          : null
      : null
    if (selectedMode === mode && selection instanceof NodeSelection) {
      const transaction = this.#editor.state.tr.setNodeMarkup(selection.from, undefined, {
        ...selection.node.attrs,
        content: formulaContent,
        formulaMode: mode,
        localError: null,
        source: serializeFormula(mode, formulaContent),
      })
      transaction.setSelection(NodeSelection.create(transaction.doc, selection.from))
      this.#editor.view.dispatch(closeHistory(transaction))
    } else if (mode === 'inline') {
      const node = this.#editor.schema.nodes['inlineFormula']?.create({
        content: formulaContent,
        formulaMode: 'inline',
        localError: null,
        source: serializeFormula('inline', formulaContent),
      })
      if (node === undefined) return Object.freeze({ active: false, changed: false })
      const transaction = this.#editor.state.tr.replaceSelectionWith(node)
      transaction.setSelection(NodeSelection.create(transaction.doc, selection.from))
      this.#editor.view.dispatch(closeHistory(transaction))
    } else {
      const replacesEmptyTextBlock = selection instanceof TextSelection
        && selection.empty
        && selection.$head.depth > 0
        && selection.$head.parent.isTextblock
        && selection.$head.parent.content.size === 0
      const insertPosition = replacesEmptyTextBlock
        ? selection.$head.before(1)
        : selection.$head.depth > 0
        ? selection.$head.before(1) + selection.$head.node(1).nodeSize
        : this.#editor.state.doc.content.size
      const node = this.#editor.schema.nodes['formulaBlock']?.create({
        content: formulaContent,
        formulaMode: 'block',
        localError: null,
      })
      if (node === undefined) return Object.freeze({ active: false, changed: false })
      const transaction = replacesEmptyTextBlock
        ? this.#editor.state.tr.replaceWith(insertPosition, selection.$head.after(1), node)
        : this.#editor.state.tr.insert(insertPosition, node)
      transaction.setSelection(NodeSelection.create(transaction.doc, insertPosition))
      this.#editor.view.dispatch(closeHistory(transaction))
    }
    return Object.freeze({
      active: this.selectedFormula() !== null,
      changed: JSON.stringify(before) !== JSON.stringify(this.#editor.state.doc.toJSON()),
    })
  }

  selectedSemanticBlock(): VisualSemanticBlockSelection | null {
    this.#assertAlive()
    const codeBlock = this.selectedCodeBlock()
    if (codeBlock !== null) return codeBlock
    const selection = this.#editor.state.selection
    if (selection instanceof NodeSelection && selection.node.type.name === 'inlineImage') {
      return Object.freeze({ ...imageAttributes(selection.node.attrs), kind: 'media', mediaKind: 'image',
        layoutKind: null, source: imageMarkdown(selection.node.attrs) })
    }
    if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'semanticBlock') return null
    const variant = selection.node.attrs['variant']
    const code = selection.node.attrs['code']
    const language = selection.node.attrs['language']
    const diagramType = selection.node.attrs['diagramType']
    const chartType = selection.node.attrs['chartType']
    const attachmentKind = selection.node.attrs['attachmentKind']
    const mediaKind = selection.node.attrs['mediaKind']
    const mediaType = selection.node.attrs['mediaType']
    const name = selection.node.attrs['name']
    const png = selection.node.attrs['png']
    const url = selection.node.attrs['url']
    const size = selection.node.attrs['size']
    const kind = String(selection.node.attrs['kind'] ?? 'unknown')
    return Object.freeze({
      ...(kind === 'attachment' && typeof attachmentKind === 'string' ? { attachmentKind } : {}),
      ...(kind === 'chart-table' && typeof chartType === 'string' ? { chartType } : {}),
      ...(kind === 'code-block' && typeof code === 'string' ? { code } : {}),
      ...(kind === 'chart-table' && Array.isArray(selection.node.attrs['columns'])
        ? { columns: selection.node.attrs['columns'] as readonly string[] }
        : {}),
      ...(kind === 'mermaid' && typeof code === 'string' ? { code } : {}),
      ...(kind === 'mermaid' && typeof diagramType === 'string' ? { diagramType } : {}),
      kind,
      ...(kind === 'code-block' && typeof language === 'string' ? { language } : {}),
      layoutKind: typeof selection.node.attrs['layoutKind'] === 'string' ? selection.node.attrs['layoutKind'] : null,
      ...(kind === 'media' && typeof mediaKind === 'string' ? { mediaKind } : {}),
      ...(kind === 'attachment' && typeof mediaType === 'string' ? { mediaType } : {}),
      ...(kind === 'attachment' && typeof name === 'string' ? { name } : {}),
      ...(kind === 'media' && typeof name === 'string' ? { name } : {}),
      ...(kind === 'drawio' && typeof name === 'string' ? { name } : {}),
      ...(kind === 'chart-table' && typeof selection.node.attrs['options'] === 'object' && selection.node.attrs['options'] !== null
        ? { options: selection.node.attrs['options'] as Readonly<Record<string, unknown>> }
        : {}),
      ...(kind === 'chart-table' && Array.isArray(selection.node.attrs['rows'])
        ? { rows: selection.node.attrs['rows'] as readonly (readonly string[])[] }
        : {}),
      ...(kind === 'attachment' && typeof size === 'number' ? { size } : {}),
      ...(kind === 'drawio' && typeof png === 'string' ? { png } : {}),
      source: String(selection.node.attrs['source'] ?? ''),
      ...(kind === 'chart-table' && typeof selection.node.attrs['title'] === 'string'
        ? { title: selection.node.attrs['title'] as string }
        : {}),
      ...(kind === 'media' && typeof url === 'string' ? { url } : {}),
      ...(kind === 'attachment' && typeof url === 'string' ? { url } : {}),
      ...(typeof variant === 'string' ? { variant } : {}),
      ...(kind === 'drawio' && typeof selection.node.attrs['xml'] === 'string'
        ? { xml: selection.node.attrs['xml'] as string }
        : {}),
    })
  }

  selectedCodeBlock(): VisualSemanticBlockSelection | null {
    this.#assertAlive()
    const selected = selectedCodeBlockAt(this.#editor.state.selection)
    if (selected === null) return null
    const language = String(selected.node.attrs['language'] ?? '')
    const code = selected.node.textContent
    return Object.freeze({
      code,
      kind: 'code-block',
      language,
      layoutKind: null,
      source: serializeFencedCode(language, code),
    })
  }

  setSelectedSemanticLocalError(message: string | null): boolean {
    this.#assertAlive()
    const selection = this.#editor.state.selection
    const codeBlock = selectedCodeBlockAt(selection)
    const selected = codeBlock ?? (selection instanceof NodeSelection && selection.node.type.name === 'semanticBlock'
      ? Object.freeze({ node: selection.node, position: selection.from })
      : null)
    if (selected === null) return false
    const transaction = this.#editor.state.tr.setNodeMarkup(selected.position, undefined, {
      ...selected.node.attrs,
      localError: message,
    })
    transaction.setMeta(TIPTAP_EXTERNAL_HYDRATION_META, true)
    transaction.setMeta('addToHistory', false)
    this.#editor.view.dispatch(transaction)
    return true
  }

  selectedRawNode(): VisualRawNodeSelection | null {
    this.#assertAlive()
    const selection = this.#editor.state.selection
    if (!(selection instanceof NodeSelection)
      || (selection.node.type.name !== 'rawBlock' && selection.node.type.name !== 'rawInline')) return null
    return Object.freeze({
      kind: selection.node.type.name,
      source: String(selection.node.attrs['source'] ?? ''),
    })
  }

  applyRawSource(source: string): VisualCommandResult {
    this.#assertAlive()
    const selection = this.#editor.state.selection
    if (!(selection instanceof NodeSelection)
      || (selection.node.type.name !== 'rawBlock' && selection.node.type.name !== 'rawInline')) {
      return Object.freeze({ active: false, changed: false })
    }
    if (String(selection.node.attrs['source'] ?? '') === source) {
      return Object.freeze({ active: true, changed: false })
    }

    const projected = this.#project(Object.freeze({
      documentId: 'raw-source-draft',
      markdown: source,
      revision: this.#projection.revision,
    }))
    const projectedDocument = this.#editor.schema.nodeFromJSON(projected.content)
    const transaction = this.#editor.state.tr
    if (selection.node.type.name === 'rawBlock') {
      const candidate = projectedDocument.childCount === 1
        ? projectedDocument.firstChild
        : null
      const projectedEntry = projected.map.entries[0]
      const exactCandidate = candidate !== null
        && projected.map.entries.length === 1
        && projectedEntry?.sourceSpan.from === 0
        && projectedEntry.sourceSpan.to === source.length
        ? candidate
        : this.#editor.schema.nodes['rawBlock']?.create({ source }) ?? null
      if (exactCandidate === null) return Object.freeze({ active: true, changed: false })
      const attrs = {
        ...exactCandidate.attrs,
        ordinaryClass: selection.node.attrs['ordinaryClass'],
        originalSource: selection.node.attrs['originalSource'],
        projectionId: selection.node.attrs['projectionId'],
        revision: selection.node.attrs['revision'],
        sourceFrom: selection.node.attrs['sourceFrom'],
        sourceTo: selection.node.attrs['sourceTo'],
      }
      const replacement = exactCandidate.type.create(attrs, exactCandidate.content, exactCandidate.marks)
      transaction.replaceWith(selection.from, selection.to, replacement)
      if (NodeSelection.isSelectable(replacement)) {
        transaction.setSelection(NodeSelection.create(transaction.doc, selection.from))
      }
    } else {
      const candidate = projectedDocument.childCount === 1 && projectedDocument.firstChild?.type.name === 'paragraph'
        ? projectedDocument.firstChild.content
        : Fragment.from(this.#editor.schema.nodes['rawInline']?.create({ source }))
      transaction.replaceWith(selection.from, selection.to, candidate)
      transaction.setSelection(TextSelection.near(transaction.doc.resolve(selection.from + candidate.size)))
    }
    this.#editor.view.dispatch(transaction)
    return Object.freeze({ active: true, changed: true })
  }

  applySemanticBlock(input: VisualSemanticBlockInput): VisualCommandResult {
    this.#assertAlive()
    if (input.kind === 'media' && input.mediaKind === 'image') return this.#applyInlineImage(input)
    if (input.kind === 'code-block') return this.applyCodeBlock(input.language ?? '', input.code ?? input.body ?? '')
    const before = this.#editor.state.doc.toJSON()
    const selection = this.#editor.state.selection
    const attributes = {
      attachmentKind: input.attachmentKind ?? null,
      body: input.body ?? '',
      chartType: input.chartType ?? null,
      code: input.code ?? '',
      columns: input.columns ?? Object.freeze([]),
      diagramType: input.diagramType ?? null,
      items: input.items ?? Object.freeze([]),
      kind: input.kind,
      language: input.language ?? '',
      editorId: input.editorId ?? null,
      identity: input.identity ?? '',
      layoutKind: input.layoutKind ?? null,
      mediaKind: input.mediaKind ?? null,
      mediaType: input.mediaType ?? '',
      name: input.name ?? '',
      options: input.options ?? Object.freeze({}),
      previewRole: input.previewRole ?? null,
      png: input.png ?? '',
      rows: input.rows ?? Object.freeze([]),
      size: input.size ?? 0,
      source: input.source,
      title: input.title ?? '',
      url: input.url ?? '',
      variant: input.variant ?? null,
      xml: input.xml ?? '',
    }
    if (selection instanceof NodeSelection
      && selection.node.type.name === 'semanticBlock'
      && selection.node.attrs['kind'] === input.kind
      && (input.layoutKind === undefined || selection.node.attrs['layoutKind'] === input.layoutKind)) {
      this.#editor.view.dispatch(this.#editor.state.tr.setNodeMarkup(selection.from, undefined, {
        ...selection.node.attrs,
        ...attributes,
      }))
    } else {
      const replacesEmptyTextBlock = selection instanceof TextSelection
        && selection.empty
        && selection.$head.depth > 0
        && selection.$head.parent.isTextblock
        && selection.$head.parent.content.size === 0
      const insertPosition = replacesEmptyTextBlock
        ? selection.$head.before(1)
        : selection.$head.depth > 0
        ? selection.$head.before(1) + selection.$head.node(1).nodeSize
        : this.#editor.state.doc.content.size
      const node = this.#editor.schema.nodes['semanticBlock']?.create(attributes)
      if (node === undefined) return Object.freeze({ active: false, changed: false })
      const transaction = replacesEmptyTextBlock
        ? this.#editor.state.tr.replaceWith(insertPosition, selection.$head.after(1), node)
        : this.#editor.state.tr.insert(insertPosition, node)
      transaction.setSelection(NodeSelection.create(transaction.doc, insertPosition))
      this.#editor.view.dispatch(transaction)
    }
    return Object.freeze({
      active: this.selectedSemanticBlock() !== null,
      changed: JSON.stringify(before) !== JSON.stringify(this.#editor.state.doc.toJSON()),
    })
  }

  #applyInlineImage(input: VisualSemanticBlockInput): VisualCommandResult {
    if (!this.#editor.isEditable) return Object.freeze({ active: false, changed: false })
    const parsed = parseInlineImageAt(input.source, 0)
    if (parsed === null || parsed.sourceSpan.to !== input.source.length) return Object.freeze({ active: false, changed: false })
    const selection = this.#editor.state.selection
    const selected = selection instanceof NodeSelection && selection.node.type.name === 'inlineImage' ? selection.node : null
    const attributes = {
      name: parsed.name, url: parsed.url,
      width: parsed.width ?? selected?.attrs['width'] ?? null,
      height: parsed.height ?? selected?.attrs['height'] ?? null,
      source: selected === null ? parsed.source : String(selected.attrs['source'] ?? ''),
    }
    attributes.source = imageMarkdown(attributes)
    const node = this.#editor.schema.nodes['inlineImage']?.create(attributes)
    if (node === undefined) return Object.freeze({ active: false, changed: false })
    const before = this.#editor.state.doc.toJSON()
    const transaction = selected === null
      ? this.#editor.state.tr.replaceSelectionWith(node)
      : this.#editor.state.tr.setNodeMarkup(selection.from, undefined, attributes)
    if (selected === null) {
      const pos = transaction.selection.from - node.nodeSize
      if (pos >= 0 && transaction.doc.nodeAt(pos)?.type.name === 'inlineImage') {
        transaction.setSelection(NodeSelection.create(transaction.doc, pos))
      }
    }
    this.#editor.view.dispatch(closeHistory(transaction))
    return Object.freeze({ active: true, changed: JSON.stringify(before) !== JSON.stringify(this.#editor.state.doc.toJSON()) })
  }

  applyCodeBlock(language: string, code: string): VisualCommandResult {
    this.#assertAlive()
    const before = this.#editor.state.doc.toJSON()
    const selection = this.#editor.state.selection
    const selected = selectedCodeBlockAt(selection)
    const nodeType = this.#editor.schema.nodes['codeBlock']
    if (nodeType === undefined) return Object.freeze({ active: false, changed: false })
    const normalizedLanguage = language.trim()

    if (selected !== null) {
      if (selected.node.textContent === code && String(selected.node.attrs['language'] ?? '') === normalizedLanguage) {
        return Object.freeze({ active: true, changed: false })
      }
      const replacement = nodeType.create(
        { ...selected.node.attrs, language: normalizedLanguage, localError: null },
        code.length === 0 ? undefined : this.#editor.schema.text(code),
      )
      const currentOffset = selection.head - selected.position - 1
      const transaction = this.#editor.state.tr.replaceWith(
        selected.position,
        selected.position + selected.node.nodeSize,
        replacement,
      )
      transaction.setSelection(TextSelection.create(
        transaction.doc,
        selected.position + 1 + Math.max(0, Math.min(code.length, currentOffset)),
      ))
      this.#editor.view.dispatch(transaction)
    } else {
      const replacesEmptyTextBlock = selection instanceof TextSelection
        && selection.empty
        && selection.$head.depth > 0
        && selection.$head.parent.isTextblock
        && selection.$head.parent.content.size === 0
      const insertPosition = replacesEmptyTextBlock
        ? selection.$head.before(1)
        : selection.$head.depth > 0
        ? selection.$head.before(1) + selection.$head.node(1).nodeSize
        : this.#editor.state.doc.content.size
      const node = nodeType.create(
        { language: normalizedLanguage, localError: null },
        code.length === 0 ? undefined : this.#editor.schema.text(code),
      )
      const transaction = replacesEmptyTextBlock
        ? this.#editor.state.tr.replaceWith(insertPosition, selection.$head.after(1), node)
        : this.#editor.state.tr.insert(insertPosition, node)
      transaction.setSelection(TextSelection.create(transaction.doc, insertPosition + 1))
      this.#editor.view.dispatch(transaction)
    }
    return Object.freeze({
      active: this.selectedCodeBlock() !== null,
      changed: JSON.stringify(before) !== JSON.stringify(this.#editor.state.doc.toJSON()),
    })
  }

  focus(): void {
    this.#assertAlive()
    if (this.#editor.isEditable) this.#editor.view.focus()
    else this.#editor.view.dom.focus({ preventScroll: true })
  }

  setPresentationMode(enabled: boolean, profile: 'author-preview' | 'reader' = 'author-preview'): void {
    this.#assertAlive()
    if (this.#editor.isEditable === !enabled) return
    this.#editor.setEditable(!enabled, false)
    this.#editor.view.dom.classList.toggle('preview-rendered-content', enabled)
    this.#editor.view.dom.dataset['presentationMode'] = enabled ? 'readonly' : 'editable'
    if (enabled) {
      this.#editor.view.dom.dataset['presentationEngine'] = 'tiptap'
      this.#editor.view.dom.dataset['rendererProfile'] = profile
    } else {
      delete this.#editor.view.dom.dataset['presentationEngine']
      delete this.#editor.view.dom.dataset['rendererProfile']
    }
    this.#editor.view.dom.setAttribute('aria-readonly', String(enabled))
    this.#editor.view.dom.querySelectorAll<HTMLElement>([
      '[data-semantic-edit]',
      '[data-raw-edit]',
      '.visual-code-block__language',
      '.table-node-view__handle',
      '.table-node-view__menu',
      '.table-cell-selection-overlay',
    ].join(', ')).forEach((control) => { control.hidden = enabled })
    if (enabled) this.#editor.view.dom.setAttribute('tabindex', '0')
    else this.#editor.view.dom.removeAttribute('tabindex')
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#unsubscribe()
    this.#editor.view.dom.removeEventListener('compositionstart', this.#handleCompositionStart)
    this.#editor.view.dom.removeEventListener('compositionend', this.#handleCompositionEnd)
    this.#editor.view.dom.removeEventListener('keydown', this.#handleKeydown)
    this.#editor.destroy()
  }

  readonly #handleCompositionStart = (): void => {
    if (this.#composing) return
    this.#composing = true
    this.#onCompositionStart?.()
  }

  readonly #handleCompositionEnd = (): void => {
    if (!this.#composing) return
    this.#composing = false
    this.#onCompositionEnd?.()
  }

  readonly #handleKeydown = (event: KeyboardEvent): void => {
    if (!this.#editor.isEditable) return
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Backspace' && event.key !== 'Delete') return
    const handled = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
      ? this.#moveHorizontal(event.key)
      : this.#joinOrSelect(event.key)
    if (!handled) return
    event.preventDefault()
  }

  #joinOrSelect(key: 'Backspace' | 'Delete'): boolean {
    const selection = this.#editor.state.selection
    this.#closeHistoryForAlignmentBoundaryEdit(selection)
    if (selection.empty && selection instanceof TextSelection) {
      if (key === 'Backspace' && this.#joinListItemBackward(selection)) return true
      const backward = key === 'Backspace'
      if (this.#selectAdjacentProtected(backward ? -1 : 1)) return true
      const atBoundary = backward
        ? selection.$head.parentOffset === 0
        : selection.$head.parentOffset === selection.$head.parent.content.size
      if (atBoundary) {
        const topLevel = Array.from({ length: this.#editor.state.doc.childCount }, (_, index) => ({
          index,
          node: this.#editor.state.doc.child(index),
          position: index === 0
            ? 0
            : Array.from({ length: index }, (__, precedingIndex) => this.#editor.state.doc.child(precedingIndex).nodeSize)
                .reduce((total, size) => total + size, 0),
        }))
        const currentIndex = topLevel.findIndex(({ node }) => node === selection.$head.parent)
        const beforeEntry = topLevel[currentIndex - 1]
        const currentEntry = topLevel[currentIndex]
        const afterEntry = topLevel[currentIndex + 1]
        const before = backward ? beforeEntry?.node ?? null : currentEntry?.node ?? null
        const after = backward ? currentEntry?.node ?? null : afterEntry?.node ?? null
        const boundary = backward
          ? currentEntry?.position ?? selection.from
          : (currentEntry?.position ?? selection.from) + (currentEntry?.node.nodeSize ?? 0)
        const adjacent = backward ? before : after
        if (adjacent !== null && (adjacent.isAtom || adjacent.type.spec.isolating === true)) {
          if (!NodeSelection.isSelectable(adjacent)) return false
          const position = backward ? boundary - adjacent.nodeSize : boundary
          this.#editor.view.dispatch(this.#editor.state.tr.setSelection(NodeSelection.create(this.#editor.state.doc, position)))
          return true
        }
        if (before?.isTextblock === true && after?.isTextblock === true) {
          const from = boundary - before.nodeSize
          const merged = before.type.create(before.attrs, before.content.append(after.content), before.marks)
          const transaction = this.#editor.state.tr.replaceWith(from, boundary + after.nodeSize, merged)
          const caret = from + 1 + before.content.size
          transaction.setSelection(TextSelection.create(transaction.doc, caret))
          this.#editor.view.dispatch(transaction)
          return true
        }
      }
    }
    const command = key === 'Backspace' ? joinBackward : joinForward
    if (command(this.#editor.state, this.#editor.view.dispatch, this.#editor.view)) return true
    const select = key === 'Backspace' ? selectNodeBackward : selectNodeForward
    return select(this.#editor.state, this.#editor.view.dispatch, this.#editor.view)
  }

  #alignmentAncestorDepth(position: { readonly depth: number; readonly node: (depth: number) => ProseMirrorNode }): number | null {
    for (let depth = position.depth; depth > 0; depth -= 1) {
      if (position.node(depth).type.name === 'alignmentBlock') return depth
    }
    return null
  }

  #closeHistoryForAlignmentBoundaryEdit(selection: Selection): void {
    if (!(selection instanceof TextSelection)
      || !selection.empty
      || selection.$head.depth !== 1
      || !selection.$head.parent.isTextblock
      || selection.$head.parent.content.size !== 0) return
    const current = selection.$head.node(1)
    const document = this.#editor.state.doc
    let currentIndex = -1
    for (let index = 0; index < document.childCount; index += 1) {
      if (document.child(index) === current) {
        currentIndex = index
        break
      }
    }
    if (currentIndex < 0) return
    const previous = currentIndex > 0 ? document.child(currentIndex - 1) : null
    const next = currentIndex + 1 < document.childCount ? document.child(currentIndex + 1) : null
    if (previous?.type.name !== 'alignmentBlock' && next?.type.name !== 'alignmentBlock') return
    this.#editor.view.dispatch(closeHistory(this.#editor.state.tr).setMeta('addToHistory', false))
  }

  #joinListItemBackward(selection: TextSelection): boolean {
    if (selection.$head.parentOffset !== 0 || selection.$head.depth < 3) return false
    const itemDepth = selection.$head.depth - 1
    const listDepth = itemDepth - 1
    const currentItem = selection.$head.node(itemDepth)
    const list = selection.$head.node(listDepth)
    if ((currentItem.type.name !== 'listItem' && currentItem.type.name !== 'taskItem')
      || (list.type.name !== 'bulletList' && list.type.name !== 'orderedList' && list.type.name !== 'taskList')) return false
    const currentIndex = selection.$head.index(listDepth)
    if (currentIndex <= 0 || currentItem.childCount !== 1) return false
    const previousItem = list.child(currentIndex - 1)
    const previousParagraph = previousItem.firstChild
    const currentParagraph = currentItem.firstChild
    if (previousItem.type !== currentItem.type
      || previousItem.childCount !== 1
      || previousParagraph?.isTextblock !== true
      || currentParagraph?.isTextblock !== true) return false
    let from = selection.$head.start(listDepth)
    for (let index = 0; index < currentIndex - 1; index += 1) from += list.child(index).nodeSize
    const mergedParagraph = previousParagraph.type.create(
      previousParagraph.attrs,
      previousParagraph.content.append(currentParagraph.content),
      previousParagraph.marks,
    )
    const mergedItem = previousItem.type.create(previousItem.attrs, mergedParagraph, previousItem.marks)
    const transaction = this.#editor.state.tr.replaceWith(
      from,
      from + previousItem.nodeSize + currentItem.nodeSize,
      mergedItem,
    )
    transaction.setSelection(TextSelection.create(transaction.doc, from + 2 + previousParagraph.content.size))
    this.#editor.view.dispatch(transaction)
    return true
  }

  #splitActiveListItem(): boolean {
    if (this.#editor.isActive('taskItem')) return this.#editor.commands.splitListItem('taskItem')
    if (this.#editor.isActive('listItem')) return this.#editor.commands.splitListItem('listItem')
    return false
  }

  #promoteNestedProjectionIds(): boolean {
    const transaction = this.#editor.state.tr
    let topPosition = 0
    let changed = false
    for (let index = 0; index < this.#editor.state.doc.childCount; index += 1) {
      const top = this.#editor.state.doc.child(index)
      if (projectionId(top) === null && (top.type.name === 'bulletList' || top.type.name === 'orderedList' || top.type.name === 'taskList')) {
        const nested: Array<{ node: ProseMirrorNode; position: number }> = []
        top.descendants((node, position) => {
          if (projectionId(node) !== null) nested.push({ node, position: topPosition + 1 + position })
          return true
        })
        const owner = nested[0]
        if (owner !== undefined) {
          transaction.setNodeMarkup(topPosition, undefined, {
            ...top.attrs,
            codecId: owner.node.attrs['codecId'],
            ordinaryClass: owner.node.attrs['ordinaryClass'],
            originalSource: owner.node.attrs['originalSource'],
            projectionId: owner.node.attrs['projectionId'],
            revision: owner.node.attrs['revision'],
            sourceFrom: owner.node.attrs['sourceFrom'],
            sourceTo: owner.node.attrs['sourceTo'],
          })
          for (const entry of nested) {
            transaction.setNodeMarkup(entry.position, undefined, {
              ...entry.node.attrs,
              codecId: null,
              ordinaryClass: null,
              originalSource: null,
              projectionId: null,
              revision: null,
              sourceFrom: null,
              sourceTo: null,
            })
          }
          changed = true
        }
      }
      topPosition += top.nodeSize
    }
    if (!changed) return false
    transaction
      .setMeta('addToHistory', false)
      .setMeta(TIPTAP_EXTERNAL_HYDRATION_META, Object.freeze({ addToHistory: false, reason: 'promote-list-projection' }))
    this.#editor.view.dispatch(transaction)
    return true
  }

  #reconcileMissingProjectionIds(snapshot: DocumentSnapshot, map: ProjectionMap): boolean {
    const projected = this.#project(snapshot)
    assertProjection(snapshot, projected)
    const projectedDocument = this.#editor.schema.nodeFromJSON(projected.content)
    const currentDocument = this.#editor.state.doc
    if (projectedDocument.childCount !== currentDocument.childCount) return false

    const transaction = this.#editor.state.tr
    const reservedIds = new Set<string>()
    currentDocument.descendants((node) => {
      const id = projectionId(node)
      if (id !== null) reservedIds.add(id)
      return true
    })
    const ids = new Set<string>()
    let generatedSequence = 0
    let position = 0
    let changed = false
    for (let index = 0; index < currentDocument.childCount; index += 1) {
      const current = currentDocument.child(index)
      const expected = projectedDocument.child(index)
      if (current.type !== expected.type || current.textContent !== expected.textContent) return false
      const currentId = projectionId(current)
      const expectedId = projectionId(expected)
      let assignedId = currentId
      if (assignedId === null || ids.has(assignedId)) {
        if (expectedId === null) return false
        assignedId = expectedId
        if (reservedIds.has(assignedId) || ids.has(assignedId)) {
          do {
            assignedId = `${expectedId}:visual:${snapshot.revision}:${position}:${generatedSequence++}`
          } while (reservedIds.has(assignedId) || ids.has(assignedId))
        }
        reservedIds.add(assignedId)
        transaction.setNodeMarkup(position, undefined, {
          ...current.attrs,
          codecId: expected.attrs['codecId'],
          ordinaryClass: expected.attrs['ordinaryClass'],
          originalSource: expected.attrs['originalSource'],
          projectionId: assignedId,
          revision: expected.attrs['revision'],
          sourceFrom: expected.attrs['sourceFrom'],
          sourceTo: expected.attrs['sourceTo'],
        })
        changed = true
      }
      ids.add(assignedId)
      current.descendants((descendant, relativePosition) => {
        if (projectionId(descendant) === null) return true
        transaction.setNodeMarkup(position + 1 + relativePosition, undefined, {
          ...descendant.attrs,
          codecId: null,
          ordinaryClass: null,
          originalSource: null,
          projectionId: null,
          revision: null,
          sourceFrom: null,
          sourceTo: null,
        })
        changed = true
        return true
      })
      position += current.nodeSize
    }
    if (!changed || ids.size !== map.entries.length) return false
    transaction
      .setMeta('addToHistory', false)
      .setMeta(TIPTAP_EXTERNAL_HYDRATION_META, Object.freeze({
        addToHistory: false,
        reason: 'reconcile-projection-identities',
        revision: snapshot.revision,
      }))
    this.#editor.view.dispatch(transaction)
    return true
  }

  #nextRuntimeProjectionId(used: ReadonlySet<string>): string {
    let candidate = `visual-runtime:${this.#session.snapshot().documentId}:${this.#projectionIdentitySequence++}`
    while (used.has(candidate)) {
      candidate = `visual-runtime:${this.#session.snapshot().documentId}:${this.#projectionIdentitySequence++}`
    }
    return candidate
  }

  #normalizeProjectionIdentities(): void {
    const document = this.#editor.state.doc
    const transaction = this.#editor.state.tr
    const used = new Set<string>()
    let position = 0
    let changed = false
    for (let index = 0; index < document.childCount; index += 1) {
      const top = document.child(index)
      const existingId = projectionId(top)
      const topId = existingId === null || used.has(existingId)
        ? this.#nextRuntimeProjectionId(used)
        : existingId
      used.add(topId)
      if (topId !== existingId) {
        transaction.setNodeMarkup(position, undefined, clearProjectionMetadata(top, topId))
        changed = true
      }
      top.descendants((node, relativePosition) => {
        if (projectionId(node) === null) return true
        transaction.setNodeMarkup(position + 1 + relativePosition, undefined, clearProjectionMetadata(node, null))
        changed = true
        return true
      })
      position += top.nodeSize
    }
    if (!changed) return
    transaction
      .setMeta('addToHistory', false)
      .setMeta(TIPTAP_EXTERNAL_HYDRATION_META, Object.freeze({
        addToHistory: false,
        reason: 'normalize-runtime-projection-identities',
      }))
    this.#editor.view.dispatch(transaction)
  }

  #applyOptimisticProjection(plan: ReturnType<TiptapTransactionPatchPlanner['plan']>): ReturnType<TiptapTransactionPatchPlanner['plan']> {
    if (plan === null || this.#projection.source === undefined) return plan
    let markdown = this.#projection.source
    for (const patch of [...plan.patches].sort((left, right) => right.from - left.from || right.to - left.to)) {
      if (markdown.slice(patch.from, patch.to) !== patch.expected) {
        return this.#recoverOptimisticProjection(plan)
      }
      markdown = `${markdown.slice(0, patch.from)}${patch.replacement}${markdown.slice(patch.to)}`
    }
    const current = this.#session.snapshot()
    const optimisticSnapshot = Object.freeze({
      documentId: current.documentId,
      markdown,
      revision: this.#projection.revision,
    })
    const projected = this.#project(optimisticSnapshot)
    assertProjection(optimisticSnapshot, projected)
    const ids = topLevelProjectionIds(this.#editor.state.doc)
    if (ids.length === projected.map.entries.length && this.#adoptOptimisticProjection(markdown, projected)) return plan
    const preserveCheckedPatch = (() => {
      try {
        const projectedDocument = this.#editor.schema.nodeFromJSON(projected.content)
        return serializeOrdinaryTiptapDocument(projectedDocument)
          === serializeOrdinaryTiptapDocument(this.#editor.state.doc)
      } catch {
        return false
      }
    })()
    return this.#recoverOptimisticProjection(plan, preserveCheckedPatch)
  }

  #adoptOptimisticProjection(markdown: string, projected: TiptapVisualProjection, verifyVisualShape = false): boolean {
    const currentDocument = this.#editor.state.doc
    if (verifyVisualShape) {
      const projectedDocument = this.#editor.schema.nodeFromJSON(projected.content)
      if (!equivalentVisualNodes(currentDocument, projectedDocument)) return false
    }
    const ids = topLevelProjectionIds(currentDocument)
    if (ids.length !== projected.map.entries.length) return false
    const optimisticEntries = widenOptimisticTrailingParagraph(markdown, projected.map.entries)
    const entries = optimisticEntries.map((entry, index) => {
      const id = ids[index]
      if (id === undefined) return null
      return Object.freeze({
        ...entry,
        projectionId: id,
        safePatchUnit: Object.freeze({ ...entry.safePatchUnit, unitId: id }),
      })
    })
    if (entries.some((entry) => entry === null)) return false
    this.#projection = Object.freeze({
      content: currentDocument.toJSON(),
      map: Object.freeze({ ...projected.map, entries: Object.freeze(entries.filter((entry) => entry !== null)) }),
      revision: this.#projection.revision,
      source: markdown,
    })
    return true
  }

  #recoverOptimisticProjection(
    plan: ReturnType<TiptapTransactionPatchPlanner['plan']>,
    preserveCheckedPatch = false,
  ): ReturnType<TiptapTransactionPatchPlanner['plan']> {
    if (plan === null || this.#projection.source === undefined) {
      throw new InvalidTiptapVisualProjectionError('An optimistic Tiptap projection cannot be recovered without a source baseline.')
    }
    const baseRevision = this.#projection.revision
    const baseSource = this.#projection.source
    const localMarkdown = serializeOrdinaryTiptapDocument(this.#editor.state.doc)
    const localSnapshot = Object.freeze({
      documentId: this.#session.snapshot().documentId,
      markdown: localMarkdown,
      revision: baseRevision,
    })
    const localProjection = this.#project(localSnapshot)
    assertProjection(localSnapshot, localProjection)
    if (!this.#adoptOptimisticProjection(localMarkdown, localProjection, true)) {
      throw new InvalidTiptapVisualProjectionError('The current Tiptap document cannot be safely reprojected from its local Markdown.')
    }
    if (preserveCheckedPatch) return plan
    return Object.freeze({
      baseRevision,
      patches: Object.freeze([Object.freeze({
        codecId: 'tiptap-visual-recovery',
        expected: baseSource,
        from: 0,
        replacement: localMarkdown,
        to: baseSource.length,
      })]),
      transactionId: plan.transactionId,
    })
  }

  #domBlock(block: HTMLElement): VisualDomBlock | null {
    const editorDom = this.#editor.view.dom
    let candidate: HTMLElement | null = block
    while (candidate !== null && candidate.parentElement !== editorDom) candidate = candidate.parentElement
    if (candidate?.parentElement !== editorDom) return null
    let position = 0
    for (let index = 0; index < this.#editor.state.doc.childCount; index += 1) {
      const node = this.#editor.state.doc.child(index)
      const rendered = this.#editor.view.nodeDOM(position)
      if (
        rendered === candidate
        || (rendered instanceof Element && rendered.contains(candidate))
        || (rendered instanceof Element && candidate.contains(rendered))
      ) {
        return Object.freeze({ node, position })
      }
      position += node.nodeSize
    }
    return null
  }

  #moveHorizontal(key: 'ArrowLeft' | 'ArrowRight'): boolean {
    const selection = this.#editor.state.selection
    const direction = key === 'ArrowLeft' ? -1 : 1
    if (selection instanceof NodeSelection) {
      const position = direction < 0 ? selection.from : selection.to
      this.#editor.view.dispatch(this.#editor.state.tr.setSelection(
        TextSelection.near(this.#editor.state.doc.resolve(position), direction),
      ).scrollIntoView())
      return true
    }
    if (!selection.empty) {
      const position = key === 'ArrowLeft' ? selection.from : selection.to
      this.#editor.view.dispatch(this.#editor.state.tr
        .setSelection(TextSelection.near(this.#editor.state.doc.resolve(position)))
        .scrollIntoView())
      return true
    }
    if (selection instanceof TextSelection && this.#selectAdjacentProtected(direction)) return true
    const atBoundary = direction < 0
      ? selection.$head.parentOffset === 0
      : selection.$head.parentOffset === selection.$head.parent.content.size
    if (!atBoundary || selection.$head.depth === 0) return false
    const boundary = direction < 0 ? selection.$head.before() : selection.$head.after()
    const adjacent = Selection.findFrom(this.#editor.state.doc.resolve(boundary), direction, true)
    if (adjacent === null || adjacent.from === selection.from) return false
    this.#editor.view.dispatch(this.#editor.state.tr.setSelection(adjacent).scrollIntoView())
    return true
  }

  #selectAdjacentProtected(direction: -1 | 1): boolean {
    const selection = this.#editor.state.selection
    if (!(selection instanceof TextSelection) || !selection.empty) return false
    const inlineAdjacent = direction < 0 ? selection.$head.nodeBefore : selection.$head.nodeAfter
    if (
      inlineAdjacent !== null
      && (inlineAdjacent.isAtom || inlineAdjacent.type.spec.isolating === true)
      && NodeSelection.isSelectable(inlineAdjacent)
    ) {
      const position = direction < 0 ? selection.from - inlineAdjacent.nodeSize : selection.from
      this.#editor.view.dispatch(this.#editor.state.tr.setSelection(NodeSelection.create(this.#editor.state.doc, position)))
      return true
    }

    const atBlockBoundary = direction < 0
      ? selection.$head.parentOffset === 0
      : selection.$head.parentOffset === selection.$head.parent.content.size
    if (!atBlockBoundary || selection.$head.depth === 0) return false
    let currentPosition = 0
    for (let index = 0; index < this.#editor.state.doc.childCount; index += 1) {
      const current = this.#editor.state.doc.child(index)
      if (current === selection.$head.parent) {
        const adjacentIndex = index + direction
        if (adjacentIndex < 0 || adjacentIndex >= this.#editor.state.doc.childCount) return false
        const adjacent = this.#editor.state.doc.child(adjacentIndex)
        if (
          !(adjacent.isAtom || adjacent.type.spec.isolating === true)
          || !NodeSelection.isSelectable(adjacent)
        ) return false
        const position = direction < 0 ? currentPosition - adjacent.nodeSize : currentPosition + current.nodeSize
        this.#editor.view.dispatch(this.#editor.state.tr.setSelection(NodeSelection.create(this.#editor.state.doc, position)))
        return true
      }
      currentPosition += current.nodeSize
    }
    return false
  }

  #hydrate(snapshot: DocumentSnapshot, addToHistory: false): void {
    const projection = this.#project(snapshot)
    assertProjection(snapshot, projection)
    const projectedDocument = this.#editor.schema.nodeFromJSON(projection.content)
    const bookmark = captureSelection(this.#editor.state.doc, this.#editor.state.selection)
    const transaction = this.#editor.state.tr
      .replaceWith(0, this.#editor.state.doc.content.size, projectedDocument.content)
      .setMeta('addToHistory', addToHistory)
      .setMeta(TIPTAP_EXTERNAL_HYDRATION_META, Object.freeze({
        addToHistory,
        revision: snapshot.revision,
      }))
    transaction.setSelection(restoreSelection(transaction.doc, bookmark))
    this.#projection = projection
    this.#editor.view.dispatch(transaction)
  }

  #synchronizeBrowserSelection(): void {
    const view = this.#editor.view
    const browserSelection = view.dom.ownerDocument.getSelection()
    if (browserSelection === null) return
    const { anchorNode, focusNode } = browserSelection
    if (anchorNode === null
      || focusNode === null
      || !view.dom.contains(anchorNode)
      || !view.dom.contains(focusNode)) return
    try {
      const doc = this.#editor.state.doc
      const anchor = clampPosition(doc, view.posAtDOM(anchorNode, browserSelection.anchorOffset))
      const head = clampPosition(doc, view.posAtDOM(focusNode, browserSelection.focusOffset))
      const resolvedAnchor = doc.resolve(anchor)
      const resolvedHead = doc.resolve(head)
      if (!resolvedAnchor.parent.isTextblock || !resolvedHead.parent.isTextblock) return
      const selection = TextSelection.between(resolvedAnchor, resolvedHead)
      if (selection.eq(this.#editor.state.selection)) return
      this.#editor.view.dispatch(this.#editor.state.tr
        .setSelection(selection)
        .setMeta('addToHistory', false))
    } catch {
      // A selection outside a mappable content DOM is not an active editor text selection.
    }
  }

  #observeTransaction(transaction: Transaction): void {
    const external = transaction.getMeta(TIPTAP_EXTERNAL_HYDRATION_META) !== undefined
    try {
      const checkpointHistoryAcknowledgement = external ? null : this.#commitCheckpointHistoryTransition(transaction)
      if (!external && this.#historyDirection === null && transaction.docChanged) {
        this.#checkpointRestoreHistory = this.#checkpointRestoreHistory.filter((entry) => entry.applied)
      }
      let patchPlan = external || checkpointHistoryAcknowledgement !== null
        ? null
        : this.#patchPlanner?.plan(transaction, this.#projection) ?? null
      if (!external && transaction.docChanged) {
        this.#normalizeProjectionIdentities()
        patchPlan = this.#applyOptimisticProjection(patchPlan)
      }
      if (this.#historyDirection === null
        && transaction.docChanged
        && transaction.getMeta('addToHistory') !== false) {
        const depth = undoDepth(this.#editor.state)
        if (depth > 0) {
          this.#historySelections.length = depth
          this.#historySelections[depth - 1] = captureSelection(
            this.#editor.state.doc,
            this.#editor.state.selection,
          )
        }
      }
      this.#onTransaction?.(Object.freeze({
        external,
        patchPlan,
        projection: this.#projection,
        transaction,
      }))
    } catch (failure) {
      if (external || this.#onTransactionFailure === undefined) throw failure
      if (transaction.docChanged) this.#normalizeProjectionIdentities()
      this.#onTransactionFailure(Object.freeze({
        failure,
        projection: this.#projection,
        transaction,
      }))
    }
  }

  #commitCheckpointHistoryTransition(transaction: Transaction): CommitAcknowledgement | null {
    const direction = this.#historyDirection
    if (direction === null || !transaction.docChanged) return null
    const current = this.#session.snapshot()
    let match: CheckpointRestoreHistoryEntry | undefined
    for (let index = this.#checkpointRestoreHistory.length - 1; index >= 0; index -= 1) {
      const entry = this.#checkpointRestoreHistory[index]
      if (entry === undefined) continue
      const matchesUndo = direction === 'undo'
        && entry.applied
        && current.markdown === entry.restoredMarkdown
        && transaction.doc.eq(entry.beforeDocument)
      const matchesRedo = direction === 'redo'
        && !entry.applied
        && current.markdown === entry.beforeMarkdown
        && transaction.doc.eq(entry.restoredDocument)
      if (matchesUndo || matchesRedo) {
        match = entry
        break
      }
    }
    if (match === undefined) return null
    const replacement = direction === 'undo' ? match.beforeMarkdown : match.restoredMarkdown
    const acknowledgement = this.#session.commitPatchPlan({
      baseRevision: current.revision,
      patches: Object.freeze([Object.freeze({
        codecId: 'checkpoint-restore-history',
        expected: current.markdown,
        from: 0,
        replacement,
        to: current.markdown.length,
      })]),
      transactionId: `checkpoint-restore-${direction}:${createRandomId()}`,
    })
    match.applied = direction === 'redo'
    const snapshot = this.#session.snapshot()
    const projection = this.#project(snapshot)
    this.acknowledgeSynchronization({ map: projection.map, snapshot })
    this.#onCheckpointHistoryCommit?.(acknowledgement)
    return acknowledgement
  }

  #runHistoryCommand(direction: 'redo' | 'undo'): boolean {
    const depth = undoDepth(this.#editor.state)
    this.#historyDirection = direction
    try {
      const changed = direction === 'undo' ? this.#editor.commands.undo() : this.#editor.commands.redo()
      const bookmark = direction === 'redo' ? this.#historySelections[depth] : undefined
      if (changed && bookmark !== undefined) {
        const selection = restoreSelection(this.#editor.state.doc, bookmark)
        if (!selection.eq(this.#editor.state.selection)) {
          this.#editor.view.dispatch(this.#editor.state.tr
            .setSelection(selection)
            .setMeta('addToHistory', false)
            .scrollIntoView())
        }
      }
      return changed
    } finally {
      this.#historyDirection = null
    }
  }

  #assertAlive(): void {
    if (this.#destroyed) throw new Error('TiptapVisualAdapter has been destroyed.')
  }
}
