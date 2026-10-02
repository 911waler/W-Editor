import type { DocumentSnapshot, PatchPlan } from '../publicContracts'
import { parseReferenceStyle, type ReferenceStyle } from './referenceMetadata'
import { referenceMarkdown, scanReferences } from './references'

/** Only a complete marker on the first document line is document metadata. */
export function parseDocumentReferenceStyle(markdown: string): { style: ReferenceStyle; source: string; from: 0; to: number } | null {
  const match = /^<!-- w-editor-reference-style: ([a-z0-9:@-]+) -->(?=\r?\n|$)/u.exec(markdown)
  if (!match) return null
  try { return { style: parseReferenceStyle(match[1]), source: match[0], from: 0, to: match[0].length } }
  catch { return null }
}

export function getDocumentReferenceStyle(markdown: string): ReferenceStyle | null {
  return parseDocumentReferenceStyle(markdown)?.style ?? null
}

export function serializeDocumentReferenceStyle(style: ReferenceStyle): string {
  return `<!-- w-editor-reference-style: ${parseReferenceStyle(style)} -->`
}

/** Metadata and occurrences share a single authority commit and undo boundary. */
export function documentReferenceStylePlan(snapshot: DocumentSnapshot, style: ReferenceStyle, transactionId: string): PatchPlan {
  const replacement = serializeDocumentReferenceStyle(style)
  const marker = parseDocumentReferenceStyle(snapshot.markdown)
  const patches = scanReferences(snapshot.markdown).flatMap(reference => {
    const expected = snapshot.markdown.slice(reference.from, reference.to)
    const next = referenceMarkdown({ ...reference, style })
    return next === expected ? [] : [{ codecId: 'reference', from: reference.from, to: reference.to, expected, replacement: next }]
  })
  if (!marker && patches[0]?.from === 0) {
    patches[0] = { ...patches[0], replacement: `${replacement}\n\n${patches[0].replacement}` }
  } else if (marker?.source !== replacement) patches.unshift({
    codecId: 'reference-document-style', from: 0, to: marker?.to ?? 0,
    expected: marker?.source ?? '', replacement: marker ? replacement : `${replacement}\n\n`,
  })
  return { baseRevision: snapshot.revision, transactionId, patches }
}
