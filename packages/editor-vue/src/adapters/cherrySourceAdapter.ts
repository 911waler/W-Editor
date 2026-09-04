import Cherry from 'cherry-markdown/dist/cherry-markdown.esm.js'
import type { TransactionSpec } from '@codemirror/state'
import * as echarts from 'echarts'
import mermaid from 'mermaid'

import {
  type CommitAcknowledgement,
  type DocumentSession,
  type DocumentSnapshot,
  type PatchPlan,
  ProjectionRevisionGate,
} from '@w-editor/editor-core'
import type { AppearanceTheme } from '../services/appearanceTheme'
import { createRandomId } from '../services/randomId'
import { revealSearchCoordinates } from './searchViewport'
import { W_EDITOR_CHERRY_ENGINE_OPTIONS } from './wEditorCherrySyntax'

const sourceHistoryShortcutEvents = new WeakSet<Event>()

export function isCherrySourceHistoryShortcutEvent(event: Event): boolean {
  return sourceHistoryShortcutEvents.has(event)
}

export function dispatchCherrySourceHistoryShortcut(
  editorView: ReturnType<Cherry['getCodeMirror']>,
  direction: 'redo' | 'undo',
): boolean {
  const before = editorView.state.doc.toString()
  editorView.focus()
  const apple = /Mac|iPhone|iPad/u.test(navigator.platform)
  const linux = /Linux/u.test(navigator.platform)
  const redoWithShiftZ = direction === 'redo' && (apple || linux)
  const key = direction === 'undo' || redoWithShiftZ ? 'z' : 'y'
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    code: key === 'z' ? 'KeyZ' : 'KeyY',
    ctrlKey: !apple,
    key,
    metaKey: apple,
    shiftKey: redoWithShiftZ,
  })
  sourceHistoryShortcutEvents.add(event)
  editorView.contentDOM.dispatchEvent(event)
  return editorView.state.doc.toString() !== before
}

export interface SourceSelection {
  readonly anchor: number
  readonly head: number
}

export interface SourceSelectionCoordinates {
  readonly bottom: number
  readonly left: number
  readonly right: number
  readonly top: number
}

export interface CheckedSourceRangeCommand {
  readonly baseRevision: number
  readonly codecId: string
  readonly expected: string
  readonly from: number
  readonly replacement: string
  readonly to: number
  readonly transactionId: string
}

export interface CherrySourceAdapterOptions {
  readonly host: HTMLElement
  readonly onAcknowledgement?: (acknowledgement: CommitAcknowledgement) => void
  readonly onCompositionChange?: (composing: boolean) => void
  readonly session: DocumentSession
  readonly theme?: AppearanceTheme
}

export interface SourceSearchMatch {
  readonly from: number
  readonly to: number
}

function normalizeForCherry(markdown: string): string {
  return markdown.replace(/\r\n?/g, '\n')
}

function viewOffsetToSourceOffset(source: string, target: number): number {
  let sourceOffset = 0
  let viewOffset = 0
  while (sourceOffset < source.length && viewOffset < target) {
    if (source[sourceOffset] === '\r' && source[sourceOffset + 1] === '\n') {
      sourceOffset += 2
    } else {
      sourceOffset += 1
    }
    viewOffset += 1
  }
  return sourceOffset
}

function sourceOffsetToViewOffset(source: string, target: number): number {
  let sourceOffset = 0
  let viewOffset = 0
  while (sourceOffset < target && sourceOffset < source.length) {
    if (source[sourceOffset] === '\r' && source[sourceOffset + 1] === '\n') {
      sourceOffset += 2
    } else {
      sourceOffset += 1
    }
    viewOffset += 1
  }
  return viewOffset
}

function preserveAuthorityLineEndings(authority: string, nextView: string): string {
  const previousView = normalizeForCherry(authority)
  if (previousView === nextView) return authority

  let prefix = 0
  while (prefix < previousView.length && prefix < nextView.length && previousView[prefix] === nextView[prefix]) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < previousView.length - prefix
    && suffix < nextView.length - prefix
    && previousView[previousView.length - suffix - 1] === nextView[nextView.length - suffix - 1]
  ) {
    suffix += 1
  }
  if (prefix === 0 && suffix === 1) return nextView
  const sourceFrom = viewOffsetToSourceOffset(authority, prefix)
  const sourceTo = viewOffsetToSourceOffset(authority, previousView.length - suffix)
  return `${authority.slice(0, sourceFrom)}${nextView.slice(prefix, nextView.length - suffix)}${authority.slice(sourceTo)}`
}

function runtimeTransactionAnnotation(
  view: ReturnType<Cherry['getCodeMirror']>,
  kind: 'addToHistory' | 'userEvent',
  value: boolean | string,
): NonNullable<TransactionSpec['annotations']> {
  const runtime = view.state.update({}).constructor as unknown as {
    readonly addToHistory: { readonly of: (annotation: boolean) => unknown }
    readonly userEvent: { readonly of: (annotation: string) => unknown }
  }
  return (kind === 'addToHistory'
    ? runtime.addToHistory.of(value as boolean)
    : runtime.userEvent.of(value as string)) as NonNullable<TransactionSpec['annotations']>
}

export interface ReplaceSourceSelectionCommand {
  readonly codecId: string
  readonly replacement: string
  readonly selectReplacement?: boolean
  readonly transactionId: string
}

export class CherrySourceAdapter {
  readonly #cherry: Cherry
  readonly #compositionEnd: () => void
  readonly #compositionStart: () => void
  readonly #onAcknowledgement: ((acknowledgement: CommitAcknowledgement) => void) | undefined
  readonly #onCompositionChange: ((composing: boolean) => void) | undefined
  readonly #session: DocumentSession
  readonly #unsubscribe: () => void
  #composing = false
  #destroyed = false
  #ignoredLocalChanges = 0
  #searchCaseSensitive = false
  #activeSearchMarker: { clear: () => void } | null = null
  #searchQuery = ''
  readonly #pendingReflections = new Map<string, number>()

  constructor(options: CherrySourceAdapterOptions) {
    this.#session = options.session
    this.#onAcknowledgement = options.onAcknowledgement
    this.#onCompositionChange = options.onCompositionChange
    const initial = options.session.snapshot()
    this.#cherry = new Cherry({
      el: options.host,
      engine: W_EDITOR_CHERRY_ENGINE_OPTIONS,
      nameSpace: 'w-editor-source',
      value: initial.markdown,
      externals: { echarts, mermaid },
      editor: { defaultModel: 'editOnly' },
      callback: {
        afterChange: (text) => this.#acceptCherryChange(text),
      },
      toolbars: {
        toolbar: false,
        toolbarRight: false,
        bubble: false,
        float: false,
        sidebar: false,
      },
    })
    this.setTheme(options.theme ?? 'default')
    const toolbar = options.host.querySelector<HTMLElement>('.cherry-toolbar')
    if (toolbar !== null) {
      toolbar.hidden = true
      toolbar.setAttribute('aria-hidden', 'true')
    }
    const gate = new ProjectionRevisionGate('cherry-source', ({ snapshot }) => this.#hydrate(snapshot))
    this.#unsubscribe = options.session.subscribe((change) => {
      gate.receive(change)
    })
    this.#compositionStart = () => {
      if (this.#composing) return
      this.#composing = true
      this.#onCompositionChange?.(true)
    }
    this.#compositionEnd = () => {
      if (!this.#composing) return
      this.#composing = false
      this.flush()
      this.#onCompositionChange?.(false)
    }
    const content = this.#view().contentDOM
    content.addEventListener('compositionstart', this.#compositionStart)
    content.addEventListener('compositionend', this.#compositionEnd)
  }

  value(): string {
    return preserveAuthorityLineEndings(this.#session.snapshot().markdown, this.#rawValue())
  }

  setTheme(theme: AppearanceTheme): void {
    const themable = this.#cherry as unknown as { setTheme: (nextTheme: string) => void }
    themable.setTheme(theme)
  }

  selection(): SourceSelection {
    const selection = this.#view().state.selection.main
    const source = this.#session.snapshot().markdown
    return Object.freeze({
      anchor: viewOffsetToSourceOffset(source, selection.anchor),
      head: viewOffsetToSourceOffset(source, selection.head),
    })
  }

  selectionCoordinates(): SourceSelectionCoordinates | null {
    const view = this.#view()
    const selection = view.state.selection.main
    if (selection.empty) return null
    const start = view.coordsAtPos(selection.from)
    const end = view.coordsAtPos(selection.to)
    if (start === null || end === null) return null
    return Object.freeze({
      bottom: Math.max(start.bottom, end.bottom),
      left: Math.min(start.left, end.left),
      right: Math.max(start.right, end.right),
      top: Math.min(start.top, end.top),
    })
  }

  setSelection(selection: SourceSelection): void {
    const source = this.#session.snapshot().markdown
    this.#view().dispatch({
      selection: {
        anchor: sourceOffsetToViewOffset(source, selection.anchor),
        head: sourceOffsetToViewOffset(source, selection.head),
      },
      scrollIntoView: true,
    })
  }

  isComposing(): boolean {
    return this.#composing
  }

  flush(): CommitAcknowledgement | null {
    const markdown = this.value()
    if (markdown === this.#session.snapshot().markdown) return null
    const acknowledgement = this.#session.commitSource({
      markdown,
      origin: 'cherry-source',
      transactionId: `cherry-source:${createRandomId()}`,
    })
    this.#onAcknowledgement?.(acknowledgement)
    return acknowledgement
  }

  applySourceRangeCommand(command: CheckedSourceRangeCommand): CommitAcknowledgement {
    const plan = {
      baseRevision: command.baseRevision,
      patches: [{
        codecId: command.codecId,
        expected: command.expected,
        from: command.from,
        replacement: command.replacement,
        to: command.to,
      }],
      transactionId: command.transactionId,
    }
    const acknowledgement = this.applySourcePatchPlan(plan)
    this.setSelection({
      anchor: command.from + command.replacement.length,
      head: command.from + command.replacement.length,
    })
    return acknowledgement
  }

  applySourcePatchPlan(plan: PatchPlan): CommitAcknowledgement {
    this.flush()
    this.#session.previewPatchPlan(plan)
    const source = this.#session.snapshot().markdown
    const changes = [...plan.patches]
      .sort((left, right) => left.from - right.from)
      .map((patch) => ({
        from: sourceOffsetToViewOffset(source, patch.from),
        insert: normalizeForCherry(patch.replacement),
        to: sourceOffsetToViewOffset(source, patch.to),
      }))
    this.#ignoredLocalChanges += 1
    const view = this.#view()
    view.dispatch({
      annotations: runtimeTransactionAnnotation(view, 'userEvent', 'input'),
      changes,
    })
    const acknowledgement = this.#session.commitPatchPlan(plan, 'toolbar-command')
    this.#onAcknowledgement?.(acknowledgement)
    return acknowledgement
  }

  replaceSelection(command: ReplaceSourceSelectionCommand): CommitAcknowledgement {
    this.flush()
    const selection = this.selection()
    const from = Math.min(selection.anchor, selection.head)
    const to = Math.max(selection.anchor, selection.head)
    const snapshot = this.#session.snapshot()
    const acknowledgement = this.applySourceRangeCommand({
      baseRevision: snapshot.revision,
      codecId: command.codecId,
      expected: snapshot.markdown.slice(from, to),
      from,
      replacement: command.replacement,
      to,
      transactionId: command.transactionId,
    })
    if (command.selectReplacement === true) {
      this.setSelection({ anchor: from, head: from + command.replacement.length })
    }
    return acknowledgement
  }

  search(query: string, caseSensitive = false): readonly SourceSearchMatch[] {
    this.#searchQuery = query
    this.#searchCaseSensitive = caseSensitive
    if (query.length === 0) return Object.freeze([])
    const source = this.value()
    const haystack = caseSensitive ? source : source.toLocaleLowerCase()
    const needle = caseSensitive ? query : query.toLocaleLowerCase()
    const matches: SourceSearchMatch[] = []
    let offset = 0
    while (offset <= haystack.length - needle.length) {
      const from = haystack.indexOf(needle, offset)
      if (from === -1) break
      matches.push(Object.freeze({ from, to: from + needle.length }))
      offset = from + Math.max(1, needle.length)
    }
    return Object.freeze(matches)
  }

  setSearchHighlights(matches: readonly SourceSearchMatch[], activeIndex: number): void {
    this.#activeSearchMarker?.clear()
    this.#activeSearchMarker = null
    if (this.#searchQuery.length === 0 || matches.length === 0) {
      this.clearSearchHighlights()
      return
    }
    this.#cherry.editor.editor?.setSearchQuery(this.#searchQuery, this.#searchCaseSensitive, false)
    const source = this.#session.snapshot().markdown
    const mapped = Object.freeze(matches.map((match) => Object.freeze({
      from: sourceOffsetToViewOffset(source, match.from),
      to: sourceOffsetToViewOffset(source, match.to),
    })))
    const active = mapped[activeIndex]
    const view = this.#view()
    if (active === undefined) return
    this.#activeSearchMarker = this.#cherry.editor.editor?.markText(active.from, active.to, {
      className: 'w-editor-search-match--active',
      markId: 'w-editor-active-search-match',
    }) ?? null
    view.dispatch({ selection: { anchor: active.from, head: active.to } })
    if (view.dom.closest('.editor-surface') === null || typeof document.createRange().getClientRects !== 'function') return
    revealSearchCoordinates(view.dom, view.coordsAtPos(active.from), view.coordsAtPos(active.to))
  }

  clearSearchHighlights(): void {
    this.#activeSearchMarker?.clear()
    this.#activeSearchMarker = null
    this.#cherry.editor.editor?.clearSearchQuery()
  }

  undo(): boolean {
    return this.#dispatchHistoryShortcut('undo')
  }

  redo(): boolean {
    return this.#dispatchHistoryShortcut('redo')
  }

  restoreCheckpoint(markdown: string, transactionId: string): CommitAcknowledgement {
    this.flush()
    const source = this.#session.snapshot().markdown
    if (source === markdown) {
      return this.#session.commitSource({ markdown, origin: 'checkpoint-restore', transactionId })
    }
    const replacement = normalizeForCherry(markdown)
    const view = this.#view()
    const selection = view.state.selection.main
    this.#ignoredLocalChanges += 1
    view.dispatch({
      annotations: runtimeTransactionAnnotation(view, 'userEvent', 'input'),
      changes: { from: 0, insert: replacement, to: view.state.doc.length },
      selection: {
        anchor: Math.min(selection.anchor, replacement.length),
        head: Math.min(selection.head, replacement.length),
      },
    })
    const acknowledgement = this.#session.commitSource({
      markdown,
      origin: 'checkpoint-restore',
      transactionId,
    })
    this.#onAcknowledgement?.(acknowledgement)
    return acknowledgement
  }

  focus(): void {
    this.#view().focus()
  }

  destroy(): void {
    if (this.#destroyed) return
    const content = this.#view().contentDOM
    this.#activeSearchMarker?.clear()
    this.#activeSearchMarker = null
    this.#destroyed = true
    this.#unsubscribe()
    content.removeEventListener('compositionstart', this.#compositionStart)
    content.removeEventListener('compositionend', this.#compositionEnd)
    this.#cherry.destroy()
  }

  #acceptCherryChange(text: string): void {
    if (this.#destroyed) return
    if (this.#ignoredLocalChanges > 0) {
      this.#ignoredLocalChanges -= 1
      return
    }
    const reflected = normalizeForCherry(text)
    const pendingCount = this.#pendingReflections.get(reflected) ?? 0
    if (pendingCount > 0) {
      if (pendingCount === 1) {
        this.#pendingReflections.delete(reflected)
      } else {
        this.#pendingReflections.set(reflected, pendingCount - 1)
      }
      return
    }
    if (this.#composing) return
    const current = this.#session.snapshot()
    const markdown = preserveAuthorityLineEndings(current.markdown, reflected)
    if (markdown === current.markdown) return
    const acknowledgement = this.#session.commitSource({
      markdown,
      origin: 'cherry-source',
      transactionId: `cherry-source:${createRandomId()}`,
    })
    this.#onAcknowledgement?.(acknowledgement)
  }

  #hydrate(snapshot: DocumentSnapshot): void {
    const reflected = normalizeForCherry(snapshot.markdown)
    const view = this.#view()
    const raw = view.state.doc.toString()
    if (reflected === raw) return
    this.#pendingReflections.set(reflected, (this.#pendingReflections.get(reflected) ?? 0) + 1)
    view.dispatch({
      annotations: runtimeTransactionAnnotation(view, 'addToHistory', false),
      changes: { from: 0, insert: reflected, to: raw.length },
    })
  }

  #dispatchHistoryShortcut(direction: 'redo' | 'undo'): boolean {
    const editorView = this.#view()
    const changed = dispatchCherrySourceHistoryShortcut(editorView, direction)
    if (changed) this.flush()
    return changed
  }

  #view(): ReturnType<Cherry['getCodeMirror']> {
    if (this.#destroyed) throw new Error('CherrySourceAdapter has been destroyed.')
    return this.#cherry.getCodeMirror()
  }

  #rawValue(): string {
    return this.#view().state.doc.toString()
  }
}
