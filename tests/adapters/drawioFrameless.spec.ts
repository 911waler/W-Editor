import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { NodeSelection } from '@tiptap/pm/state'
import { afterEach, describe, expect, it } from 'vitest'

import { SemanticBlock, type SemanticNodeEditEvent } from '../../src/adapters/tiptapVisualSchema'
import { drawioSource } from '../../src/codecs'

const name = 'Architecture <A> & "B"'
const png = '/synthetic-diagram.png'
const xml = '<mxfile host="中文 &amp; &quot;host&quot;"><diagram id="original"/></mxfile>\n'
const source = drawioSource(name, png, xml)
const editors: Editor[] = []

function mount(editable = true) {
  const host = document.createElement('div')
  document.body.append(host)
  const edits: SemanticNodeEditEvent[] = []
  const editor = new Editor({
    element: host,
    editable,
    extensions: [StarterKit, SemanticBlock.configure({ onEdit: event => { edits.push(event) } })],
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
        { type: 'semanticBlock', attrs: { kind: 'drawio', editorId: 'drawio-editor', name, png, xml, source } },
        { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
      ],
    },
  })
  editors.push(editor)
  const node = () => host.querySelector<HTMLElement>('[data-semantic-kind="drawio"]')!
  const image = () => node().querySelector<HTMLImageElement>('img')!
  return { editor, edits, host, node, image }
}

function doubleClick(target: HTMLElement) {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
  target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, detail: 2 }))
}

function focusTarget(node: HTMLElement): HTMLElement {
  const target = node.matches('[tabindex="0"]') ? node : node.querySelector<HTMLElement>('[tabindex="0"]')
  expect(target, 'the diagram must be reachable with the keyboard').not.toBeNull()
  return target!
}

function enter(target: HTMLElement) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
}

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy()
  document.body.replaceChildren()
})

describe('frameless draw.io semantic nodes', () => {
  it.each([true, false])('renders only the diagram preview, with editable=%s', editable => {
    const app = mount(editable)

    expect(app.node().classList.contains('semantic-node-view')).toBe(true)
    expect(app.node().classList.contains('complex-node')).toBe(false)
    expect(app.node().querySelector('header, figcaption, button, .semantic-node-view__identity, .complex-node__controls')).toBeNull()
    expect(app.image().getAttribute('src')).toBe(png)
    expect(app.image().alt).toBe(name)
    expect(app.node().getAttribute('data-drawio-source')).toBe(source)
  })

  it('selects on a single click and opens once on a double click with complete original data', () => {
    const app = mount()
    const before = app.editor.getJSON()

    app.image().click()
    expect(app.editor.state.selection).toBeInstanceOf(NodeSelection)
    expect(app.node().dataset['selected']).toBe('true')
    expect(app.node().classList.contains('ProseMirror-selectednode')).toBe(true)
    expect(app.edits).toEqual([])

    doubleClick(app.image())
    expect(app.edits).toEqual([expect.objectContaining({
      editorId: 'drawio-editor', kind: 'drawio', name, png, xml, source,
    })])
    expect(app.editor.getJSON()).toEqual(before)
  })

  it('offers Enter editing on a focusable diagram without a visible button', () => {
    const app = mount()
    const target = focusTarget(app.node())
    target.focus()
    expect(document.activeElement).toBe(target)
    expect(target.getAttribute('aria-label')).toContain(name)

    enter(target)
    expect(app.edits).toEqual([expect.objectContaining({ xml, source })])
    expect(app.editor.state.selection).toBeInstanceOf(NodeSelection)
    expect(app.node().querySelector('button')).toBeNull()
  })

  it.each([true, false])('checks editable state at gesture time after starting editable=%s', initiallyEditable => {
    const app = mount(initiallyEditable)
    app.editor.setEditable(false)

    doubleClick(app.image())
    enter(app.node().querySelector<HTMLElement>('.semantic-node-view__preview')!)
    expect(app.edits).toEqual([])

    app.editor.setEditable(true)
    doubleClick(app.image())
    expect(app.edits).toHaveLength(1)
    app.editor.setEditable(false)
    doubleClick(app.image())
    enter(app.node().querySelector<HTMLElement>('.semantic-node-view__preview')!)
    expect(app.edits).toHaveLength(1)
  })

  it('uses current source after repeated updates and removes obsolete gesture listeners', () => {
    const app = mount()
    const oldImage = app.image()
    const oldFocus = focusTarget(app.node())
    app.image().click()
    const position = app.editor.state.selection.from
    const updatedXml = '<mxfile><diagram id="updated"/></mxfile>'
    const updatedSource = drawioSource('Updated architecture', '/updated-diagram.png', updatedXml)

    for (let revision = 0; revision < 3; revision += 1) {
      const current = app.editor.state.doc.nodeAt(position)!
      app.editor.view.dispatch(app.editor.state.tr.setNodeMarkup(position, undefined, {
        ...current.attrs,
        name: 'Updated architecture', png: '/updated-diagram.png', xml: updatedXml, source: updatedSource,
        identity: `revision ${revision}`,
      }))
    }
    expect(app.image()).not.toBe(oldImage)
    expect(app.node().dataset['selected']).toBe('true')
    doubleClick(oldImage)
    enter(oldFocus)
    expect(app.edits).toEqual([])

    doubleClick(app.image())
    expect(app.edits).toEqual([expect.objectContaining({
      name: 'Updated architecture', png: '/updated-diagram.png', xml: updatedXml, source: updatedSource,
    })])
    const currentFocus = focusTarget(app.node())
    currentFocus.focus()
    expect(document.activeElement).toBe(currentFocus)
    enter(currentFocus)
    expect(app.edits).toHaveLength(2)
    expect(app.edits[1]).toMatchObject({ xml: updatedXml, source: updatedSource })

    const currentImage = app.image()
    app.editor.destroy()
    doubleClick(currentImage)
    enter(currentFocus)
    expect(app.edits).toHaveLength(2)
  })

  it('serializes a plain image figure with editable source metadata that survives an HTML round trip', () => {
    const app = mount()
    const container = document.createElement('div')
    container.innerHTML = app.editor.getHTML()
    const figure = container.querySelector('figure')!

    expect(figure.querySelector('header, figcaption, button')).toBeNull()
    expect(figure.classList.contains('complex-node')).toBe(false)
    expect(figure.getAttribute('data-drawio-source')).toBe(source)
    expect(figure.querySelector('img')?.getAttribute('src')).toBe(png)
    app.editor.commands.setContent(container.innerHTML)
    expect(app.editor.getJSON().content?.find(node => node.type === 'semanticBlock')?.attrs).toMatchObject({
      kind: 'drawio', editorId: 'drawio-editor', name, png, xml, source,
    })
    doubleClick(app.image())
    expect(app.edits).toEqual([expect.objectContaining({ xml, source })])
  })

  it('keeps the existing card and edit control for other semantic block kinds', () => {
    const app = mount()
    app.editor.commands.setContent({
      type: 'doc', content: [{ type: 'semanticBlock', attrs: {
        kind: 'mermaid', editorId: 'mermaid-editor', code: 'graph TD; A-->B', source: '```mermaid\ngraph TD; A-->B\n```',
      } }],
    })
    const node = app.host.querySelector<HTMLElement>('[data-semantic-kind="mermaid"]')!
    expect(node.classList.contains('complex-node')).toBe(true)
    expect(node.querySelector('.semantic-node-view__header')).not.toBeNull()
    expect(node.querySelector('figcaption')).not.toBeNull()
    node.querySelector<HTMLButtonElement>('[data-semantic-edit="mermaid-editor"]')!.click()
    expect(app.edits).toEqual([expect.objectContaining({ kind: 'mermaid', code: 'graph TD; A-->B' })])
  })
})
