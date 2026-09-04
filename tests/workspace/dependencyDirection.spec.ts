import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '../..')

describe('workspace dependency direction', () => {
  it('rejects forbidden imports and accepts only the planned package direction', () => {
    const output = execFileSync(
      process.execPath,
      [resolve(repositoryRoot, 'scripts/verify-workspace-dependencies.mjs')],
      { cwd: repositoryRoot, encoding: 'utf8' },
    )

    expect(output).toContain('Workspace dependency direction passed.')
  })
})
