import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '../..')

describe('workspace feature manifest gate', () => {
  it('verifies the complete manifest against canonical shared and playground owners', () => {
    const output = execFileSync(
      process.execPath,
      [resolve(repositoryRoot, 'scripts/verify-workspace-feature-manifest.mjs')],
      { cwd: repositoryRoot, encoding: 'utf8' },
    )

    expect(output).toContain('Workspace feature manifest passed: 80 commands, 41 components')
  })
})
