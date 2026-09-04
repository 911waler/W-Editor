import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '../..')

describe('shared implementation ownership', () => {
  it('rejects duplicate command/codec/renderer/UI implementations in Web or Desktop', () => {
    const output = execFileSync(
      process.execPath,
      [resolve(repositoryRoot, 'scripts/verify-code-ownership.mjs')],
      { cwd: repositoryRoot, encoding: 'utf8' },
    )

    expect(output).toContain('Code ownership passed.')
    const facadeOutput = execFileSync(
      process.execPath,
      [resolve(repositoryRoot, 'scripts/verify-web-entry-facades.mjs')],
      { cwd: repositoryRoot, encoding: 'utf8' },
    )
    expect(facadeOutput).toContain('Web entry façade gate passed')
  })
})
