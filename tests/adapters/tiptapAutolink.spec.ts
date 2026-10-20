import { describe, expect, it } from 'vitest'

import { TiptapTransactionPatchPlanner, TiptapVisualAdapter, serializeOrdinaryTiptapPatch } from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'

function mount(markdown = '') {
  const host = document.createElement('div')
  document.body.append(host)
  const session = new DocumentSession({ documentId: 'autolink', markdown })
  const plans: PatchPlan[] = []
  const failures: unknown[] = []
  const adapter = new TiptapVisualAdapter({
    host,
    session,
    project: projectOrdinaryMarkdown,
    patchPlanner: new TiptapTransactionPatchPlanner({
      createTransactionId: () => `autolink:${plans.length + 1}`,
      serialize: serializeOrdinaryTiptapPatch,
    }),
    onTransaction: ({ patchPlan }) => { if (patchPlan !== null) plans.push(patchPlan) },
    onTransactionFailure: ({ failure }) => { failures.push(failure) },
  })
  const commit = () => {
    expect(failures).toEqual([])
    const plan = plans.at(-1)
    if (plan === undefined) throw new Error('Expected an editable Markdown patch')
    session.commitPatchPlan(plan)
    const snapshot = session.snapshot()
    adapter.acknowledgeSynchronization({ snapshot, map: projectOrdinaryMarkdown(snapshot).map })
  }
  const type = (text: string) => {
    for (const character of text) {
      adapter.insertText(character)
      commit()
    }
  }
  const paste = (text: string, html = '') => {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: {
      getData: (format: string) => format === 'text/plain' ? text : format === 'text/html' ? html : '',
      files: [],
      items: [],
      types: html ? ['text/plain', 'text/html'] : ['text/plain'],
    } })
    host.querySelector('.ProseMirror')!.dispatchEvent(event)
    commit()
  }
  return { adapter, host, session, commit, type, paste, destroy: () => { adapter.destroy(); host.remove() } }
}

const plainTexts = ['ph.in', 'pw.in', 'example.com', 'www.example.com', 'user@example.com', 'ftp://example.com/file']
const explicitUrls = ['http://example.com/path', 'https://example.com/ph.in', 'HTTPS://example.com/path']

describe('visual automatic links require an explicit HTTP(S) protocol', () => {
  it.each(plainTexts)('keeps typed %s as plain text after a space and reopening', (text) => {
    const fixture = mount()
    try {
      fixture.type(`${text} `)
      expect(fixture.host.querySelector('a')).toBeNull()
      expect(fixture.session.snapshot().markdown).toBe(`${text} `)
      const reopened = mount(fixture.session.snapshot().markdown)
      try {
        expect(reopened.adapter.text()).toBe(`${text} `)
        expect(reopened.host.querySelector('a')).toBeNull()
      } finally { reopened.destroy() }
    } finally { fixture.destroy() }
  })

  it.each(explicitUrls)('automatically links typed %s after a space', (url) => {
    const fixture = mount()
    try {
      fixture.type(`${url} `)
      expect(fixture.host.querySelector('a')?.getAttribute('href')).toBe(url)
      expect(fixture.host.querySelector('a')?.textContent).toBe(url)
    } finally { fixture.destroy() }
  })

  describe.each([false, true])('plain-text paste with a selection: %s', (selected) => {
    it.each(plainTexts)('pastes %s as text without creating a link', (text) => {
      const fixture = mount(selected ? 'label' : '')
      try {
        if (selected) fixture.adapter.setSelection({ anchor: 1, head: 6 })
        fixture.paste(text)
        expect(fixture.adapter.text()).toBe(text)
        expect(fixture.host.querySelector('a')).toBeNull()
        expect(fixture.session.snapshot().markdown).toBe(text)
      } finally { fixture.destroy() }
    })

    it.each(explicitUrls)('automatically links pasted %s', (url) => {
      const fixture = mount(selected ? 'label' : '')
      try {
        if (selected) fixture.adapter.setSelection({ anchor: 1, head: 6 })
        fixture.paste(url)
        const label = selected ? 'label' : url
        expect(fixture.adapter.text()).toBe(label)
        expect(fixture.host.querySelector('a')?.getAttribute('href')).toBe(url)
        if (selected) expect(fixture.session.snapshot().markdown).toBe(`[label](${url})`)
      } finally { fixture.destroy() }
    })
  })

  it('keeps unlinked HTML filenames plain while preserving explicit pasted links', () => {
    const plain = mount()
    const linked = mount()
    try {
      plain.paste('ph.in', '<p>ph.in</p>')
      expect(plain.session.snapshot().markdown).toBe('ph.in')
      expect(plain.host.querySelector('a')).toBeNull()
      linked.paste('ph.in', '<p><a href="ph.in">ph.in</a></p>')
      expect(linked.session.snapshot().markdown).toBe('[ph.in](ph.in)')
      expect(linked.host.querySelector('a')?.getAttribute('href')).toBe('ph.in')
    } finally { plain.destroy(); linked.destroy() }
  })

  it.each(['ph.in', 'mailto:user@example.com', 'http://ph.in'])('preserves manual and saved links to %s', (href) => {
    const fixture = mount('label')
    try {
      fixture.adapter.setSelection({ anchor: 1, head: 6 })
      expect(fixture.adapter.applyLink(href).changed).toBe(true)
      fixture.commit()
      expect(fixture.session.snapshot().markdown).toBe(`[label](${href})`)
      const reopened = mount(fixture.session.snapshot().markdown)
      try { expect(reopened.host.querySelector('a')?.getAttribute('href')).toBe(href) }
      finally { reopened.destroy() }
    } finally { fixture.destroy() }
  })

  it('does not automatically link HTTP(S) text typed inside inline code', () => {
    const fixture = mount('`code`')
    try {
      fixture.adapter.setSelection({ anchor: 3, head: 3 })
      fixture.type(' https://example.com ')
      expect(fixture.host.querySelector('a')).toBeNull()
      expect(fixture.host.querySelector('code')?.textContent).toContain('https://example.com')
    } finally { fixture.destroy() }
  })
})
