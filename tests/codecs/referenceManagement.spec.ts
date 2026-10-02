import { describe, expect, it } from 'vitest'
import { DocumentSession } from '../../packages/editor-core/src/core/documentSession'
import { referenceMarkdown, scanReferences, ReferenceRegistry, updateReferencePlan, removeReferencePlan } from '../../packages/editor-core/src/codecs/references'

const reference = { id: 'a', number: 7, text: 'Manual source', metadata: { title: '研究', authors: [{ family: 'Doe', given: 'Jane' }], year: '2024' }, style: 'apa' as const }
describe('reference management', () => {
  it('roundtrips optional metadata/style while retaining legacy text exactly', () => {
    expect(scanReferences(referenceMarkdown(reference))[0]).toMatchObject(reference)
    expect(referenceMarkdown({ id: 'old', number: 1, text: '{"v":1} ~ !' })).toBe('[1](#wref-old~%7B%22v%22%3A1%7D%20~%20%21)')
    expect(scanReferences(referenceMarkdown({ id: 'old', number: 1, text: '{"v":1} ~ !' }))[0]?.text).toBe('{"v":1} ~ !')
  })
  it('updates every active occurrence but leaves code examples unchanged, preserving fields', () => {
    const link = referenceMarkdown(reference)
    const session = new DocumentSession({ documentId: 'doc', markdown: `${link} and ${link}\n\n\`${link}\`` })
    session.commitPatchPlan(updateReferencePlan(session.snapshot(), 'a', { text: 'Edited', metadata: reference.metadata, style: reference.style }, 'edit'))
    expect(scanReferences(session.snapshot().markdown)).toHaveLength(2)
    expect(scanReferences(session.snapshot().markdown).every(r => r.text === 'Edited' && r.metadata?.title === '研究' && r.number === 7)).toBe(true)
    expect(session.snapshot().markdown).toContain(`\`${link}\``)
    session.commitPatchPlan(removeReferencePlan(session.snapshot(), 'a', 'remove'))
    expect(session.snapshot().markdown).toBe(` and \n\n\`${link}\``)
  })
  it('clears optional metadata and style when replacing the public fields', () => {
    const session = new DocumentSession({ documentId: 'doc', markdown: referenceMarkdown(reference) })
    session.commitPatchPlan(updateReferencePlan(session.snapshot(), 'a', { text: 'Raw text' }, 'clear'))
    expect(scanReferences(session.snapshot().markdown)[0]).toEqual({ id: 'a', number: 7, text: 'Raw text', from: 0, to: session.snapshot().markdown.length })
  })
  it('rejects missing IDs and stale plans through the document authority', () => {
    const session = new DocumentSession({ documentId: 'doc', markdown: referenceMarkdown(reference) })
    expect(() => removeReferencePlan(session.snapshot(), 'missing', 'remove')).toThrow()
    const plan = updateReferencePlan(session.snapshot(), 'a', { text: 'new' }, 'edit')
    session.commitSource({ markdown: 'other', origin: 'cherry-source' })
    expect(() => session.commitPatchPlan(plan)).toThrow(expect.objectContaining({ code: 'STALE_REVISION' }))
  })
  it('forgets explicit deletions without recycling numbers and adopts current metadata', () => {
    const registry = new ReferenceRegistry()
    registry.observe([reference])
    registry.observe([{ ...reference, metadata: { title: 'Updated' } }])
    expect(registry.adopt(reference).metadata?.title).toBe('Updated')
    registry.forget('a')
    expect(registry.adopt(reference)).toMatchObject({ ...reference, number: 8 })
  })
  it('rejects malformed structured data and never serializes editor notes', () => {
    const payload = { ...reference, metadata: { ...reference.metadata, notes: 'PRIVATE', authors: [{ literal: 'Team', notes: 'PRIVATE' }] }, notes: 'PRIVATE' }
    const serialized = referenceMarkdown(payload)
    expect(decodeURIComponent(serialized)).not.toContain('PRIVATE')
    for (const bad of [{ text: 'ok', metadata: { authors: [null] } }, { text: 'ok', style: 'unknown' }, { text: 'ok', metadata: { title: 1 } }]) {
      expect(scanReferences(`[1](#wref2-id~${encodeURIComponent(JSON.stringify(bad))})`)).toEqual([])
    }
  })

})
