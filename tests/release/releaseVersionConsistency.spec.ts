import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readReleaseVersions } from '../../scripts/release-versions.mjs'

const repositoryRoot = resolve(import.meta.dirname, '../..')

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(repositoryRoot, path), 'utf8')) as Record<string, unknown>
}

describe('release version matrix', () => {
  it('keeps product manifests and independent release versions on one source', () => {
    const versions = readReleaseVersions(repositoryRoot)
    const packagePaths = [
      'package.json',
      'packages/editor-core/package.json',
      'packages/editor-vue/package.json',
      'packages/editor-web/package.json',
      'apps/playground/package.json',
      'apps/desktop/package.json',
    ]

    for (const path of packagePaths) expect(readJson(path)['version']).toBe(versions.productVersion)
    expect(readJson('apps/desktop/src-tauri/tauri.conf.json')['version']).toBe(versions.productVersion)
    expect(readFileSync(resolve(repositoryRoot, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8')).toContain(`version = "${versions.productVersion}"`)
    expect(versions).toMatchObject({
      webApiVersion: '1.0.0',
      webSchemaVersion: '1.0.0',
      markdownDialectVersion: '1.0.0',
      databaseSchemaVersion: 2,
      manifestVersion: '1.0.0',
    })
  })
})
