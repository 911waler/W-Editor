import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CherryRenderAdapter as SharedCherryRenderAdapter } from '../../packages/editor-vue/src/adapters/cherryRenderAdapter'
import { CherryRenderAdapter as RootCherryRenderAdapter } from '../../src/adapters/cherryRenderAdapter'

const repositoryRoot = resolve(import.meta.dirname, '../..')

describe('editor-vue shared UI boundary', () => {
  it('owns the adapters and shared surfaces while root paths remain compatibility wrappers', () => {
    expect(RootCherryRenderAdapter).toBe(SharedCherryRenderAdapter)
    expect(readFileSync(resolve(repositoryRoot, 'packages/editor-vue/src/ui/styles.css'), 'utf8')).toContain('.workspace-shell')
    for (const file of [
      'SourceEditorSurface.vue',
      'VisualEditorSurface.vue',
      'SafePreviewHtml.vue',
      'DrawioDialog.vue',
      'FormulaPicker.vue',
      'MediaEditorHost.vue',
    ]) {
      expect(readFileSync(resolve(repositoryRoot, 'packages/editor-vue/src/ui', file), 'utf8')).toBeTruthy()
    }
  })
})
