import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '../..')

const workspaceEntries = [
  ['packages/editor-core', '@w-editor/editor-core'],
  ['packages/editor-vue', '@w-editor/editor-vue'],
  ['packages/editor-web', '@w-editor/editor-web'],
  ['apps/playground', '@w-editor/playground'],
  ['apps/desktop', '@w-editor/desktop'],
  ['examples/nwu-host', '@w-editor/nwu-host'],
] as const

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(repositoryRoot, relativePath), 'utf8')) as Record<string, unknown>
}

describe('workspace topology', () => {
  it('declares a private root orchestrator and all planned workspace packages', () => {
    const rootPackage = readJson('package.json')
    const workspace = readFileSync(resolve(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8')
    const scripts = rootPackage['scripts'] as Record<string, string>

    expect(rootPackage['private']).toBe(true)
    expect(workspace).toMatch(/packages:\s*\n(?:\s+- .*\n)*\s+- packages\/\*/) 
    expect(workspace).toContain('  - apps/*')
    expect(workspace).toContain('  - examples/*')
    expect(scripts['workspace-typecheck']).toBeDefined()
    expect(scripts['workspace-build']).toBeDefined()

    for (const [relativePath, packageName] of workspaceEntries) {
      const packageRoot = resolve(repositoryRoot, relativePath)
      const packageJson = readJson(`${relativePath}/package.json`)
      expect(packageJson['name']).toBe(packageName)
      expect(packageJson['private']).toBe(true)
      expect(readFileSync(resolve(packageRoot, 'tsconfig.json'), 'utf8')).toContain('workspace')
      expect(readFileSync(resolve(packageRoot, 'vite.config.ts'), 'utf8')).toContain('defineConfig')
      expect(readFileSync(resolve(packageRoot, 'src/index.ts'), 'utf8')).toBeTruthy()
    }
  })
})
