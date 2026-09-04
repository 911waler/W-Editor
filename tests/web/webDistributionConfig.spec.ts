import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { resolveConfig } from 'vite'

const repositoryRoot = resolve(process.cwd())
const packageRoot = resolve(repositoryRoot, 'packages/editor-web')
const configFile = resolve(packageRoot, 'vite.config.ts')
const distributionRoot = resolve(packageRoot, 'dist')

describe('Web distribution Vite output boundary', () => {
  it.each(['distribution-es', 'distribution-iife'])('resolves %s output inside the editor-web package', async (mode) => {
    const config = await resolveConfig({ configFile, mode }, 'build')

    expect(resolve(config.root, config.build.outDir)).toBe(distributionRoot)
  })
})
