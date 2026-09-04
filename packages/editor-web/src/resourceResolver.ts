import type { ResourceLocator } from '@w-editor/editor-core'

export type AssetUrlResolution =
  | Readonly<{ url: string; valid: true }>
  | Readonly<{ code: 'ASSET_URL_REQUIRED' | 'ASSET_URL_UNSUPPORTED' | 'ASSET_URL_CREDENTIALS'; message: string; valid: false }>

export interface AssetUrlResolutionOptions {
  readonly assetBaseUrl?: string
  readonly baseUrl?: string
}

export function createWebResourceLocator(options: AssetUrlResolutionOptions = {}): ResourceLocator {
  return Object.freeze({
    resolve: (resourcePath: string): string => {
      const resolved = resolveWebAssetUrl(resourcePath, options)
      if (!resolved.valid) throw new TypeError(resolved.message)
      return resolved.url
    },
  })
}

function baseUrl(options: AssetUrlResolutionOptions): string {
  if (options.baseUrl !== undefined) return options.baseUrl
  if (typeof document !== 'undefined' && document.baseURI.length > 0) return document.baseURI
  if (typeof location !== 'undefined' && location.href.length > 0) return location.href
  return 'http://localhost/'
}

export function resolveWebAssetUrl(input: string, options: AssetUrlResolutionOptions = {}): AssetUrlResolution {
  const value = input.trim()
  if (value.length === 0) return Object.freeze({ code: 'ASSET_URL_REQUIRED', message: 'Asset URL is required.', valid: false })
  if (value.startsWith('//')) {
    return Object.freeze({ code: 'ASSET_URL_UNSUPPORTED', message: 'Network-path URLs are not supported.', valid: false })
  }
  const hasScheme = /^[a-z][a-z\d+.-]*:/iu.test(value)
  if (!value.startsWith('/') && !hasScheme && options.assetBaseUrl === undefined) {
    return Object.freeze({ code: 'ASSET_URL_UNSUPPORTED', message: 'Relative asset paths require an injected assetBaseUrl.', valid: false })
  }
  const candidate = options.assetBaseUrl === undefined || value.startsWith('/') || /^[a-z][a-z\d+.-]*:/iu.test(value)
    ? value
    : `${options.assetBaseUrl.replace(/\/$/u, '')}/${value.replace(/^\//u, '')}`
  try {
    const parsed = new URL(candidate, baseUrl(options))
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return Object.freeze({ code: 'ASSET_URL_UNSUPPORTED', message: 'Asset URL must use HTTP or HTTPS.', valid: false })
    }
    if (parsed.username.length > 0 || parsed.password.length > 0) {
      return Object.freeze({ code: 'ASSET_URL_CREDENTIALS', message: 'Asset URL must not contain credentials.', valid: false })
    }
    return Object.freeze({ url: parsed.href, valid: true })
  } catch {
    return Object.freeze({ code: 'ASSET_URL_UNSUPPORTED', message: 'Asset URL must be an absolute HTTP or HTTPS URL.', valid: false })
  }
}
