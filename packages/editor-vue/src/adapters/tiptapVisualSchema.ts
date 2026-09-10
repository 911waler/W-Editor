import { Extension, Mark, Node, mergeAttributes, type Attributes, type NodeViewRendererProps } from '@tiptap/core'
import { Color } from '@tiptap/extension-color'
import { Highlight } from '@tiptap/extension-highlight'
import { Link } from '@tiptap/extension-link'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { Table, TableKit } from '@tiptap/extension-table'
import { TaskItem } from '@tiptap/extension-task-item'
import { TaskList } from '@tiptap/extension-task-list'
import { TextAlign } from '@tiptap/extension-text-align'
import { BackgroundColor, FontSize, TextStyle } from '@tiptap/extension-text-style'
import { Underline } from '@tiptap/extension-underline'
import StarterKit from '@tiptap/starter-kit'
import { closeHistory } from '@tiptap/pm/history'
import { DOMSerializer, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeSelection, Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type ViewMutationRecord } from '@tiptap/pm/view'

import {
  CHART_TABLE_DESCRIPTORS,
  codeLanguageOptions,
  createTocHeadingItems,
  serializeFencedCode,
  serializeFormula,
  type FormulaMode,
  type TocHeadingItem,
} from '@w-editor/editor-core'
import {
  createUiLocalizationStore,
  type UiLocalizationStore,
  type UiMessageKey,
} from '../services/uiLocalization'
import { InlineImage } from './imageNode'
import { highlightCodeTokens } from './codeSyntaxHighlighting'
import { renderFormulaVisual } from './formulaVisualRenderer'

function bindLocalizedNodeView(
  localization: UiLocalizationStore,
  renderCopy: () => void,
): () => void {
  renderCopy()
  return localization.subscribe(renderCopy)
}

function listenNodeViewEvent<EventType extends Event>(
  target: EventTarget,
  type: string,
  listener: (event: EventType) => void,
): () => void {
  const eventListener = listener as EventListener
  target.addEventListener(type, eventListener)
  return () => target.removeEventListener(type, eventListener)
}

const PROJECTED_STANDARD_NODE_TYPES = Object.freeze([
  'blockquote',
  'bulletList',
  'codeBlock',
  'heading',
  'horizontalRule',
  'listItem',
  'orderedList',
  'paragraph',
  'table',
  'tableCell',
  'tableHeader',
  'tableRow',
  'taskItem',
  'taskList',
])

function projectionAttributes(): Attributes {
  return {
    ordinaryClass: {
      default: null,
      renderHTML: (attributes) => attributes['ordinaryClass'] === true ? { class: 'ordinary-block' } : {},
    },
    codecId: {
      default: null,
      parseHTML: (element) => element.getAttribute('data-codec-id'),
      renderHTML: (attributes) => attributes['codecId'] === null
        ? {}
        : { 'data-codec-id': attributes['codecId'] },
    },
    originalSource: {
      default: null,
      renderHTML: () => ({}),
    },
    projectionId: {
      default: null,
      parseHTML: (element) => element.getAttribute('data-projection-id'),
      renderHTML: (attributes) => attributes['projectionId'] === null
        ? {}
        : { 'data-projection-id': attributes['projectionId'] },
    },
    revision: {
      default: null,
      renderHTML: () => ({}),
    },
    sourceFrom: {
      default: null,
      renderHTML: () => ({}),
    },
    sourceTo: {
      default: null,
      renderHTML: () => ({}),
    },
  }
}

const ProjectionAttributes = Extension.create({
  name: 'wEditorProjectionAttributes',
  addGlobalAttributes: () => [{
    types: [...PROJECTED_STANDARD_NODE_TYPES],
    attributes: projectionAttributes(),
  }],
})

const TocHeadingAttributes = Extension.create({
  name: 'wEditorTocHeadingAttributes',
  addGlobalAttributes: () => [{
    types: ['heading'],
    attributes: {
      tocAnchor: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-toc-explicit-anchor'),
        renderHTML: (attributes) => typeof attributes['tocAnchor'] === 'string'
          ? { 'data-toc-explicit-anchor': attributes['tocAnchor'] }
          : {},
      },
    },
  }],
})

export interface PositionedTocHeading extends TocHeadingItem {
  readonly position: number
  readonly size: number
}

export function positionedTocHeadings(documentNode: ProseMirrorNode): readonly PositionedTocHeading[] {
  const inputs: Array<Readonly<{ explicitAnchor: string | null; level: number; text: string }>> = []
  const positions: Array<Readonly<{ position: number; size: number }>> = []
  documentNode.descendants((node, position) => {
    if (node.type.name !== 'heading') return true
    inputs.push(Object.freeze({
      explicitAnchor: typeof node.attrs['tocAnchor'] === 'string' ? node.attrs['tocAnchor'] as string : null,
      level: Number(node.attrs['level'] ?? 1),
      text: node.textContent,
    }))
    positions.push(Object.freeze({ position, size: node.nodeSize }))
    return false
  })
  return Object.freeze(createTocHeadingItems(inputs).map((heading, index) => Object.freeze({
    ...heading,
    position: positions[index]?.position ?? 0,
    size: positions[index]?.size ?? 0,
  })))
}

const TOC_HEADING_PLUGIN_KEY = new PluginKey<DecorationSet>('wEditorTocHeadings')

const TocHeadingAnchors = Extension.create({
  name: 'wEditorTocHeadingAnchors',
  addProseMirrorPlugins: () => [new Plugin({
    key: TOC_HEADING_PLUGIN_KEY,
    props: {
      decorations: (state) => DecorationSet.create(state.doc, positionedTocHeadings(state.doc).map((heading) => (
        Decoration.node(heading.position, heading.position + heading.size, {
          'data-toc-heading': '',
          id: heading.anchor,
        })
      ))),
    },
  })],
})

export const Ruby = Mark.create({
  name: 'ruby',
  addAttributes: () => ({
    annotation: {
      default: '',
      parseHTML: (element) => element.getAttribute('data-ruby-annotation') ?? '',
      renderHTML: (attributes) => ({ 'data-ruby-annotation': attributes['annotation'] }),
    },
  }),
  parseHTML: () => [{ tag: 'span[data-ruby-annotation]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'span',
    mergeAttributes(HTMLAttributes, { class: 'ruby-mark' }),
    0,
  ],
})

function rawAttributes(): Attributes {
  return {
    ...projectionAttributes(),
    source: {
      default: '',
      renderHTML: () => ({}),
    },
  }
}

export interface RawNodeEditEvent {
  readonly kind: 'rawBlock' | 'rawInline'
  readonly source: string
}

export const PresentationFallback = Node.create({
  name: 'presentationFallback',
  group: 'block',
  atom: true,
  isolating: true,
  selectable: false,
  addAttributes: () => ({
    ...projectionAttributes(),
    fallbackKind: {
      default: 'cherry-raw',
      renderHTML: (attributes) => ({ 'data-w-editor-presentation-fallback': attributes['fallbackKind'] }),
    },
    safeHtml: {
      default: '',
      renderHTML: () => ({}),
    },
    showSourceWhenEmpty: {
      default: true,
      renderHTML: () => ({}),
    },
    source: {
      default: '',
      renderHTML: () => ({}),
    },
  }),
  parseHTML: () => [{ tag: '[data-w-editor-presentation-fallback]' }],
  addNodeView() {
    return ({ editor, node }) => {
      const editorElement = editor.options.element
      const ownerDocument = typeof editorElement === 'object'
        && editorElement !== null
        && 'ownerDocument' in editorElement
        ? editorElement.ownerDocument as Document
        : document
      const dom = ownerDocument.createElement('div')
      dom.className = 'presentation-fallback'
      dom.dataset['wEditorPresentationFallback'] = String(node.attrs['fallbackKind'] ?? 'cherry-raw')
      dom.setAttribute('contenteditable', 'false')
      const safeHtml = String(node.attrs['safeHtml'] ?? '')
      if (safeHtml.length > 0) {
        const template = ownerDocument.createElement('template')
        template.innerHTML = safeHtml
        dom.append(template.content.cloneNode(true))
      } else if (node.attrs['showSourceWhenEmpty'] === true) {
        const source = ownerDocument.createElement('pre')
        source.textContent = String(node.attrs['source'] ?? '')
        dom.append(source)
      }
      return { dom }
    }
  },
  renderHTML({ HTMLAttributes, node }) {
    const children = node.attrs['showSourceWhenEmpty'] === true
      ? [['pre', {}, String(node.attrs['source'] ?? '')]]
      : []
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        class: 'presentation-fallback',
        'data-w-editor-presentation-fallback': node.attrs['fallbackKind'],
      }),
      ...children,
    ]
  },
})

interface RawNodeOptions {
  readonly localization: UiLocalizationStore
  readonly onEdit: ((event: RawNodeEditEvent) => void) | null
}

function rawNodeView(localization: UiLocalizationStore, onEdit: RawNodeOptions['onEdit']) {
  return ({ editor, getPos, node }: NodeViewRendererProps) => {
    let currentNode = node
    const render = (renderNode: ProseMirrorNode): HTMLElement => {
      const inline = renderNode.type.name === 'rawInline'
      const dom = document.createElement(inline ? 'span' : 'pre')
      dom.className = inline ? 'raw-node raw-node--inline' : 'complex-node raw-node raw-node--block'
      dom.dataset['wEditorNode'] = inline ? 'raw-inline' : 'raw-block'
      dom.dataset['selected'] = 'false'
      dom.setAttribute('contenteditable', 'false')

      const source = document.createElement(inline ? 'code' : 'span')
      source.className = 'raw-node__source'
      source.textContent = String(renderNode.attrs['source'] ?? '')
      dom.append(source)

      const controls = document.createElement('span')
      controls.className = 'complex-node__controls raw-node__controls'
      const edit = document.createElement('button')
      edit.type = 'button'
      edit.dataset['rawEdit'] = inline ? 'rawInline' : 'rawBlock'
      controls.append(edit)
      dom.append(controls)
      return dom
    }

    const dom = render(currentNode)
    const renderCopy = (): void => {
      const inline = currentNode.type.name === 'rawInline'
      dom.setAttribute('aria-label', localization.t(inline ? 'rawNode.unknownInline' : 'rawNode.unknownBlock'))
      const edit = dom.querySelector<HTMLButtonElement>('[data-raw-edit]')
      if (edit === null) return
      edit.textContent = localization.t('rawNode.editSource')
      edit.setAttribute('aria-label', localization.t(inline ? 'rawNode.editUnknownInline' : 'rawNode.editUnknownBlock'))
    }
    const preserveSelection = (event: MouseEvent): void => {
      if (event.target instanceof Element && event.target.closest('[data-raw-edit]') !== null) event.preventDefault()
    }
    const editSource = (event: MouseEvent): void => {
      if (!(event.target instanceof Element) || event.target.closest('[data-raw-edit]') === null) return
      event.preventDefault()
      event.stopPropagation()
      const position = getPos()
      if (typeof position === 'number') {
        editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, position)))
      }
      const inline = currentNode.type.name === 'rawInline'
      onEdit?.(Object.freeze({
        kind: inline ? 'rawInline' : 'rawBlock',
        source: String(currentNode.attrs['source'] ?? ''),
      }))
    }
    const removeMousedown = listenNodeViewEvent(dom, 'mousedown', preserveSelection)
    const removeClick = listenNodeViewEvent(dom, 'click', editSource)
    const unsubscribeLocalization = bindLocalizedNodeView(localization, renderCopy)
    return {
      dom,
      destroy: () => {
        unsubscribeLocalization()
        removeMousedown()
        removeClick()
      },
      selectNode: () => {
        dom.dataset['selected'] = 'true'
        dom.classList.add('ProseMirror-selectednode')
      },
      deselectNode: () => {
        dom.dataset['selected'] = 'false'
        dom.classList.remove('ProseMirror-selectednode')
      },
      stopEvent: (event: Event) => event.target instanceof Element && event.target.closest('[data-raw-edit]') !== null,
      update: (updatedNode: ProseMirrorNode) => {
        if (updatedNode.type !== currentNode.type) return false
        const selected = dom.dataset['selected'] === 'true'
        currentNode = updatedNode
        const replacement = render(updatedNode)
        for (const attribute of [...dom.attributes]) dom.removeAttribute(attribute.name)
        for (const attribute of [...replacement.attributes]) dom.setAttribute(attribute.name, attribute.value)
        dom.replaceChildren(...replacement.childNodes)
        if (selected) {
          dom.dataset['selected'] = 'true'
          dom.classList.add('ProseMirror-selectednode')
        }
        renderCopy()
        return true
      },
    }
  }
}

export const RawInline = Node.create<RawNodeOptions>({
  name: 'rawInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addOptions: () => ({ localization: createUiLocalizationStore('en'), onEdit: null }),
  addAttributes: rawAttributes,
  addNodeView() {
    return rawNodeView(this.options.localization, this.options.onEdit)
  },
  parseHTML: () => [{ tag: 'span[data-w-editor-node="raw-inline"]' }],
  renderHTML: ({ HTMLAttributes, node }) => [
    'span',
    mergeAttributes(HTMLAttributes, { 'data-w-editor-node': 'raw-inline' }),
    String(node.attrs['source'] ?? ''),
  ],
})

export const RawBlock = Node.create<RawNodeOptions>({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  isolating: true,
  selectable: true,
  addOptions: () => ({ localization: createUiLocalizationStore('en'), onEdit: null }),
  addAttributes: rawAttributes,
  addNodeView() {
    return rawNodeView(this.options.localization, this.options.onEdit)
  },
  parseHTML: () => [{ tag: 'pre[data-w-editor-node="raw-block"]' }],
  renderHTML: ({ HTMLAttributes, node }) => [
    'pre',
    mergeAttributes(HTMLAttributes, { 'data-w-editor-node': 'raw-block' }),
    String(node.attrs['source'] ?? ''),
  ],
})

export interface SemanticNodeEditEvent {
  readonly attachmentKind?: string
  readonly chartType?: string
  readonly code?: string
  readonly columns?: readonly string[]
  readonly diagramType?: string
  readonly editorId: string
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

interface FormulaNodeOptions {
  readonly localization: UiLocalizationStore
  readonly onEdit: ((event: SemanticNodeEditEvent) => void) | null
}

function formulaAttributes(includeProjection: boolean): Attributes {
  return {
    ...(includeProjection ? projectionAttributes() : {}),
    content: {
      default: '',
      renderHTML: () => ({}),
    },
    formulaMode: {
      default: includeProjection ? 'block' : 'inline',
      renderHTML: (attributes) => ({ 'data-formula-mode': attributes['formulaMode'] }),
    },
    localError: {
      default: null,
      renderHTML: () => ({}),
    },
    source: {
      default: '',
      renderHTML: () => ({}),
    },
  }
}

function formulaNodeView(localization: UiLocalizationStore, onEdit: FormulaNodeOptions['onEdit']) {
  return ({ editor, getPos, node }: NodeViewRendererProps) => {
    let currentNode = node
    const editCurrentFormula = (event: MouseEvent): void => {
      event.preventDefault()
      const position = getPos()
      if (typeof position === 'number') {
        editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, position)))
      }
      const mode: FormulaMode = currentNode.type.name === 'inlineFormula' ? 'inline' : 'block'
      const currentContent = String(currentNode.attrs['content'] ?? '')
      onEdit?.(Object.freeze({
        editorId: 'formula-editor',
        formulaContent: currentContent,
        formulaMode: mode,
        kind: 'formula',
        layoutKind: null,
        source: serializeFormula(mode, currentContent),
      }))
    }
    const render = (renderNode: ProseMirrorNode): HTMLElement => {
      const mode: FormulaMode = renderNode.type.name === 'inlineFormula' ? 'inline' : 'block'
      const content = String(renderNode.attrs['content'] ?? '')
      const dom = document.createElement(mode === 'inline' ? 'span' : 'figure')
      dom.className = `formula-node formula-node--${mode}`
      dom.dataset['formulaMode'] = mode
      dom.dataset['selected'] = 'false'
      dom.dataset['wEditorNode'] = 'formula'
      dom.setAttribute('contenteditable', 'false')
      const renderedFormula = renderFormulaVisual(mode, content)
      if (renderedFormula.dataset['renderState'] === 'error') {
        const message = renderedFormula.textContent ?? ''
        const prefix = 'Formula preview unavailable: '
        renderedFormula.dataset['formulaPreviewDetail'] = message.startsWith(prefix)
          ? message.slice(prefix.length)
          : ''
      }
      dom.append(renderedFormula)

      const localError = renderNode.attrs['localError']
      if (typeof localError === 'string' && localError.length > 0) {
        const alert = document.createElement('span')
        alert.className = 'formula-node__error'
        alert.setAttribute('role', 'alert')
        alert.textContent = localError
        dom.append(alert)
      }
      return dom
    }

    const dom = render(currentNode)
    const renderCopy = (): void => {
      const mode: FormulaMode = currentNode.type.name === 'inlineFormula' ? 'inline' : 'block'
      const renderedLabel = localization.t(
        mode === 'inline' ? 'formula.renderedInline' : 'formula.renderedBlock',
      )
      dom.setAttribute('aria-label', renderedLabel)
      const rendered = dom.querySelector<HTMLElement>('.formula-rendered')
      if (rendered !== null) {
        rendered.setAttribute('aria-label', renderedLabel)
        if (rendered.dataset['renderState'] === 'error') {
          const detail = rendered.dataset['formulaPreviewDetail'] ?? ''
          rendered.textContent = detail.length > 0
            ? localization.t('formula.previewUnavailableWithDetail', { detail })
            : localization.t('formula.previewUnavailable')
        }
      }
      dom.querySelector<HTMLElement>('.formula-node__error')
        ?.setAttribute('aria-label', localization.t('formula.previewError'))
    }
    const removeDoubleClick = listenNodeViewEvent(dom, 'dblclick', editCurrentFormula)
    const unsubscribeLocalization = bindLocalizedNodeView(localization, renderCopy)
    return {
      dom,
      destroy: () => {
        unsubscribeLocalization()
        removeDoubleClick()
      },
      selectNode: () => {
        dom.dataset['selected'] = 'true'
        dom.classList.add('ProseMirror-selectednode')
      },
      deselectNode: () => {
        dom.dataset['selected'] = 'false'
        dom.classList.remove('ProseMirror-selectednode')
      },
      stopEvent: (event: Event) => event.type === 'dblclick',
      update: (updatedNode: ProseMirrorNode) => {
        if (updatedNode.type !== currentNode.type) return false
        const selected = dom.dataset['selected'] === 'true'
        currentNode = updatedNode
        const replacement = render(updatedNode)
        for (const attribute of [...dom.attributes]) dom.removeAttribute(attribute.name)
        for (const attribute of [...replacement.attributes]) dom.setAttribute(attribute.name, attribute.value)
        dom.replaceChildren(...replacement.childNodes)
        if (selected) {
          dom.dataset['selected'] = 'true'
          dom.classList.add('ProseMirror-selectednode')
        }
        renderCopy()
        return true
      },
    }
  }
}

export const InlineFormula = Node.create<FormulaNodeOptions>({
  name: 'inlineFormula',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addOptions: () => ({ localization: createUiLocalizationStore('en'), onEdit: null }),
  addAttributes: () => formulaAttributes(false),
  addNodeView() {
    return formulaNodeView(this.options.localization, this.options.onEdit)
  },
  parseHTML: () => [{ tag: 'span[data-w-editor-node="formula"][data-formula-mode="inline"]' }],
  renderHTML: ({ HTMLAttributes, node }) => [
    'span',
    mergeAttributes(HTMLAttributes, { 'data-formula-mode': 'inline', 'data-w-editor-node': 'formula' }),
    String(node.attrs['content'] ?? ''),
  ],
})

export const FormulaBlock = Node.create<FormulaNodeOptions>({
  name: 'formulaBlock',
  group: 'block',
  atom: true,
  isolating: true,
  selectable: true,
  addOptions: () => ({ localization: createUiLocalizationStore('en'), onEdit: null }),
  addAttributes: () => formulaAttributes(true),
  addNodeView() {
    return formulaNodeView(this.options.localization, this.options.onEdit)
  },
  parseHTML: () => [{ tag: 'figure[data-w-editor-node="formula"][data-formula-mode="block"]' }],
  renderHTML: ({ HTMLAttributes, node }) => [
    'figure',
    mergeAttributes(HTMLAttributes, { 'data-formula-mode': 'block', 'data-w-editor-node': 'formula' }),
    String(node.attrs['content'] ?? ''),
  ],
})

export function scrollTocHeadingIntoView(editorRoot: HTMLElement, anchor: string): void {
  const heading = [...editorRoot.querySelectorAll<HTMLElement>('[data-toc-heading]')]
    .find((candidate) => candidate.id === anchor)
  if (heading === undefined) return
  if (typeof heading.scrollIntoView === 'function') heading.scrollIntoView({ block: 'start' })
}

function renderTocNode(documentNode: ProseMirrorNode): HTMLElement {
  const headings = positionedTocHeadings(documentNode)
  const dom = document.createElement('nav')
  dom.className = 'toc-node toc'
  dom.dataset['wEditorNode'] = 'toc'
  dom.setAttribute('contenteditable', 'false')

  const title = document.createElement('p')
  title.className = 'toc-node__title toc-title'
  dom.append(title)

  if (headings.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'toc-node__empty'
    empty.dataset['tocEmpty'] = 'true'
    empty.setAttribute('role', 'status')
    dom.append(empty)
    return dom
  }

  const list = document.createElement('ol')
  list.className = 'toc-node__list'
  for (const heading of headings) {
    const item = document.createElement('li')
    item.className = 'toc-node__item toc-li'
    item.dataset['tocLevel'] = String(heading.level)
    const link = document.createElement('a')
    link.className = `toc-node__link level-${heading.level}`
    link.dataset['tocLevel'] = String(heading.level)
    link.dataset['tocAnchor'] = heading.anchor
    link.href = `#${heading.anchor}`
    link.textContent = heading.text
    item.append(link)
    list.append(item)
  }
  dom.append(list)
  return dom
}

interface TocNodeOptions {
  readonly localization: UiLocalizationStore
}

export const TocBlock = Node.create<TocNodeOptions>({
  name: 'tocBlock',
  group: 'block',
  atom: true,
  isolating: true,
  selectable: true,
  addOptions: () => ({ localization: createUiLocalizationStore('en') }),
  addAttributes: rawAttributes,
  addNodeView() {
    const localization = this.options.localization
    return ({ editor, node }) => {
      let currentNode = node
      const editorRoot = editor.options.element
      if (!(editorRoot instanceof HTMLElement)) throw new TypeError('TOC node requires an HTMLElement editor host.')
      const navigate = (heading: PositionedTocHeading): void => {
        scrollTocHeadingIntoView(editorRoot, heading.anchor)
        editor.commands.focus(heading.position + 1, { scrollIntoView: false })
        window.history.replaceState(null, '', `#${heading.anchor}`)
      }
      const dom = renderTocNode(editor.state.doc)
      const renderCopy = (): void => {
        dom.setAttribute('aria-label', localization.t('toc.navigation'))
        const title = dom.querySelector<HTMLElement>('.toc-node__title')
        if (title !== null) title.textContent = localization.t('toc.title')
        const empty = dom.querySelector<HTMLElement>('[data-toc-empty]')
        if (empty !== null) empty.textContent = localization.t('toc.empty')
      }
      const refresh = (): void => {
        const replacement = renderTocNode(editor.state.doc)
        dom.replaceChildren(...replacement.childNodes)
        renderCopy()
      }
      const handleClick = (event: MouseEvent): void => {
        const link = event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>('a[data-toc-anchor]')
          : null
        if (link === null) return
        const heading = positionedTocHeadings(editor.state.doc)
          .find((candidate) => candidate.anchor === link.dataset['tocAnchor'])
        if (heading === undefined) return
        event.preventDefault()
        event.stopPropagation()
        navigate(heading)
      }
      const handleKeydown = (event: KeyboardEvent): void => {
        const link = event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>('a[data-toc-anchor]')
          : null
        if (link === null) return
        const links = [...dom.querySelectorAll<HTMLAnchorElement>('a[data-toc-anchor]')]
        const index = links.indexOf(link)
        let next: number | null = null
        if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + links.length) % links.length
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % links.length
        if (event.key === 'Home') next = 0
        if (event.key === 'End') next = links.length - 1
        if (next === null) return
        event.preventDefault()
        event.stopPropagation()
        links[next]?.focus()
      }
      const removeClick = listenNodeViewEvent(dom, 'click', handleClick)
      const removeKeydown = listenNodeViewEvent(dom, 'keydown', handleKeydown)
      const unsubscribeLocalization = bindLocalizedNodeView(localization, renderCopy)
      editor.on('transaction', refresh)
      return {
        dom,
        destroy: () => {
          editor.off('transaction', refresh)
          unsubscribeLocalization()
          removeClick()
          removeKeydown()
        },
        selectNode: () => dom.classList.add('ProseMirror-selectednode'),
        deselectNode: () => dom.classList.remove('ProseMirror-selectednode'),
        stopEvent: (event: Event) => event.target instanceof Element && event.target.closest('a') !== null,
        update: (updatedNode: ProseMirrorNode) => {
          if (updatedNode.type !== currentNode.type) return false
          currentNode = updatedNode
          refresh()
          return true
        },
      }
    }
  },
  parseHTML: () => [{ tag: 'nav[data-w-editor-node="toc"]' }],
  renderHTML({ HTMLAttributes }) {
    return [
      'nav',
      mergeAttributes(HTMLAttributes, {
        'aria-label': this.options.localization.t('toc.navigation'),
        'data-w-editor-node': 'toc',
      }),
    ]
  },
})

export interface SemanticNodeCopyEvent {
  readonly code: string
  readonly language: string
  readonly source: string
}

export interface SemanticBlockOptions {
  readonly localization: UiLocalizationStore
  readonly mountChart: ((target: HTMLElement, source: string) => () => void) | null
  readonly onCopy: ((event: SemanticNodeCopyEvent) => void) | null
  readonly onEdit: ((event: SemanticNodeEditEvent) => void) | null
  readonly renderMermaid: ((source: string) => Promise<string>) | null
}

export interface VisualSearchHighlightMatch {
  readonly from: number
  readonly to: number
}

export interface VisualSearchHighlightUpdate {
  readonly activeIndex: number
  readonly matches: readonly VisualSearchHighlightMatch[]
}

export const VISUAL_SEARCH_HIGHLIGHT_META = 'w-editor:visual-search-highlights'
const VISUAL_SEARCH_HIGHLIGHT_PLUGIN_KEY = new PluginKey<DecorationSet>('wEditorSearchHighlights')
const VisualSearchHighlighting = Extension.create({
  name: 'wEditorSearchHighlights',
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: VISUAL_SEARCH_HIGHLIGHT_PLUGIN_KEY,
      props: {
        decorations: (state) => VISUAL_SEARCH_HIGHLIGHT_PLUGIN_KEY.getState(state) ?? null,
      },
      state: {
        init: () => DecorationSet.empty,
        apply: (transaction, previous) => {
          const update = transaction.getMeta(VISUAL_SEARCH_HIGHLIGHT_META) as VisualSearchHighlightUpdate | undefined
          if (update !== undefined) {
            return DecorationSet.create(transaction.doc, update.matches.map((match, index) => Decoration.inline(
              match.from,
              match.to,
              {
                class: index === update.activeIndex
                  ? 'w-editor-search-match w-editor-search-match--active'
                  : 'w-editor-search-match',
                'data-search-active': String(index === update.activeIndex),
                'data-search-match': '',
              },
            )))
          }
          return transaction.docChanged ? previous.map(transaction.mapping, transaction.doc) : previous
        },
      },
    })]
  },
})

const CODE_HIGHLIGHT_PLUGIN_KEY = new PluginKey<DecorationSet>('wEditorCodeHighlight')
const CODE_FOLD_STATE = new WeakMap<object, Map<string, boolean>>()
function normalizedCodeLanguage(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function codeLanguageClass(language: string): string {
  const normalized = language.toLowerCase().replace(/[^a-z0-9_-]+/gu, '-')
  return `language-${normalized.length > 0 ? normalized : 'text'}`
}

function highlightedCodeDecorations(documentNode: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = []
  documentNode.descendants((node, position) => {
    if (node.type.name !== 'codeBlock') return true
    const source = node.textContent
    const language = normalizedCodeLanguage(node.attrs['language'])
    for (const token of highlightCodeTokens(source, language)) {
      decorations.push(Decoration.inline(
        position + 1 + token.from,
        position + 1 + token.to,
        { class: token.className, 'data-code-token': token.token },
      ))
    }
    return false
  })
  return DecorationSet.create(documentNode, decorations)
}

export const VisualCodeBlock = Node.create<SemanticBlockOptions>({
  name: 'codeBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  selectable: true,
  addOptions: () => ({
    localization: createUiLocalizationStore('en'),
    mountChart: null,
    onCopy: null,
    onEdit: null,
    renderMermaid: null,
  }),
  addAttributes: () => ({
    language: {
      default: '',
      parseHTML: (element) => element.querySelector('code')?.className.match(/(?:^|\s)language-([^\s]+)/u)?.[1] ?? '',
      renderHTML: () => ({}),
    },
    localError: {
      default: null,
      renderHTML: () => ({}),
    },
  }),
  parseHTML: () => [{ tag: 'pre', preserveWhitespace: 'full' as const }],
  renderHTML: ({ node }) => [
    'pre',
    { 'data-w-editor-node': 'code-block' },
    ['code', { class: codeLanguageClass(normalizedCodeLanguage(node.attrs['language'])), 'data-highlighted': 'true' }, 0],
  ],
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: CODE_HIGHLIGHT_PLUGIN_KEY,
      state: {
        init: (_, state) => highlightedCodeDecorations(state.doc),
        apply: (transaction, previous) => transaction.docChanged
          ? highlightedCodeDecorations(transaction.doc)
          : previous.map(transaction.mapping, transaction.doc),
      },
      props: {
        decorations: (state) => CODE_HIGHLIGHT_PLUGIN_KEY.getState(state) ?? null,
      },
    })]
  },
  addNodeView() {
    const localization = this.options.localization
    const onCopy = this.options.onCopy
    const onEdit = this.options.onEdit
    return ({ editor, getPos, node }) => {
      let currentNode = node
      const foldKey = String(node.attrs['projectionId'] ?? getPos())
      const editorFoldState = CODE_FOLD_STATE.get(editor) ?? new Map<string, boolean>()
      CODE_FOLD_STATE.set(editor, editorFoldState)
      let folded = editorFoldState.get(foldKey) ?? currentNode.textContent.split('\n').length > 12
      let copied = false
      const dom = document.createElement('figure')
      dom.className = 'visual-code-block ordinary-block'
      dom.dataset['wEditorNode'] = 'code-block'

      const toolbar = document.createElement('div')
      toolbar.className = 'visual-code-block__toolbar'
      toolbar.dataset['codeActions'] = 'true'
      toolbar.setAttribute('contenteditable', 'false')
      toolbar.setAttribute('role', 'toolbar')

      const language = document.createElement('select')
      language.dataset['codeAction'] = 'language'
      language.dataset['codeActions'] = 'true'
      language.className = 'visual-code-block__language'

      const copy = document.createElement('button')
      copy.type = 'button'
      copy.dataset['codeAction'] = 'copy'
      copy.dataset['semanticCopy'] = 'code-block'
      copy.dataset['wEditorAction'] = 'copy-code'

      const advanced = document.createElement('button')
      advanced.type = 'button'
      advanced.dataset['codeAction'] = 'advanced'
      advanced.dataset['semanticEdit'] = 'code-block-editor'
      advanced.dataset['wEditorAction'] = 'edit-code'

      const fold = document.createElement('button')
      fold.type = 'button'
      fold.dataset['codeAction'] = 'fold'

      const expand = document.createElement('button')
      expand.type = 'button'
      expand.dataset['codeAction'] = 'expand'
      expand.className = 'visual-code-block__expand'

      const actionIcon = (className: string): HTMLSpanElement => {
        const icon = document.createElement('span')
        icon.className = `ch-icon ${className} visual-code-block__action-icon`
        icon.setAttribute('aria-hidden', 'true')
        return icon
      }
      copy.append(actionIcon('ch-icon-copy'))
      advanced.append(actionIcon('ch-icon-edit'))
      fold.append(actionIcon('ch-icon-unExpand'))
      expand.append(actionIcon('ch-icon-expand'))

      const pre = document.createElement('pre')
      const contentDOM = document.createElement('code')
      contentDOM.dataset['highlighted'] = 'true'
      pre.append(contentDOM)

      const fade = document.createElement('div')
      fade.className = 'visual-code-block__fade'
      fade.dataset['codeFade'] = 'true'
      fade.setAttribute('aria-hidden', 'true')

      const frame = document.createElement('div')
      frame.className = 'visual-code-block__frame'

      const error = document.createElement('p')
      error.className = 'semantic-node-view__error'
      error.setAttribute('contenteditable', 'false')
      error.setAttribute('role', 'alert')
      error.hidden = true

      const renderState = (): void => {
        const lineCount = currentNode.textContent.split('\n').length
        const canFold = lineCount > 12
        const storedFoldState = editorFoldState.get(foldKey)
        folded = canFold ? storedFoldState ?? true : false
        const currentLanguage = normalizedCodeLanguage(currentNode.attrs['language'])
        const choices = codeLanguageOptions(currentLanguage)
        language.replaceChildren(...choices.map((choice) => {
          const option = document.createElement('option')
          option.value = choice.value
          option.textContent = choice.label
          return option
        }))
        language.value = currentLanguage
        contentDOM.className = codeLanguageClass(currentLanguage)
        dom.dataset['codeLines'] = String(lineCount)
        dom.dataset['folded'] = String(folded)
        fade.hidden = !folded
        expand.hidden = !folded
        fold.hidden = !canFold || folded
        fold.setAttribute('aria-expanded', String(!folded))
        expand.setAttribute('aria-expanded', String(!folded))
        const localError = currentNode.attrs['localError']
        const hasError = typeof localError === 'string' && localError.length > 0
        dom.dataset['previewState'] = hasError ? 'error' : 'ready'
        error.hidden = !hasError
        error.textContent = hasError ? localError : ''
      }

      const renderCopy = (): void => {
        dom.setAttribute('aria-label', localization.t('codeNode.editable'))
        toolbar.setAttribute('aria-label', localization.t('codeNode.actions'))
        language.setAttribute('aria-label', localization.t('codeNode.changeLanguage'))
        const plainText = language.querySelector<HTMLOptionElement>('option[value=""]')
        if (plainText !== null) plainText.textContent = localization.t('codeNode.plainText')
        copy.setAttribute('aria-label', localization.t('codeNode.copyCode'))
        copy.setAttribute('title', localization.t(copied ? 'codeNode.copied' : 'codeNode.copyCode'))
        advanced.setAttribute('aria-label', localization.t('codeNode.editCode'))
        advanced.setAttribute('title', localization.t('codeNode.editCode'))
        fold.setAttribute('aria-label', localization.t('codeNode.foldCode'))
        fold.setAttribute('title', localization.t('codeNode.foldCode'))
        expand.setAttribute('aria-label', localization.t('codeNode.expandCode'))
        expand.setAttribute('title', localization.t('codeNode.expandCode'))
        error.setAttribute('aria-label', localization.t('codeNode.previewError'))
      }

      const preserveSelection = (event: Event): void => event.preventDefault()
      const copyCode = (event: MouseEvent): void => {
        event.preventDefault()
        event.stopPropagation()
        const currentLanguage = normalizedCodeLanguage(currentNode.attrs['language'])
        onCopy?.(Object.freeze({
          code: currentNode.textContent,
          language: currentLanguage,
          source: serializeFencedCode(currentLanguage, currentNode.textContent),
        }))
        copied = true
        renderCopy()
      }
      const editCode = (event: MouseEvent): void => {
        event.preventDefault()
        event.stopPropagation()
        const position = getPos()
        if (typeof position === 'number') {
          const selection = editor.state.selection
          if (selection.from < position + 1 || selection.to > position + currentNode.nodeSize - 1) {
            editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, position + 1)))
          }
        }
        const currentLanguage = normalizedCodeLanguage(currentNode.attrs['language'])
        onEdit?.(Object.freeze({
          code: currentNode.textContent,
          editorId: 'code-block-editor',
          kind: 'code-block',
          language: currentLanguage,
          layoutKind: null,
          source: serializeFencedCode(currentLanguage, currentNode.textContent),
        }))
      }
      const changeLanguage = (): void => {
        const position = getPos()
        if (typeof position !== 'number') return
        editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, {
          ...currentNode.attrs,
          language: language.value,
          localError: null,
        }))
        editor.view.focus()
      }
      const toggleFold = (event: MouseEvent): void => {
        event.preventDefault()
        event.stopPropagation()
        folded = !folded
        editorFoldState.set(foldKey, folded)
        renderState()
        renderCopy()
      }

      const removeEvents = [
        listenNodeViewEvent(copy, 'mousedown', preserveSelection),
        listenNodeViewEvent(copy, 'click', copyCode),
        listenNodeViewEvent(advanced, 'mousedown', preserveSelection),
        listenNodeViewEvent(advanced, 'click', editCode),
        listenNodeViewEvent(language, 'change', changeLanguage),
        listenNodeViewEvent(fold, 'mousedown', preserveSelection),
        listenNodeViewEvent(fold, 'click', toggleFold),
        listenNodeViewEvent(expand, 'mousedown', preserveSelection),
        listenNodeViewEvent(expand, 'click', toggleFold),
      ]

      toolbar.append(copy, advanced, fold)
      frame.append(toolbar, pre, fade, expand)
      dom.append(language, frame, error)
      renderState()
      const unsubscribeLocalization = bindLocalizedNodeView(localization, renderCopy)
      return {
        contentDOM,
        dom,
        destroy: () => {
          unsubscribeLocalization()
          for (const removeEvent of removeEvents) removeEvent()
        },
        ignoreMutation: (mutation: ViewMutationRecord) => !contentDOM.contains(mutation.target),
        stopEvent: (event: Event) => event.target instanceof Element && event.target.closest('[data-code-actions]') !== null,
        update: (updatedNode: ProseMirrorNode) => {
          if (updatedNode.type !== currentNode.type) return false
          currentNode = updatedNode
          copied = false
          renderState()
          renderCopy()
          return true
        },
      }
    }
  },
})

function localizedMediaKind(localization: UiLocalizationStore, kind: unknown): string {
  if (kind === 'audio') return localization.t('media.kind.audio')
  if (kind === 'video') return localization.t('media.kind.video')
  return localization.t('media.kind.image')
}

function localizedAttachmentKind(localization: UiLocalizationStore, kind: unknown): string {
  if (kind === 'pdf') return localization.t('semanticNode.attachment.pdf')
  if (kind === 'word') return localization.t('semanticNode.attachment.word')
  return localization.t('semanticNode.attachment.file')
}

function semanticIdentity(localization: UiLocalizationStore, node: ProseMirrorNode): string {
  const kind = String(node.attrs['kind'] ?? 'Content')
  const name = String(node.attrs['name'] ?? '')
  if (kind === 'media') {
    return localization.t('semanticNode.mediaIdentity', {
      kind: localizedMediaKind(localization, node.attrs['mediaKind']),
      name,
    })
  }
  if (kind === 'attachment') {
    return localization.t('semanticNode.attachmentIdentity', {
      kind: localizedAttachmentKind(localization, node.attrs['attachmentKind']),
      name,
    })
  }
  if (kind === 'drawio') return localization.t('semanticNode.drawioIdentity', { name })
  if (kind === 'timeline') return localization.t('semanticNode.timeline')
  if (kind === 'disclosure') {
    return localization.t(node.attrs['layoutKind'] === 'tabs' ? 'semanticNode.tabs' : 'semanticNode.accordion')
  }
  if (kind === 'column-layout') {
    return localization.t(
      node.attrs['layoutKind'] === 'two-column'
        ? 'semanticNode.twoColumnLayout'
        : 'semanticNode.multiColumnLayout',
    )
  }
  if (kind === 'panel') {
    const variant = node.attrs['variant']
    if (variant === 'info') return localization.t('semanticNode.panel.info')
    if (variant === 'success') return localization.t('semanticNode.panel.success')
    if (variant === 'warning') return localization.t('semanticNode.panel.warning')
    if (variant === 'danger') return localization.t('semanticNode.panel.danger')
    return localization.t('semanticNode.panel.primary')
  }
  if (kind === 'chart-table') {
    const chartType = node.attrs['chartType']
    return CHART_TABLE_DESCRIPTORS.find((descriptor) => descriptor.chartType === chartType)
      ?.labels[localization.locale]
      ?? localization.t('semanticNode.chartTitle', { type: String(chartType ?? '') })
  }
  if (kind === 'mermaid') {
    const diagramType = String(node.attrs['diagramType'] ?? '')
    return diagramType.length > 0
      ? localization.t('semanticNode.mermaidIdentity', { type: diagramType })
      : localization.t('semanticNode.mermaidDiagram')
  }
  const declared = node.attrs['identity']
  if (typeof declared === 'string' && declared.length > 0) return declared
  const detail = node.attrs['variant'] ?? node.attrs['layoutKind']
  if (typeof detail === 'string' && detail.length > 0) return `${kind}: ${detail}`
  return kind === 'unknown' ? localization.t('semanticNode.content') : kind
}

function createSemanticNodeEditEvent(node: ProseMirrorNode, editorId: string): SemanticNodeEditEvent {
  const variant = node.attrs['variant']
  return Object.freeze({
    ...(node.attrs['kind'] === 'code-block'
      ? { code: String(node.attrs['code'] ?? ''), language: String(node.attrs['language'] ?? '') }
      : {}),
    ...(node.attrs['kind'] === 'mermaid'
      ? {
          code: String(node.attrs['code'] ?? ''),
          ...(typeof node.attrs['diagramType'] === 'string'
            ? { diagramType: node.attrs['diagramType'] as string }
            : {}),
        }
      : {}),
    ...(node.attrs['kind'] === 'chart-table'
      ? {
          chartType: String(node.attrs['chartType'] ?? ''),
          columns: Array.isArray(node.attrs['columns'])
            ? node.attrs['columns'] as readonly string[]
            : Object.freeze([]),
          options: typeof node.attrs['options'] === 'object' && node.attrs['options'] !== null
            ? node.attrs['options'] as Readonly<Record<string, unknown>>
            : Object.freeze({}),
          rows: Array.isArray(node.attrs['rows'])
            ? node.attrs['rows'] as readonly (readonly string[])[]
            : Object.freeze([]),
          title: String(node.attrs['title'] ?? ''),
        }
      : {}),
    ...(node.attrs['kind'] === 'media'
      ? {
          mediaKind: String(node.attrs['mediaKind'] ?? ''),
          name: String(node.attrs['name'] ?? ''),
          url: String(node.attrs['url'] ?? ''),
        }
      : {}),
    ...(node.attrs['kind'] === 'attachment'
      ? {
          attachmentKind: String(node.attrs['attachmentKind'] ?? ''),
          mediaType: String(node.attrs['mediaType'] ?? ''),
          name: String(node.attrs['name'] ?? ''),
          size: Number(node.attrs['size'] ?? 0),
          url: String(node.attrs['url'] ?? ''),
        }
      : {}),
    ...(node.attrs['kind'] === 'drawio'
      ? {
          name: String(node.attrs['name'] ?? ''),
          png: String(node.attrs['png'] ?? ''),
          xml: String(node.attrs['xml'] ?? ''),
        }
      : {}),
    editorId,
    kind: String(node.attrs['kind'] ?? 'unknown'),
    layoutKind: typeof node.attrs['layoutKind'] === 'string' ? node.attrs['layoutKind'] : null,
    source: String(node.attrs['source'] ?? ''),
    ...(typeof variant === 'string' ? { variant } : {}),
  })
}

function installSemanticPresentationInteractions(root: HTMLElement): () => void {
  const removeEvents: Array<() => void> = []
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[data-semantic-presentation="tab"]')]
  const panels = [...root.querySelectorAll<HTMLElement>('[data-semantic-presentation="tabpanel"]')]
  const activateTab = (index: number, focus: boolean): void => {
    tabs.forEach((tab, tabIndex) => {
      const active = tabIndex === index
      tab.setAttribute('aria-selected', String(active))
      tab.tabIndex = active ? 0 : -1
      if (active && focus) tab.focus()
    })
    panels.forEach((panel, panelIndex) => {
      panel.hidden = panelIndex !== index
    })
  }
  tabs.forEach((tab, index) => {
    removeEvents.push(listenNodeViewEvent(tab, 'click', (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      activateTab(index, false)
    }))
    removeEvents.push(listenNodeViewEvent(tab, 'keydown', (event: KeyboardEvent) => {
      let next: number | null = null
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length
      if (event.key === 'Home') next = 0
      if (event.key === 'End') next = tabs.length - 1
      if (next === null) return
      event.preventDefault()
      event.stopPropagation()
      activateTab(next, true)
    }))
  })

  for (const toggle of root.querySelectorAll<HTMLButtonElement>('[data-semantic-presentation="accordion-toggle"]')) {
    const panelId = toggle.getAttribute('aria-controls')
    const panel = panelId === null ? null : root.querySelector<HTMLElement>(`#${CSS.escape(panelId)}`)
    if (panel === null) continue
    removeEvents.push(listenNodeViewEvent(toggle, 'click', (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const expanded = toggle.getAttribute('aria-expanded') !== 'true'
      toggle.setAttribute('aria-expanded', String(expanded))
      panel.hidden = !expanded
    }))
  }
  return () => {
    for (const removeEvent of removeEvents) removeEvent()
  }
}

export const SemanticBlock = Node.create<SemanticBlockOptions>({
  name: 'semanticBlock',
  group: 'block',
  atom: true,
  isolating: true,
  selectable: true,
  addOptions: () => ({
    localization: createUiLocalizationStore('en'),
    mountChart: null,
    onCopy: null,
    onEdit: null,
    renderMermaid: null,
  }),
  addAttributes: () => ({
    ...rawAttributes(),
    attachmentKind: {
      default: null,
      renderHTML: (attributes) => attributes['attachmentKind'] === null
        ? {}
        : { 'data-attachment-kind': attributes['attachmentKind'] },
    },
    body: {
      default: '',
      renderHTML: () => ({}),
    },
    code: {
      default: '',
      renderHTML: () => ({}),
    },
    chartType: {
      default: null,
      renderHTML: (attributes) => attributes['chartType'] === null
        ? {}
        : { 'data-chart-type': attributes['chartType'] },
    },
    columns: {
      default: Object.freeze([]),
      renderHTML: () => ({}),
    },
    diagramType: {
      default: null,
      renderHTML: (attributes) => attributes['diagramType'] === null
        ? {}
        : { 'data-mermaid-type': attributes['diagramType'] },
    },
    kind: {
      default: 'unknown',
      renderHTML: (attributes) => ({ 'data-semantic-kind': attributes['kind'] }),
    },
    editorId: {
      default: null,
      renderHTML: (attributes) => attributes['editorId'] === null
        ? {}
        : { 'data-semantic-editor': attributes['editorId'] },
    },
    identity: {
      default: '',
      renderHTML: (attributes) => ({ 'data-semantic-identity': attributes['identity'] }),
    },
    items: {
      default: Object.freeze([]),
      renderHTML: () => ({}),
    },
    layoutKind: {
      default: null,
      renderHTML: () => ({}),
    },
    localError: {
      default: null,
      renderHTML: () => ({}),
    },
    language: {
      default: '',
      renderHTML: (attributes) => ({ 'data-code-language': attributes['language'] }),
    },
    mediaKind: {
      default: null,
      renderHTML: (attributes) => attributes['mediaKind'] === null
        ? {}
        : { 'data-media-kind': attributes['mediaKind'] },
    },
    mediaType: {
      default: '',
      renderHTML: () => ({}),
    },
    name: {
      default: '',
      renderHTML: () => ({}),
    },
    previewRole: {
      default: null,
      renderHTML: (attributes) => attributes['previewRole'] === null
        ? {}
        : { role: attributes['previewRole'] },
    },
    png: {
      default: '',
      renderHTML: () => ({}),
    },
    title: {
      default: '',
      renderHTML: () => ({}),
    },
    url: {
      default: '',
      renderHTML: () => ({}),
    },
    variant: {
      default: null,
      renderHTML: (attributes) => attributes['variant'] === null
        ? {}
        : { 'data-semantic-variant': attributes['variant'] },
    },
    xml: {
      default: '',
      renderHTML: () => ({}),
    },
    options: {
      default: Object.freeze({}),
      renderHTML: () => ({}),
    },
    rows: {
      default: Object.freeze([]),
      renderHTML: () => ({}),
    },
    size: {
      default: 0,
      renderHTML: () => ({}),
    },
  }),
  parseHTML: () => [{ tag: 'figure[data-w-editor-node="semantic-block"]' }],
  addProseMirrorPlugins() {
    const nodeTypeName = this.name
    const onEdit = this.options.onEdit
    return [new Plugin({
      props: {
        handleDoubleClickOn: (view, _position, node, nodePosition, event) => {
          if (node.type.name !== nodeTypeName || node.attrs['kind'] !== 'chart-table') return false
          if (event.target instanceof Element && event.target.closest('.complex-node__controls') !== null) return false
          const editorId = node.attrs['editorId']
          if (typeof editorId !== 'string' || editorId.length === 0) return false
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePosition)))
          onEdit?.(createSemanticNodeEditEvent(node, editorId))
          return true
        },
      },
    })]
  },
  addNodeView() {
    const localization = this.options.localization
    const mountChart = this.options.mountChart
    const onCopy = this.options.onCopy
    const onEdit = this.options.onEdit
    const renderMermaid = this.options.renderMermaid
    return ({ editor, getPos, node }) => {
      let currentNode = node
      const render = (renderNode: ProseMirrorNode): Readonly<{ cleanup: () => void; dom: HTMLElement }> => {
        const removeEvents: Array<() => void> = []
        const toDOM = renderNode.type.spec.toDOM
        if (toDOM === undefined) throw new TypeError('Semantic block is missing its DOM renderer.')
        const rendered = DOMSerializer.renderSpec(document, toDOM(renderNode)).dom
        if (!(rendered instanceof HTMLElement)) throw new TypeError('Semantic block renderer must create an HTMLElement.')
        rendered.classList.add('complex-node', 'semantic-node-view')
        rendered.dataset['selected'] = 'false'
        rendered.setAttribute('contenteditable', 'false')
        rendered.setAttribute('aria-label', semanticIdentity(localization, renderNode))

        const preview = document.createElement('div')
        preview.className = 'semantic-node-view__preview'
        while (rendered.firstChild !== null) preview.append(rendered.firstChild)

        const header = document.createElement('header')
        header.className = 'semantic-node-view__header'
        const identity = document.createElement('span')
        identity.className = 'semantic-node-view__identity'
        identity.textContent = semanticIdentity(localization, renderNode)
        header.append(identity)

        const editorId = renderNode.attrs['editorId']
        if (typeof editorId === 'string' && editorId.length > 0) {
          const controls = document.createElement('div')
          controls.className = 'complex-node__controls'
          if (renderNode.attrs['kind'] === 'code-block') {
            const copy = document.createElement('button')
            copy.type = 'button'
            copy.dataset['semanticCopy'] = 'code-block'
            copy.dataset['wEditorAction'] = 'copy-code'
            removeEvents.push(listenNodeViewEvent(copy, 'mousedown', (event: MouseEvent) => event.preventDefault()))
            removeEvents.push(listenNodeViewEvent(copy, 'click', (event: MouseEvent) => {
              event.preventDefault()
              event.stopPropagation()
              onCopy?.(Object.freeze({
                code: String(currentNode.attrs['code'] ?? ''),
                language: String(currentNode.attrs['language'] ?? ''),
                source: String(currentNode.attrs['source'] ?? ''),
              }))
            }))
            controls.append(copy)
          }
          const openEditor = (): void => {
            const position = getPos()
            if (typeof position === 'number') {
              editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, position)))
            }
            onEdit?.(createSemanticNodeEditEvent(currentNode, editorId))
          }
          const edit = document.createElement('button')
          edit.type = 'button'
          edit.dataset['semanticEdit'] = editorId
          if (renderNode.attrs['kind'] === 'code-block') edit.dataset['wEditorAction'] = 'edit-code'
          removeEvents.push(listenNodeViewEvent(edit, 'mousedown', (event: MouseEvent) => event.preventDefault()))
          removeEvents.push(listenNodeViewEvent(edit, 'click', (event: MouseEvent) => {
            event.preventDefault()
            event.stopPropagation()
            openEditor()
          }))
          controls.append(edit)
          header.append(controls)
        }

        const localError = renderNode.attrs['localError']
        rendered.append(header)
        if (typeof localError === 'string' && localError.length > 0) {
          rendered.dataset['previewState'] = 'error'
          preview.hidden = true
          const error = document.createElement('p')
          error.className = 'semantic-node-view__error'
          error.setAttribute('role', 'alert')
          error.textContent = localError
          rendered.append(error)
        } else {
          rendered.dataset['previewState'] = 'ready'
        }
        rendered.append(preview)
        if (renderNode.attrs['kind'] === 'media'
          && !(typeof localError === 'string' && localError.length > 0)) {
          const media = preview.querySelector<HTMLElement>('.semantic-preview__media-element')
          const fallback = preview.querySelector<HTMLElement>('.semantic-preview__media-fallback')
          if (media !== null && fallback !== null) {
            const failed = (): void => {
              rendered.dataset['previewState'] = 'error'
              media.hidden = true
              fallback.hidden = false
            }
            const loaded = (): void => {
              rendered.dataset['previewState'] = 'ready'
              media.hidden = false
              fallback.hidden = true
            }
            removeEvents.push(listenNodeViewEvent(media, 'error', failed))
            removeEvents.push(listenNodeViewEvent(
              media,
              media instanceof HTMLImageElement ? 'load' : 'loadeddata',
              loaded,
            ))
          }
        }
        if (renderNode.attrs['kind'] === 'mermaid'
          && !(typeof localError === 'string' && localError.length > 0)
          && renderMermaid !== null) {
          const target = preview.querySelector<HTMLElement>('.semantic-preview__mermaid-rendered')
          if (target !== null) {
            rendered.dataset['previewState'] = 'loading'
            target.setAttribute('aria-busy', 'true')
            void renderMermaid(String(renderNode.attrs['code'] ?? '')).then((svg) => {
              if (!target.isConnected) return
              target.innerHTML = svg
              target.setAttribute('aria-busy', 'false')
              const owner = target.closest<HTMLElement>('.semantic-node-view')
              if (owner !== null) owner.dataset['previewState'] = 'ready'
            }).catch((error: unknown) => {
              if (!target.isConnected) return
              target.setAttribute('aria-busy', 'false')
              const owner = target.closest<HTMLElement>('.semantic-node-view')
              if (owner === null) return
              owner.dataset['previewState'] = 'error'
              const externalMessage = error instanceof Error && error.message.length > 0
                ? error.message
                : null
              const alert = document.createElement('p')
              alert.className = 'semantic-node-view__error'
              alert.dataset['mermaidPreviewError'] = ''
              if (externalMessage !== null) alert.dataset['mermaidPreviewMessage'] = externalMessage
              alert.setAttribute('role', 'alert')
              alert.textContent = localization.t('semanticNode.mermaidPreviewFailed', {
                message: externalMessage ?? localization.t('semanticNode.unknownMermaidError'),
              })
              owner.append(alert)
            })
          }
        }
        if (renderNode.attrs['kind'] === 'chart-table'
          && !(typeof localError === 'string' && localError.length > 0)
          && mountChart !== null) {
          const target = preview.querySelector<HTMLElement>('.semantic-preview__chart-rendered')
          if (target !== null) {
            rendered.dataset['previewState'] = 'loading'
            target.setAttribute('aria-busy', 'true')
            try {
              removeEvents.push(mountChart(target, String(renderNode.attrs['source'] ?? '')))
              target.setAttribute('aria-busy', 'false')
              rendered.dataset['previewState'] = 'ready'
            } catch (error: unknown) {
              target.setAttribute('aria-busy', 'false')
              rendered.dataset['previewState'] = 'error'
              const externalMessage = error instanceof Error && error.message.length > 0
                ? error.message
                : null
              const alert = document.createElement('p')
              alert.className = 'semantic-node-view__error'
              alert.dataset['chartPreviewError'] = ''
              if (externalMessage !== null) alert.dataset['chartPreviewMessage'] = externalMessage
              alert.setAttribute('role', 'alert')
              alert.textContent = localization.t('semanticNode.chartPreviewFailed', {
                message: externalMessage ?? localization.t('semanticNode.unknownChartError'),
              })
              rendered.append(alert)
            }
          }
        }
        const removePresentationEvents = installSemanticPresentationInteractions(rendered)
        return Object.freeze({
          cleanup: () => {
            removePresentationEvents()
            for (const removeEvent of removeEvents) removeEvent()
          },
          dom: rendered,
        })
      }

      const initialRender = render(currentNode)
      const dom = initialRender.dom
      let cleanupRenderEvents = initialRender.cleanup
      const renderCopy = (): void => {
        const label = semanticIdentity(localization, currentNode)
        dom.setAttribute('aria-label', label)
        const identity = dom.querySelector<HTMLElement>('.semantic-node-view__identity')
        if (identity !== null) identity.textContent = label
        const copy = dom.querySelector<HTMLButtonElement>('[data-semantic-copy]')
        if (copy !== null) {
          copy.textContent = localization.t('semanticNode.copySource')
          copy.setAttribute('aria-label', localization.t('semanticNode.copySource'))
        }
        const edit = dom.querySelector<HTMLButtonElement>('[data-semantic-edit]')
        if (edit !== null) {
          const isChart = currentNode.attrs['kind'] === 'chart-table'
          const editLabel = isChart
            ? CHART_TABLE_DESCRIPTORS.find((descriptor) => descriptor.chartType === currentNode.attrs['chartType'])
              ?.labels[localization.locale] ?? label
            : label
          edit.textContent = localization.t(isChart ? 'semanticNode.editChart' : 'semanticNode.editSource')
          edit.setAttribute('aria-label', localization.t(
            isChart ? 'semanticNode.editChartLabel' : 'semanticNode.editSourceLabel',
            { label: editLabel },
          ))
        }
        const semanticError = dom.querySelector<HTMLElement>('.semantic-node-view__error:not([data-mermaid-preview-error])')
        semanticError?.setAttribute('aria-label', localization.t('semanticNode.previewUnavailable', { kind: label }))
        const mermaidError = dom.querySelector<HTMLElement>('[data-mermaid-preview-error]')
        if (mermaidError !== null) {
          mermaidError.textContent = localization.t('semanticNode.mermaidPreviewFailed', {
            message: mermaidError.dataset['mermaidPreviewMessage'] ?? localization.t('semanticNode.unknownMermaidError'),
          })
        }
        const chartError = dom.querySelector<HTMLElement>('[data-chart-preview-error]')
        if (chartError !== null) {
          chartError.textContent = localization.t('semanticNode.chartPreviewFailed', {
            message: chartError.dataset['chartPreviewMessage'] ?? localization.t('semanticNode.unknownChartError'),
          })
        }
        if (currentNode.attrs['kind'] === 'media') {
          const kind = localizedMediaKind(localization, currentNode.attrs['mediaKind'])
          const fallback = dom.querySelector<HTMLElement>('.semantic-preview__media-fallback strong')
          if (fallback !== null) fallback.textContent = localization.t('semanticNode.previewUnavailable', { kind })
          const nativeFallback = dom.querySelector<HTMLElement>('[data-semantic-native-media-fallback]')
          if (nativeFallback !== null) {
            nativeFallback.textContent = localization.t('semanticNode.browserCannotPreview', { kind })
          }
        }
        if (currentNode.attrs['kind'] === 'attachment') {
          const kind = localizedAttachmentKind(localization, currentNode.attrs['attachmentKind'])
          const type = dom.querySelector<HTMLElement>('.semantic-preview__attachment-type')
          if (type !== null) type.textContent = kind
          const metadata = dom.querySelector<HTMLElement>('.semantic-preview__attachment-metadata')
          if (metadata !== null) {
            const size = Number(currentNode.attrs['size'] ?? 0)
            metadata.textContent = `${String(currentNode.attrs['mediaType'] ?? '')} · ${size > 0
              ? localization.t('semanticNode.attachmentBytes', { size })
              : localization.t('semanticNode.attachmentSizeUnknown')}`
          }
          const link = dom.querySelector<HTMLAnchorElement>('[data-semantic-attachment-link]')
          if (link !== null) {
            link.textContent = localization.t('semanticNode.openAttachment', {
              name: String(currentNode.attrs['name'] ?? ''),
            })
          }
        }
        if (currentNode.attrs['kind'] === 'code-block'
          && normalizedCodeLanguage(currentNode.attrs['language']).length === 0) {
          const title = dom.querySelector<HTMLElement>('.semantic-preview__title')
          if (title !== null) title.textContent = localization.t('codeNode.plainText')
        }
        if (currentNode.attrs['kind'] === 'timeline'
          && String(currentNode.attrs['title'] ?? '').length === 0) {
          const title = localization.t('semanticNode.timeline')
          dom.querySelector<HTMLElement>('.cherry-timeline')?.setAttribute('aria-label', title)
          const header = dom.querySelector<HTMLElement>('.cherry-timeline--header')
          if (header !== null) header.textContent = title
        }
        if (currentNode.attrs['kind'] === 'disclosure' && currentNode.attrs['layoutKind'] === 'tabs') {
          const tabs = localization.t('semanticNode.tabs')
          const title = dom.querySelector<HTMLElement>('.semantic-preview__title')
          if (title !== null) title.textContent = tabs
          dom.querySelector<HTMLElement>('.semantic-preview__tab-list')?.setAttribute('aria-label', tabs)
        }
        if (currentNode.attrs['kind'] === 'column-layout') {
          const items = Array.isArray(currentNode.attrs['items']) ? currentNode.attrs['items'] as unknown[] : []
          if (String(currentNode.attrs['title'] ?? '').length === 0) {
            const columns = localization.t('semanticNode.columns')
            dom.setAttribute('aria-label', columns)
            const title = dom.querySelector<HTMLElement>('.semantic-preview__title')
            if (title !== null) title.textContent = columns
          }
          dom.querySelectorAll<HTMLElement>('.semantic-preview__column').forEach((column, index) => {
            column.setAttribute('aria-label', localization.t('semanticNode.columnRegion', {
              number: index + 1,
              total: items.length,
            }))
          })
        }
        if (currentNode.attrs['kind'] === 'chart-table') {
          const declaredTitle = String(currentNode.attrs['title'] ?? '')
          const title = declaredTitle.length > 0
            ? declaredTitle
            : localization.t('semanticNode.chartTitle', { type: String(currentNode.attrs['chartType'] ?? 'chart') })
          const previewTitle = dom.querySelector<HTMLElement>('.semantic-preview__title')
          if (previewTitle !== null) previewTitle.textContent = title
          dom.querySelector<HTMLElement>('.semantic-preview__chart-data')
            ?.setAttribute('aria-label', localization.t('semanticNode.chartData', { title }))
          const series = dom.querySelector<HTMLElement>('[data-semantic-series-heading]')
          if (series !== null) series.textContent = localization.t('semanticNode.series')
        }
        if (currentNode.attrs['kind'] === 'mermaid') {
          const diagramType = String(currentNode.attrs['diagramType'] ?? '')
          const title = diagramType.length > 0
            ? localization.t('semanticNode.mermaidIdentity', { type: diagramType })
            : localization.t('semanticNode.mermaidDiagram')
          const previewTitle = dom.querySelector<HTMLElement>('.semantic-preview__title')
          if (previewTitle !== null) previewTitle.textContent = title
        }
      }
      const unsubscribeLocalization = bindLocalizedNodeView(localization, renderCopy)
      return {
        dom,
        destroy: () => {
          unsubscribeLocalization()
          cleanupRenderEvents()
        },
        selectNode: () => {
          dom.dataset['selected'] = 'true'
          dom.classList.add('ProseMirror-selectednode')
        },
        deselectNode: () => {
          dom.dataset['selected'] = 'false'
          dom.classList.remove('ProseMirror-selectednode')
        },
        stopEvent: (event) => (
          event.target instanceof Element
          && event.target.closest('[data-semantic-edit], [data-semantic-copy], [data-semantic-media-control], [data-semantic-attachment-link], [data-semantic-presentation]') !== null
        ),
        update: (updatedNode) => {
          if (updatedNode.type !== currentNode.type) return false
          const selected = dom.dataset['selected'] === 'true'
          currentNode = updatedNode
          const replacement = render(updatedNode)
          cleanupRenderEvents()
          for (const attribute of [...dom.attributes]) dom.removeAttribute(attribute.name)
          for (const attribute of [...replacement.dom.attributes]) dom.setAttribute(attribute.name, attribute.value)
          dom.replaceChildren(...replacement.dom.childNodes)
          cleanupRenderEvents = replacement.cleanup
          if (selected) {
            dom.dataset['selected'] = 'true'
            dom.classList.add('ProseMirror-selectednode')
          }
          renderCopy()
          return true
        },
      }
    }
  },
  renderHTML({ HTMLAttributes, node }) {
    const localization = this.options.localization
    const kind = String(node.attrs['kind'] ?? 'unknown')
    if (kind === 'timeline') {
      const items = Array.isArray(node.attrs['items']) ? node.attrs['items'] as Array<Record<string, unknown>> : []
      const declaredTitle = String(node.attrs['title'] ?? '')
      const title = declaredTitle.length > 0 ? declaredTitle : localization.t('semanticNode.timeline')
      return [
        'figure',
        mergeAttributes(HTMLAttributes, {
          class: 'semantic-preview semantic-preview--timeline',
          'data-w-editor-node': 'semantic-block',
        }),
        ['div', { class: 'cherry theme__default semantic-preview__timeline-theme' },
          ['div', { class: 'cherry-markdown' },
            ['section', { class: 'cherry-timeline', 'aria-label': title },
              ['header', { class: 'cherry-timeline--header' }, title],
              ['div', { class: 'cherry-timeline--body', role: 'list' }, ...items.map((item) => {
                const status = String(item['status'] ?? 'todo')
                return ['article', {
                  class: `cherry-timeline--item cherry-timeline--item__${status}`,
                  'data-timeline-status': status,
                  role: 'listitem',
                },
                ['span', { 'aria-hidden': 'true', class: 'cherry-timeline--node' }],
                ['div', { class: 'cherry-timeline--content' },
                  ['time', { class: 'cherry-timeline--time' }, String(item['time'] ?? '')],
                  ['div', { class: 'cherry-timeline--title' }, String(item['title'] ?? '')],
                  ['div', { class: 'cherry-timeline--desc' }, String(item['body'] ?? '')],
                ]]
              })],
            ],
          ],
        ],
      ]
    }
    if (kind === 'disclosure') {
      const items = Array.isArray(node.attrs['items']) ? node.attrs['items'] as Array<Record<string, unknown>> : []
      const layoutKind = String(node.attrs['layoutKind'] ?? 'accordion')
      const presentationId = `semantic-${String(node.attrs['projectionId'] ?? 'disclosure').replace(/[^a-zA-Z0-9_-]/gu, '-')}`
      if (layoutKind === 'tabs') {
        return [
          'figure',
          mergeAttributes(HTMLAttributes, {
            class: 'semantic-preview semantic-preview--disclosure semantic-preview--tabs',
            'data-w-editor-node': 'semantic-block',
          }),
          ['figcaption', { class: 'semantic-preview__title' }, localization.t('semanticNode.tabs')],
          ['div', {
            'aria-label': localization.t('semanticNode.tabs'),
            class: 'semantic-preview__tab-list',
            role: 'tablist',
          }, ...items.map((item, index) => (
            ['button', {
              'aria-controls': `${presentationId}-panel-${index}`,
              'aria-selected': index === 0 ? 'true' : 'false',
              class: 'semantic-preview__tab',
              'data-semantic-presentation': 'tab',
              id: `${presentationId}-tab-${index}`,
              role: 'tab',
              tabindex: index === 0 ? '0' : '-1',
              type: 'button',
            }, String(item['label'] ?? '')]
          ))],
          ...items.map((item, index) => ['section', {
            'aria-labelledby': `${presentationId}-tab-${index}`,
            class: 'semantic-preview__tab-panel',
            'data-semantic-presentation': 'tabpanel',
            ...(index === 0 ? {} : { hidden: 'hidden' }),
            id: `${presentationId}-panel-${index}`,
            role: 'tabpanel',
          }, String(item['body'] ?? '')]),
        ]
      }
      const item = items[0]
      const panelId = `${presentationId}-panel`
      const toggleId = `${presentationId}-toggle`
      return [
        'figure',
        mergeAttributes(HTMLAttributes, {
          class: 'semantic-preview semantic-preview--disclosure semantic-preview--accordion',
          'data-w-editor-node': 'semantic-block',
        }),
        ['button', {
          'aria-controls': panelId,
          'aria-expanded': 'true',
          class: 'semantic-preview__accordion-toggle',
          'data-semantic-presentation': 'accordion-toggle',
          id: toggleId,
          type: 'button',
        },
        ['span', { 'aria-hidden': 'true', class: 'semantic-preview__accordion-caret' }],
        ['span', {}, String(item?.['label'] ?? '')],
        ],
        ['div', {
          'aria-labelledby': toggleId,
          class: 'semantic-preview__body semantic-preview__accordion-body',
          id: panelId,
          role: 'region',
        }, String(item?.['body'] ?? '')],
      ]
    }
    if (kind === 'column-layout') {
      const items = Array.isArray(node.attrs['items']) ? node.attrs['items'] as unknown[] : []
      const declaredTitle = String(node.attrs['title'] ?? '')
      const title = declaredTitle.length > 0 ? declaredTitle : localization.t('semanticNode.columns')
      return [
        'figure',
        mergeAttributes(HTMLAttributes, {
          'aria-label': title,
          class: `semantic-preview semantic-preview--column-layout semantic-preview--${String(node.attrs['layoutKind'] ?? 'multi-column')}`,
          'data-w-editor-node': 'semantic-block',
        }),
        ['figcaption', { class: 'semantic-preview__title' }, title],
        ['div', { class: 'semantic-preview__columns' }, ...items.map((item, index) => (
          ['section', {
            'aria-label': localization.t('semanticNode.columnRegion', { number: index + 1, total: items.length }),
            class: 'semantic-preview__column',
            'data-column-index': String(index),
            role: 'region',
          }, String(item)]
        ))],
      ]
    }
    if (kind === 'panel') {
      const variant = String(node.attrs['variant'] ?? 'primary')
      const icon = ({ danger: '×', info: 'i', primary: 'i', success: '✓', warning: '!' } as Record<string, string>)[variant] ?? 'i'
      return [
        'figure',
        mergeAttributes(HTMLAttributes, {
          class: `semantic-preview semantic-preview--panel semantic-preview--${variant}`,
          'data-w-editor-node': 'semantic-block',
        }),
        ['figcaption', { class: 'semantic-preview__panel-header' },
          ['span', { 'aria-hidden': 'true', class: 'semantic-preview__panel-icon' }, icon],
          ['span', { class: 'semantic-preview__title' }, String(node.attrs['title'] ?? '')],
        ],
        ['div', { class: 'semantic-preview__body' }, String(node.attrs['body'] ?? '')],
      ]
    }
    if (kind === 'code-block') {
      const language = String(node.attrs['language'] ?? '')
      return [
        'figure',
        mergeAttributes(HTMLAttributes, {
          class: 'semantic-preview semantic-preview--code',
          'data-w-editor-node': 'semantic-block',
        }),
        ['figcaption', { class: 'semantic-preview__title' }, language.length > 0 ? language : localization.t('codeNode.plainText')],
        ['pre', {}, ['code', { class: language.length > 0 ? `language-${language}` : 'language-text' }, String(node.attrs['code'] ?? '')]],
      ]
    }
    if (kind === 'chart-table') {
      const chartType = String(node.attrs['chartType'] ?? 'chart')
      const columns = Array.isArray(node.attrs['columns']) ? node.attrs['columns'] as unknown[] : []
      const rows = Array.isArray(node.attrs['rows']) ? node.attrs['rows'] as unknown[][] : []
      const declaredTitle = String(node.attrs['title'] ?? '')
      const title = declaredTitle.length > 0
        ? declaredTitle
        : localization.t('semanticNode.chartTitle', { type: chartType })
      return [
        'figure',
        mergeAttributes(HTMLAttributes, {
          class: 'semantic-preview semantic-preview--chart-table',
          'data-w-editor-node': 'semantic-block',
        }),
        ['figcaption', { class: 'semantic-preview__title visually-hidden' }, title],
        ['div', {
          'aria-busy': 'true',
          class: 'semantic-preview__chart-rendered',
          'data-chart-preview': chartType,
        }],
        ['table', {
          'aria-label': localization.t('semanticNode.chartData', { title }),
          class: 'semantic-preview__chart-data visually-hidden',
        },
          ['thead', {}, ['tr', {},
            ['th', { 'data-semantic-series-heading': '', scope: 'col' }, localization.t('semanticNode.series')],
            ...columns.map((column) => ['th', { scope: 'col' }, String(column)]),
          ]],
          ['tbody', {}, ...rows.map((row) => ['tr', {}, ...row.map((cell, index) => (
            [index === 0 ? 'th' : 'td', index === 0 ? { scope: 'row' } : {}, String(cell)]
          ))])],
        ],
      ]
    }
    if (kind === 'mermaid') {
      const diagramType = String(node.attrs['diagramType'] ?? '')
      const title = diagramType.length > 0
        ? localization.t('semanticNode.mermaidIdentity', { type: diagramType })
        : localization.t('semanticNode.mermaidDiagram')
      return [
        'figure',
        mergeAttributes(HTMLAttributes, {
          class: 'semantic-preview semantic-preview--mermaid',
          'data-w-editor-node': 'semantic-block',
        }),
        ['figcaption', { class: 'semantic-preview__title' }, title],
        ['div', {
          'aria-busy': 'true',
          class: 'semantic-preview__mermaid-rendered',
          'data-mermaid-preview': diagramType.length > 0 ? diagramType : 'diagram',
        }],
      ]
    }
    if (kind === 'drawio') {
      const name = String(node.attrs['name'] ?? 'draw.io diagram')
      return [
        'figure',
        mergeAttributes(HTMLAttributes, {
          class: 'semantic-preview semantic-preview--drawio',
          'data-w-editor-node': 'semantic-block',
        }),
        ['figcaption', { class: 'semantic-preview__title' }, name],
        ['img', {
          alt: name,
          class: 'semantic-preview__drawio-image',
          src: String(node.attrs['png'] ?? ''),
        }],
      ]
    }
    if (kind === 'media') {
      const mediaKind = String(node.attrs['mediaKind'] ?? 'image')
      const name = String(node.attrs['name'] ?? '')
      const url = String(node.attrs['url'] ?? '')
      const element = mediaKind === 'image'
        ? ['img', {
            alt: name,
            class: 'semantic-preview__media-element',
            'data-semantic-media-control': mediaKind,
            src: url,
          }]
        : [mediaKind, {
            class: 'semantic-preview__media-element',
            controls: 'controls',
            'data-semantic-media-control': mediaKind,
            preload: 'metadata',
            src: url,
          }, ['span', { 'data-semantic-native-media-fallback': '' }, localization.t(
            'semanticNode.browserCannotPreview',
            { kind: localizedMediaKind(localization, mediaKind) },
          )]]
      return [
        'figure',
        mergeAttributes(HTMLAttributes, {
          class: `semantic-preview semantic-preview--media semantic-preview--${mediaKind}`,
          'data-w-editor-node': 'semantic-block',
        }),
        ['figcaption', { class: 'semantic-preview__title' }, name],
        element,
        ['div', {
          class: 'semantic-preview__media-fallback',
          'data-media-fallback': mediaKind,
          hidden: 'hidden',
          role: 'status',
        },
        ['strong', {}, localization.t('semanticNode.previewUnavailable', {
          kind: localizedMediaKind(localization, mediaKind),
        })],
        ['span', { class: 'semantic-preview__media-url' }, url],
        ],
      ]
    }
    if (kind === 'attachment') {
      const attachmentKind = String(node.attrs['attachmentKind'] ?? 'file')
      const name = String(node.attrs['name'] ?? '')
      const mediaType = String(node.attrs['mediaType'] ?? 'application/octet-stream')
      const size = Number(node.attrs['size'] ?? 0)
      const url = String(node.attrs['url'] ?? '')
      const label = localizedAttachmentKind(localization, attachmentKind)
      return [
        'figure',
        mergeAttributes(HTMLAttributes, {
          class: `semantic-preview semantic-preview--attachment semantic-preview--attachment-${attachmentKind}`,
          'data-w-editor-node': 'semantic-block',
        }),
        ['div', { 'aria-hidden': 'true', class: 'semantic-preview__attachment-icon' }, attachmentKind === 'pdf' ? 'PDF' : attachmentKind === 'word' ? 'DOC' : 'FILE'],
        ['figcaption', { class: 'semantic-preview__attachment-copy' },
          ['strong', { class: 'semantic-preview__title' }, name],
          ['span', { class: 'semantic-preview__attachment-type' }, label],
          ['span', { class: 'semantic-preview__attachment-metadata' }, `${mediaType} · ${size > 0
            ? localization.t('semanticNode.attachmentBytes', { size })
            : localization.t('semanticNode.attachmentSizeUnknown')}`],
        ],
        ['a', {
          class: 'semantic-preview__attachment-link',
          'data-semantic-attachment-link': attachmentKind,
          href: url,
          rel: 'noopener noreferrer',
          target: '_blank',
        }, localization.t('semanticNode.openAttachment', { name })],
      ]
    }
    return [
      'figure',
      mergeAttributes(HTMLAttributes, { 'data-w-editor-node': 'semantic-block' }),
      ['figcaption', {}, kind],
    ]
  },
})

export const AlignmentBlock = Node.create({
  name: 'alignmentBlock',
  group: 'block',
  content: '(paragraph | heading)+',
  defining: true,
  addAttributes: () => ({
    ...projectionAttributes(),
    alignment: {
      default: 'left',
      parseHTML: (element) => element.getAttribute('data-alignment') ?? 'left',
      renderHTML: (attributes) => ({
        'data-alignment': attributes['alignment'],
        style: `text-align: ${String(attributes['alignment'] ?? 'left')}`,
      }),
    },
  }),
  parseHTML: () => [{ tag: 'div[data-w-editor-node="alignment-block"]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    mergeAttributes(HTMLAttributes, {
      class: 'alignment-block',
      'data-w-editor-node': 'alignment-block',
    }),
    0,
  ],
})

type OrdinaryTableAction =
  | 'add-column-after'
  | 'add-column-before'
  | 'add-row-after'
  | 'add-row-before'
  | 'align-column-center'
  | 'align-column-left'
  | 'align-column-right'
  | 'delete-column'
  | 'delete-row'
  | 'duplicate-column'
  | 'duplicate-row'
  | 'move-column-left'
  | 'move-column-right'
  | 'move-row-down'
  | 'move-row-up'
  | 'sort-column-ascending'
  | 'sort-column-descending'

function dispatchIsolatedTableTransaction(
  editor: NodeViewRendererProps['editor'],
  transaction: Transaction,
): void {
  editor.view.dispatch(closeHistory(transaction))
  editor.view.dispatch(closeHistory(editor.state.tr).setMeta('addToHistory', false))
}

function selectedTableCoordinates(editor: NodeViewRendererProps['editor']): Readonly<{
  cellIndex: number
  rowIndex: number
  tableDepth: number
  tablePosition: number
}> | null {
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name !== 'table') continue
    return Object.freeze({
      cellIndex: $from.index(depth + 1),
      rowIndex: $from.index(depth),
      tableDepth: depth,
      tablePosition: $from.before(depth),
    })
  }
  return null
}

function alignSelectedTableColumn(editor: NodeViewRendererProps['editor'], alignment: 'center' | 'left' | 'right'): boolean {
  const context = selectedTableCoordinates(editor)
  if (context === null) return false
  const table = editor.state.selection.$from.node(context.tableDepth)
  const transaction = editor.state.tr
  let rowPosition = context.tablePosition + 1
  for (let rowIndex = 0; rowIndex < table.childCount; rowIndex += 1) {
    const row = table.child(rowIndex)
    if (context.cellIndex >= row.childCount) return false
    let cellPosition = rowPosition + 1
    for (let columnIndex = 0; columnIndex < context.cellIndex; columnIndex += 1) {
      cellPosition += row.child(columnIndex).nodeSize
    }
    const cell = row.child(context.cellIndex)
    transaction.setNodeMarkup(cellPosition, undefined, { ...cell.attrs, align: alignment })
    rowPosition += row.nodeSize
  }
  dispatchIsolatedTableTransaction(editor, transaction)
  return true
}

function tableRows(table: ProseMirrorNode): ProseMirrorNode[] {
  const rows: ProseMirrorNode[] = []
  table.forEach((row) => rows.push(row))
  return rows
}

function tableCells(row: ProseMirrorNode): ProseMirrorNode[] {
  const cells: ProseMirrorNode[] = []
  row.forEach((cell) => cells.push(cell))
  return cells
}

function tableDelimiterMarkers(table: ProseMirrorNode): Array<string | null> {
  const stored = table.attrs['markdownDelimiters']
  const columnCount = table.firstChild?.childCount ?? 0
  return Array.from({ length: columnCount }, (_, index) => (
    Array.isArray(stored) && typeof stored[index] === 'string' ? stored[index] : null
  ))
}

function tableCellSelectionPosition(
  tablePosition: number,
  rows: readonly ProseMirrorNode[],
  rowIndex: number,
  cellIndex: number,
): number {
  let position = tablePosition + 1
  for (let index = 0; index < rowIndex; index += 1) position += rows[index]?.nodeSize ?? 0
  position += 1
  const row = rows[rowIndex]
  if (row !== undefined) {
    for (let index = 0; index < cellIndex; index += 1) position += row.child(index).nodeSize
  }
  return position + 1
}

function replaceOrdinaryTable(
  editor: NodeViewRendererProps['editor'],
  context: NonNullable<ReturnType<typeof selectedTableCoordinates>>,
  table: ProseMirrorNode,
  rows: readonly ProseMirrorNode[],
  rowIndex: number,
  cellIndex: number,
  tableAttrs: Readonly<Record<string, unknown>> = table.attrs,
): boolean {
  const nextTable = table.type.create(tableAttrs, rows)
  const transaction = editor.state.tr.replaceWith(
    context.tablePosition,
    context.tablePosition + table.nodeSize,
    nextTable,
  )
  const selectionPosition = Math.min(
    tableCellSelectionPosition(context.tablePosition, rows, rowIndex, cellIndex),
    transaction.doc.content.size,
  )
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(selectionPosition)))
  dispatchIsolatedTableTransaction(editor, transaction)
  return true
}

function emptyBodyRow(editor: NodeViewRendererProps['editor'], table: ProseMirrorNode): ProseMirrorNode | null {
  const paragraph = editor.schema.nodes['paragraph']
  const tableCell = editor.schema.nodes['tableCell']
  const tableRow = editor.schema.nodes['tableRow']
  if (paragraph === undefined || tableCell === undefined || tableRow === undefined) return null
  const columns = table.firstChild?.childCount ?? 0
  const cells = Array.from({ length: columns }, (_, columnIndex) => tableCell.create(
    { align: table.firstChild?.child(columnIndex).attrs['align'] ?? null },
    paragraph.create(),
  ))
  return tableRow.create(null, cells)
}

function emptyTableCell(
  editor: NodeViewRendererProps['editor'],
  header: boolean,
): ProseMirrorNode | null {
  const paragraph = editor.schema.nodes['paragraph']
  const type = editor.schema.nodes[header ? 'tableHeader' : 'tableCell']
  if (paragraph === undefined || type === undefined) return null
  return type.create({ align: 'left' }, paragraph.create())
}

function compareTableCell(left: ProseMirrorNode, right: ProseMirrorNode, columnIndex: number): number {
  const leftValue = left.child(columnIndex).textContent.trim()
  const rightValue = right.child(columnIndex).textContent.trim()
  const leftNumber = Number(leftValue)
  const rightNumber = Number(rightValue)
  if (leftValue.length > 0 && rightValue.length > 0 && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber
  }
  return leftValue.localeCompare(rightValue, 'en', { numeric: true, sensitivity: 'base' })
}

function canRunOrdinaryTableAction(
  table: ProseMirrorNode,
  context: NonNullable<ReturnType<typeof selectedTableCoordinates>>,
  action: OrdinaryTableAction,
): boolean {
  const columnCount = table.firstChild?.childCount ?? 0
  if (action === 'delete-row') return context.rowIndex > 0 && table.childCount > 2
  if (action === 'duplicate-row') return context.rowIndex > 0
  if (action === 'move-row-up') return context.rowIndex > 1
  if (action === 'move-row-down') return context.rowIndex > 0 && context.rowIndex < table.childCount - 1
  if (action === 'delete-column') return columnCount > 1
  if (action === 'move-column-left') return context.cellIndex > 0
  if (action === 'move-column-right') return context.cellIndex < columnCount - 1
  return true
}

function runOrdinaryTableAction(editor: NodeViewRendererProps['editor'], action: OrdinaryTableAction): boolean {
  const context = selectedTableCoordinates(editor)
  if (context === null) return false
  const table = editor.state.selection.$from.node(context.tableDepth)
  if (!canRunOrdinaryTableAction(table, context, action)) return false
  if (action.startsWith('align-column-')) {
    return alignSelectedTableColumn(editor, action.slice('align-column-'.length) as 'center' | 'left' | 'right')
  }

  const rows = tableRows(table)
  if (action === 'add-row-before' || action === 'add-row-after') {
    const row = emptyBodyRow(editor, table)
    if (row === null) return false
    const insertAt = action === 'add-row-before' ? context.rowIndex : context.rowIndex + 1
    rows.splice(insertAt, 0, row)
    return replaceOrdinaryTable(editor, context, table, rows, insertAt, context.cellIndex)
  }
  if (action === 'duplicate-row') {
    const row = rows[context.rowIndex]
    if (row === undefined) return false
    rows.splice(context.rowIndex + 1, 0, row)
    return replaceOrdinaryTable(editor, context, table, rows, context.rowIndex + 1, context.cellIndex)
  }
  if (action === 'move-row-up' || action === 'move-row-down') {
    const target = context.rowIndex + (action === 'move-row-up' ? -1 : 1)
    const [row] = rows.splice(context.rowIndex, 1)
    if (row === undefined) return false
    rows.splice(target, 0, row)
    return replaceOrdinaryTable(editor, context, table, rows, target, context.cellIndex)
  }
  if (action === 'delete-row') {
    rows.splice(context.rowIndex, 1)
    const target = Math.min(context.rowIndex, rows.length - 1)
    return replaceOrdinaryTable(editor, context, table, rows, target, context.cellIndex)
  }
  if (action === 'sort-column-ascending' || action === 'sort-column-descending') {
    const direction = action === 'sort-column-ascending' ? 1 : -1
    const body = rows.slice(1).map((row, index) => ({ index, row }))
    body.sort((left, right) => {
      const compared = compareTableCell(left.row, right.row, context.cellIndex) * direction
      return compared === 0 ? left.index - right.index : compared
    })
    const sorted = [rows[0], ...body.map(({ row }) => row)].filter((row): row is ProseMirrorNode => row !== undefined)
    return replaceOrdinaryTable(editor, context, table, sorted, Math.min(context.rowIndex, sorted.length - 1), context.cellIndex)
  }

  const columnDelta = action === 'move-column-left' ? -1 : action === 'move-column-right' ? 1 : 0
  const targetColumn = context.cellIndex + columnDelta
  const delimiters = tableDelimiterMarkers(table)
  const nextRows: ProseMirrorNode[] = []
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]
    if (row === undefined) return false
    const cells = tableCells(row)
    if (action === 'add-column-before' || action === 'add-column-after') {
      const cell = emptyTableCell(editor, rowIndex === 0)
      if (cell === null) return false
      const insertAt = context.cellIndex + (action === 'add-column-after' ? 1 : 0)
      cells.splice(insertAt, 0, cell)
      if (rowIndex === 0) delimiters.splice(insertAt, 0, null)
    } else if (action === 'duplicate-column') {
      const cell = cells[context.cellIndex]
      if (cell === undefined) return false
      cells.splice(context.cellIndex + 1, 0, cell)
      if (rowIndex === 0) delimiters.splice(context.cellIndex + 1, 0, delimiters[context.cellIndex] ?? null)
    } else if (action === 'move-column-left' || action === 'move-column-right') {
      const [cell] = cells.splice(context.cellIndex, 1)
      if (cell === undefined) return false
      cells.splice(targetColumn, 0, cell)
      if (rowIndex === 0) {
        const [delimiter] = delimiters.splice(context.cellIndex, 1)
        delimiters.splice(targetColumn, 0, delimiter ?? null)
      }
    } else if (action === 'delete-column') {
      cells.splice(context.cellIndex, 1)
      if (rowIndex === 0) delimiters.splice(context.cellIndex, 1)
    } else {
      return false
    }
    nextRows.push(row.type.create(row.attrs, cells))
  }
  const selectedColumn = action === 'add-column-before'
    ? context.cellIndex
    : action === 'add-column-after' || action === 'duplicate-column'
      ? context.cellIndex + 1
      : action === 'delete-column'
        ? Math.min(context.cellIndex, (nextRows[0]?.childCount ?? 1) - 1)
        : targetColumn
  return replaceOrdinaryTable(
    editor,
    context,
    table,
    nextRows,
    context.rowIndex,
    selectedColumn,
    { ...table.attrs, markdownDelimiters: delimiters },
  )
}

interface OrdinaryTableActionDescriptor {
  readonly action: OrdinaryTableAction
  readonly danger?: boolean
  readonly icon: TableMenuActionIconName
  readonly labelKey: UiMessageKey
}

type TableMenuActionIconName =
  | 'align-center'
  | 'align-left'
  | 'align-right'
  | 'delete'
  | 'duplicate'
  | 'insert-column-left'
  | 'insert-column-right'
  | 'insert-row-after'
  | 'insert-row-before'
  | 'move-down'
  | 'move-left'
  | 'move-right'
  | 'move-up'
  | 'sort-ascending'
  | 'sort-descending'

interface OrdinaryTableActionGroup {
  readonly actions: readonly OrdinaryTableActionDescriptor[]
  readonly name: string
}

const ROW_TABLE_ACTION_GROUPS: readonly OrdinaryTableActionGroup[] = Object.freeze([
  Object.freeze({
    actions: Object.freeze([
      Object.freeze({ action: 'move-row-up', icon: 'move-up', labelKey: 'tableNode.moveRowUp' }),
      Object.freeze({ action: 'move-row-down', icon: 'move-down', labelKey: 'tableNode.moveRowDown' }),
    ]),
    name: 'move',
  }),
  Object.freeze({
    actions: Object.freeze([
      Object.freeze({ action: 'add-row-before', icon: 'insert-row-before', labelKey: 'tableNode.addRowBefore' }),
      Object.freeze({ action: 'add-row-after', icon: 'insert-row-after', labelKey: 'tableNode.addRowAfter' }),
    ]),
    name: 'insert',
  }),
  Object.freeze({
    actions: Object.freeze([
      Object.freeze({ action: 'duplicate-row', icon: 'duplicate', labelKey: 'tableNode.duplicateRow' }),
      Object.freeze({ action: 'delete-row', danger: true, icon: 'delete', labelKey: 'tableNode.deleteRow' }),
    ]),
    name: 'finish',
  }),
])

const COLUMN_TABLE_ACTION_GROUPS: readonly OrdinaryTableActionGroup[] = Object.freeze([
  Object.freeze({
    actions: Object.freeze([
      Object.freeze({ action: 'move-column-left', icon: 'move-left', labelKey: 'tableNode.moveColumnLeft' }),
      Object.freeze({ action: 'move-column-right', icon: 'move-right', labelKey: 'tableNode.moveColumnRight' }),
    ]),
    name: 'move',
  }),
  Object.freeze({
    actions: Object.freeze([
      Object.freeze({ action: 'add-column-before', icon: 'insert-column-left', labelKey: 'tableNode.addColumnBefore' }),
      Object.freeze({ action: 'add-column-after', icon: 'insert-column-right', labelKey: 'tableNode.addColumnAfter' }),
    ]),
    name: 'insert',
  }),
  Object.freeze({
    actions: Object.freeze([
      Object.freeze({ action: 'sort-column-ascending', icon: 'sort-ascending', labelKey: 'tableNode.sortAscending' }),
      Object.freeze({ action: 'sort-column-descending', icon: 'sort-descending', labelKey: 'tableNode.sortDescending' }),
    ]),
    name: 'sort',
  }),
  Object.freeze({
    actions: Object.freeze([
      Object.freeze({ action: 'align-column-left', icon: 'align-left', labelKey: 'tableNode.alignColumnLeft' }),
      Object.freeze({ action: 'align-column-center', icon: 'align-center', labelKey: 'tableNode.alignColumnCenter' }),
      Object.freeze({ action: 'align-column-right', icon: 'align-right', labelKey: 'tableNode.alignColumnRight' }),
    ]),
    name: 'alignment',
  }),
  Object.freeze({
    actions: Object.freeze([
      Object.freeze({ action: 'duplicate-column', icon: 'duplicate', labelKey: 'tableNode.duplicateColumn' }),
      Object.freeze({ action: 'delete-column', danger: true, icon: 'delete', labelKey: 'tableNode.deleteColumn' }),
    ]),
    name: 'finish',
  }),
])

const TABLE_MENU_ICON_PATHS: Readonly<Record<TableMenuActionIconName, readonly string[]>> = Object.freeze({
  'align-center': Object.freeze(['M5 6h14', 'M8 10h8', 'M6 14h12', 'M9 18h6']),
  'align-left': Object.freeze(['M5 6h14', 'M5 10h9', 'M5 14h12', 'M5 18h7']),
  'align-right': Object.freeze(['M5 6h14', 'M10 10h9', 'M7 14h12', 'M12 18h7']),
  'delete': Object.freeze(['M4 7h16', 'M9 7V4h6v3', 'm6 4-.5 8h-5L9 11', 'M10 11v6', 'M14 11v6']),
  'duplicate': Object.freeze(['M8 8h11v11H8z', 'M5 16V5h11']),
  'insert-column-left': Object.freeze(['M11 4h8v16h-8z', 'M4 12h5', 'M6.5 9.5v5']),
  'insert-column-right': Object.freeze(['M5 4h8v16H5z', 'M15 12h5', 'M17.5 9.5v5']),
  'insert-row-after': Object.freeze(['M4 5h16v8H4z', 'M12 15v5', 'M9.5 17.5h5']),
  'insert-row-before': Object.freeze(['M4 11h16v8H4z', 'M12 4v5', 'M9.5 6.5h5']),
  'move-down': Object.freeze(['M12 4v16', 'm6-6 6 6 6-6']),
  'move-left': Object.freeze(['M20 12H4', 'm10-6-6 6 6 6']),
  'move-right': Object.freeze(['M4 12h16', 'm14-6 6 6-6 6']),
  'move-up': Object.freeze(['M12 20V4', 'm6 6 6-6 6 6']),
  'sort-ascending': Object.freeze(['M4 6h7', 'M4 10h5', 'M4 14h3', 'M17 5v14', 'm-3-3 3 3 3-3']),
  'sort-descending': Object.freeze(['M4 6h3', 'M4 10h5', 'M4 14h7', 'M17 5v14', 'm-3-3 3 3 3-3']),
})

function createTableMenuActionIcon(name: TableMenuActionIconName): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg'
  const icon = document.createElementNS(namespace, 'svg')
  icon.classList.add('table-node-view__menu-icon')
  icon.dataset['tableActionIcon'] = name
  icon.setAttribute('aria-hidden', 'true')
  icon.setAttribute('fill', 'none')
  icon.setAttribute('stroke', 'currentColor')
  icon.setAttribute('stroke-linecap', 'round')
  icon.setAttribute('stroke-linejoin', 'round')
  icon.setAttribute('stroke-width', '1.75')
  icon.setAttribute('viewBox', '0 0 24 24')
  for (const pathData of TABLE_MENU_ICON_PATHS[name]) {
    const path = document.createElementNS(namespace, 'path')
    path.setAttribute('d', pathData)
    icon.append(path)
  }
  return icon
}

interface OrdinaryTableOptions {
  readonly localization: UiLocalizationStore
}

const OrdinaryTable = Table.extend<OrdinaryTableOptions>({
  addAttributes() {
    return {
      ...this.parent?.(),
      markdownDelimiters: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
    }
  },
  addOptions() {
    return {
      ...this.parent?.(),
      localization: createUiLocalizationStore('en'),
    }
  },
  addNodeView() {
    const localization = this.options.localization
    return ({ editor, getPos, node }) => {
      let currentNode = node
      const removeEvents: Array<() => void> = []
      const dom = document.createElement('div')
      dom.className = 'table-node-view'
      dom.dataset['wEditorNode'] = 'ordinary-table'
      const scroll = document.createElement('div')
      scroll.className = 'table-node-view__scroll'
      const table = document.createElement('table')
      table.className = 'ordinary-table'
      const contentDOM = table.appendChild(document.createElement('tbody'))
      scroll.append(table)

      const overlay = document.createElement('span')
      overlay.className = 'table-cell-selection-overlay'
      overlay.dataset['tableSelectionOverlay'] = ''
      overlay.setAttribute('aria-hidden', 'true')
      overlay.hidden = true

      const rowHandle = document.createElement('button')
      rowHandle.type = 'button'
      rowHandle.className = 'table-node-view__handle table-node-view__handle--row'
      rowHandle.dataset['tableHandle'] = 'row'
      rowHandle.setAttribute('aria-haspopup', 'menu')
      rowHandle.setAttribute('aria-expanded', 'false')
      rowHandle.textContent = '⋮'
      rowHandle.hidden = true

      const columnHandle = document.createElement('button')
      columnHandle.type = 'button'
      columnHandle.className = 'table-node-view__handle table-node-view__handle--column'
      columnHandle.dataset['tableHandle'] = 'column'
      columnHandle.setAttribute('aria-haspopup', 'menu')
      columnHandle.setAttribute('aria-expanded', 'false')
      columnHandle.textContent = '⋯'
      columnHandle.hidden = true

      const rowMenu = document.createElement('div')
      rowMenu.className = 'table-node-view__menu'
      rowMenu.dataset['tableMenu'] = 'row'
      rowMenu.role = 'menu'
      rowMenu.hidden = true

      const columnMenu = document.createElement('div')
      columnMenu.className = 'table-node-view__menu'
      columnMenu.dataset['tableMenu'] = 'column'
      columnMenu.role = 'menu'
      columnMenu.hidden = true

      const actionButtons = new Map<OrdinaryTableAction, HTMLButtonElement>()
      const actionDescriptors = new Map<OrdinaryTableAction, OrdinaryTableActionDescriptor>()
      const actionLabels = new Map<OrdinaryTableAction, HTMLSpanElement>()
      const appendMenuSeparator = (menu: HTMLElement): void => {
        const separator = document.createElement('div')
        separator.className = 'table-node-view__menu-separator'
        separator.setAttribute('role', 'separator')
        menu.append(separator)
      }
      const addActionGroups = (menu: HTMLElement, groups: readonly OrdinaryTableActionGroup[]): void => {
        for (const [groupIndex, descriptorGroup] of groups.entries()) {
          if (groupIndex > 0) appendMenuSeparator(menu)
          const group = document.createElement('div')
          group.className = 'table-node-view__menu-group'
          group.dataset['tableMenuGroup'] = descriptorGroup.name
          group.setAttribute('role', 'group')
          for (const descriptor of descriptorGroup.actions) {
            const button = document.createElement('button')
            button.type = 'button'
            button.role = 'menuitem'
            button.className = 'table-node-view__menu-item'
            button.dataset['tableAction'] = descriptor.action
            if (descriptor.danger === true) button.dataset['danger'] = 'true'
            const label = document.createElement('span')
            label.className = 'table-node-view__menu-label'
            button.append(createTableMenuActionIcon(descriptor.icon), label)
            removeEvents.push(listenNodeViewEvent(button, 'mousedown', (event: MouseEvent) => event.preventDefault()))
            removeEvents.push(listenNodeViewEvent(button, 'click', (event: MouseEvent) => {
              event.preventDefault()
              event.stopPropagation()
              rowMenu.hidden = true
              columnMenu.hidden = true
              rowHandle.setAttribute('aria-expanded', 'false')
              columnHandle.setAttribute('aria-expanded', 'false')
              if (runOrdinaryTableAction(editor, descriptor.action)) editor.view.focus()
            }))
            actionButtons.set(descriptor.action, button)
            actionDescriptors.set(descriptor.action, descriptor)
            actionLabels.set(descriptor.action, label)
            group.append(button)
          }
          menu.append(group)
        }
      }
      addActionGroups(rowMenu, ROW_TABLE_ACTION_GROUPS)
      addActionGroups(columnMenu, COLUMN_TABLE_ACTION_GROUPS)

      const closeMenus = (restoreHandle?: HTMLButtonElement): void => {
        rowMenu.hidden = true
        columnMenu.hidden = true
        rowHandle.setAttribute('aria-expanded', 'false')
        columnHandle.setAttribute('aria-expanded', 'false')
        restoreHandle?.focus()
      }

      const menuKeydown = (event: KeyboardEvent, menu: HTMLElement, handle: HTMLButtonElement): void => {
        const controls = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        const target = event.target instanceof HTMLButtonElement ? event.target : null
        const current = target === null ? -1 : controls.indexOf(target)
        let next: number | null = null
        if (event.key === 'ArrowDown') next = (current + 1) % controls.length
        else if (event.key === 'ArrowUp') next = current <= 0 ? controls.length - 1 : current - 1
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = controls.length - 1
        else if (event.key === 'Escape') {
          event.preventDefault()
          closeMenus(handle)
          return
        }
        if (next === null || controls.length === 0) return
        event.preventDefault()
        controls[next]?.focus()
      }
      removeEvents.push(listenNodeViewEvent(rowMenu, 'keydown', (event: KeyboardEvent) => menuKeydown(event, rowMenu, rowHandle)))
      removeEvents.push(listenNodeViewEvent(columnMenu, 'keydown', (event: KeyboardEvent) => menuKeydown(event, columnMenu, columnHandle)))

      const openMenu = (kind: 'column' | 'row'): void => {
        const menu = kind === 'row' ? rowMenu : columnMenu
        const handle = kind === 'row' ? rowHandle : columnHandle
        const open = menu.hidden
        closeMenus()
        if (!open) return
        menu.hidden = false
        handle.setAttribute('aria-expanded', 'true')
        queueMicrotask(() => menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus())
      }
      for (const [kind, handle] of [['row', rowHandle], ['column', columnHandle]] as const) {
        removeEvents.push(listenNodeViewEvent(handle, 'mousedown', (event: MouseEvent) => event.preventDefault()))
        removeEvents.push(listenNodeViewEvent(handle, 'click', (event: MouseEvent) => {
          event.preventDefault()
          event.stopPropagation()
          openMenu(kind)
        }))
      }

      let selectedCell: Element | null = null
      const refreshSelection = (): void => {
        const position = getPos()
        const context = selectedTableCoordinates(editor)
        const selected = typeof position === 'number' && context?.tablePosition === position ? context : null
        selectedCell?.removeAttribute('data-table-cell-selected')
        selectedCell = null
        if (selected === null) {
          overlay.hidden = true
          rowHandle.hidden = true
          columnHandle.hidden = true
          closeMenus()
          return
        }
        const cell = contentDOM.children.item(selected.rowIndex)?.children.item(selected.cellIndex)
        if (!(cell instanceof HTMLElement)) return
        selectedCell = cell
        cell.dataset['tableCellSelected'] = 'true'
        overlay.hidden = false
        rowHandle.hidden = false
        columnHandle.hidden = false
        const rowLabel = localization.t('tableNode.rowActions', { number: selected.rowIndex + 1 })
        const columnLabel = localization.t('tableNode.columnActions', { number: selected.cellIndex + 1 })
        rowHandle.setAttribute('aria-label', rowLabel)
        columnHandle.setAttribute('aria-label', columnLabel)
        rowMenu.setAttribute('aria-label', rowLabel)
        columnMenu.setAttribute('aria-label', columnLabel)
        const bounds = dom.getBoundingClientRect()
        const cellBounds = cell.getBoundingClientRect()
        overlay.style.left = `${cellBounds.left - bounds.left}px`
        overlay.style.top = `${cellBounds.top - bounds.top}px`
        overlay.style.width = `${cellBounds.width}px`
        overlay.style.height = `${cellBounds.height}px`
        rowHandle.style.top = `${cellBounds.top - bounds.top + cellBounds.height / 2}px`
        columnHandle.style.left = `${cellBounds.left - bounds.left + cellBounds.width / 2}px`
        rowMenu.style.top = `${cellBounds.top - bounds.top + cellBounds.height / 2}px`
        columnMenu.style.left = `${cellBounds.left - bounds.left + cellBounds.width / 2}px`
        for (const [action, button] of actionButtons) {
          button.disabled = !canRunOrdinaryTableAction(currentNode, selected, action)
        }
      }

      const renderCopy = (): void => {
        table.setAttribute('aria-label', localization.t('tableNode.editable'))
        for (const [action] of actionButtons) {
          const descriptor = actionDescriptors.get(action)
          const label = actionLabels.get(action)
          if (descriptor !== undefined && label !== undefined) label.textContent = localization.t(descriptor.labelKey)
        }
        const position = getPos()
        const selected = selectedTableCoordinates(editor)
        if (typeof position !== 'number' || selected?.tablePosition !== position) return
        const rowLabel = localization.t('tableNode.rowActions', { number: selected.rowIndex + 1 })
        const columnLabel = localization.t('tableNode.columnActions', { number: selected.cellIndex + 1 })
        rowHandle.setAttribute('aria-label', rowLabel)
        columnHandle.setAttribute('aria-label', columnLabel)
        rowMenu.setAttribute('aria-label', rowLabel)
        columnMenu.setAttribute('aria-label', columnLabel)
      }

      editor.on('selectionUpdate', refreshSelection)
      dom.append(scroll, overlay, rowHandle, columnHandle, rowMenu, columnMenu)
      const unsubscribeLocalization = bindLocalizedNodeView(localization, renderCopy)
      return {
        contentDOM,
        dom,
        destroy: () => {
          editor.off('selectionUpdate', refreshSelection)
          unsubscribeLocalization()
          for (const removeEvent of removeEvents) removeEvent()
        },
        ignoreMutation: (mutation: ViewMutationRecord) => mutation.type === 'attributes'
          && mutation.attributeName === 'data-table-cell-selected'
          ? true
          : !contentDOM.contains(mutation.target),
        stopEvent: (event: Event) => event.target instanceof Element
          && event.target.closest('[data-table-action], [data-table-handle], [data-table-menu]') !== null,
        update: (updatedNode: ProseMirrorNode) => {
          if (updatedNode.type !== currentNode.type) return false
          const contentChanged = !updatedNode.eq(currentNode)
          currentNode = updatedNode
          if (contentChanged) queueMicrotask(refreshSelection)
          return true
        },
      }
    }
  },
})

interface TiptapVisualExtensionOptions {
  readonly localization: UiLocalizationStore
  readonly mountChart?: (target: HTMLElement, source: string) => () => void
  readonly onRawEdit?: (event: RawNodeEditEvent) => void
  readonly onReadOnlyTaskChecked?: (node: ProseMirrorNode, checked: boolean) => boolean
  readonly onSemanticCopy?: (event: SemanticNodeCopyEvent) => void
  readonly onSemanticEdit?: (event: SemanticNodeEditEvent) => void
  readonly renderMermaid?: (source: string) => Promise<string>
}

export const TIPTAP_VISUAL_HISTORY_CONFIG = Object.freeze({
  depth: 100,
  newGroupDelay: 500,
})

export function createTiptapVisualExtensions(options?: Readonly<TiptapVisualExtensionOptions>) {
  const resolvedOptions: Readonly<TiptapVisualExtensionOptions> = options
    ?? Object.freeze({ localization: createUiLocalizationStore('en') })
  const localization = resolvedOptions.localization
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4, 5] },
      link: false,
      trailingNode: false,
      underline: false,
      undoRedo: TIPTAP_VISUAL_HISTORY_CONFIG,
    }),
    Link.configure({ openOnClick: false }),
    Underline,
    Subscript,
    Superscript,
    Ruby,
    TextStyle,
    Color,
    BackgroundColor,
    FontSize,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TaskList,
    TaskItem.configure({
      nested: true,
      ...(resolvedOptions.onReadOnlyTaskChecked === undefined
        ? {}
        : { onReadOnlyChecked: resolvedOptions.onReadOnlyTaskChecked }),
    }),
    TableKit.configure({ table: false }),
    OrdinaryTable.configure({ localization }),
    ProjectionAttributes,
    TocHeadingAttributes,
    TocHeadingAnchors,
    RawInline.configure({ localization, onEdit: resolvedOptions.onRawEdit ?? null }),
    RawBlock.configure({ localization, onEdit: resolvedOptions.onRawEdit ?? null }),
    PresentationFallback,
    InlineImage.configure({ localization, onEdit: resolvedOptions.onSemanticEdit ?? null }),
    InlineFormula.configure({ localization, onEdit: resolvedOptions.onSemanticEdit ?? null }),
    FormulaBlock.configure({ localization, onEdit: resolvedOptions.onSemanticEdit ?? null }),
    TocBlock.configure({ localization }),
    VisualCodeBlock.configure({
      localization,
      onCopy: resolvedOptions.onSemanticCopy ?? null,
      onEdit: resolvedOptions.onSemanticEdit ?? null,
    }),
    SemanticBlock.configure({
      localization,
      mountChart: resolvedOptions.mountChart ?? null,
      onCopy: resolvedOptions.onSemanticCopy ?? null,
      onEdit: resolvedOptions.onSemanticEdit ?? null,
      renderMermaid: resolvedOptions.renderMermaid ?? null,
    }),
    VisualSearchHighlighting,
    AlignmentBlock,
  ]
}
