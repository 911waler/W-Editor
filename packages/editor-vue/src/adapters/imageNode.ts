import { Node, type NodeViewRendererProps } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { resizedImageDimensions, type ResizeHandle } from './imageResize'
import { NodeSelection, Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

const imageViewUpdates = new WeakMap<EditorView, Set<() => void>>()
import { normalizeImageUrl, parseInlineImageAt, serializeImage } from '@w-editor/editor-core'
import { createUiLocalizationStore, type UiLocalizationStore } from '../services/uiLocalization'
import type { SemanticNodeEditEvent } from './tiptapVisualSchema'

export function imageAttributes(attrs: Readonly<Record<string, unknown>>) {
  return {
    name: String(attrs['name'] ?? ''),
    url: String(attrs['url'] ?? ''),
    source: String(attrs['source'] ?? ''),
    width: typeof attrs['width'] === 'number' ? attrs['width'] : null,
    height: typeof attrs['height'] === 'number' ? attrs['height'] : null,
  }
}

export function imageMarkdown(attrs: Readonly<Record<string, unknown>>): string {
  const model = imageAttributes(attrs)
  const original = parseInlineImageAt(model.source, 0)
  if (original !== null && original.name === model.name && original.url === model.url
    && original.width === model.width && original.height === model.height) return model.source
  return serializeImage(model)
}

export interface ImageOptions {
  readonly localization: UiLocalizationStore
  readonly onEdit: ((event: SemanticNodeEditEvent) => void) | null
}

function imageNodeView(props: NodeViewRendererProps, options: ImageOptions) {
  let current = props.node
  const doc = props.view.dom.ownerDocument
  const dom = doc.createElement('span')
  dom.className = 'inline-image'
  dom.dataset['inlineImage'] = ''
  dom.contentEditable = 'false'
  dom.dataset['semanticKind'] = 'media'
  dom.dataset['mediaKind'] = 'image'
  const img = doc.createElement('img')
  img.draggable = false
  img.className = 'semantic-preview__media-element'
  const fallback = doc.createElement('span')
  fallback.className = 'inline-image__fallback'
  fallback.hidden = true
  fallback.dataset['mediaFallback'] = 'image'
  const controls = doc.createElement('span')
  controls.className = 'inline-image__controls'
  controls.hidden = true
  const toolbar = doc.createElement('span')
  toolbar.className = 'inline-image__toolbar'
  toolbar.dataset['imageToolbar'] = ''
  toolbar.setAttribute('role', 'group')
  const widthInput = doc.createElement('input')
  const heightInput = doc.createElement('input')
  const widthLabel = doc.createElement('label')
  const heightLabel = doc.createElement('label')
  const widthText = doc.createElement('span')
  const heightText = doc.createElement('span')
  for (const [input, key] of [[widthInput, 'width'], [heightInput, 'height']] as const) {
    input.type = 'number'; input.min = '16'; input.max = '4096'; input.step = '1'
    input.dataset['imageDimension'] = key
  }
  widthLabel.append(widthText, widthInput); heightLabel.append(heightText, heightInput)
  const lock = doc.createElement('input'); lock.type = 'checkbox'; lock.checked = true
  lock.dataset['imageAspectLock'] = ''
  const lockLabel = doc.createElement('label'); const lockText = doc.createElement('span')
  lockLabel.append(lock, lockText)
  const reset = doc.createElement('button'); reset.type = 'button'; reset.dataset['imageReset'] = ''
  const editButton = doc.createElement('button'); editButton.type = 'button'; editButton.dataset['semanticEdit'] = 'media-editor'
  toolbar.append(widthLabel, heightLabel, lockLabel, reset, editButton)
  controls.append(toolbar); dom.append(img, fallback, controls)
  let failedLoad = false
  let drag: { pointerId: number; target: HTMLElement; x: number; y: number; width: number; height: number; scaleX: number; scaleY: number; handle: ResizeHandle; moved: boolean; preview: { width: number; height: number } } | null = null
  const dimensions = () => {
    const attrs = imageAttributes(current.attrs)
    const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 2
    return { width: attrs.width ?? (attrs.height ? attrs.height * ratio : img.naturalWidth || 200), height: attrs.height ?? (attrs.width ? attrs.width / ratio : img.naturalHeight || 100) }
  }
  const displayDimensions = (size: { width: number; height: number }) => {
    dom.style.width = `${size.width}px`
    img.style.width = '100%'; img.style.height = 'auto'
    img.style.aspectRatio = `${size.width} / ${size.height}`
  }
  const commit = (size: { width: number | null; height: number | null }) => {
    const pos = props.getPos()
    if (typeof pos !== 'number' || !props.editor.isEditable) return
    const attrs = { ...current.attrs, ...size }
    if (current.attrs['width'] === size.width && current.attrs['height'] === size.height) return
    props.view.dispatch(closeHistory(props.view.state.tr.setNodeMarkup(pos, undefined, attrs)))
    props.view.dispatch(closeHistory(props.view.state.tr).setMeta('addToHistory', false))
  }
  const stopDrag = (apply: boolean) => {
    const active = drag; if (active === null) return
    drag = null
    if (active.target.hasPointerCapture?.(active.pointerId)) active.target.releasePointerCapture(active.pointerId)
    if (apply && active.moved) commit(active.preview)
    render()
  }
  const move = (event: PointerEvent) => {
    if (drag === null || event.pointerId !== drag.pointerId) return
    drag.moved = event.clientX !== drag.x || event.clientY !== drag.y
    drag.preview = resizedImageDimensions({ ...drag, dx: (event.clientX - drag.x) * drag.scaleX, dy: (event.clientY - drag.y) * drag.scaleY, lockAspectRatio: lock.checked && !lock.disabled })
    displayDimensions(drag.preview)
  }
  const up = (event: PointerEvent) => { if (drag?.pointerId === event.pointerId) { move(event); stopDrag(true) } }
  const cancel = (event: PointerEvent) => { if (drag?.pointerId === event.pointerId) stopDrag(false) }
  const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && drag !== null) { event.preventDefault(); stopDrag(false) } }
  for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
    const button = doc.createElement('span')
    button.className = 'inline-image__handle'; button.dataset['imageResizeHandle'] = handle
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !props.editor.isEditable) return
      event.preventDefault(); event.stopPropagation(); select()
      const size = dimensions()
      // Preserve saved dimensions; translate screen movement into model pixels.
      const rect = img.getBoundingClientRect()
      const scaleX = rect.width > 0 ? size.width / rect.width : 1
      const scaleY = rect.height > 0 ? size.height / rect.height : 1
      drag = { pointerId: event.pointerId, target: button, x: event.clientX, y: event.clientY, ...size, scaleX, scaleY, handle, moved: false, preview: size }
      button.setPointerCapture?.(event.pointerId)
    })
    controls.append(button)
  }
  const changeDimension = (axis: 'width' | 'height', input: HTMLInputElement) => {
    const value = Number(input.value)
    if (!Number.isInteger(value) || value < 16 || value > 4096) { render(); return }
    const size = dimensions()
    commit(resizedImageDimensions({ ...size, dx: axis === 'width' ? value - size.width : 0, dy: axis === 'height' ? value - size.height : 0, handle: axis === 'width' ? 'e' : 's', lockAspectRatio: lock.checked && !lock.disabled }))
  }
  widthInput.addEventListener('change', () => changeDimension('width', widthInput))
  heightInput.addEventListener('change', () => changeDimension('height', heightInput))
  reset.addEventListener('click', () => commit({ width: null, height: null }))
  editButton.addEventListener('click', () => edit())
  controls.addEventListener('click', event => event.stopPropagation())
  dom.addEventListener('pointermove', move); dom.addEventListener('pointerup', up)
  dom.addEventListener('pointercancel', cancel); dom.addEventListener('lostpointercapture', cancel)
  doc.addEventListener('keydown', keydown)

  const positionToolbar = () => {
    if (controls.hidden || !controls.isConnected) return
    const viewport = doc.defaultView
    if (viewport === null) return
    const bounds = dom.getBoundingClientRect()
    const panel = toolbar.getBoundingClientRect()
    toolbar.style.position = 'fixed'
    toolbar.style.bottom = 'auto'
    toolbar.style.left = `${Math.max(8, Math.min(bounds.left, viewport.innerWidth - panel.width - 8))}px`
    toolbar.style.top = `${Math.max(8, bounds.top >= panel.height + 18 ? bounds.top - panel.height - 10 : Math.min(bounds.bottom + 10, viewport.innerHeight - panel.height - 8))}px`
  }
  const syncControls = () => {
    if (!props.editor.isEditable) {
      stopDrag(false)
      controls.remove()
      return
    }
    if (controls.parentNode !== dom) dom.append(controls)
    controls.hidden = !dom.classList.contains('ProseMirror-selectednode')
    positionToolbar()
  }
  const updates = imageViewUpdates.get(props.view) ?? new Set<() => void>()
  imageViewUpdates.set(props.view, updates); updates.add(syncControls)
  doc.addEventListener('scroll', positionToolbar, true)
  doc.defaultView?.addEventListener('resize', positionToolbar)

  function render() {
    const attrs = imageAttributes(current.attrs)
    const url = normalizeImageUrl(attrs.url)
    if (url !== null && img.getAttribute('src') !== url) { failedLoad = false; img.hidden = false; fallback.hidden = true; img.setAttribute('src', url) }
    else if (url === null) img.removeAttribute('src')
    img.alt = attrs.name
    for (const key of ['width', 'height'] as const) {
      if (attrs[key] === null) img.removeAttribute(key)
      else img.setAttribute(key, String(attrs[key]))
    }
    const size = dimensions()
    if (attrs.width !== null || attrs.height !== null || img.naturalWidth > 0) displayDimensions(size)
    else { dom.style.removeProperty('width'); img.style.removeProperty('aspect-ratio') }
    widthInput.value = String(Math.round(size.width)); heightInput.value = String(Math.round(size.height))
    widthText.textContent = options.localization.t('image.width')
    heightText.textContent = options.localization.t('image.height')
    lockText.textContent = options.localization.t('image.lockAspectRatio')
    reset.textContent = options.localization.t('image.resetSize')
    editButton.textContent = options.localization.t('image.edit')
    toolbar.setAttribute('aria-label', options.localization.t('image.dimensions'))
    lock.disabled = failedLoad && !(attrs.width !== null && attrs.height !== null)
    reset.disabled = failedLoad || !img.naturalWidth || !img.naturalHeight
    syncControls()
    dom.dataset['previewState'] = failedLoad ? 'error' : img.complete && img.naturalWidth > 0 ? 'ready' : 'loading'
    fallback.textContent = `${options.localization.t('semanticNode.previewUnavailable', { kind: options.localization.t('media.kind.image') })} · ${attrs.name} (${attrs.url})`
  }
  const select = () => {
    if (!props.editor.isEditable) return
    const pos = props.getPos()
    if (typeof pos === 'number') props.editor.view.dispatch(props.editor.state.tr.setSelection(NodeSelection.create(props.editor.state.doc, pos)))
  }
  const edit = () => {
    if (!props.editor.isEditable) return
    select()
    const attrs = imageAttributes(current.attrs)
    options.onEdit?.({ ...attrs, editorId: 'media-editor', kind: 'media', mediaKind: 'image', layoutKind: null, source: imageMarkdown(current.attrs) })
  }
  const failed = () => { stopDrag(false); failedLoad = true; img.hidden = true; fallback.hidden = false; render() }
  const loaded = () => { failedLoad = false; img.hidden = false; fallback.hidden = true; render() }
  dom.addEventListener('click', select)
  dom.addEventListener('dblclick', edit)
  img.addEventListener('error', failed)
  img.addEventListener('load', loaded)
  const unsubscribe = options.localization.subscribe(render)
  render()
  return {
    dom,
    selectNode: () => { dom.classList.add('ProseMirror-selectednode'); syncControls() },
    deselectNode: () => { dom.classList.remove('ProseMirror-selectednode'); controls.hidden = true; stopDrag(false) },
    stopEvent: (event: Event) => controls.contains(event.target as globalThis.Node),
    update: (node: typeof current) => {
      if (node.type !== current.type) return false
      current = node; render(); return true
    },
    ignoreMutation: () => true,
    destroy: () => {
      stopDrag(false); unsubscribe(); updates.delete(syncControls)
      doc.removeEventListener('scroll', positionToolbar, true)
      doc.defaultView?.removeEventListener('resize', positionToolbar)
      dom.removeEventListener('pointermove', move); dom.removeEventListener('pointerup', up)
      dom.removeEventListener('pointercancel', cancel); dom.removeEventListener('lostpointercapture', cancel)
      doc.removeEventListener('keydown', keydown)
      dom.removeEventListener('click', select); dom.removeEventListener('dblclick', edit)
      img.removeEventListener('error', failed); img.removeEventListener('load', loaded)
    },
  }
}

export const InlineImage = Node.create<ImageOptions>({
  name: 'inlineImage', inline: true, group: 'inline', atom: true, draggable: true,
  addOptions: () => ({ localization: createUiLocalizationStore('en'), onEdit: null }),
  addAttributes: () => ({
    name: { default: '', parseHTML: element => element.getAttribute('alt') ?? '', rendered: false },
    url: { default: '', parseHTML: element => normalizeImageUrl(element.getAttribute('src') ?? ''), rendered: false },
    source: { default: '', rendered: false },
    width: { default: null, parseHTML: element => Number(element.getAttribute('width')) || null, rendered: false },
    height: { default: null, parseHTML: element => Number(element.getAttribute('height')) || null, rendered: false },
  }),
  parseHTML: () => [{ tag: 'img[src]', getAttrs: element => normalizeImageUrl(element.getAttribute('src') ?? '') === null ? false : null }],
  renderHTML: ({ node }) => ['img', {
    src: normalizeImageUrl(String(node.attrs['url'] ?? '')) ?? '', alt: node.attrs['name'],
    ...(node.attrs['width'] === null ? {} : { width: node.attrs['width'] }),
    ...(node.attrs['height'] === null ? {} : { height: node.attrs['height'] }),
  }],
  addProseMirrorPlugins() {
    return [new Plugin({ view: () => ({ update: view => {
      for (const update of imageViewUpdates.get(view) ?? []) update()
    } }) })]
  },
  addNodeView() { return props => imageNodeView(props, this.options) },
})
