/** Public bibliographic facts only. Editor notes must never enter this payload. */
export interface ReferenceAuthor { readonly family?: string; readonly given?: string; readonly literal?: string }
export interface ReferenceMetadata {
  readonly doi?: string
  readonly title?: string
  readonly authors?: readonly ReferenceAuthor[]
  readonly year?: string
  readonly journal?: string
  readonly volume?: string
  readonly issue?: string
  readonly pages?: string
  readonly url?: string
  readonly publisher?: string
  readonly type?: 'article-journal' | 'book' | 'webpage'
}
/** Curated CSL catalog; IDs version the bundled definition, never a remote URL. */
export const JOURNAL_REFERENCE_STYLES = [
  { id: 'journal:nature@1', label: 'Nature', aliases: [], issns: ["0028-0836", "1476-4687"] },
  { id: 'journal:science@1', label: 'Science', aliases: [], issns: ["0036-8075", "1095-9203"] },
  { id: 'journal:physical-review-b@1', label: 'Physical Review B', aliases: ['PRB', 'Phys. Rev. B'], issns: ["2469-9950", "2469-9969"] },
  { id: 'journal:physical-review-letters@1', label: 'Physical Review Letters', aliases: ['PRL', 'Phys. Rev. Lett.'], issns: ["0031-9007", "1079-7114"] },
  { id: 'journal:physics-letters-a@1', label: 'Physics Letters A', aliases: [], issns: ["0375-9601"] },
  { id: 'journal:journal-of-materiomics@1', label: 'Journal of Materiomics', aliases: [], issns: ["2352-8478"] },
  { id: 'journal:applied-physics-letters@1', label: 'Applied Physics Letters', aliases: ['APL', 'Appl. Phys. Lett.'], issns: ["0003-6951", "1077-3118"] },
] as const
export type JournalReferenceStyle = typeof JOURNAL_REFERENCE_STYLES[number]['id']
export type ReferenceStyle = 'plain' | 'gbt7714' | 'apa' | 'mla' | JournalReferenceStyle
export function parseReferenceStyle(value: unknown): ReferenceStyle {
  if (value === 'plain' || value === 'gbt7714' || value === 'apa' || value === 'mla') return value
  for (const style of JOURNAL_REFERENCE_STYLES) if (value === style.id) return style.id
  throw new TypeError('Invalid reference style')
}
/** Whitelisting prevents editor-only fields from leaking through untrusted pasted data. */
export function parseReferenceMetadata(value: unknown): ReferenceMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Invalid reference metadata')
  const input = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of ['doi', 'title', 'year', 'journal', 'volume', 'issue', 'pages', 'url', 'publisher']) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string') throw new TypeError('Invalid reference field')
      result[key] = input[key]
    }
  }
  if (input['type'] !== undefined) {
    if (!['article-journal', 'book', 'webpage'].includes(String(input['type']))) throw new TypeError('Invalid reference type')
    result['type'] = input['type']
  }
  if (input['authors'] !== undefined) {
    if (!Array.isArray(input['authors'])) throw new TypeError('Invalid reference authors')
    result['authors'] = input['authors'].map(author => {
      if (!author || typeof author !== 'object' || Array.isArray(author)) throw new TypeError('Invalid reference author')
      const clean: Record<string, string> = {}
      for (const key of ['family', 'given', 'literal']) {
        if (author[key] !== undefined) {
          if (typeof author[key] !== 'string') throw new TypeError('Invalid reference author field')
          clean[key] = author[key]
        }
      }
      return clean
    })
  }
  return result as ReferenceMetadata
}
