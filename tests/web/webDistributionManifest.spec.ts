import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

type ManifestFile = Readonly<{
  path: string
  sha256: string
  size: number
}>

type WebDistributionManifest = Readonly<{
  apiVersion: string
  commit: string
  css: readonly string[]
  drawio: Readonly<{ files: readonly string[]; lazy: boolean }>
  entries: Readonly<Record<string, string>>
  files: readonly ManifestFile[]
  fonts: Readonly<{ embedded: boolean; files: readonly string[] }>
  licenses: readonly string[]
  manifestVersion: string
  markdownDialectVersion: string
  productVersion: string
  schemaVersion: string
  types: readonly string[]
}>

const distributionRoot = resolve(process.cwd(), 'packages/editor-web/dist')
const manifestPath = resolve(distributionRoot, 'manifest.json')

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

describe('Web distribution resource manifest', () => {
  it('describes a complete hashed closure for the built release', () => {
    expect(existsSync(manifestPath)).toBe(true)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as WebDistributionManifest
    expect(manifest.manifestVersion).toBe('1.0.0')
    expect(manifest.productVersion).toBe('0.1.0')
    expect(manifest.apiVersion).toBe('1.0.0')
    expect(manifest.schemaVersion).toBe('1.0.0')
    expect(manifest.markdownDialectVersion).toBe('1.0.0')
    expect(manifest.commit).toBe(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim())
    expect(manifest.entries).toEqual({
      editor: 'editor.es.js',
      iife: 'w-editor.global.js',
      renderer: 'renderer.es.js',
    })
    expect(manifest.css).toEqual(['w-editor.css'])
    expect(manifest.types).toContain('types/index.d.ts')
    expect(manifest.fonts.embedded).toBe(true)
    expect(manifest.drawio.lazy).toBe(true)
    expect(manifest.drawio.files.length).toBeGreaterThan(340)
    expect(manifest.licenses).toContain('drawio/LICENSE')
    expect(manifest.licenses).toContain('drawio/PROVENANCE.md')
    expect(manifest.files.length).toBeGreaterThan(190)

    const declared = new Set(manifest.files.map((file) => file.path))
    for (const file of manifest.files) {
      expect(file.path).not.toMatch(/(^|\/)\.\.?(?:\/|$)/u)
      expect(declared.has(file.path)).toBe(true)
      const absolute = resolve(distributionRoot, file.path)
      expect(relative(distributionRoot, absolute)).not.toMatch(/^\.\.(?:[\\/]|$)/u)
      expect(existsSync(absolute)).toBe(true)
      expect(readFileSync(absolute).byteLength).toBe(file.size)
      expect(sha256(absolute)).toBe(file.sha256)
    }
    for (const path of [
      ...Object.values(manifest.entries),
      ...manifest.css,
      ...manifest.types,
      ...manifest.drawio.files,
      ...manifest.licenses,
    ]) {
      expect(declared.has(path)).toBe(true)
    }
  })
})
