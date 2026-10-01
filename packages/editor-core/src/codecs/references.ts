import type { DocumentSnapshot, PatchPlan } from '../publicContracts'
import { parseReferenceMetadata, parseReferenceStyle, type ReferenceMetadata, type ReferenceStyle } from './referenceMetadata'

/** Self-contained links keep references portable when copying part of a document. */
export interface DocumentReference {
  readonly id: string
  readonly number: number
  readonly text: string
  readonly metadata?: ReferenceMetadata
  readonly style?: ReferenceStyle
}
export interface ReferenceOccurrence extends DocumentReference {
  readonly from: number
  readonly to: number
}

export function referenceMarkdown(reference: DocumentReference): string {
  if (!/^[a-zA-Z0-9_-]+$/u.test(reference.id) || !Number.isSafeInteger(reference.number) || reference.number < 1 || !reference.text.trim()) {
    throw new TypeError('Invalid reference')
  }
  const structured = reference.metadata !== undefined || reference.style !== undefined
  const data = structured ? JSON.stringify({
    text: reference.text,
    ...(reference.metadata !== undefined ? { metadata: parseReferenceMetadata(reference.metadata) } : {}),
    ...(reference.style !== undefined ? { style: parseReferenceStyle(reference.style) } : {}),
  }) : reference.text
  const encoded = encodeURIComponent(data).replace(/[!'()*]/gu, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `[${reference.number}](#wref${structured ? '2' : ''}-${reference.id}~${encoded})`
}

export function parseReferenceAt(source: string, offset: number): ReferenceOccurrence | null {
  if (source[offset] !== '[') return null
  const match = /^\[([1-9]\d*)\]\(#wref(2?)-([a-zA-Z0-9_-]+)~([^\s()]*)\)/u.exec(source.slice(offset))
  if (!match) return null
  try {
    const decoded = decodeURIComponent(match[4]!)
    const data = match[2] === '2' ? JSON.parse(decoded) : { text: decoded }
    const number = Number(match[1])
    if (typeof data?.text !== 'string' || !data.text.trim() || !Number.isSafeInteger(number)) return null
    return { id: match[3]!, number, text: data.text,
      ...(data.metadata !== undefined ? { metadata: parseReferenceMetadata(data.metadata) } : {}),
      ...(data.style !== undefined ? { style: parseReferenceStyle(data.style) } : {}),
      from: offset, to: offset + match[0].length }
  } catch { return null }
}

/** Invoked for reference actions and publication, never by ordinary input handlers. */
export function scanReferences(markdown: string): ReferenceOccurrence[] {
  const references: ReferenceOccurrence[] = []
  let offset = 0
  let fence: string | null = null
  const listIndents: number[] = []
  while (offset < markdown.length) {
    if (offset === 0 || markdown[offset - 1] === '\n') {
      const end = markdown.indexOf('\n', offset)
      const line = markdown.slice(offset, end < 0 ? undefined : end)
      const plainLine = line.replace(/^(?: {0,3}>[ \t]?)+/u, '').replace(/\t/gu, '    ')
      const indent = /^ */u.exec(plainLine)![0].length
      if (plainLine.trim()) {
        while (listIndents.length && indent < listIndents.at(-1)!) listIndents.pop()
      }
      const containerIndent = listIndents.at(-1) ?? 0
      const list = /^( *)(?:[-+*]|[0-9]+[.)]) +/u.exec(plainLine)
      const codeIndent = indent >= containerIndent + 4
      if (list && !codeIndent) listIndents.push(list[0].length)
      const boundary = /^ {0,3}(`{3,}|~{3,})/u.exec(plainLine.slice(containerIndent))
      if (boundary && (fence === null || (boundary[1]![0] === fence[0] && boundary[1]!.length >= fence.length))) {
        fence = fence === null ? boundary[1]! : null
        offset += line.length + 1
        continue
      }
      if (fence !== null || codeIndent) { offset += line.length + 1; continue }
    }
    if (markdown[offset] === '\\') { offset += 2; continue }
    if (markdown.startsWith('<!--', offset)) {
      const end = markdown.indexOf('-->', offset + 4)
      offset = end < 0 ? markdown.length : end + 3
      continue
    }
    if (markdown[offset] === '`' || markdown[offset] === '$') {
      const token = markdown[offset]!
      let length = 1
      while (markdown[offset + length] === token) length++
      const end = markdown.indexOf(token.repeat(length), offset + length)
      if (end >= 0) { offset = end + length; continue }
      offset += length
      continue
    }
    const reference = parseReferenceAt(markdown, offset)
    if (reference) { references.push(reference); offset = reference.to } else offset++
  }
  return references
}

export function referenceIdentity(text: string): string {
  const trimmed = text.trim()
  const doi = trimmed.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/iu, '')
  return /^10\.\d{4,9}\/\S+$/u.test(doi) ? `doi:${doi.toLowerCase()}` : trimmed
}

export function createReference(markdown: string, text: string, id: string, highWater = 0): DocumentReference {
  const references = scanReferences(markdown)
  const existing = references.find(reference => referenceIdentity(reference.text) === referenceIdentity(text))
  if (existing) return existing
  const reference = { id, number: Math.max(highWater, ...references.map(item => item.number), 0) + 1, text: text.trim() }
  referenceMarkdown(reference)
  return reference
}

export function normalizeReferences(markdown: string): string {
  const references = scanReferences(markdown)
  const numbers = new Map<string, number>()
  const replacements = references.map(reference => {
    if (!numbers.has(reference.id)) numbers.set(reference.id, numbers.size + 1)
    return { ...reference, number: numbers.get(reference.id)! }
  })
  for (const reference of replacements.reverse()) {
    markdown = markdown.slice(0, reference.from) + referenceMarkdown(reference) + markdown.slice(reference.to)
  }
  return markdown
}

export function referenceUrl(text: string): string | null {
  const identity = referenceIdentity(text)
  if (identity.startsWith('doi:')) return `https://doi.org/${identity.slice(4)}`
  try { const url = new URL(text); return ['http:', 'https:'].includes(url.protocol) ? url.href : null } catch { return null }
}

/** Session-scoped history survives deletion, cut/paste and surface switches. */
export class ReferenceRegistry {
  #known = new Map<string, DocumentReference>()
  #highWater = 0
  reset(references: readonly DocumentReference[]): void {
    this.#known.clear()
    this.#highWater = 0
    this.observe(references)
  }
  observe(references: readonly DocumentReference[]): void {
    for (const reference of references) {
      this.#known.set(reference.id, reference)
      this.#highWater = Math.max(this.#highWater, reference.number)
    }
  }
  reserveNumbersThrough(number: number): void {
    if (!Number.isSafeInteger(number) || number < 0) throw new TypeError('Invalid reference high-water number')
    this.#highWater = Math.max(this.#highWater, number)
  }
  forget(id: string): void { this.#known.delete(id) }
  adopt(reference: DocumentReference): DocumentReference {
    const existing = [...this.#known.values()].find(item => referenceIdentity(item.text) === referenceIdentity(reference.text))
    if (existing) return existing
    const number = ++this.#highWater
    let id = reference.id
    while (this.#known.has(id)) id += `-${number}`
    const result = { ...reference, id, number, text: reference.text.trim() }
    referenceMarkdown(result)
    this.#known.set(id, result)
    return result
  }
}
const registries = new WeakMap<object, ReferenceRegistry>()
export function referenceRegistry(session: { snapshot(): { markdown: string } }): ReferenceRegistry {
  let registry = registries.get(session)
  if (!registry) {
    registry = new ReferenceRegistry()
    registry.observe(scanReferences(session.snapshot().markdown))
    registries.set(session, registry)
  }
  return registry
}

/** Snapshot-bound plans are applied atomically by DocumentSession, which rejects stale revisions. */
export function updateReferencePlan(snapshot: DocumentSnapshot, id: string, change: Pick<DocumentReference, 'text' | 'metadata' | 'style'>, transactionId: string): PatchPlan {
  const occurrences = scanReferences(snapshot.markdown).filter(reference => reference.id === id)
  if (!occurrences.length) throw new RangeError('Reference is no longer present')
  const updated = { id, number: occurrences[0]!.number, ...change }
  referenceMarkdown(updated)
  return { baseRevision: snapshot.revision, transactionId, patches: occurrences.map(reference => ({
    codecId: 'reference', from: reference.from, to: reference.to,
    expected: snapshot.markdown.slice(reference.from, reference.to),
    replacement: referenceMarkdown({ ...updated, number: reference.number }),
  })) }
}
export function removeReferencePlan(snapshot: DocumentSnapshot, id: string, transactionId: string): PatchPlan {
  const occurrences = scanReferences(snapshot.markdown).filter(reference => reference.id === id)
  if (!occurrences.length) throw new RangeError('Reference is no longer present')
  return { baseRevision: snapshot.revision, transactionId, patches: occurrences.map(reference => ({
    codecId: 'reference', from: reference.from, to: reference.to,
    expected: snapshot.markdown.slice(reference.from, reference.to), replacement: '',
  })) }
}
