import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

interface ReferenceAssetRecord {
  readonly animationControls: string
  readonly baselineReviewEvidence: string
  readonly browser: string
  readonly browserVersion: string
  readonly captureDate: string
  readonly dpr: number
  readonly fixture: string
  readonly fonts: readonly string[]
  readonly id: string
  readonly locale: string
  readonly localPath: string
  readonly masks: readonly string[]
  readonly ownership: string
  readonly screenshotRegion: string
  readonly sha256: string
  readonly sourceUrl: string
  readonly theme: string
  readonly timeControls: string
  readonly tolerance: {
    readonly maxDiffPixelRatio: number
    readonly threshold: number
  }
  readonly viewport: { readonly height: number; readonly width: number }
}

interface ReferenceBaselineManifest {
  readonly assets: readonly ReferenceAssetRecord[]
  readonly pixelCanonicalEngine: string
  readonly unreviewedRerecordingForbidden: boolean
}

const manifestPath = 'tests/fixtures/parity/reference-baseline-manifest.json'
const requiredAssetIds = [
  'cherry-toolbar-main-right',
  'cherry-components',
  'cherry-panel-picker',
  'cherry-formula-picker',
  'cherry-table-picker',
  'tiptap-notion-like-visual',
  'tiptap-notion-like-code',
  'tiptap-table-node',
  'w-editor-parity-document',
  'w-editor-parity-state',
] as const

describe('frozen reference baseline manifest', () => {
  it('pins reviewed local assets and deterministic W-Editor fixtures with complete capture metadata', () => {
    expect(existsSync(manifestPath), `${manifestPath} must exist`).toBe(true)

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ReferenceBaselineManifest
    expect(manifest.pixelCanonicalEngine).toBe('Playwright bundled Chromium 151.0.7922.34')
    expect(manifest.unreviewedRerecordingForbidden).toBe(true)
    expect(manifest.assets.map(({ id }) => id)).toEqual(requiredAssetIds)

    for (const asset of manifest.assets) {
      expect(asset.sourceUrl).toMatch(/^(https:\/\/|repository:\/\/)/u)
      expect(asset.captureDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u)
      expect(asset.browser).toBeTruthy()
      expect(asset.browserVersion).toBeTruthy()
      expect(asset.viewport.width).toBeGreaterThan(0)
      expect(asset.viewport.height).toBeGreaterThan(0)
      expect(asset.dpr).toBeGreaterThan(0)
      expect(asset.fonts.length).toBeGreaterThan(0)
      expect(asset.theme).toBeTruthy()
      expect(asset.locale).toBeTruthy()
      expect(asset.fixture).toBeTruthy()
      expect(asset.animationControls).toBeTruthy()
      expect(asset.timeControls).toBeTruthy()
      expect(asset.screenshotRegion).toBeTruthy()
      expect(asset.ownership).toMatch(/^(Cherry|Tiptap|W-Editor)/u)
      expect(asset.baselineReviewEvidence).toBeTruthy()
      expect(asset.tolerance.threshold).toBeGreaterThanOrEqual(0)
      expect(asset.tolerance.maxDiffPixelRatio).toBeGreaterThanOrEqual(0)
      expect(existsSync(asset.localPath), `${asset.id} local asset must exist`).toBe(true)

      const digest = createHash('sha256').update(readFileSync(asset.localPath)).digest('hex')
      expect(digest).toBe(asset.sha256)
    }
  })
})
