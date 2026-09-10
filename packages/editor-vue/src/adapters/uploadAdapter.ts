import { normalizeImageUrl } from '@w-editor/editor-core'
import { type AssetKind, type UploadAdapter, type UploadSignal, type UploadedAsset, type UploadedAssetDisplayMetadata, type UploadRequest } from '@w-editor/editor-core'

export { ASSET_KINDS } from '@w-editor/editor-core'
export type { AssetKind, UploadAdapter, UploadedAsset, UploadedAssetDisplayMetadata, UploadRequest } from '@w-editor/editor-core'

export interface AssetUrlValidationOptions {
  readonly allowInlineImage?: boolean
}

export type AssetUrlValidation =
  | Readonly<{ valid: true; url: string }>
  | Readonly<{ code: 'ASSET_URL_REQUIRED' | 'ASSET_URL_UNSUPPORTED' | 'ASSET_URL_CREDENTIALS'; message: string; valid: false }>

export class UploadAdapterError extends Error {
  readonly code: 'INVALID_UPLOAD_RESULT' | 'LOCAL_UPLOAD_UNSUPPORTED' | 'MOCK_UPLOAD_FAILURE'

  constructor(code: UploadAdapterError['code'], message: string) {
    super(message)
    this.name = 'UploadAdapterError'
    this.code = code
  }
}

const MEDIA_TYPES: Readonly<Record<AssetKind, string>> = Object.freeze({
  audio: 'audio/wav',
  file: 'text/plain',
  image: 'image/png',
  pdf: 'application/pdf',
  video: 'video/mp4',
  word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
})

const MIME_TYPE = /^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/u
const INLINE_IMAGE_MEDIA_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])
const INLINE_IMAGE_URL = /^data:(image\/(?:avif|gif|jpeg|png|webp));base64,([a-z\d+/]+={0,2})$/iu

export function validateAssetUrl(input: string, options: AssetUrlValidationOptions = {}): AssetUrlValidation {
  const value = input.trim()
  if (value.length === 0) {
    return Object.freeze({ code: 'ASSET_URL_REQUIRED', message: 'Asset URL is required.', valid: false })
  }
  if (options.allowInlineImage === true && value.startsWith('/') && normalizeImageUrl(value) !== null) {
    return Object.freeze({ valid: true, url: value })
  }
  if (options.allowInlineImage === true && INLINE_IMAGE_URL.test(value)) {
    return Object.freeze({ valid: true, url: value })
  }
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return Object.freeze({
        code: 'ASSET_URL_UNSUPPORTED',
        message: 'Asset URL must use HTTP or HTTPS.',
        valid: false,
      })
    }
    if (parsed.username.length > 0 || parsed.password.length > 0) {
      return Object.freeze({
        code: 'ASSET_URL_CREDENTIALS',
        message: 'Asset URL must not contain credentials.',
        valid: false,
      })
    }
    return Object.freeze({ valid: true, url: parsed.href })
  } catch {
    return Object.freeze({
      code: 'ASSET_URL_UNSUPPORTED',
      message: 'Asset URL must be an absolute HTTP or HTTPS URL.',
      valid: false,
    })
  }
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function optionalFiniteNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new UploadAdapterError('INVALID_UPLOAD_RESULT', `Uploaded asset ${key} must be a non-negative finite number.`)
  }
  return value
}

export function normalizeUploadedAsset(value: unknown): UploadedAsset {
  const record = objectRecord(value)
  if (record === null) throw new UploadAdapterError('INVALID_UPLOAD_RESULT', 'Upload result must be an object.')
  const name = typeof record['name'] === 'string' ? record['name'].trim() : ''
  if (name.length === 0) throw new UploadAdapterError('INVALID_UPLOAD_RESULT', 'Uploaded asset name is required.')
  const mediaType = typeof record['mediaType'] === 'string' ? record['mediaType'].trim().toLowerCase() : ''
  if (!MIME_TYPE.test(mediaType)) {
    throw new UploadAdapterError('INVALID_UPLOAD_RESULT', 'Uploaded asset media type is invalid.')
  }
  const url = typeof record['url'] === 'string'
    ? validateAssetUrl(record['url'], { allowInlineImage: INLINE_IMAGE_MEDIA_TYPES.has(mediaType) })
    : null
  if (url === null || !url.valid) {
    throw new UploadAdapterError('INVALID_UPLOAD_RESULT', url?.message ?? 'Uploaded asset URL is required.')
  }
  const inlineImage = INLINE_IMAGE_URL.exec(url.url)
  if (inlineImage !== null && inlineImage[1]?.toLowerCase() !== mediaType) {
    throw new UploadAdapterError('INVALID_UPLOAD_RESULT', 'Inline image URL media type must match uploaded asset media type.')
  }
  const size = record['size']
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
    throw new UploadAdapterError('INVALID_UPLOAD_RESULT', 'Uploaded asset size must be a non-negative safe integer.')
  }

  const displayRecord = record['display'] === undefined ? null : objectRecord(record['display'])
  if (record['display'] !== undefined && displayRecord === null) {
    throw new UploadAdapterError('INVALID_UPLOAD_RESULT', 'Uploaded asset display metadata must be an object.')
  }
  let display: UploadedAssetDisplayMetadata | undefined
  if (displayRecord !== null) {
    const durationSeconds = optionalFiniteNumber(displayRecord, 'durationSeconds')
    const height = optionalFiniteNumber(displayRecord, 'height')
    const label = typeof displayRecord['label'] === 'string' ? displayRecord['label'].trim() : ''
    const width = optionalFiniteNumber(displayRecord, 'width')
    display = Object.freeze({
      ...(durationSeconds === undefined ? {} : { durationSeconds }),
      ...(height === undefined ? {} : { height }),
      ...(label.length === 0 ? {} : { label }),
      ...(width === undefined ? {} : { width }),
    })
  }

  return Object.freeze({
    ...(display === undefined ? {} : { display }),
    mediaType,
    name,
    size,
    url: url.url,
  })
}

function abortError(): DOMException {
  return new DOMException('Upload cancelled.', 'AbortError')
}

function throwIfAborted(signal: UploadSignal | undefined): void {
  if (signal?.aborted === true) throw abortError()
}

function browserBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return globalThis.btoa(binary)
}

function safeLocalImageName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/u, '').trim()
  return (withoutExtension || 'image').replace(/[\]\r\n]/gu, '-')
}

/**
 * Offline browser default for local raster images. A real site can inject its own
 * UploadAdapter and return a permanent HTTP(S) URL instead.
 */
export class BrowserLocalUploadAdapter implements UploadAdapter {
  async upload(request: UploadRequest): Promise<UploadedAsset> {
    throwIfAborted(request.signal)
    const mediaType = request.file.type.trim().toLowerCase()
    if (request.kind !== 'image' || !INLINE_IMAGE_MEDIA_TYPES.has(mediaType)) {
      throw new UploadAdapterError(
        'LOCAL_UPLOAD_UNSUPPORTED',
        request.kind === 'image'
          ? 'Local images must be PNG, JPEG, GIF, WebP, or AVIF files.'
          : 'Local upload for this asset type requires a configured upload service.',
      )
    }
    const bytes = new Uint8Array(await request.file.arrayBuffer())
    throwIfAborted(request.signal)
    return normalizeUploadedAsset({
      mediaType,
      name: safeLocalImageName(request.file.name),
      size: request.file.size,
      url: `data:${mediaType};base64,${browserBase64(bytes)}`,
    })
  }
}

function waitForMockUpload(signal: UploadSignal | undefined, delayMs: number): Promise<void> {
  if (signal?.aborted === true) return Promise.reject(abortError())
  if (delayMs === 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', cancelled)
      resolve()
    }, delayMs)
    const cancelled = (): void => {
      globalThis.clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener('abort', cancelled, { once: true })
  })
}

export interface MockUploadAdapterOptions {
  readonly delayMs?: number
  readonly failureKinds?: readonly AssetKind[]
}

export class MockUploadAdapter implements UploadAdapter {
  readonly #delayMs: number
  readonly #failureKinds: ReadonlySet<AssetKind>

  constructor(options: MockUploadAdapterOptions = {}) {
    this.#delayMs = options.delayMs ?? 0
    this.#failureKinds = new Set(options.failureKinds ?? [])
  }

  async upload(request: UploadRequest): Promise<UploadedAsset> {
    await waitForMockUpload(request.signal, this.#delayMs)
    if (request.signal?.aborted === true) throw abortError()
    if (this.#failureKinds.has(request.kind)) {
      throw new UploadAdapterError('MOCK_UPLOAD_FAILURE', `Deterministic ${request.kind} upload failure.`)
    }
    return normalizeUploadedAsset({
      mediaType: MEDIA_TYPES[request.kind],
      name: `sample-${request.kind}`,
      size: 128,
      url: `https://fixtures.w-editor.test/uploads/${request.kind}/asset-001`,
    })
  }
}
