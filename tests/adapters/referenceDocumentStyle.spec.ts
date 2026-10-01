import { describe, expect, it } from 'vitest'
import { referenceMarkdown, scanReferences, getDocumentReferenceStyle, documentReferenceStylePlan, serializeDocumentReferenceStyle } from '../../packages/editor-core/src'
import { TiptapTransactionPatchPlanner, TiptapVisualAdapter, serializeOrdinaryTiptapPatch } from '../../src/adapters'
import { projectOrdinaryMarkdown } from '../../src/codecs'
import { DocumentSession, type PatchPlan } from '../../src/core'
import { createTiptapPresentation } from '../../packages/editor-vue/src/rendering/tiptapPresentation'
import { renderSafeTiptapExportDocument } from '../../packages/editor-vue/src/services/browserFileExport'

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


describe('portable document reference style', () => {
  it('recognizes only a valid first-line marker and preserves unknown source', () => {
    const marker = serializeDocumentReferenceStyle('apa')
    expect(getDocumentReferenceStyle(marker)).toBe('apa')
    for (const source of [`before\n${marker}`, `\n${marker}`, `\`\`\`\n${marker}\n\`\`\``, '<!-- w-editor-reference-style: unknown -->']) {
      expect(getDocumentReferenceStyle(source)).toBeNull()
      expect(projectOrdinaryMarkdown({ documentId: 'd', revision: 0, markdown: source }).content.content?.some(n => n.type === 'referenceDocumentStyle')).toBe(false)
    }
  })
  it('creates and updates source metadata and all occurrences in one plan', () => {
    const link = referenceMarkdown({ id: 'a', number: 1, text: 'A' })
    const session = new DocumentSession({ documentId: 'd', markdown: `${link} ${link}` })
    session.commitPatchPlan(documentReferenceStylePlan(session.snapshot(), 'apa', 'style-1'))
    expect(getDocumentReferenceStyle(session.snapshot().markdown)).toBe('apa')
    expect(scanReferences(session.snapshot().markdown).map(r => r.style)).toEqual(['apa', 'apa'])
    session.commitPatchPlan(documentReferenceStylePlan(session.snapshot(), 'mla', 'style-2'))
    expect(session.snapshot().markdown.match(/<!--/g)).toHaveLength(1)
    expect(getDocumentReferenceStyle(session.snapshot().markdown)).toBe('mla')
  })
  it.each(['apa', 'journal:nature@1'] as const)('persists empty-document %s style, reloads with an editable paragraph and keeps the marker while typing', style => {
    const source = mount('')
    let markdown = ''
    try {
      expect(source.adapter.setReferenceStyle(style).changed).toBe(true)
      source.commit()
      markdown = source.session.snapshot().markdown
      expect(getDocumentReferenceStyle(markdown)).toBe(style)
      expect(source.host.textContent).not.toContain('w-editor-reference-style')
      expect(source.adapter.undo()).toBe(true)
      source.commit()
      expect(getDocumentReferenceStyle(source.session.snapshot().markdown)).toBeNull()
      expect(source.adapter.redo()).toBe(true)
      source.commit()
      expect(getDocumentReferenceStyle(source.session.snapshot().markdown)).toBe(style)
    } finally { source.destroy() }
    const loaded = mount(markdown)
    try {
      loaded.adapter.setSelection({ anchor: 2, head: 2 })
      loaded.adapter.insertText('Text')
      loaded.commit()
      expect(getDocumentReferenceStyle(loaded.session.snapshot().markdown)).toBe(style)
      expect(loaded.session.snapshot().markdown).toContain('Text')
    } finally { loaded.destroy() }
  })
  it('keeps a marker-only imported file editable', () => {
    const source = mount(serializeDocumentReferenceStyle('journal:nature@1'))
    try {
      source.adapter.setSelection({ anchor: 2, head: 2 })
      source.adapter.insertText('Body')
      source.commit()
      expect(getDocumentReferenceStyle(source.session.snapshot().markdown)).toBe('journal:nature@1')
      expect(source.session.snapshot().markdown).toContain('Body')
    } finally { source.destroy() }
  })
  it('undoes the document style and citation styles together', () => {
    const link = referenceMarkdown({ id: 'a', number: 1, text: 'A', style: 'apa' })
    const source = mount(`${link} and ${link}`)
    try {
      source.adapter.setReferenceStyle('mla')
      source.commit()
      expect(getDocumentReferenceStyle(source.session.snapshot().markdown)).toBe('mla')
      expect(scanReferences(source.session.snapshot().markdown).map(r => r.style)).toEqual(['mla', 'mla'])
      source.adapter.setReferenceStyle('journal:nature@1')
      source.commit()
      expect(getDocumentReferenceStyle(source.session.snapshot().markdown)).toBe('journal:nature@1')
      expect(source.session.snapshot().markdown.match(/<!--/g)).toHaveLength(1)
      source.adapter.undo()
      source.commit()
      expect(getDocumentReferenceStyle(source.session.snapshot().markdown)).toBe('mla')
      expect(scanReferences(source.session.snapshot().markdown).map(r => r.style)).toEqual(['mla', 'mla'])
      source.adapter.undo()
      source.commit()
      expect(getDocumentReferenceStyle(source.session.snapshot().markdown)).toBeNull()
      expect(scanReferences(source.session.snapshot().markdown).map(r => r.style)).toEqual(['apa', 'apa'])
    } finally { source.destroy() }
  })
  it('hides the marker in presentation and exported text', () => {
    const snapshot = { documentId: 'd', revision: 0, markdown: `${serializeDocumentReferenceStyle('apa')}\n\nBody` }
    const host = document.createElement('div')
    const presentation = createTiptapPresentation(host, { snapshot, profile: 'reader' })
    try {
      expect(host.querySelector('.ProseMirror > p')?.textContent).toBe('Body')
      expect(host.textContent).not.toContain('w-editor-reference-style')
      const exported = renderSafeTiptapExportDocument(snapshot, host.querySelector<HTMLElement>('.ProseMirror')!)
      const body = document.createElement('div')
      body.innerHTML = exported.bodyHtml
      expect(body.textContent).toContain('Body')
      expect(body.textContent).not.toContain('w-editor-reference-style')
    } finally { presentation.destroy() }
  })
})
