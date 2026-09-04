import { describe, expect, it } from 'vitest'

import * as esm from '../../packages/editor-web/src/publicEntry'
import { createWEditorIifeApi } from '../../packages/editor-web/src/iifeEntry'

describe('ESM and IIFE public entry parity', () => {
  it('uses one public API source for both entry styles', () => {
    const iife = createWEditorIifeApi()
    const publicKeys = [
      'HOST_CONTRACTS_VERSION',
      'PUBLIC_ERROR_CODES',
      'W_EDITOR_PROFILES',
      'WEB_API_VERSION',
      'WEB_SCHEMA_VERSION',
      'W_EDITOR_COMMAND_IDS',
      'checkWebHostCompatibility',
      'mountWEditor',
      'mountWRenderer',
      'resolveWebAssetUrl',
    ] as const

    expect(Object.keys(iife).sort()).toEqual(Object.keys(esm).sort())
    for (const key of publicKeys) expect(iife[key]).toBe(esm[key])
  })
})
