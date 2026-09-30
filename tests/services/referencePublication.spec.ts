import { describe, expect, it } from 'vitest'
import { DocumentSession, referenceMarkdown, scanReferences, referenceRegistry } from '../../packages/editor-core/src'
import { publishReferenceSnapshot } from '../../packages/editor-vue/src/services/referencePublication'
const source = referenceMarkdown({ id: 'ref', number: 8, text: 'A book' })
function session() { return new DocumentSession({ documentId: 'references', markdown: source }) }
describe('reference publication', () => {
  it('publishes normalized snapshot, then updates unchanged draft', async () => {
    const document = session()
    const published = await publishReferenceSnapshot(document, async snapshot => {
      expect(scanReferences(snapshot.markdown)[0]?.number).toBe(1)
      expect(document.snapshot().markdown).toBe(source)
    }, async () => {})
    expect(document.snapshot()).toEqual(published)
  })
  it('starts a new numbering history after publishing so retired numbers cannot collide', async () => {
    const document = session()
    const registry = referenceRegistry(document)
    registry.observe([{ id: 'retired', number: 1, text: 'Retired book' }])
    await publishReferenceSnapshot(document, async () => {}, async () => {})
    expect(registry.adopt({ id: 'retired', number: 1, text: 'Retired book' }).number).toBe(2)
  })
  it('preserves the draft on publication failure', async () => {
    const document = session()
    await expect(publishReferenceSnapshot(document, async () => { throw new Error('offline') }, async () => {})).rejects.toThrow('offline')
    expect(document.snapshot().markdown).toBe(source)
    expect(document.snapshot().revision).toBe(0)
  })
  it('does not overwrite newer input including buffered visual input', async () => {
    const document = session()
    let flushes = 0
    await publishReferenceSnapshot(document, async () => {}, async () => {
      if (++flushes === 2) document.commitSource({ markdown: source + ' new input', origin: 'cherry-source' })
    })
    expect(document.snapshot().markdown).toBe(source + ' new input')
  })
})
