import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '../..')
const validator = resolve(repositoryRoot, 'scripts/verify-web-entry-facades.mjs')

describe('Web build entry façades', () => {
  it('accepts import/re-export-only entries and rejects a local implementation declaration', () => {
    const output = execFileSync(process.execPath, [validator], { cwd: repositoryRoot, encoding: 'utf8' })
    expect(output).toContain('Web entry façade gate passed')

    const temporaryRoot = mkdtempSync(resolve(tmpdir(), 'w-editor-entry-facade-'))
    const invalidEntry = resolve(temporaryRoot, 'invalidEntry.ts')
    try {
      writeFileSync(invalidEntry, 'export const duplicateRenderer = () => "unsafe"\n', 'utf8')
      expect(() => execFileSync(process.execPath, [validator, invalidEntry], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      })).toThrow(/must contain only imports and re-exports/iu)
    } finally {
      rmSync(temporaryRoot, { force: true, recursive: true })
    }
  })
})
