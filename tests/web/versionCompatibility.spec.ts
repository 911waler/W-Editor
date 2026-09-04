import { describe, expect, it } from 'vitest'

import {
  DEPRECATED_PUBLIC_FIELDS,
  MINIMUM_HOST_ADAPTER_VERSION,
  WEB_API_VERSION,
  WEB_SCHEMA_VERSION,
  checkWebHostCompatibility,
  mountWEditor,
} from '../../packages/editor-web/src/index'

describe('versioned Web host compatibility', () => {
  it('accepts compatible SemVer majors and the declared minimum adapter version', () => {
    expect(checkWebHostCompatibility({
      apiVersion: WEB_API_VERSION,
      hostAdapterVersion: MINIMUM_HOST_ADAPTER_VERSION,
      schemaVersion: WEB_SCHEMA_VERSION,
    })).toMatchObject({ compatible: true })
    expect(checkWebHostCompatibility({
      apiVersion: '1.4.0',
      hostAdapterVersion: '1.2.0',
      schemaVersion: '1.1.7',
    })).toMatchObject({ compatible: true })
  })

  it('rejects invalid, too-old, and incompatible-major hosts', () => {
    expect(checkWebHostCompatibility({ hostAdapterVersion: '0.9.0' })).toMatchObject({ compatible: false, code: 'INCOMPATIBLE_HOST' })
    expect(checkWebHostCompatibility({ apiVersion: '2.0.0' })).toMatchObject({ compatible: false, code: 'INCOMPATIBLE_HOST' })
    expect(checkWebHostCompatibility({ schemaVersion: 'not-semver' })).toMatchObject({ compatible: false, code: 'INCOMPATIBLE_HOST' })
  })

  it('publishes a deprecation migration record instead of silently removing a field', () => {
    expect(DEPRECATED_PUBLIC_FIELDS).toContainEqual(expect.objectContaining({
      field: 'WEditorMountOptions.profile',
      replacement: expect.any(String),
      removal: '2.0.0',
    }))
  })

  it('rejects an incompatible host before creating mount DOM', () => {
    const container = document.createElement('div')
    expect(() => mountWEditor(container, {
      apiVersion: '2.0.0',
      document: { documentId: 'article-1', markdown: '# Article' },
    })).toThrowError(expect.objectContaining({ code: 'INCOMPATIBLE_HOST' }))
    expect(container.childElementCount).toBe(0)
  })
})
