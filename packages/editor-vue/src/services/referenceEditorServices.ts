import type { ReferenceMetadata } from '@w-editor/editor-core'

export interface ReferenceNote { readonly text: string; readonly revision: number }
export interface ReferenceEditorServices {
  readonly loadNotes: (documentId: string) => Promise<Readonly<Record<string, ReferenceNote>>>
  readonly saveNote: (documentId: string, referenceId: string, input: ReferenceNote) => Promise<ReferenceNote>
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
  return {
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
