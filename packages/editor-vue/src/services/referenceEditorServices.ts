import { parseReferenceMetadata, parseReferenceStyle, type DocumentReference, type ReferenceMetadata } from '@w-editor/editor-core'

export type LibraryEntry = Omit<DocumentReference, 'number'>
export interface ReferenceLibrary {
  readonly revision: number
  readonly entries: readonly LibraryEntry[]
  readonly deletedIds: readonly string[]
  readonly highWater: number
}
export const emptyReferenceLibrary = (): ReferenceLibrary => ({ revision: 0, entries: [], deletedIds: [], highWater: 0 })
const validReferenceId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/u.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id)
export function parseReferenceLibrary(value: unknown): ReferenceLibrary {
  if (!value || typeof value !== 'object') throw new Error('文献库格式不正确。')
  const v = value as ReferenceLibrary
  if (!Number.isSafeInteger(v.revision) || v.revision < 0 || !Number.isSafeInteger(v.highWater) || v.highWater < 0
    || !Array.isArray(v.entries) || !Array.isArray(v.deletedIds) || v.entries.length > 2000 || v.deletedIds.length > 10000) throw new Error('文献库格式不正确。')
  const ids = new Set<string>()
  const entries = v.entries.map(entry => {
    if (!entry || !validReferenceId(entry.id) || ids.has(entry.id) || typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 10000) throw new Error('文献资料无效。')
    if (entry.metadata) {
      if ((entry.metadata.authors?.length ?? 0) > 200) throw new Error('文献作者过多。')
      for (const field of Object.values(entry.metadata)) if (typeof field === 'string' && field.length > 10000) throw new Error('文献资料过长。')
      for (const author of entry.metadata.authors ?? []) for (const field of Object.values(author)) if (typeof field === 'string' && field.length > 10000) throw new Error('文献作者资料过长。')
    }
    ids.add(entry.id)
    return { id: entry.id, text: entry.text, ...(entry.metadata === undefined ? {} : { metadata: parseReferenceMetadata(entry.metadata) }), ...(entry.style === undefined ? {} : { style: parseReferenceStyle(entry.style) }) }
  })
  const deletedIds = v.deletedIds.map(id => {
    if (!validReferenceId(id) || ids.has(id)) throw new Error('文献删除记录无效。')
    ids.add(id)
    return id
  })
  if (new TextEncoder().encode(JSON.stringify({ entries, deletedIds, highWater: v.highWater })).length > 4 * 1024 * 1024) throw new Error('文献库过大。')
  return { revision: v.revision, entries, deletedIds, highWater: v.highWater }
}

export interface ReferenceNote { readonly text: string; readonly revision: number }
export interface ReferenceEditorServices {
  readonly loadNotes: (documentId: string) => Promise<Readonly<Record<string, ReferenceNote>>>
  readonly saveNote: (documentId: string, referenceId: string, input: ReferenceNote) => Promise<ReferenceNote>
  readonly loadLibrary?: (documentId: string) => Promise<ReferenceLibrary>
  readonly saveLibrary?: (documentId: string, input: ReferenceLibrary) => Promise<ReferenceLibrary>
  readonly lookupDoi?: (documentId: string, doi: string, signal?: AbortSignal) => Promise<ReferenceMetadata>
}

/** Notes are deliberately separate from document snapshots, exports and clipboard data. */
export function createLocalReferenceServices(storage: Storage): ReferenceEditorServices {
  const validId = (id: string) => /^[a-zA-Z0-9_-]{1,128}$/u.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id)
  const key = (id: string) => `w-editor:editor-reference-notes:v1:${encodeURIComponent(id)}`
  const load = (id: string): Record<string, ReferenceNote> => {
    const raw = storage.getItem(key(id))
    if (!raw) return Object.create(null) as Record<string, ReferenceNote>
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('文献备注存储已损坏，请先备份。')
    const notes: Record<string, ReferenceNote> = Object.create(null) as Record<string, ReferenceNote>
    for (const [referenceId, item] of Object.entries(value)) {
      if (!validId(referenceId) || typeof item !== 'object' || item === null
        || !('text' in item) || typeof item.text !== 'string' || item.text.length > 10000 || !('revision' in item)
        || typeof item.revision !== 'number' || !Number.isSafeInteger(item.revision) || item.revision < 1) throw new Error('文献备注存储格式不正确。')
      notes[referenceId] = { text: item.text, revision: item.revision }
    }
    return notes
  }
  const libraryKey = (id: string) => `w-editor:editor-reference-library:v1:${encodeURIComponent(id)}`
  const loadLibrary = (id: string) => {
    const raw = storage.getItem(libraryKey(id))
    return raw === null ? emptyReferenceLibrary() : parseReferenceLibrary(JSON.parse(raw))
  }
  return {
    loadLibrary: async id => loadLibrary(id),
    saveLibrary: async (id, input) => {
      const clean = parseReferenceLibrary(input)
      const save = () => {
        const previous = loadLibrary(id)
        if (previous.revision !== clean.revision) throw Object.assign(new Error('文献库已被其他窗口修改，请重试合并。'), { code: 'REVISION_CONFLICT' })
        if (clean.revision >= Number.MAX_SAFE_INTEGER) throw new Error('文献库版本超出限制。')
        const next = { ...clean, highWater: Math.max(previous.highWater, clean.highWater), revision: clean.revision + 1 }
        storage.setItem(libraryKey(id), JSON.stringify(next))
        return next
      }
      return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request(libraryKey(id), save) : save()
    },
    loadNotes: async id => load(id),
    saveNote: async (id, referenceId, input) => {
      if (!validId(referenceId) || typeof input.text !== 'string' || input.text.length > 10000
        || !Number.isSafeInteger(input.revision) || input.revision < 0 || input.revision >= Number.MAX_SAFE_INTEGER) throw new Error('备注或文献标识无效。')
      const save = (): ReferenceNote => {
        const notes = load(id)
        if ((notes[referenceId]?.revision ?? 0) !== input.revision) throw new Error('备注已被其他窗口修改，请重新载入后合并。')
        const note = { text: input.text, revision: input.revision + 1 }
        notes[referenceId] = note
        storage.setItem(key(id), JSON.stringify(notes))
        return note
      }
      // Web Locks make read/check/write atomic between tabs of the same origin.
      // Older standalone environments retain synchronous same-window semantics.
      return typeof navigator !== 'undefined' && navigator.locks
        ? navigator.locks.request(key(id), save)
        : save()
    },
  }
}
