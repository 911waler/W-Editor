import { describe, expect, it, vi } from 'vitest'

import {
  DOCUMENT_KEY_PREFIX,
  LocalDocumentRepository,
  LocalPersistenceQuotaError,
  RawEnvelopeRecoveryRequiredError,
  WORKSPACE_KEY,
  documentStorageKey,
  type DocumentEnvelopeV1,
  type WorkspaceEnvelopeV1,
} from '../../src/services/localDocumentRepository'

function memoryStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() { return entries.size },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => { entries.delete(key) },
    setItem: (key, value) => { entries.set(key, value) },
  }
}

const workspaceEnvelope = Object.freeze({
  activeDocumentId: 'welcome',
  articlePanel: Object.freeze({ collapsed: false, width: 252 }),
  catalogDocumentIds: Object.freeze(['welcome', 'product-notes', 'formatting-gallery']),
  schemaVersion: 1,
}) satisfies WorkspaceEnvelopeV1

function documentEnvelope(documentId: string, markdown: string): DocumentEnvelopeV1 {
  return Object.freeze({
    autosave: Object.freeze({ markdown, revision: 3, savedAt: '2026-01-15T12:00:00.000Z' }),
    documentId,
    manualCheckpoint: null,
    preDestructiveReplace: null,
    preModeSwitch: null,
    schemaVersion: 1,
    status: Object.freeze({ lastPersistenceFailure: null }),
  })
}

describe('LocalDocumentRepository version-1 envelopes', () => {
  it('uses deterministic workspace and per-document keys', () => {
    expect(WORKSPACE_KEY).toBe('w-editor:v1:workspace')
    expect(DOCUMENT_KEY_PREFIX).toBe('w-editor:v1:document:')
    expect(documentStorageKey('welcome')).toBe('w-editor:v1:document:welcome')
    expect(documentStorageKey('notes / 中文')).toBe('w-editor:v1:document:notes%20%2F%20%E4%B8%AD%E6%96%87')
  })

  it('writes one complete workspace or document envelope per storage call', () => {
    const storage = memoryStorage()
    const setItem = vi.spyOn(storage, 'setItem')
    const repository = new LocalDocumentRepository(storage)

    repository.writeWorkspace(workspaceEnvelope)
    expect(setItem).toHaveBeenLastCalledWith(WORKSPACE_KEY, JSON.stringify(workspaceEnvelope))
    expect(setItem).toHaveBeenCalledTimes(1)

    const document = documentEnvelope('welcome', '# Welcome')
    repository.writeDocument(document)
    expect(setItem).toHaveBeenLastCalledWith(documentStorageKey('welcome'), JSON.stringify(document))
    expect(setItem).toHaveBeenCalledTimes(2)
  })

  it('isolates documents and never persists a rebuildable Tiptap projection', () => {
    const storage = memoryStorage()
    const repository = new LocalDocumentRepository(storage)
    const welcome = {
      ...documentEnvelope('welcome', '# Welcome'),
      tiptapProjection: { type: 'doc', content: [{ type: 'paragraph' }] },
    } as DocumentEnvelopeV1
    repository.writeDocument(welcome)
    repository.writeDocument(documentEnvelope('product-notes', '# Product notes'))

    expect(repository.readDocument('welcome')).toEqual({ status: 'valid', value: documentEnvelope('welcome', '# Welcome') })
    expect(repository.readDocument('product-notes')).toEqual({ status: 'valid', value: documentEnvelope('product-notes', '# Product notes') })
    expect(storage.getItem(documentStorageKey('welcome'))).not.toContain('tiptapProjection')
  })

  it.each([
    ['corrupt JSON', '{not-json', 'corrupt'],
    ['unknown schema', '{"schemaVersion":2,"documentId":"welcome"}', 'unsupported-version'],
  ] as const)('retains %s for raw recovery and blocks automatic overwrite', (_label, raw, reason) => {
    const storage = memoryStorage()
    const key = documentStorageKey('welcome')
    storage.setItem(key, raw)
    const repository = new LocalDocumentRepository(storage)

    expect(repository.readDocument('welcome')).toEqual({ key, raw, reason, status: 'recovery-required' })
    expect(repository.rawRecovery(key)).toEqual({ filename: 'w-editor-recovery-document-welcome.json', key, raw })
    expect(() => repository.writeDocument(documentEnvelope('welcome', 'replacement')))
      .toThrow(RawEnvelopeRecoveryRequiredError)
    expect(storage.getItem(key)).toBe(raw)

    repository.clearAndResetDocument('welcome', documentEnvelope('welcome', '# Reset'))
    expect(repository.readDocument('welcome')).toEqual({ status: 'valid', value: documentEnvelope('welcome', '# Reset') })
  })

  it('creates an exact raw recovery download without changing storage', async () => {
    const storage = memoryStorage()
    storage.setItem(WORKSPACE_KEY, '{"schemaVersion":99,"raw":true}')
    const repository = new LocalDocumentRepository(storage)

    expect(repository.readWorkspace()).toMatchObject({ reason: 'unsupported-version', status: 'recovery-required' })
    const download = repository.createRawRecoveryDownload(WORKSPACE_KEY)
    expect(download?.filename).toBe('w-editor-recovery-workspace.json')
    await expect(download?.blob.text()).resolves.toBe('{"schemaVersion":99,"raw":true}')
    expect(storage.getItem(WORKSPACE_KEY)).toBe('{"schemaVersion":99,"raw":true}')
  })

  it('intentionally applies last-successful-write-wins across repository instances', () => {
    const storage = memoryStorage()
    const firstTab = new LocalDocumentRepository(storage)
    const secondTab = new LocalDocumentRepository(storage)

    firstTab.writeDocument(documentEnvelope('welcome', 'first tab'))
    secondTab.writeDocument(documentEnvelope('welcome', 'second tab'))

    expect(firstTab.readDocument('welcome')).toEqual({
      status: 'valid',
      value: documentEnvelope('welcome', 'second tab'),
    })
  })

  it('surfaces quota exhaustion without replacing the last persisted envelope', () => {
    const storage = memoryStorage()
    const repository = new LocalDocumentRepository(storage)
    const original = documentEnvelope('welcome', '# Persisted')
    repository.writeDocument(original)
    const setItem = vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })

    expect(() => repository.writeDocument(documentEnvelope('welcome', '# In memory')))
      .toThrow(LocalPersistenceQuotaError)
    expect(() => repository.writeDocument(documentEnvelope('welcome', '# In memory')))
      .toThrow('Your current Markdown remains in memory')
    expect(storage.getItem(documentStorageKey('welcome'))).toBe(JSON.stringify(original))
    setItem.mockRestore()
  })
})
