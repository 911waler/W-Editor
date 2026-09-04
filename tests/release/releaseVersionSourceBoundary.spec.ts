import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { RELEASE_VERSIONS } from '../../packages/editor-web/src/releaseVersions.generated'

const repositoryRoot = resolve(import.meta.dirname, '../..')

describe('editor-web release version source boundary', () => {
  it('uses an exact package-local projection of the central release version matrix', () => {
    const central = JSON.parse(readFileSync(resolve(repositoryRoot, 'release/versions.json'), 'utf8')) as Readonly<Record<string, unknown>>
    expect(RELEASE_VERSIONS).toEqual({
      hostContractsVersion: central['hostContractsVersion'],
      minimumHostAdapterVersion: central['minimumHostAdapterVersion'],
      webApiVersion: central['webApiVersion'],
      webSchemaVersion: central['webSchemaVersion'],
    })
    expect(Object.isFrozen(RELEASE_VERSIONS)).toBe(true)

    const publicContracts = readFileSync(resolve(repositoryRoot, 'packages/editor-web/src/publicContracts.ts'), 'utf8')
    expect(publicContracts).toContain("from './releaseVersions.generated'")
    expect(publicContracts).not.toContain('release/versions.json')
  })
})
