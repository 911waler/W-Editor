import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '../..')

describe('playground shell boundary', () => {
  it('owns the demo catalog and browser envelopes outside the shared editor package', () => {
    const playgroundApp = resolve(repositoryRoot, 'apps/playground/src/PlaygroundApp.vue')
    const articleCatalog = resolve(repositoryRoot, 'apps/playground/src/services/articleCatalog.ts')
    const appSource = readFileSync(playgroundApp, 'utf8')
    const catalogSource = readFileSync(articleCatalog, 'utf8')
    const envelopeSource = readFileSync(resolve(repositoryRoot, 'apps/playground/src/services/localDocumentRepository.ts'), 'utf8')

    expect(appSource).toContain('@w-editor/editor-vue')
    expect(catalogSource).toContain('Welcome to W-Editor')
    expect(envelopeSource).toContain('w-editor:v1:document:')
    expect(readFileSync(resolve(repositoryRoot, 'src/ui/App.vue'), 'utf8')).toContain('PlaygroundApp')

    const sharedSource = readFileSync(resolve(repositoryRoot, 'packages/editor-vue/src/index.ts'), 'utf8')
    expect(sharedSource).not.toContain('articleCatalog')
    expect(sharedSource).not.toContain('w-editor:v1:document:')
  })
})
