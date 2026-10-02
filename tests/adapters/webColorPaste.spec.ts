import { describe, expect, it } from 'vitest'

import { TiptapTransactionPatchPlanner, TiptapVisualAdapter, serializeOrdinaryTiptapPatch } from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

function mount(markdown: string) {
  const host = document.createElement('div')
  document.body.append(host)
  const session = new DocumentSession({ documentId: 'web-color-paste', markdown })
  const failures: unknown[] = []
  const plans: PatchPlan[] = []
  const adapter = new TiptapVisualAdapter({
    host,
    onTransaction: ({ patchPlan }) => { if (patchPlan !== null) plans.push(patchPlan) },
    onTransactionFailure: ({ failure }) => { failures.push(failure) },
    patchPlanner: new TiptapTransactionPatchPlanner({
      createTransactionId: () => 'web-color:paste',
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

describe('webpage color paste', () => {
  it.each(['rgb(93, 93, 93)', '#5d5d5d'])('preserves text and styles after paste, reload and editing: %s', (color) => {
    const fixture = mount('')
    try {
      const text = '除了向量的标量积之外，请使用“x”而不是中心点。'
      const clipboard = new Map([
        ['text/plain', text],
        ['text/html', `<p><span style="font-size:16px;color:${color}">${text}</span></p>`],
      ])
      fixture.host.querySelector('.ProseMirror')!.dispatchEvent(clipboardEvent('paste', clipboard))
      fixture.commit()
      expect(fixture.session.snapshot().markdown).toBe(`!16 !!#5d5d5d ${text}!!!`)
      const loaded = mount(fixture.session.snapshot().markdown)
      try {
        expect(loaded.host.querySelector('.ProseMirror')!.textContent).toBe(text)
        loaded.adapter.setSelection({ anchor: 1, head: 1 })
        loaded.adapter.insertText('新增')
        loaded.commit()
        expect(loaded.host.querySelector('.ProseMirror')!.textContent).toBe(`新增${text}`)
      } finally { loaded.destroy(); }
    } finally { fixture.destroy(); }
  })
  it('round trips adjacent webpage spans with emphasis and RGB background', () => {
    const fixture = mount('')
    try {
      const text = '使用“x”而不是中心点。'
      const html = '<p><span style="font-size:16px;color:rgb(93, 93, 93)">使用“</span><em>x</em><span style="font-size:16px;color:rgb(93, 93, 93);background-color:rgb(255, 255, 0)">”而不是中心点。</span></p>'
      const clipboard = new Map([['text/plain', text], ['text/html', html]])
      fixture.host.querySelector('.ProseMirror')!.dispatchEvent(clipboardEvent('paste', clipboard))
      fixture.commit()
      const loaded = mount(fixture.session.snapshot().markdown)
      try { expect(loaded.host.querySelector('.ProseMirror')!.textContent).toBe(text) }
      finally { loaded.destroy() }
    } finally { fixture.destroy() }
  })

  it('reads already saved nested RGB marks without exposing source', () => {
    const fixture = mount('!16 !!rgb(93, 93, 93) 网页文字!!!')
    try {
      expect(fixture.host.querySelector('.ProseMirror')!.textContent).toBe('网页文字')
      expect(fixture.session.snapshot().markdown).toBe('!16 !!rgb(93, 93, 93) 网页文字!!!')
      fixture.adapter.setSelection({ anchor: 1, head: 1 })
      fixture.adapter.insertText('新增')
      fixture.commit()
      expect(fixture.host.querySelector('.ProseMirror')!.textContent).toBe('新增网页文字')
    } finally { fixture.destroy(); }
  })
})
