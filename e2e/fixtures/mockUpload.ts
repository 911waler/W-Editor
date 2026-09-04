import type { Page } from '@playwright/test'

export const MOCK_UPLOAD_ENDPOINT = 'http://127.0.0.1:4173/__fixtures/upload'

export type MockAssetKind = 'image' | 'audio' | 'video' | 'pdf' | 'word' | 'file'

export interface MockUploadedAsset {
  readonly url: string
  readonly name: string
  readonly mediaType: string
  readonly size: number
}

const mediaTypes: Record<MockAssetKind, string> = {
  image: 'image/png',
  audio: 'audio/wav',
  video: 'video/mp4',
  pdf: 'application/pdf',
  word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  file: 'text/plain',
}

export function mockUploadedAsset(kind: MockAssetKind): MockUploadedAsset {
  return {
    url: `https://fixtures.w-editor.test/uploads/${kind}/asset-001`,
    name: `sample-${kind}`,
    mediaType: mediaTypes[kind],
    size: 128,
  }
}

export async function installMockUploadEndpoint(page: Page): Promise<void> {
  await page.route(`${MOCK_UPLOAD_ENDPOINT}**`, async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('result') === 'failure') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'fixture failure' }) })
      return
    }
    const kind = (url.searchParams.get('kind') ?? 'file') as MockAssetKind
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockUploadedAsset(kind)) })
  })
}
