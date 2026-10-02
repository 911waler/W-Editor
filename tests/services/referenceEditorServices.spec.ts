import { beforeEach, describe, expect, it } from 'vitest'
import { createLocalReferenceServices } from '../../packages/editor-vue/src/services/referenceEditorServices'

describe('local private reference notes', () => {
  beforeEach(() => localStorage.clear())
  it('isolates documents, shares same-document instances and retains deletion revisions', async () => {
    const first = createLocalReferenceServices(localStorage)
    const second = createLocalReferenceServices(localStorage)
    await first.saveNote('a/b', 'ref', { text: 'private', revision: 0 })
    expect(await second.loadNotes('a%2Fb')).toEqual({})
    expect(await second.loadNotes('a/b')).toEqual({ ref: { text: 'private', revision: 1 } })
    await expect(second.saveNote('a/b', 'ref', { text: 'stale', revision: 0 })).rejects.toThrow('修改')
    await second.saveNote('a/b', 'ref', { text: '', revision: 1 })
    expect(await first.loadNotes('a/b')).toEqual({ ref: { text: '', revision: 2 } })
    await expect(first.saveNote('a/b', 'ref', { text: 'ABA', revision: 0 })).rejects.toThrow('修改')
    expect(localStorage.length).toBe(1)
  })
  it.each(['__proto__', 'constructor', 'prototype', '../other', 'x/y', 'x'.repeat(129)])('rejects unsafe reference id %s', async id => {
    const service = createLocalReferenceServices(localStorage)
    await expect(service.saveNote('doc', id, { text: 'bad', revision: 0 })).rejects.toThrow()
    expect(localStorage.length).toBe(0)
  })
  it('validates text and revisions without replacing damaged stored notes', async () => {
    const service = createLocalReferenceServices(localStorage)
    for (const revision of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER]) {
      await expect(service.saveNote('doc', 'ref', { text: 'bad', revision })).rejects.toThrow()
    }
    await expect(service.saveNote('doc', 'ref', { text: 'x'.repeat(10001), revision: 0 })).rejects.toThrow()
    const key = 'w-editor:editor-reference-notes:v1:doc'
    localStorage.setItem(key, '{broken')
    await expect(service.saveNote('doc', 'ref', { text: 'new', revision: 0 })).rejects.toThrow()
    expect(localStorage.getItem(key)).toBe('{broken')
    localStorage.setItem(key, JSON.stringify({ ref: { text: 'x'.repeat(10001), revision: 1 } }))
    await expect(service.loadNotes('doc')).rejects.toThrow()
  })
  it('serializes optimistic writes through browser Web Locks when available', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'locks')
    const keys: string[] = []
    let tail = Promise.resolve()
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: (key: string, action: () => unknown) => {
        keys.push(key)
        const next = tail.then(action)
        tail = next.then(() => undefined, () => undefined)
        return next
      },
    } })
    try {
      const first = createLocalReferenceServices(localStorage)
      const second = createLocalReferenceServices(localStorage)
      const result = await Promise.allSettled([
        first.saveNote('doc', 'r', { text: 'one', revision: 0 }),
        second.saveNote('doc', 'r', { text: 'two', revision: 0 }),
      ])
      expect(result.map(item => item.status)).toEqual(['fulfilled', 'rejected'])
      expect(keys).toHaveLength(2)
      expect(keys[0]).toBe(keys[1])
    } finally {
      if (original) Object.defineProperty(navigator, 'locks', original)
      else Reflect.deleteProperty(navigator, 'locks')
    }
  })
})

describe('local private reference libraries', () => {
  beforeEach(() => localStorage.clear())
  it('checks revisions across instances and keeps high-water and tombstones', async () => {
    const a = createLocalReferenceServices(localStorage), b = createLocalReferenceServices(localStorage)
    const initial = { revision: 0, entries: [{ id: 'r', text: 'Paper' }], deletedIds: [], highWater: 8 }
    await a.saveLibrary!('doc', initial)
    await expect(b.saveLibrary!('doc', initial)).rejects.toThrow('修改')
    await b.saveLibrary!('doc', { revision: 1, entries: [], deletedIds: ['r'], highWater: 0 })
    expect(await a.loadLibrary!('doc')).toEqual({ revision: 2, entries: [], deletedIds: ['r'], highWater: 8 })
    expect(await a.loadLibrary!('other')).toEqual({ revision: 0, entries: [], deletedIds: [], highWater: 0 })
  })
  it('rejects malformed snapshots without overwriting durable data', async () => {
    const service = createLocalReferenceServices(localStorage)
    const base = { revision: 0, entries: [{ id: 'r', text: 'Paper' }], deletedIds: [], highWater: 0 }
    await expect(service.saveLibrary!('doc', { ...base, deletedIds: ['r'] })).rejects.toThrow()
    await expect(service.saveLibrary!('doc', { ...base, entries: [{ id: '__proto__', text: 'Invalid' }] })).rejects.toThrow()
    await expect(service.saveLibrary!('doc', { ...base, highWater: -1 })).rejects.toThrow()
    localStorage.setItem('w-editor:editor-reference-library:v1:doc', '{damaged')
    await expect(service.saveLibrary!('doc', base)).rejects.toThrow()
    expect(localStorage.getItem('w-editor:editor-reference-library:v1:doc')).toBe('{damaged')
  })
})
