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
export type ReferenceStyle = 'plain' | 'gbt7714' | 'apa' | 'mla'
export function parseReferenceStyle(value: unknown): ReferenceStyle {
  if (value === 'plain' || value === 'gbt7714' || value === 'apa' || value === 'mla') return value
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
