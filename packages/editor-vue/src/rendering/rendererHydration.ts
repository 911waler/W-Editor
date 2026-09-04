import { hydrateCherryChartPreviews } from './chartHydration'
import { hydrateMermaidPreviews } from './mermaidHydration'
import { rendererProfileCapabilities, type RendererProfile } from './rendererProfiles'
import { translateUi, type UiLocale } from '../services/uiLocalization'
import type { MermaidPreviewRendererContract } from '../adapters/mermaidPreviewRenderer'

export interface RendererHydrationOptions {
  readonly locale: UiLocale
  readonly mermaidRenderer?: MermaidPreviewRendererContract
  readonly onCodeEdit?: (index: number) => void
  readonly onError?: (error: unknown) => void
  readonly onTaskToggle?: (event: RendererTaskToggleEvent) => void
  readonly profile: RendererProfile
}

export interface RendererTaskToggleEvent {
  readonly checked: boolean
  readonly index: number
}

function taskItemText(item: HTMLElement): string {
  const paragraph = item.querySelector<HTMLElement>(':scope > p') ?? item.querySelector<HTMLElement>('p')
  if (paragraph === null) return ''
  const copy = paragraph.cloneNode(true) as HTMLElement
  for (const indicator of copy.querySelectorAll('.ch-icon, input[type="checkbox"]')) indicator.remove()
  return (copy.textContent ?? '').replace(/\s+/gu, ' ').trim()
}

function taskStateLabel(locale: UiLocale, checked: boolean, label: string): string {
  return translateUi(locale, checked ? 'preview.taskCompleted' : 'preview.taskIncomplete', { label })
}

function updateTaskLabels(root: HTMLElement, locale: UiLocale): void {
  for (const control of root.querySelectorAll<HTMLInputElement>('input[data-w-editor-task-index]')) {
    const label = control.dataset['wEditorTaskLabel'] ?? ''
    control.setAttribute('aria-label', translateUi(locale, 'preview.taskCheckbox', { label }))
  }
  for (const indicator of root.querySelectorAll<HTMLElement>('[data-w-editor-task-state]')) {
    const label = indicator.dataset['wEditorTaskLabel'] ?? ''
    indicator.setAttribute('aria-label', taskStateLabel(locale, indicator.dataset['wEditorTaskState'] === 'checked', label))
  }
}

export function updateRendererLabels(root: HTMLElement, locale: UiLocale): void {
  for (const toolbar of root.querySelectorAll<HTMLElement>('.final-code-block__toolbar')) {
    toolbar.setAttribute('aria-label', translateUi(locale, 'preview.codeActions'))
  }
  const actionLabels = Object.freeze({
    'copy-code': translateUi(locale, 'preview.copyCode'),
    'edit-code': translateUi(locale, 'preview.editCode'),
  })
  for (const [action, label] of Object.entries(actionLabels)) {
    for (const control of root.querySelectorAll<HTMLElement>(`[data-w-editor-action="${action}"]`)) {
      control.setAttribute('aria-label', label)
      control.setAttribute('title', label)
    }
  }
  for (const fold of root.querySelectorAll<HTMLButtonElement>('[data-w-editor-action="collapse-code"]')) {
    const label = translateUi(locale, 'preview.collapseCode')
    fold.setAttribute('aria-label', label)
    fold.setAttribute('title', label)
  }
  for (const expand of root.querySelectorAll<HTMLButtonElement>('[data-w-editor-action="expand-code"]')) {
    const label = translateUi(locale, 'preview.expandCode')
    expand.setAttribute('aria-label', label)
    expand.setAttribute('title', label)
  }
  updateTaskLabels(root, locale)
}

function createTaskActions(root: HTMLElement, options: RendererHydrationOptions): readonly (() => void)[] {
  const capabilities = rendererProfileCapabilities(options.profile)
  const disposers: Array<() => void> = []
  for (const item of root.querySelectorAll<HTMLElement>('li.check-list-item[data-w-editor-task-index]')) {
    const index = Number(item.dataset['wEditorTaskIndex'])
    if (!Number.isInteger(index) || index < 0) continue
    const indicator = item.querySelector<HTMLElement>('.ch-icon-check, .ch-icon-square')
    if (indicator === null) continue
    const checked = indicator.classList.contains('ch-icon-check')
    const label = taskItemText(item)
    item.parentElement?.classList.add('w-editor-task-list')
    if (capabilities.allowsTaskToggle && options.onTaskToggle !== undefined) {
      const control = root.ownerDocument.createElement('input')
      control.type = 'checkbox'
      control.checked = checked
      control.dataset['wEditorTaskIndex'] = String(index)
      control.dataset['wEditorTaskLabel'] = label
      const toggle = (): void => options.onTaskToggle?.(Object.freeze({ checked: control.checked, index }))
      control.addEventListener('change', toggle)
      indicator.replaceWith(control)
      disposers.push(() => control.removeEventListener('change', toggle))
      continue
    }
    indicator.dataset['wEditorTaskLabel'] = label
    indicator.dataset['wEditorTaskState'] = checked ? 'checked' : 'unchecked'
    indicator.setAttribute('role', 'img')
    indicator.removeAttribute('aria-hidden')
  }
  updateTaskLabels(root, options.locale)
  return Object.freeze(disposers)
}

function createCodeActions(root: HTMLElement, options: RendererHydrationOptions): readonly (() => void)[] {
  const ownerDocument = root.ownerDocument
  const view = ownerDocument.defaultView
  const capabilities = rendererProfileCapabilities(options.profile)
  const disposers: Array<() => void> = []
  for (const [codeIndex, code] of [...root.querySelectorAll<HTMLElement>('pre > code')].entries()) {
    const pre = code.parentElement
    if (view === null || !(pre instanceof view.HTMLPreElement) || pre.closest('[data-w-editor-node="code-block"]') !== null) continue
    const block = ownerDocument.createElement('figure')
    block.className = 'final-code-block'
    block.dataset['wEditorNode'] = 'code-block'
    const lineCount = (code.textContent ?? '').split('\n').length
    const canFold = lineCount > 12
    block.dataset['codeLines'] = String(lineCount)
    block.dataset['folded'] = String(canFold)
    const frame = ownerDocument.createElement('div')
    frame.className = 'final-code-block__frame'
    const toolbar = ownerDocument.createElement('div')
    toolbar.className = 'final-code-block__toolbar'
    toolbar.setAttribute('role', 'toolbar')
    const copy = ownerDocument.createElement('button')
    copy.type = 'button'
    copy.dataset['wEditorAction'] = 'copy-code'
    const copyIcon = ownerDocument.createElement('span')
    copyIcon.className = 'ch-icon ch-icon-copy final-code-block__action-icon'
    copyIcon.setAttribute('aria-hidden', 'true')
    copy.append(copyIcon)

    let edit: HTMLButtonElement | null = null
    if (capabilities.allowsCodeEdit) {
      edit = ownerDocument.createElement('button')
      edit.type = 'button'
      edit.dataset['wEditorAction'] = 'edit-code'
      const editIcon = ownerDocument.createElement('span')
      editIcon.className = 'ch-icon ch-icon-edit final-code-block__action-icon'
      editIcon.setAttribute('aria-hidden', 'true')
      edit.append(editIcon)
    }

    const fold = ownerDocument.createElement('button')
    fold.type = 'button'
    fold.dataset['wEditorAction'] = 'collapse-code'
    fold.setAttribute('aria-expanded', 'true')
    fold.hidden = true
    const foldIcon = ownerDocument.createElement('span')
    foldIcon.className = 'ch-icon ch-icon-unExpand final-code-block__action-icon'
    foldIcon.setAttribute('aria-hidden', 'true')
    fold.append(foldIcon)
    const fade = ownerDocument.createElement('div')
    fade.className = 'final-code-block__fade'
    fade.dataset['codeFade'] = 'true'
    fade.setAttribute('aria-hidden', 'true')
    fade.hidden = !canFold
    const expand = ownerDocument.createElement('button')
    expand.type = 'button'
    expand.className = 'final-code-block__expand'
    expand.dataset['wEditorAction'] = 'expand-code'
    expand.setAttribute('aria-expanded', String(!canFold))
    expand.hidden = !canFold
    const expandIcon = ownerDocument.createElement('span')
    expandIcon.className = 'ch-icon ch-icon-expand final-code-block__action-icon'
    expandIcon.setAttribute('aria-hidden', 'true')
    expand.append(expandIcon)
    pre.tabIndex = 0
    pre.replaceWith(block)
    toolbar.append(copy)
    if (edit !== null) toolbar.append(edit)
    toolbar.append(fold)
    frame.append(toolbar, pre, fade, expand)
    block.append(frame)
    const copyCode = async (): Promise<void> => {
      const clipboard = view.navigator.clipboard
      if (clipboard === undefined) throw new Error('Clipboard is unavailable in this Renderer realm.')
      await clipboard.writeText(code.textContent ?? '')
    }
    const editCode = (): void => options.onCodeEdit?.(codeIndex)
    const setFolded = (folded: boolean): void => {
      block.dataset['folded'] = String(folded)
      fold.hidden = folded || !canFold
      fold.setAttribute('aria-expanded', String(!folded))
      fade.hidden = !folded
      expand.hidden = !folded
      expand.setAttribute('aria-expanded', String(!folded))
    }
    const collapseCode = (): void => setFolded(true)
    const expandCode = (): void => setFolded(false)
    copy.addEventListener('click', copyCode)
    if (edit !== null) edit.addEventListener('click', editCode)
    fold.addEventListener('click', collapseCode)
    expand.addEventListener('click', expandCode)
    disposers.push(
      () => copy.removeEventListener('click', copyCode),
      () => { if (edit !== null) edit.removeEventListener('click', editCode) },
      () => fold.removeEventListener('click', collapseCode),
      () => expand.removeEventListener('click', expandCode),
    )
  }
  return Object.freeze(disposers)
}

export function hydrateRendererContent(root: HTMLElement, options: RendererHydrationOptions): () => void {
  const capabilities = rendererProfileCapabilities(options.profile)
  const disposeCharts = hydrateCherryChartPreviews(root)
  const disposeMermaid = hydrateMermaidPreviews(root, {
    ...(options.mermaidRenderer === undefined ? {} : { renderer: options.mermaidRenderer }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  })
  const disposeCodeActions = createCodeActions(root, options)
  const disposeTaskActions = createTaskActions(root, options)
  const mutationEvents = ['beforeinput', 'input', 'paste', 'drop', 'cut'] as const
  const preventMutation = (event: Event): void => {
    if (!capabilities.allowsDocumentMutation) {
      event.preventDefault()
      event.stopPropagation()
    }
  }
  root.setAttribute('contenteditable', 'false')
  for (const eventName of mutationEvents) root.addEventListener(eventName, preventMutation, true)
  updateRendererLabels(root, options.locale)
  return () => {
    disposeCharts()
    disposeMermaid()
    for (const dispose of disposeCodeActions) dispose()
    for (const dispose of disposeTaskActions) dispose()
    for (const eventName of mutationEvents) root.removeEventListener(eventName, preventMutation, true)
  }
}
