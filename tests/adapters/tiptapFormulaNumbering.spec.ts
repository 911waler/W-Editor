import { Editor, type JSONContent } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTiptapVisualExtensions } from '../../packages/editor-vue/src/adapters/tiptapVisualSchema'
import { TiptapTransactionPatchPlanner, TiptapVisualAdapter, serializeOrdinaryTiptapPatch } from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession } from '../../src/core'

const editors: Editor[] = []

function mount(content: JSONContent[]) {
  const host = document.createElement('div')
  document.body.append(host)
  const editor = new Editor({ element: host, extensions: createTiptapVisualExtensions(), content: { type: 'doc', content } })
  editors.push(editor)
  return { editor, host }
}

const block = (content: string): JSONContent => ({ type: 'formulaBlock', attrs: { content, formulaMode: 'block' } })
const paragraph: JSONContent = { type: 'paragraph', content: [{ type: 'text', text: 'Between' }] }

function numberedSources(host: ParentNode) {
  return [...host.querySelectorAll('.formula-node--block, .Cherry-Math')].map(node => ({
    source: node.querySelector('annotation')?.textContent ?? node.querySelector('.formula-rendered')?.getAttribute('data-formula-source'),
    number: node.querySelector(':scope > .formula-node__number')?.textContent,
    attribute: node.getAttribute('data-formula-number'),
  }))
}

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy()
  document.body.replaceChildren()
})

describe('derived document formula numbering', () => {
  it('numbers initial mixed formulas including errors without changing Markdown, JSON or history', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const markdown = '$inline$\n\n$$\na=1\n$$\n\n$$\n\\frac{\n$$\n\n$$\nb=2\\tag{explicit}\n$$'
    const session = new DocumentSession({ documentId: 'numbered-formulas', markdown })
    const transactions: unknown[] = []
    const adapter = new TiptapVisualAdapter({ host, session, project: projectOrdinaryMarkdown,
      patchPlanner: new TiptapTransactionPatchPlanner({ createTransactionId: () => 'formula-numbering', serialize: serializeOrdinaryTiptapPatch }),
      onTransaction: event => { transactions.push(event.patchPlan) },
    })
    try {
      expect([...host.querySelectorAll('.formula-node--block')].map(node => node.getAttribute('data-formula-number'))).toEqual(['1', '2', '3'])
      expect([...host.querySelectorAll('.formula-node__number')].map(node => node.textContent)).toEqual(['(1)', '(2)', '(3)'])
      expect(host.querySelector('.formula-node--inline .formula-node__number')).toBeNull()
      expect(host.querySelector('.formula-node--block [data-render-state="error"]')).not.toBeNull()
      expect(JSON.stringify(adapter.documentJSON())).not.toMatch(/formulaNumber|formula-number|formula-node__number/u)
      expect(JSON.stringify(adapter.documentJSON())).toContain('explicit')
      await vi.runOnlyPendingTimersAsync()
      adapter.setSelection({ anchor: 0, head: 0 })
      adapter.setSearchHighlights(adapter.search('inline'), 0)
      adapter.clearSearchHighlights()
      expect(session.snapshot().markdown).toBe(markdown)
      expect(transactions.filter(Boolean)).toEqual([])
      expect(adapter.undo()).toBe(false)
    } finally { adapter.destroy() }
  })

  it('restores a block label after editing renders new formula children', () => {
    const { editor, host } = mount([block('old'), block('next')])
    editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { content: 'edited', formulaMode: 'block' }))
    expect(numberedSources(host)).toEqual([
      { source: 'edited', number: '(1)', attribute: '1' },
      { source: 'next', number: '(2)', attribute: '2' },
    ])
  })

  it('recalculates after prepending, copying and deleting formula nodes', () => {
    const { editor, host } = mount([block('a'), paragraph, block('b')])
    editor.view.dispatch(editor.state.tr.insert(0, editor.schema.nodeFromJSON(block('c'))))
    expect(numberedSources(host)).toEqual([
      { source: 'c', number: '(1)', attribute: '1' },
      { source: 'a', number: '(2)', attribute: '2' },
      { source: 'b', number: '(3)', attribute: '3' },
    ])
    const original = editor.state.doc.firstChild!
    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, original))
    expect(numberedSources(host).at(-1)).toEqual({ source: 'c', number: '(4)', attribute: '4' })
    editor.view.dispatch(editor.state.tr.delete(0, original.nodeSize))
    expect(numberedSources(host)).toEqual([
      { source: 'a', number: '(1)', attribute: '1' },
      { source: 'b', number: '(2)', attribute: '2' },
      { source: 'c', number: '(3)', attribute: '3' },
    ])
  })

  it('follows the source when two existing nodes exchange positions', () => {
    const { editor, host } = mount([block('first'), block('second')])
    const first = editor.state.doc.child(0)
    const second = editor.state.doc.child(1)
    editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, [second, first]))
    expect(numberedSources(host)).toEqual([
      { source: 'second', number: '(1)', attribute: '1' },
      { source: 'first', number: '(2)', attribute: '2' },
    ])
    expect(editor.commands.undo()).toBe(true)
    expect(numberedSources(host)).toEqual([
      { source: 'first', number: '(1)', attribute: '1' },
      { source: 'second', number: '(2)', attribute: '2' },
    ])
    expect(editor.commands.redo()).toBe(true)
    expect(numberedSources(host)[0]).toEqual({ source: 'second', number: '(1)', attribute: '1' })
  })

  it('keeps labels when a metadata-only decoration update refreshes the formula NodeView', () => {
    const { editor, host } = mount([block('decorated')])
    const key = new PluginKey<boolean>('formula-decoration-test')
    editor.registerPlugin(new Plugin({ key,
      state: { init: () => false, apply: (transaction, active) => transaction.getMeta(key) as boolean | undefined ?? active },
      props: { decorations: state => key.getState(state)
        ? DecorationSet.create(state.doc, [Decoration.node(0, state.doc.firstChild!.nodeSize, { class: 'search-result' })])
        : DecorationSet.empty },
    }))
    const before = editor.state.doc
    editor.view.dispatch(editor.state.tr.setMeta(key, true))
    expect(editor.state.doc).toBe(before)
    expect(host.querySelector('.search-result')).not.toBeNull()
    expect(numberedSources(host)).toEqual([{ source: 'decorated', number: '(1)', attribute: '1' }])
    editor.view.dispatch(editor.state.tr.setMeta(key, false))
    expect(numberedSources(host)).toEqual([{ source: 'decorated', number: '(1)', attribute: '1' }])
    expect(editor.commands.undo()).toBe(false)
  })

  it('numbers fallback fragments continuously between ordinary nodes and resets each independent root', () => {
    const fallback: JSONContent = { type: 'presentationFallback', attrs: { safeHtml:
      '<div class="Cherry-Math" data-formula-number="99"><span class="formula-node__number">(99)</span><annotation>fallback</annotation></div><span class="Cherry-InlineMath">inline</span>',
    } }
    const { host } = mount([block('before'), fallback, block('after')])
    const other = mount([block('independent')])
    expect(numberedSources(host)).toEqual([
      { source: 'before', number: '(1)', attribute: '1' },
      { source: 'fallback', number: '(2)', attribute: '2' },
      { source: 'after', number: '(3)', attribute: '3' },
    ])
    expect(numberedSources(other.host)).toEqual([{ source: 'independent', number: '(1)', attribute: '1' }])
    expect(host.querySelector('.Cherry-InlineMath .formula-node__number')).toBeNull()
  })
})

it('inserts a reference with its target marker in one undoable visual transaction', () => {
  const host = document.createElement('div'); document.body.append(host)
  const markdown = '$$\na=1\n$$\n\nSee here'
  const session = new DocumentSession({ documentId: 'atomic-reference', markdown })
  const adapter = new TiptapVisualAdapter({ host, session, project: projectOrdinaryMarkdown,
    patchPlanner: new TiptapTransactionPatchPlanner({ createTransactionId: () => 'reference-insert', serialize: serializeOrdinaryTiptapPatch }),
  })
  try {
    expect(adapter).toHaveProperty('applyFormulaReference')
    adapter.setSelection({ anchor: 6, head: 6 })
    expect(adapter.applyFormulaReference(0).changed).toBe(true)
    const json = adapter.documentJSON()
    const id = json.content?.[0]?.attrs?.['formulaId']
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/u)
    expect(JSON.stringify(json)).toContain('formulaReference')
    expect(host.querySelector('[data-formula-reference-target]')?.getAttribute('href')).toBe(`#wformula-${id}`)
    expect(adapter.undo()).toBe(true)
    expect(adapter.documentJSON().content?.[0]?.attrs?.['formulaId']).toBeNull()
    expect(host.querySelector('[data-formula-reference-target]')).toBeNull()
  } finally { adapter.destroy() }
})

it('keeps links in scope and refreshes labels after locale changes and target conversion', async () => {
  const { createUiLocalizationStore } = await import('../../packages/editor-vue/src/services/uiLocalization')
  const localization = createUiLocalizationStore('en')
  const host = document.createElement('div'); document.body.append(host)
  const session = new DocumentSession({ documentId: 'lifecycle', markdown: '$$\na=b\n$$\n<!-- w-editor-formula-id: stable -->\n\n[公式](#wformula-stable)' })
  const adapter = new TiptapVisualAdapter({ host, session, project: projectOrdinaryMarkdown, localization })
  try {
    const reference = host.querySelector<HTMLElement>('[data-formula-reference-target]')!
    const target = host.querySelector<HTMLElement>('.formula-node--block')!
    expect(reference.textContent).toBe('Equation 1')
    localization.setLocale('ru')
    expect(reference.textContent).toBe('Формула 1')
    reference.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(target)
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(adapter.applyFormula('inline', 'a=b').changed).toBe(true)
    expect(reference.textContent).toBe('Формула (недоступна)')
    expect(reference.hasAttribute('href')).toBe(false)
    expect(adapter.undo()).toBe(true)
    expect(reference.textContent).toBe('Формула 1')
  } finally { adapter.destroy() }
})

it('preserves target identity for internal drag moves while copied drops get a new identity', () => {
  const { editor } = mount([{ type: 'formulaBlock', attrs: { content: 'a=b', formulaId: 'stable' } }, paragraph])
  const original = editor.state.doc.slice(0, 1)
  editor.view.dragging = { slice: original, move: true }
  let moved = original
  editor.view.someProp('transformPasted', transform => { moved = transform(moved, editor.view, false) })
  expect(moved.content.firstChild?.attrs['formulaId']).toBe('stable')
  editor.view.dragging = { slice: original, move: false }
  let copied = original
  editor.view.someProp('transformPasted', transform => { copied = transform(copied, editor.view, false) })
  expect(copied.content.firstChild?.attrs['formulaId']).not.toBe('stable')
  editor.view.dragging = null
})
