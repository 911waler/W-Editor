import { describe, expect, it, vi } from 'vitest'
import { formatReference } from '../../packages/editor-vue/src/services/citationFormatting'
import CSL from 'citeproc'
import type { DocumentReference } from '../../packages/editor-core/src/codecs/references'
const reference: DocumentReference = { id: 'a', number: 19, text: 'Original manual wording', metadata: { title: 'Example title', authors: [{ family: 'Smith', given: 'Jane' }], year: '2020', journal: 'Example Journal', volume: '4', issue: '2', pages: '10-20', type: 'article-journal' } }
describe('CSL bibliography entries', () => {
  it('retains manual source text in plain mode and for incomplete metadata', () => {
    expect(formatReference(reference)).toBe(reference.text)
    expect(formatReference({ ...reference, style: 'apa', metadata: { doi: '10.1000/test' } })).toBe(reference.text)
  })
  it('uses APA 7 bibliography punctuation without a numeric label', () => {
    expect(formatReference({ ...reference, style: 'apa' })).toBe('Smith, J. (2020). Example title. Example Journal, 4(2), 10–20.')
  })
  it('uses MLA 9 and GB/T 7714-2025 official bibliography styles without app numbering', () => {
    expect(formatReference({ ...reference, style: 'mla' })).toContain('Smith, Jane.')
    const gbt = formatReference({ ...reference, style: 'gbt7714' })
    expect(gbt).toContain('Example title[J]')
    expect(gbt).not.toMatch(/^\s*\[\d+\]/u)
    expect(gbt).not.toContain('<')
  })
  it('does not mutate source metadata or lose updates when formatting cached entries', () => {
    const styled = { ...reference, style: 'apa' as const }
    const before = JSON.stringify(styled)
    const first = formatReference(styled)
    expect(formatReference({ ...styled, number: 20 })).toBe(first)
    expect(formatReference({ ...styled, metadata: { ...styled.metadata, title: 'Changed' } })).toContain('Changed')
    expect(JSON.stringify(styled)).toBe(before)
  })
  it('does no processor work for unchanged bibliographic content', () => {
    const styled = { ...reference, style: 'apa' as const, metadata: { ...reference.metadata, title: 'Cache probe' } }
    formatReference(styled)
    const spy = vi.spyOn(CSL.Engine.prototype, 'updateItems')
    expect(formatReference({ ...styled, id: 'different', number: 100 })).toContain('Cache probe')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

})

import { JOURNAL_REFERENCE_STYLES, parseReferenceStyle, referenceMarkdown, parseReferenceAt } from '../../packages/editor-core/src'
import { ensureReferenceStyles, onReferenceStylesLoaded } from '../../packages/editor-vue/src/services/citationFormatting'
import { renderSafeTiptapExportDocument } from '../../packages/editor-vue/src/services/browserFileExport'
import { buildReferenceList, hydrateReferenceStyles } from '../../packages/editor-vue/src/adapters/referenceNode'

describe('bundled journal bibliography styles', () => {
  it('round-trips only known versioned IDs and rejects remote or future styles', () => {
    for (const style of JOURNAL_REFERENCE_STYLES) {
      expect(parseReferenceStyle(style.id)).toBe(style.id)
      const encoded = referenceMarkdown({ ...reference, style: style.id })
      expect(parseReferenceAt(encoded, 0)?.style).toBe(style.id)
    }
    for (const unknown of ['journal:nature@2', 'journal:unknown@1', 'https://example.com/style.csl']) {
      expect(() => parseReferenceStyle(unknown)).toThrow('Invalid reference style')
    }
  })
  it('updates an already rendered cold bibliography and notifies Vue consumers', async () => {
    const styled: DocumentReference = { ...reference, style: 'journal:nature@1' }
    const notify = vi.fn()
    const stop = onReferenceStylesLoaded(notify)
    const list = buildReferenceList([styled], document)
    expect(list.querySelector('span')?.textContent).toBe(reference.text)
    const exportRoot = document.createElement('div')
    exportRoot.className = 'ProseMirror'
    const snapshot = { documentId: 'journal', revision: 1, markdown: referenceMarkdown(styled) }
    expect(() => renderSafeTiptapExportDocument(snapshot, exportRoot)).toThrow('finish loading')
    await ensureReferenceStyles([styled.style!])
    expect(list.querySelector('span')?.textContent).toContain('Smith')
    expect(list.querySelector('span')?.textContent).not.toBe(reference.text)
    expect(renderSafeTiptapExportDocument(snapshot, exportRoot).bodyHtml).toContain('Smith')
    expect(notify).toHaveBeenCalledTimes(1)
    stop()
  })
  it('uses the pinned independent parent for each journal and leaves app labels out', async () => {
    await ensureReferenceStyles(JOURNAL_REFERENCE_STYLES.map(style => style.id))
    const output = JOURNAL_REFERENCE_STYLES.map(style => formatReference({ ...reference, style: style.id }))
    for (const text of output) {
      expect(text).toContain('Smith')
      expect(text).toContain('2020')
      expect(text).not.toMatch(/^\s*(?:\[1\]|1[.\s])/u)
    }
    expect(output[2]).toBe(output[3]) // PRB/PRL resolve to the same official APS parent.
    expect(output[0]).not.toBe(output[1])
    expect(output[4]).not.toBe(output[5])
  })
  it('preserves numeric title prefixes and original metadata', async () => {
    const styled: DocumentReference = { ...reference, style: 'journal:nature@1', metadata: { title: '1984 observations', year: '2024' } }
    const before = JSON.stringify(styled)
    await ensureReferenceStyles([styled.style!])
    expect(formatReference(styled)).toContain('1984 observations')
    expect(JSON.stringify(styled)).toBe(before)
    expect(formatReference({ ...styled, metadata: { doi: '10.1234/test' } })).toBe(reference.text)
  })
  it('hydrates serialized bibliography rows from preserved citation payloads', async () => {
    const styled: DocumentReference = { ...reference, style: 'journal:science@1' }
    const root = document.createElement('div')
    const anchor = document.createElement('a')
    anchor.dataset['referenceSource'] = referenceMarkdown(styled)
    root.append(anchor)
    const dispose = hydrateReferenceStyles(root)
    await ensureReferenceStyles([styled.style!])
    expect(root.querySelector('.w-reference-list span')?.textContent).toContain('Smith')
    expect(root.querySelector('.w-reference-list a')?.textContent).toBe('[19]')
    dispose()
  })
})
