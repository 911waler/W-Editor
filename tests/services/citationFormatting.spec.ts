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
