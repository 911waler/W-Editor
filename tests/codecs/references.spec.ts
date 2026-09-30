import { describe, expect, it } from 'vitest'
import { referenceMarkdown, scanReferences, normalizeReferences, createReference, ReferenceRegistry } from '../../packages/editor-core/src/codecs/references'

describe('reference source', () => {
  const a = { id: 'alpha', number: 7, text: 'https://example.org/a?q="中文"' }
  const b = { id: 'beta', number: 3, text: '10.1234/abc' }
  it('round trips arbitrary reference text and stable identity', () => {
    const source = referenceMarkdown(a)
    expect(scanReferences(source)[0]).toMatchObject(a)
  })
  it('normalizes only at publication, ordered by first occurrence', () => {
    const source = `${referenceMarkdown(a)} then ${referenceMarkdown(b)} and ${referenceMarkdown(a)}`
    expect(scanReferences(source).map(r => r.number)).toEqual([7, 3, 7])
    const normalized = normalizeReferences(source)
    expect(scanReferences(normalized).map(r => r.number)).toEqual([1, 2, 1])
    expect(normalizeReferences(normalized)).toBe(normalized)
  })
  it('does not modify code, escaped links, comments or formulas', () => {
    const ref = referenceMarkdown(a)
    const source = `\`${ref}\`\n\n\`\`\`md\n${ref}\n\`\`\`\n\n\\${ref}\n<!-- ${ref} -->\n$${ref}$`
    expect(scanReferences(source)).toEqual([])
    expect(normalizeReferences(source)).toBe(source)
  })
  it('reuses DOI identity and allocates above the high water mark', () => {
    const source = referenceMarkdown(b)
    expect(createReference(source, 'https://doi.org/10.1234/abc', 'new', 10)).toMatchObject(b)
    expect(createReference(source, 'A book', 'new', 10).number).toBe(11)
  })
  it('includes nested lists while excluding indented code', () => {
    const source = `- Parent\n    - Child ${referenceMarkdown(a)}\n\nLater ${referenceMarkdown(b)}\n\n    code ${referenceMarkdown(a)}`
    expect(scanReferences(normalizeReferences(source)).map(item => item.number)).toEqual([1, 2])
    expect(normalizeReferences(source)).toContain(`    code ${referenceMarkdown(a)}`)
  })
  it('keeps cut references and retired numbers in session history', () => {
    const registry = new ReferenceRegistry()
    registry.observe([a, b])
    registry.observe([b])
    expect(registry.adopt(a)).toEqual(a)
    expect(registry.adopt({ id: 'new', number: 1, text: 'New work' }).number).toBe(8)
  })
  it('rejects malformed encoded references without losing source', () => {
    expect(scanReferences('[2](#wref-bad~%ZZ)')).toEqual([])
  })
})
