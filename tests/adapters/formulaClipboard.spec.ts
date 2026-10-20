import type { Editor } from '@tiptap/core'
import { describe, expect, it, vi } from 'vitest'

import { TiptapTransactionPatchPlanner, TiptapVisualAdapter, serializeOrdinaryTiptapPatch } from '../../src/adapters'
import { formulaReferenceCandidates, projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

function mount(markdown: string) {
  const host = document.createElement('div')
  document.body.append(host)
  const session = new DocumentSession({ documentId: 'formula-clipboard', markdown })
  const failures: unknown[] = []
  const plans: PatchPlan[] = []
  const adapter = new TiptapVisualAdapter({
    host,
    onTransaction: ({ patchPlan }) => { if (patchPlan !== null) plans.push(patchPlan) },
    onTransactionFailure: ({ failure }) => { failures.push(failure) },
    patchPlanner: new TiptapTransactionPatchPlanner({
      createTransactionId: () => 'formula:paste',
      serialize: serializeOrdinaryTiptapPatch,
    }),
    project: projectOrdinaryMarkdown,
    session,
  })
  const commit = () => {
    expect(failures).toEqual([])
    const plan = plans.at(-1)
    expect(plan).toBeDefined()
    session.commitPatchPlan(plan!)
    const snapshot = session.snapshot()
    adapter.acknowledgeSynchronization({ map: projectOrdinaryMarkdown(snapshot).map, snapshot })
  }
  return { adapter, commit, failures, host, plans, session, destroy: () => { adapter.destroy(); host.remove() } }
}

function clipboardEvent(type: 'copy' | 'paste', data: Map<string, string>): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: {
    clearData: () => data.clear(),
    getData: (format: string) => data.get(format) ?? '',
    setData: (format: string, value: string) => data.set(format, value),
    files: [],
    items: [],
    types: [...data.keys()],
  } })
  return event
}

describe('formula clipboard', () => {
  it.each([false, true])('copies a complete paragraph with a formula (different editor: %s)', (differentEditor) => {
    const paragraph = 'Before $E=mc^2$ after'
    const source = mount(`${paragraph}\n\nMiddle\n\nTarget`)
    const target = differentEditor ? mount('Target') : source
    try {
      const first = source.adapter.schema().nodeFromJSON(source.adapter.documentJSON()).firstChild!
      source.adapter.setSelection({ anchor: 1, head: first.nodeSize - 1 })
      const clipboard = new Map<string, string>()
      source.host.querySelector('.ProseMirror')!.dispatchEvent(clipboardEvent('copy', clipboard))
      expect(clipboard.get('text/plain')).toBe(paragraph)
      const end = target.adapter.schema().nodeFromJSON(target.adapter.documentJSON()).content.size - 1
      target.adapter.setSelection({ anchor: end, head: end })
      target.host.querySelector('.ProseMirror')!.dispatchEvent(clipboardEvent('paste', clipboard))
      target.commit()
      expect(target.session.snapshot().markdown).toBe(`${differentEditor ? '' : `${paragraph}\n\nMiddle\n\n`}Target${paragraph}`)
      target.adapter.insertText('!')
      target.commit()
      expect(target.session.snapshot().markdown.endsWith(`${paragraph}!`)).toBe(true)
      if (differentEditor) expect(source.session.snapshot().markdown).toBe(`${paragraph}\n\nMiddle\n\nTarget`)
    } finally {
      if (differentEditor) target.destroy()
      source.destroy()
    }
  })

  it('pastes a block before its original without replacing the original or another paragraph', () => {
    const source = '$$\nE=mc^2\n$$'
    const fixture = mount(`Target\n\nMiddle\n\n${source}`)
    try {
      const editable = fixture.host.querySelector('.ProseMirror')!
      fixture.host.querySelector('[data-formula-mode="block"]')!
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
      const clipboard = new Map<string, string>()
      editable.dispatchEvent(clipboardEvent('copy', clipboard))
      expect(clipboard.get('text/plain')).toBe(source)
      fixture.adapter.setSelection({ anchor: 1, head: 1 })
      editable.dispatchEvent(clipboardEvent('paste', clipboard))
      fixture.commit()
      expect(fixture.session.snapshot().markdown).toBe(`${source}\n\nTarget\n\nMiddle\n\n${source}`)
    } finally { fixture.destroy() }
  })

  it('copies only the selected text and inline formula, excluding surrounding content', () => {
    const fixture = mount('Outside $a$ before $E=mc^2$ after $b$ outside')
    try {
      fixture.adapter.setSelection({ anchor: 11, head: 26 })
      const clipboard = new Map<string, string>()
      fixture.host.querySelector('.ProseMirror')!.dispatchEvent(clipboardEvent('copy', clipboard))
      expect(clipboard.get('text/plain')).toBe('before $E=mc^2$ after ')
    } finally { fixture.destroy() }
  })

  it('copies multiple blocks with inline and display formulas in document order', () => {
    const markdown = 'Before $a+b$ after\n\n$$\n\\frac{a}{b}\n$$\n\nThen $c=d$ end'
    const fixture = mount(markdown)
    try {
      const end = fixture.adapter.schema().nodeFromJSON(fixture.adapter.documentJSON()).content.size - 1
      fixture.adapter.setSelection({ anchor: 1, head: end })
      const clipboard = new Map<string, string>()
      fixture.host.querySelector('.ProseMirror')!.dispatchEvent(clipboardEvent('copy', clipboard))
      expect(clipboard.get('text/plain')).toBe(markdown)
    } finally { fixture.destroy() }
  })

  const cases = (['inline', 'block'] as const).flatMap((mode) =>
    [false, true].flatMap((legacy) => [
      { mode, legacy, content: String.raw`\frac{a_{1}+b^2}{c} < x & y` },
      { mode, legacy, content: '\\langle a \\mid b \\rangle % comment\n + "x" & y < z' },
    ]))

  it.each(['   ', 'a $$ b', 'a % $$ comment\n + b', '  E=mc^2  '])('copies a formula block verbatim without validating its body: %j', (content) => {
    const markdown = `Before\n\n$$\n${content}\n$$\n\nAfter`
    const fixture = mount(markdown)
    try {
      const end = fixture.adapter.schema().nodeFromJSON(fixture.adapter.documentJSON()).content.size - 1
      fixture.adapter.setSelection({ anchor: 1, head: end })
      const clipboard = new Map<string, string>()
      fixture.host.querySelector('.ProseMirror')!.dispatchEvent(clipboardEvent('copy', clipboard))
      expect(clipboard.get('text/plain')).toBe(markdown)
      expect(clipboard.get('text/html')).toContain('data-formula-content=')
      expect(fixture.session.snapshot().markdown).toBe(markdown)
    } finally { fixture.destroy() }
  })

  it('preserves whitespace in copied inline formula source', () => {
    const markdown = 'Before $  a+b  $ after'
    const fixture = mount(markdown)
    try {
      const end = fixture.adapter.schema().nodeFromJSON(fixture.adapter.documentJSON()).content.size - 1
      fixture.adapter.setSelection({ anchor: 1, head: end })
      const clipboard = new Map<string, string>()
      fixture.host.querySelector('.ProseMirror')!.dispatchEvent(clipboardEvent('copy', clipboard))
      expect(clipboard.get('text/plain')).toBe(markdown)
    } finally { fixture.destroy() }
  })

  it.each(cases)('copies and pastes $mode formulas (legacy HTML: $legacy, LaTeX: $content)', ({ mode, legacy, content }) => {
    const source = mode === 'inline' ? `$${content}$` : `$$\n${content}\n$$`
    const original = mode === 'inline' ? `Alpha ${source} omega` : source
    const fixture = mount(`${original}\n\nTarget`)
    try {
      const editable = fixture.host.querySelector<HTMLElement>('.ProseMirror')!
      fixture.host.querySelector<HTMLElement>(`[data-formula-mode="${mode}"]`)!
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
      const clipboard = new Map<string, string>()
      editable.dispatchEvent(clipboardEvent('copy', clipboard))
      expect(clipboard.get('text/plain')).toBe(source)
      expect(clipboard.get('text/html')).toContain('data-w-editor-node="formula"')
      if (legacy) {
        const wrapper = document.createElement('div')
        wrapper.innerHTML = clipboard.get('text/html')!
        wrapper.querySelectorAll('[data-formula-content]').forEach((formula) => formula.removeAttribute('data-formula-content'))
        clipboard.set('text/html', wrapper.innerHTML)
      }

      const end = fixture.adapter.schema().nodeFromJSON(fixture.adapter.documentJSON()).content.size - 1
      fixture.adapter.setSelection({ anchor: end, head: end })
      editable.dispatchEvent(clipboardEvent('paste', clipboard))

      fixture.commit()
      const expected = `${original}\n\nTarget${mode === 'inline' ? '' : '\n\n'}${source}`
      expect(fixture.session.snapshot().markdown).toBe(expected)

      expect(fixture.adapter.undo()).toBe(true)
      fixture.commit()
      expect(fixture.session.snapshot().markdown).toBe(`${original}\n\nTarget`)
      expect(fixture.adapter.redo()).toBe(true)
      fixture.commit()
      expect(fixture.session.snapshot().markdown).toBe(expected)

      const reopened = mount(fixture.session.snapshot().markdown)
      try {
        const formulas: string[] = []
        reopened.adapter.schema().nodeFromJSON(reopened.adapter.documentJSON()).descendants((node) => {
          if (node.type.name === 'inlineFormula' || node.type.name === 'formulaBlock') formulas.push(node.attrs['content'])
        })
        expect(formulas).toEqual([content, content])
      } finally { reopened.destroy() }
    } finally { fixture.destroy() }
  })
})

it('duplicates a formula with a new identity and remaps references copied with it', () => {
  const fixture = mount('Before\n\n$$\na=b\n$$\n<!-- w-editor-formula-id: original -->\n\n[公式](#wformula-original)\n\nTarget')
  try {
    const doc = fixture.adapter.schema().nodeFromJSON(fixture.adapter.documentJSON())
    fixture.adapter.setSelection({ anchor: 1, head: doc.child(0).nodeSize + doc.child(1).nodeSize + doc.child(2).nodeSize - 1 })
    const clipboard = new Map<string, string>()
    const editable = fixture.host.querySelector('.ProseMirror')!
    editable.dispatchEvent(clipboardEvent('copy', clipboard))
    expect(clipboard.get('text/plain')).toContain('w-editor-formula-id: original')
    const end = doc.content.size - 1
    fixture.adapter.setSelection({ anchor: end, head: end })
    editable.dispatchEvent(clipboardEvent('paste', clipboard))
    fixture.commit()
    const blocks = [...fixture.host.querySelectorAll<HTMLElement>('.formula-node--block')]
    expect(blocks).toHaveLength(2)
    expect(blocks[0]?.dataset['formulaId']).toBe('original')
    expect(blocks[1]?.dataset['formulaId']).not.toBe('original')
    const id = blocks[1]!.dataset['formulaId']!
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/u)
    const links = [...fixture.host.querySelectorAll('a[data-formula-reference-target]')]
    expect(links.map(link => link.getAttribute('href'))).toEqual(['#wformula-original', `#wformula-${id}`])
    expect(fixture.session.snapshot().markdown).toContain(`<!-- w-editor-formula-id: ${id} -->`)
    expect(fixture.session.snapshot().markdown).toContain(`[公式](#wformula-${id})`)
  } finally { fixture.destroy() }
})

it.each([
  { label: 'copies when Ctrl is pressed after dragstart', startCopy: false, dropCopy: true, count: 2 },
  { label: 'moves when Ctrl is released after dragstart', startCopy: true, dropCopy: false, count: 1 },
])('$label without breaking the original formula reference', ({ startCopy, dropCopy, count }) => {
  const fixture = mount('$$\na=b\n$$\n<!-- w-editor-formula-id: original -->\n\n[公式](#wformula-original)\n\nEnd')
  try {
    const editable = fixture.host.querySelector<HTMLElement>('.ProseMirror')!
    // Tiptap attaches its owning Editor to the mounted editable DOM element.
    const editor = (editable as HTMLElement & { editor: Editor }).editor
    const block = fixture.host.querySelector<HTMLElement>('.formula-node--block')!
    fixture.adapter.selectDomBlock(block)
    // JSDOM has no layout; keep the real drag/drop handlers and supply hit tests.
    const hitTest = vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 0, inside: -1 })
    const data = new Map<string, string>()
    const dataTransfer = {
      clearData: () => data.clear(),
      getData: (format: string) => data.get(format) ?? '',
      setData: (format: string, value: string) => data.set(format, value),
      files: [],
      effectAllowed: '',
      get types() { return [...data.keys()] },
    }
    const dispatchDrag = (type: 'dragstart' | 'drop', ctrlKey: boolean) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, ctrlKey })
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
      editable.dispatchEvent(event)
    }
    dispatchDrag('dragstart', startCopy)
    hitTest.mockReturnValue({ pos: editor.state.doc.content.size, inside: -1 })
    dispatchDrag('drop', dropCopy)
    hitTest.mockRestore()

    const blocks = [...fixture.host.querySelectorAll<HTMLElement>('.formula-node--block')]
    expect(blocks).toHaveLength(count)
    const ids = blocks.map(formula => formula.dataset['formulaId'])
    expect(ids[0]).toBe('original')
    expect(new Set(ids).size).toBe(count)
    if (dropCopy) expect(ids[1]).toMatch(/^[A-Za-z0-9_-]+$/u)
    const reference = fixture.host.querySelector<HTMLAnchorElement>('[data-formula-reference-target]')!
    expect(reference.getAttribute('href')).toBe('#wformula-original')
    expect(reference.textContent).toBe('Equation 1')

    fixture.commit()
    const markdown = fixture.session.snapshot().markdown
    expect(formulaReferenceCandidates(markdown).map(formula => formula.formulaId)).toEqual(ids)
    expect(markdown.match(/<!-- w-editor-formula-id: original -->/gu)).toHaveLength(1)
    expect(markdown).toContain('[公式](#wformula-original)')
  } finally { fixture.destroy() }
})
