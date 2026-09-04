import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(process.cwd())
const packageReadmePath = join(projectRoot, 'packages/editor-web/README.md')
const consumerReadmePath = join(projectRoot, 'examples/web-consumer/README.md')
const licenseListPath = join(projectRoot, 'docs/web-distribution-licenses.md')
const distributionRoot = join(projectRoot, 'packages/editor-web/dist')

function readIfPresent(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

describe('Web Distribution documentation', () => {
  it('documents the self-contained package contract, integration paths, upgrade rollback, limits, and licenses', () => {
    const packageReadme = readIfPresent(packageReadmePath)
    const consumerReadme = readIfPresent(consumerReadmePath)
    const licenseList = readIfPresent(licenseListPath)
    const manifest = existsSync(join(distributionRoot, 'manifest.json'))
      ? JSON.parse(readFileSync(join(distributionRoot, 'manifest.json'), 'utf8')) as {
          readonly licenses?: readonly string[]
          readonly entries?: Readonly<Record<string, string>>
          readonly apiVersion?: string
          readonly schemaVersion?: string
          readonly markdownDialectVersion?: string
        }
      : {}

    expect(existsSync(packageReadmePath)).toBe(true)
    expect(existsSync(consumerReadmePath)).toBe(true)
    expect(existsSync(licenseListPath)).toBe(true)
    expect(packageReadme).toContain('Web Distribution')
    expect(packageReadme).toContain('editor.es.js')
    expect(packageReadme).toContain('renderer.es.js')
    expect(packageReadme).toContain('w-editor.global.js')
    expect(packageReadme).toContain('mountWEditor')
    expect(packageReadme).toContain('mountWRenderer')
    expect(packageReadme).toContain('assetBaseUrl')
    expect(packageReadme).toContain('manifest.json')
    expect(packageReadme).toContain('pnpm run verify:web-manifest')
    expect(packageReadme).toContain('pnpm run verify:seam:absent')
    expect(packageReadme).toMatch(/公共 CDN|public CDN/u)
    expect(packageReadme).toMatch(/draw\.io/u)
    expect(packageReadme).toMatch(/atomic|原子/u)
    expect(packageReadme).toMatch(/rollback|回退/u)
    expect(packageReadme).toMatch(/known limitations|已知限制/u)

    expect(consumerReadme).toContain('esm.html')
    expect(consumerReadme).toContain('iife.html')
    expect(consumerReadme).toContain('offline-esm.html')
    expect(consumerReadme).toContain('offline-iife.html')
    expect(consumerReadme).toContain('subpath-esm.html')
    expect(consumerReadme).toContain('subpath-iife.html')
    expect(consumerReadme).toContain('assetBaseUrl')
    expect(consumerReadme).toMatch(/Jinja|Flask/u)
    expect(consumerReadme).toMatch(/CSP/u)

    expect(licenseList).toContain('cherry-markdown')
    expect(licenseList).toContain('Vue')
    expect(licenseList).toContain('Tiptap')
    expect(licenseList).toContain('CodeMirror')
    expect(licenseList).toContain('KaTeX')
    expect(licenseList).toContain('Mermaid')
    expect(licenseList).toContain('ECharts')
    expect(licenseList).toContain('drawio/LICENSE')
    expect(licenseList).toContain('drawio/PROVENANCE.md')
    for (const path of manifest.licenses ?? []) {
      expect(licenseList).toContain(path)
      expect(existsSync(join(distributionRoot, path))).toBe(true)
    }

    expect(manifest.entries).toMatchObject({
      editor: 'editor.es.js',
      iife: 'w-editor.global.js',
      renderer: 'renderer.es.js',
    })
    expect(manifest.apiVersion).toBe('1.0.0')
    expect(manifest.schemaVersion).toBe('1.0.0')
    expect(manifest.markdownDialectVersion).toBe('1.0.0')
  })
})
