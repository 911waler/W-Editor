import { describe, expect, it } from 'vitest'

import {
  ASSET_KINDS,
  PORTS_CONTRACT_VERSION,
  type PreviewRenderer,
  type ResourceLocator,
  type SettingsStore,
  type UploadAdapter,
  type UploadRequest,
} from '../../packages/editor-core/src/ports'
import type { PreviewRenderer as RootPreviewRenderer } from '../../src/services/workspaceModeAdapters'
import type { UploadAdapter as RootUploadAdapter } from '../../src/adapters/uploadAdapter'

describe('editor-core port boundary', () => {
  it('exposes framework-neutral renderer, upload, resource, settings, and error ports', () => {
    const renderer: PreviewRenderer = {
      render: (snapshot) => ({ html: '<p>port</p>', snapshot }),
    }
    const rootRenderer: RootPreviewRenderer = renderer
    const upload: UploadAdapter = {
      upload: async (_request: UploadRequest) => {
        void _request
        return { mediaType: 'text/plain', name: 'note', size: 0, url: 'https://example.test/note' }
      },
    }
    const rootUpload: RootUploadAdapter = upload
    const locator: ResourceLocator = { resolve: (path) => `/assets/${path}` }
    const settings: SettingsStore = {
      clearUserOverride: () => undefined,
      getSiteDefaults: () => Object.freeze({}),
      getUserOverrides: () => Object.freeze({}),
      setUserOverride: () => undefined,
      subscribe: () => () => undefined,
    }

    expect(PORTS_CONTRACT_VERSION).toBe('1.0.0')
    expect(ASSET_KINDS).toContain('image')
    expect(rootRenderer).toBe(renderer)
    expect(rootUpload).toBe(upload)
    expect(locator.resolve('main.js')).toBe('/assets/main.js')
    expect(settings.getSiteDefaults()).toEqual({})
  })
})
