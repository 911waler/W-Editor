import { describe, expect, it } from 'vitest'

import { TiptapTransactionPatchPlanner, TiptapVisualAdapter, serializeOrdinaryTiptapPatch } from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs'
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
      fixture.adapter.setSelection({ anchor: 1, head: 1 })
      editable.dispatchEvent(clipboardEvent('paste', clipboard))
      fixture.commit()
      expect(fixture.session.snapshot().markdown).toBe(`${source}\n\nTarget\n\nMiddle\n\n${source}`)
    } finally { fixture.destroy() }
  })

  const cases = (['inline', 'block'] as const).flatMap((mode) =>
    [false, true].flatMap((legacy) => [
      { mode, legacy, content: String.raw`\frac{a_{1}+b^2}{c} < x & y` },
      { mode, legacy, content: mode === 'inline'
        ? '\\langle a \\mid b \\rangle + "x" & y < z'
        : '\\langle a \\mid b \\rangle % comment\n + "x" & y < z' },
    ]))

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
