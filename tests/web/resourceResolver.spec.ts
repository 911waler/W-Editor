import { describe, expect, it } from 'vitest'

import { resolveWebAssetUrl } from '../../packages/editor-web/src/index'

describe('Web asset URL resolver', () => {
  it('resolves absolute HTTP(S) and same-origin root-relative URLs', () => {
    expect(resolveWebAssetUrl('https://cdn.example.test/image.png', { baseUrl: 'https://host.example.test/blog/edit' }))
      .toEqual({ valid: true, url: 'https://cdn.example.test/image.png' })
    expect(resolveWebAssetUrl('/static/w-editor/image.png', { baseUrl: 'https://host.example.test/blog/edit' }))
      .toEqual({ valid: true, url: 'https://host.example.test/static/w-editor/image.png' })
  })

  it('joins relative distribution resources to an injected asset base', () => {
    expect(resolveWebAssetUrl('chunks/editor.js', {
      assetBaseUrl: '/static/vendor/w-editor/1.0.0/',
      baseUrl: 'https://host.example.test/blog/edit',
    })).toEqual({ valid: true, url: 'https://host.example.test/static/vendor/w-editor/1.0.0/chunks/editor.js' })
  })

  it('rejects a plain relative URL when no distribution base was injected', () => {
    expect(resolveWebAssetUrl('images/editor.png', { baseUrl: 'https://host.example.test/blog/edit' }))
      .toMatchObject({ code: 'ASSET_URL_UNSUPPORTED', valid: false })
  })

  it.each([
    ['https://user:password@host.example.test/image.png', 'ASSET_URL_CREDENTIALS'],
    ['//other.example.test/image.png', 'ASSET_URL_UNSUPPORTED'],
    ['javascript:alert(1)', 'ASSET_URL_UNSUPPORTED'],
    ['data:image/png;base64,AAAA', 'ASSET_URL_UNSUPPORTED'],
  ] as const)('rejects unsafe URL %s', (url, code) => {
    expect(resolveWebAssetUrl(url, { baseUrl: 'https://host.example.test/blog/edit' })).toMatchObject({ valid: false, code })
  })
})
