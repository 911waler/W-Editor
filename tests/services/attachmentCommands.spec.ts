import { describe, expect, it } from 'vitest'

import { attachmentSource } from '../../src/codecs'
import { attachmentAtSelection, createAttachmentCommandPlan } from '../../src/services'

describe('attachment command plans', () => {
  it('inserts and replaces typed attachment links in one checked patch', () => {
    const original = attachmentSource({
      kind: 'pdf', mediaType: 'application/pdf', name: 'Original.pdf', size: 10, url: 'https://assets.example.test/original.pdf',
    })
    const markdown = `Before\n\n${original}\n\nAfter`
    const selection = { from: markdown.indexOf('Original'), to: markdown.indexOf('Original') }
    expect(attachmentAtSelection(markdown, selection)?.kind).toBe('pdf')
    const result = createAttachmentCommandPlan(
      { documentId: 'attachment-edit', markdown, revision: 4 },
      selection,
      { kind: 'pdf', mediaType: 'application/pdf', name: 'Updated.pdf', size: 20, url: 'https://assets.example.test/updated.pdf' },
      'attachment-edit:1',
    )
    expect(result.plan.patches[0]).toEqual({
      codecId: 'attachment-pdf',
      expected: original,
      from: markdown.indexOf(original),
      replacement: result.source,
      to: markdown.indexOf(original) + original.length,
    })
    expect(result.source).toContain('kind=pdf;mediaType=application%2Fpdf;size=20')
  })
})
