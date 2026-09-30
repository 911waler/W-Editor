import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

interface VisualReferenceManifest {
  readonly approvalRules: {
    readonly forbidden: readonly string[]
    readonly replaceRequires: readonly string[]
  }
  readonly behaviorSnapshots: readonly {
    readonly commandIds: readonly string[]
    readonly componentCounts: Readonly<Record<string, number>>
    readonly dpr: number
    readonly lineSpacingIds: readonly string[]
    readonly modeIds: readonly string[]
    readonly shellTheme: string
    readonly theme: string
    readonly themeOptionIds: readonly string[]
    readonly viewport: { readonly height: number; readonly width: number }
  }[]
  readonly browser: string
  readonly browserVersion: string
  readonly captures: readonly {
    readonly browser: string
    readonly browserVersion: string
    readonly dpr: number
    readonly id: string
    readonly localPath: string
    readonly masks: readonly string[]
    readonly sha256: string
    readonly theme: string
    readonly tolerance: { readonly maxDiffPixelRatio: number; readonly threshold: number }
    readonly viewport: { readonly height: number; readonly width: number }
  }[]
  readonly currentHead: string
  readonly dpr: number
  readonly fixture: string
  readonly manifestType: string
  readonly pagesAndComponents: readonly { readonly id: string; readonly selector: string }[]
  readonly productBaselineCommit: string
  readonly reviewedReferenceManifest: { readonly assetIds: readonly string[]; readonly path: string }
  readonly schemaVersion: number
  readonly sourceInputs: readonly string[]
  readonly themes: readonly string[]
  readonly viewport: { readonly height: number; readonly width: number }
}

const manifestPath = 'tests/fixtures/parity/visual-reference-manifest.json'
// The captured images are historical evidence; never rewrite their command inventory.
const featureManifestPath = 'tests/fixtures/manifests/archived-acceptance-commands.json'

describe('archived visual reference freeze', () => {
  it('pins all themes, current regions, behavior snapshots, hashes, and review policy', () => {
    expect(existsSync(manifestPath)).toBe(true)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as VisualReferenceManifest
    const featureManifest = JSON.parse(readFileSync(featureManifestPath, 'utf8')) as {
      readonly commands: { readonly ids: readonly string[] }
    }
    const expectedThemes = ['default', 'dark', 'gray', 'abyss', 'green', 'red', 'violet', 'blue']
    const expectedRegions = ['workspace', 'toolbar', 'editor-surface', 'status']
    const expectedCommandIds = [...featureManifest.commands.ids].sort()

    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.manifestType).toBe('w-editor-current-visual-reference-freeze')
    expect(manifest.productBaselineCommit).toBe('39dddc311f0afb23339b4bba6d816fcfb285ef91')
    expect(manifest.browser).toBe('Playwright bundled Chromium')
    expect(manifest.browserVersion).toBe('151.0.7922.34')
    expect(manifest.viewport).toEqual({ height: 1000, width: 1440 })
    expect(manifest.dpr).toBe(1)
    expect(manifest.fixture).toBe('apps/playground/src/content/articles/welcome.md')
    expect(manifest.themes).toEqual(expectedThemes)
    expect(manifest.pagesAndComponents.map(({ id }) => id)).toEqual(expectedRegions)
    expect(manifest.reviewedReferenceManifest.assetIds).toHaveLength(10)
    expect(existsSync(manifest.reviewedReferenceManifest.path)).toBe(true)
    expect(manifest.captures).toHaveLength(32)
    expect(manifest.behaviorSnapshots).toHaveLength(8)

    for (const input of manifest.sourceInputs) expect(existsSync(input), input).toBe(true)
    for (const theme of expectedThemes) {
      const captures = manifest.captures.filter((capture) => capture.theme === theme)
      expect(captures.map(({ id }) => id).sort()).toEqual(expectedRegions.map((region) => `${theme}-${region}`).sort())
      const behavior = manifest.behaviorSnapshots.find((snapshot) => snapshot.theme === theme)
      expect(behavior?.shellTheme).toBe(theme)
      expect(behavior?.commandIds.toSorted()).toEqual(expectedCommandIds)
      expect(behavior?.modeIds).toEqual(['mode.source', 'mode.visual', 'mode.preview'])
      expect(behavior?.themeOptionIds).toEqual(expectedThemes)
      expect(behavior?.lineSpacingIds).toEqual(['single', 'compact', 'standard', 'double'])
      expect(behavior?.dpr).toBe(1)
      expect(behavior?.viewport).toEqual({ height: 1000, width: 1440 })
      expect(behavior?.componentCounts).toEqual({
        '.workspace-shell': 1,
        '.toolbar-region': 1,
        '.editor-surface': 1,
        '.visual-surface': 1,
        '.status-region': 1,
      })
    }

    for (const capture of manifest.captures) {
      expect(existsSync(capture.localPath), capture.localPath).toBe(true)
      expect(capture.browser).toBe(manifest.browser)
      expect(capture.browserVersion).toBe(manifest.browserVersion)
      expect(capture.viewport).toEqual(manifest.viewport)
      expect(capture.dpr).toBe(manifest.dpr)
      expect(capture.masks).toEqual([])
      expect(capture.tolerance).toEqual({ maxDiffPixelRatio: 0, threshold: 0 })
      expect(createHash('sha256').update(readFileSync(capture.localPath)).digest('hex')).toBe(capture.sha256)
    }

    expect(manifest.approvalRules.replaceRequires.length).toBeGreaterThanOrEqual(4)
    expect(manifest.approvalRules.forbidden).toContain('changing tolerance to make a mismatch green')
  })
})
