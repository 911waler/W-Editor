import CSL from 'citeproc'
import { JOURNAL_REFERENCE_STYLES, type JournalReferenceStyle, type DocumentReference, type ReferenceMetadata, type ReferenceStyle } from '@w-editor/editor-core'
import apa from './csl/apa.csl?raw'
import mla from './csl/modern-language-association.csl?raw'
import gbt from './csl/china-national-standard-gb-t-7714-2025-numeric.csl?raw'
import en from './csl/locales-en-US.xml?raw'
import zh from './csl/locales-zh-CN.xml?raw'

export const REFERENCE_STYLE_LABELS: Readonly<Record<ReferenceStyle, string>> = {
  ...Object.fromEntries(JOURNAL_REFERENCE_STYLES.map(style => [style.id, style.label])) as Record<JournalReferenceStyle, string>,
  plain: '原始文本', gbt7714: 'GB/T 7714—2025', apa: 'APA 7', mla: 'MLA 9',
}
// Adapt only bibliography XML instructions. Never strip prefixes from rendered titles.
function withoutBibliographyLabel(xml: string): string {
  return xml.replace(/<bibliography\b[\s\S]*?<\/bibliography>/u, bibliography =>
    bibliography.replace(/<text\b(?=[^>]*\bvariable="citation-number")[^>]*\/>/gu, ''))
}
const styles: Partial<Record<ReferenceStyle, string>> = { apa, mla, gbt7714: withoutBibliographyLabel(gbt) }
const journalLoaders: Record<JournalReferenceStyle, () => Promise<{ default: string }>> = {
  'journal:nature@1': () => import('./csl/journals/nature.csl?raw'),
  'journal:science@1': () => import('./csl/journals/science.csl?raw'),
  'journal:physical-review-b@1': () => import('./csl/journals/american-physics-society.csl?raw'),
  'journal:physical-review-letters@1': () => import('./csl/journals/american-physics-society.csl?raw'),
  'journal:physics-letters-a@1': () => import('./csl/journals/elsevier-with-titles.csl?raw'),
  'journal:journal-of-materiomics@1': () => import('./csl/journals/elsevier-vancouver.csl?raw'),
}
const pending = new Map<ReferenceStyle, Promise<void>>()
const listeners = new Set<() => void>()
export function onReferenceStylesLoaded(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function areReferenceStylesReady(selected: readonly ReferenceStyle[]): boolean {
  return selected.every(style => style === 'plain' || styles[style] !== undefined)
}
/** Local dynamic imports only. Await before exporting or committing a style selection. */
export async function ensureReferenceStyles(selected: readonly ReferenceStyle[]): Promise<void> {
  await Promise.all([...new Set(selected)].map(async style => {
    if (style === 'plain' || styles[style] !== undefined) return
    let loading = pending.get(style)
    if (!loading) {
      const loader = journalLoaders[style as JournalReferenceStyle]
      if (!loader) throw new TypeError('Invalid reference style')
      loading = loader().then(module => {
        styles[style] = withoutBibliographyLabel(module.default)
        for (const listener of listeners) listener()
      }).finally(() => { pending.delete(style) })
      pending.set(style, loading)
    }
    await loading
  }))
}
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
  if (!styles[style]) {
    void ensureReferenceStyles([style]).catch(() => { /* UI can retry and surface explicit load failures. */ })
    return reference.text
  }
  const key = JSON.stringify([style, reference.metadata])
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  let state = engines.get(style)
  if (!state) {
    const holder = { item: {} as Record<string, unknown> }
    const engine = new CSL.Engine({ retrieveLocale: language => language.startsWith('zh') ? zh : en, retrieveItem: () => holder.item }, styles[style]!)
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
