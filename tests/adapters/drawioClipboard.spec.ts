import { expect, it } from 'vitest'
import { TiptapTransactionPatchPlanner, TiptapVisualAdapter, serializeOrdinaryTiptapPatch, type VisualSemanticBlockSelection } from '../../src/adapters'
import { drawioSource, projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

function fixture(markdown: string) {
  const host = document.createElement('div')
  document.body.append(host)
  const session = new DocumentSession({documentId: 'drawio-clipboard', markdown})
  const plans: PatchPlan[] = []
  const failures: unknown[] = []
  const edits: VisualSemanticBlockSelection[] = []
  const adapter = new TiptapVisualAdapter({
    host, session, project: projectOrdinaryMarkdown,
    patchPlanner: new TiptapTransactionPatchPlanner({
      createTransactionId: () => `drawio-clipboard:${plans.length + 1}`,
      serialize: serializeOrdinaryTiptapPatch,
    }),
    onTransaction: ({patchPlan}) => { if (patchPlan !== null) plans.push(patchPlan) },
    onTransactionFailure: ({failure}) => { failures.push(failure) },
    onSemanticEdit: event => { edits.push(event) },
  })
  const commit = () => {
    expect(failures).toEqual([])
    const plan = plans.at(-1)
    expect(plan).toBeDefined()
    session.commitPatchPlan(plan!)
    const snapshot = session.snapshot()
    adapter.acknowledgeSynchronization({map: projectOrdinaryMarkdown(snapshot).map, snapshot})
  }
  return {host, session, adapter, plans, failures, edits, commit, destroy: () => { adapter.destroy(); host.remove() }}
}

function clipboardEvent(type: 'copy' | 'cut' | 'paste', data: Map<string, string>) {
  const event = new Event(type, {bubbles: true, cancelable: true})
  Object.defineProperty(event, 'clipboardData', {value: {
    clearData: () => data.clear(),
    getData: (format: string) => data.get(format) ?? '',
    setData: (format: string, value: string) => data.set(format, value),
    files: [], items: [], types: [...data.keys()],
  }})
  return event
}

it.each([false, true])('copies a draw.io node to another editor retaining XML (HTML only: %s)', htmlOnly => {
  const png = '/synthetic-diagram.png'
  const xml = '<mxfile><diagram id="clipboard"><mxGraphModel><root/></mxGraphModel></diagram></mxfile>'
  const source = drawioSource('Synthetic architecture', png, xml)
  const from = fixture(source)
  const target = fixture('Target')
  try {
    from.host.querySelector<HTMLElement>('[data-semantic-kind="drawio"] img')!.click()
    expect(from.adapter.selection().kind).toBe('node')
    const clipboard = new Map<string, string>()
    from.host.querySelector('.ProseMirror')!.dispatchEvent(clipboardEvent('copy', clipboard))
    expect(clipboard.get('text/plain')).toBe(source)
    expect(clipboard.get('text/html')).toContain('data-drawio-source=')
    if (htmlOnly) clipboard.delete('text/plain')
    target.adapter.setSelection({anchor: 1, head: 1})
    target.host.querySelector('.ProseMirror')!.dispatchEvent(clipboardEvent('paste', clipboard))
    const nodes = target.adapter.documentJSON().content ?? []
    const pasted = nodes.find(node => node.type === 'semanticBlock')
    expect(pasted?.attrs).toMatchObject({kind: 'drawio', name: 'Synthetic architecture', png, xml, source})
    target.commit()
    expect(target.session.snapshot().markdown).toBe(`${source}\n\nTarget`)
    target.host.querySelector<HTMLElement>('[data-semantic-kind="drawio"] img')!
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    expect(target.edits.at(-1)).toMatchObject({kind: 'drawio', name: 'Synthetic architecture', png, xml, source})
  } finally { from.destroy(); target.destroy() }
})

it.each(['before', 'after'])('pastes %s the original without overwriting it, including history and reopening', position => {
  const xml = '<mxfile host="中文 &amp; &quot;host&quot;"><diagram name="A &lt; B"><mxGraphModel/></diagram></mxfile>\n'
  const source = drawioSource('图表 <A> & "B"', 'data:image/png;base64,AAAA', xml)
  const original = `Before\n\n${source}\n\nAfter`
  const app = fixture(original)
  try {
    app.host.querySelector<HTMLElement>('[data-semantic-kind="drawio"] img')!.click()
    const clipboard = new Map<string, string>()
    app.host.querySelector('.ProseMirror')!.dispatchEvent(clipboardEvent('copy', clipboard))
    const end = app.adapter.schema().nodeFromJSON(app.adapter.documentJSON()).content.size - 1
    app.adapter.setSelection({anchor: position === 'before' ? 1 : end, head: position === 'before' ? 1 : end})
    app.host.querySelector('.ProseMirror')!.dispatchEvent(clipboardEvent('paste', clipboard))
    app.commit()
    const expected = position === 'before' ? `${source}\n\n${original}` : `${original}\n\n${source}`
    expect(app.session.snapshot().markdown).toBe(expected)
    expect(app.host.querySelectorAll('[data-semantic-kind="drawio"]')).toHaveLength(2)
    expect(app.adapter.undo()).toBe(true)
    app.commit()
    expect(app.session.snapshot().markdown).toBe(original)
    expect(app.adapter.redo()).toBe(true)
    app.commit()
    expect(app.session.snapshot().markdown).toBe(expected)
    const reopened = fixture(expected)
    try {
      const nodes = reopened.adapter.documentJSON().content?.filter(node => node.type === 'semanticBlock')
      expect(nodes?.map(node => node.attrs?.['xml'])).toEqual([xml, xml])
      expect(reopened.host.querySelectorAll('[data-semantic-kind="drawio"]')).toHaveLength(2)
    } finally { reopened.destroy() }
  } finally { app.destroy() }
})

it('copies surrounding paragraphs and a diagram as one editable clipboard fragment', () => {
  const source = drawioSource('Architecture', '/diagram.png', '<mxfile><diagram id="mixed"/></mxfile>')
  const original = `Before\n\n${source}\n\nAfter`
  const from = fixture(original)
  const target = fixture('Target')
  try {
    const end = from.adapter.schema().nodeFromJSON(from.adapter.documentJSON()).content.size - 1
    from.adapter.setSelection({anchor: 1, head: end})
    const clipboard = new Map<string, string>()
    from.host.querySelector('.ProseMirror')!.dispatchEvent(clipboardEvent('copy', clipboard))
    expect(clipboard.get('text/plain')).toBe(original)
    target.adapter.setSelection({anchor: 7, head: 7})
    target.host.querySelector('.ProseMirror')!.dispatchEvent(clipboardEvent('paste', clipboard))
    target.commit()
    expect(target.session.snapshot().markdown).toBe(`TargetBefore\n\n${source}\n\nAfter`)
    target.adapter.insertText('!')
    target.commit()
    expect(target.session.snapshot().markdown.endsWith('After!')).toBe(true)
    expect(from.session.snapshot().markdown).toBe(original)
  } finally { from.destroy(); target.destroy() }
})

it('restores only validated diagram data when HTML also contains conflicting bare attributes', () => {
  const xml = '<mxfile><diagram id="trusted"/></mxfile>'
  const source = drawioSource('Trusted diagram', '/trusted.png', xml)
  const app = fixture('Target')
  try {
    const figure = document.createElement('figure')
    figure.dataset['wEditorNode'] = 'semantic-block'
    figure.dataset['semanticKind'] = 'drawio'
    figure.setAttribute('data-drawio-source', source)
    for (const [key, value] of Object.entries({
      kind: 'unknown', name: 'Other name', png: 'javascript:alert(1)', source: 'unvalidated replacement',
      xml: '<other/>', editorId: 'other-editor', identity: 'Other identity',
      'data-projection-id': 'copied-untrusted-id', 'data-codec-id': 'other-codec',
    })) figure.setAttribute(key, value)
    const clipboard = new Map([['text/html', figure.outerHTML]])
    app.adapter.setSelection({anchor: 1, head: 1})
    app.host.querySelector('.ProseMirror')!.dispatchEvent(clipboardEvent('paste', clipboard))
    const pasted = app.adapter.documentJSON().content?.find(node => node.type === 'semanticBlock')
    expect(pasted?.attrs).toMatchObject({kind: 'drawio', name: 'Trusted diagram', png: '/trusted.png', xml, source, editorId: 'drawio-editor'})
    app.commit()
    expect(app.session.snapshot().markdown).toBe(`${source}\n\nTarget`)
  } finally { app.destroy() }
})

it.each([undefined, 'not a diagram', '![bad](javascript:alert){data-type=drawio data-xml=%3Cmxfile%3E}'])('keeps only the preview when editable metadata is absent or invalid: %j', metadata => {
  const app = fixture('Target')
  try {
    const figure = document.createElement('figure')
    figure.dataset['wEditorNode'] = 'semantic-block'
    figure.dataset['semanticKind'] = 'drawio'
    if (metadata !== undefined) figure.setAttribute('data-drawio-source', metadata)
    const img = document.createElement('img')
    img.src = '/legacy-preview.png'
    img.alt = 'Legacy preview'
    figure.append(img)
    const clipboard = new Map([['text/html', figure.outerHTML]])
    app.adapter.setSelection({anchor: 1, head: 1})
    app.host.querySelector('.ProseMirror')!.dispatchEvent(clipboardEvent('paste', clipboard))
    expect(app.host.querySelector('[data-semantic-kind="unknown"]')).toBeNull()
    expect(app.host.querySelector('[data-semantic-kind="drawio"]')).toBeNull()
    app.commit()
    expect(app.session.snapshot().markdown).toContain('![Legacy preview](/legacy-preview.png)')
    expect(app.session.snapshot().markdown).not.toContain('javascript:')
  } finally { app.destroy() }
})
