import { describe, expect, it } from 'vitest'

import {
  HOST_CONTRACTS_VERSION,
  MINIMUM_HOST_ADAPTER_VERSION,
  PUBLIC_ERROR_CODES,
  WEB_API_VERSION,
  WEB_SCHEMA_VERSION,
  W_EDITOR_PROFILES,
  createDocumentSnapshot,
  createPublicError,
  type WEditorMountOptions,
  type WEditorChangeEvent,
} from '../../packages/editor-web/src/publicContracts'

describe('Web host public contracts', () => {
  it('publishes independent API, schema, and host-contract versions', () => {
    expect(WEB_API_VERSION).toBe('1.0.0')
    expect(WEB_SCHEMA_VERSION).toBe('1.0.0')
    expect(HOST_CONTRACTS_VERSION).toBe('1.0.0')
    expect(MINIMUM_HOST_ADAPTER_VERSION).toBe('1.0.0')
    expect(W_EDITOR_PROFILES).toEqual(['reader', 'author-preview'])
  })

  it('defines immutable snapshots, events, and a discriminated public error union', () => {
    const snapshot = createDocumentSnapshot({
      documentId: 'article-1',
      markdown: '# Contract',
      serverRevision: 'opaque-1',
      revision: 3,
    })
    const event: WEditorChangeEvent = Object.freeze({
      apiVersion: WEB_API_VERSION,
      instanceId: 'w-editor-test',
      origin: 'source-edit',
      snapshot: Object.freeze({
        ...snapshot,
        dirty: false,
        historyDepth: 0,
        mode: 'source',
        saveState: 'clean',
      }),
      type: 'change',
    })
    const error = createPublicError('AUTH_REQUIRED', 'Sign in to save this document.')

    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(event)).toBe(true)
    expect(Object.isFrozen(error)).toBe(true)
    expect(error).toMatchObject({
      actionHints: ['login'],
      code: 'AUTH_REQUIRED',
      retryable: false,
    })
    expect(PUBLIC_ERROR_CODES).toContain('REVISION_CONFLICT')
  })

  it('exposes a framework-neutral mount option shape without internal Vue state', () => {
    const options = {
      document: { documentId: 'article-1', markdown: '# Contract' },
      profile: 'editor',
    } satisfies WEditorMountOptions

    expect(options.document.documentId).toBe('article-1')
    expect(options.profile).toBe('editor')
  })
})
