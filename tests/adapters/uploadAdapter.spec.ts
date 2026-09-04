import { describe, expect, it } from 'vitest'

import {
  ASSET_KINDS,
  BrowserLocalUploadAdapter,
  MockUploadAdapter,
  UploadAdapterError,
  normalizeUploadedAsset,
  validateAssetUrl,
} from '../../src/adapters'

function file(name = 'fixture.bin'): File {
  return new File(['fixture'], name, { type: 'application/octet-stream' })
}

describe('UploadAdapter contract', () => {
  it('accepts normalized HTTP(S) URLs and rejects unsupported, relative, credentialed, and empty input', () => {
    expect(validateAssetUrl(' https://assets.example.test/image.png ')).toEqual({
      valid: true,
      url: 'https://assets.example.test/image.png',
    })
    expect(validateAssetUrl('http://assets.example.test')).toEqual({
      valid: true,
      url: 'http://assets.example.test/',
    })
    expect(validateAssetUrl('')).toMatchObject({ code: 'ASSET_URL_REQUIRED', valid: false })
    expect(validateAssetUrl('/relative.png')).toMatchObject({ code: 'ASSET_URL_UNSUPPORTED', valid: false })
    expect(validateAssetUrl('blob:https://example.test/id')).toMatchObject({ code: 'ASSET_URL_UNSUPPORTED', valid: false })
    expect(validateAssetUrl('data:image/png;base64,AAAA')).toMatchObject({ code: 'ASSET_URL_UNSUPPORTED', valid: false })
    expect(validateAssetUrl('data:image/png;base64,AAAA', { allowInlineImage: true })).toEqual({
      valid: true,
      url: 'data:image/png;base64,AAAA',
    })
    expect(validateAssetUrl('data:image/svg+xml;base64,AAAA', { allowInlineImage: true }))
      .toMatchObject({ code: 'ASSET_URL_UNSUPPORTED', valid: false })
    expect(validateAssetUrl('https://user:secret@example.test/file')).toMatchObject({
      code: 'ASSET_URL_CREDENTIALS',
      valid: false,
    })
  })

  it('persists safe local raster images as serializable data URLs and rejects SVG', async () => {
    const adapter = new BrowserLocalUploadAdapter()
    const png = new File(['png'], 'sample-image.png', { type: 'image/png' })

    await expect(adapter.upload({ file: png, kind: 'image' })).resolves.toEqual({
      mediaType: 'image/png',
      name: 'sample-image',
      size: 3,
      url: 'data:image/png;base64,cG5n',
    })
    await expect(adapter.upload({
      file: new File(['<svg/>'], 'unsafe.svg', { type: 'image/svg+xml' }),
      kind: 'image',
    })).rejects.toMatchObject({ code: 'LOCAL_UPLOAD_UNSUPPORTED' })
  })

  it('normalizes only serializable uploaded-asset metadata', () => {
    const asset = normalizeUploadedAsset({
      display: { durationSeconds: 1.5, height: 480, label: ' Fixture ', width: 640 },
      mediaType: 'Video/MP4',
      name: ' Fixture video ',
      size: 512,
      url: 'https://assets.example.test/video.mp4',
    })

    expect(asset).toEqual({
      display: { durationSeconds: 1.5, height: 480, label: 'Fixture', width: 640 },
      mediaType: 'video/mp4',
      name: 'Fixture video',
      size: 512,
      url: 'https://assets.example.test/video.mp4',
    })
    expect(JSON.parse(JSON.stringify(asset))).toEqual(asset)
    expect(Object.isFrozen(asset)).toBe(true)
    expect(Object.isFrozen(asset.display)).toBe(true)
    expect(() => normalizeUploadedAsset({ ...asset, size: Number.NaN })).toThrow(UploadAdapterError)
    expect(() => normalizeUploadedAsset({ ...asset, url: 'blob:https://example.test/id' })).toThrow(UploadAdapterError)
    expect(() => normalizeUploadedAsset({ ...asset, display: { width: new Blob() } })).toThrow(UploadAdapterError)
  })

  it('returns deterministic fixture metadata for every requested asset kind', async () => {
    const adapter = new MockUploadAdapter()
    for (const kind of ASSET_KINDS) {
      await expect(adapter.upload({ file: file(`local-${kind}`), kind })).resolves.toEqual({
        mediaType: kind === 'word'
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : {
              audio: 'audio/wav',
              file: 'text/plain',
              image: 'image/png',
              pdf: 'application/pdf',
              video: 'video/mp4',
            }[kind],
        name: `sample-${kind}`,
        size: 128,
        url: `https://fixtures.w-editor.test/uploads/${kind}/asset-001`,
      })
    }
  })

  it('supports preflight and in-flight cancellation without producing metadata', async () => {
    const adapter = new MockUploadAdapter({ delayMs: 20 })
    const preflight = new AbortController()
    preflight.abort()
    await expect(adapter.upload({ file: file(), kind: 'file', signal: preflight.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })

    const inFlight = new AbortController()
    const pending = adapter.upload({ file: file(), kind: 'image', signal: inFlight.signal })
    inFlight.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('injects deterministic failures for configured kinds', async () => {
    const adapter = new MockUploadAdapter({ failureKinds: ['video'] })
    await expect(adapter.upload({ file: file(), kind: 'video' })).rejects.toMatchObject({
      code: 'MOCK_UPLOAD_FAILURE',
      message: 'Deterministic video upload failure.',
      name: 'UploadAdapterError',
    })
    await expect(adapter.upload({ file: file(), kind: 'image' })).resolves.toMatchObject({
      mediaType: 'image/png',
    })
  })
})
