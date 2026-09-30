import CSL from 'citeproc'
import type { DocumentReference, ReferenceMetadata, ReferenceStyle } from '@w-editor/editor-core'
import apa from './csl/apa.csl?raw'
import mla from './csl/modern-language-association.csl?raw'
import gbt from './csl/china-national-standard-gb-t-7714-2025-numeric.csl?raw'
import en from './csl/locales-en-US.xml?raw'
import zh from './csl/locales-zh-CN.xml?raw'

export const REFERENCE_STYLE_LABELS: Readonly<Record<ReferenceStyle, string>> = {
  plain: '原始文本', gbt7714: 'GB/T 7714—2025', apa: 'APA 7', mla: 'MLA 9',
}
// The app owns numbering. Remove only this exact CSL bibliography label instruction,
// never a prefix of the formatted title (which can itself begin with a number).
const styles = { apa, mla, gbt7714: gbt.replace('<text variable="citation-number" prefix="[" suffix="]"/>', '') }
const engines = new Map<Exclude<ReferenceStyle, 'plain'>, { engine: InstanceType<typeof CSL.Engine>; item: Record<string, unknown> }>()
const cache = new Map<string, string>()
const CACHE_LIMIT = 512
function cslItem(metadata: ReferenceMetadata): Record<string, unknown> {
  return {
    id: 'entry', type: metadata.type ?? 'article-journal', title: metadata.title,
    author: metadata.authors?.map(author => ({ ...author })),
    ...(metadata.year ? { issued: /^\d{1,4}$/u.test(metadata.year) ? { 'date-parts': [[Number(metadata.year)]] } : { literal: metadata.year } } : {}),
    'container-title': metadata.journal, volume: metadata.volume, issue: metadata.issue,
    page: metadata.pages, DOI: metadata.doi, URL: metadata.url, publisher: metadata.publisher,
  }
}
/** Format one bibliography entry; numeric order and labels remain owned by the app. */
export function formatReference(reference: DocumentReference): string {
  const style = reference.style ?? 'plain'
  if (style === 'plain' || !reference.metadata?.title?.trim()) return reference.text
  const key = JSON.stringify([style, reference.metadata])
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  let state = engines.get(style)
  if (!state) {
    const holder = { item: {} as Record<string, unknown> }
    const engine = new CSL.Engine({ retrieveLocale: language => language.startsWith('zh') ? zh : en, retrieveItem: () => holder.item }, styles[style])
    engine.setOutputFormat('text')
    state = Object.assign(holder, { engine })
    engines.set(style, state)
  }
  // Clear processor item cache before reusing the stable one-entry ID.
  state.engine.updateItems([])
  state.item = cslItem(reference.metadata)
  state.engine.updateItems(['entry'])
  const bibliography = state.engine.makeBibliography()
  const result = bibliography && bibliography[1][0]?.trim()
  const formatted = result || reference.text
  cache.set(key, formatted)
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
  return formatted
}
