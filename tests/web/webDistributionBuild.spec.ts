import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const distributionRoot = resolve(process.cwd(), 'packages/editor-web/dist')

describe('Web distribution library build', () => {
  it('publishes self-contained ESM, IIFE, CSS, public types, and tracked chunks', () => {
    expect(existsSync(resolve(distributionRoot, 'editor.es.js'))).toBe(true)
    expect(existsSync(resolve(distributionRoot, 'renderer.es.js'))).toBe(true)
    expect(existsSync(resolve(distributionRoot, 'w-editor.global.js'))).toBe(true)
    expect(existsSync(resolve(distributionRoot, 'w-editor.css'))).toBe(true)
    expect(existsSync(resolve(distributionRoot, 'types/index.d.ts'))).toBe(true)

    const chunkRoot = resolve(distributionRoot, 'chunks')
    expect(readdirSync(chunkRoot).some((file) => file.endsWith('.js'))).toBe(true)

    const editorSource = readFileSync(resolve(distributionRoot, 'editor.es.js'), 'utf8')
    const rendererSource = readFileSync(resolve(distributionRoot, 'renderer.es.js'), 'utf8')
    const iifeSource = readFileSync(resolve(distributionRoot, 'w-editor.global.js'), 'utf8')
    for (const source of [editorSource, rendererSource, iifeSource]) {
      expect(source).not.toMatch(/from ['"](?:vue|@w-editor\/editor-(?:core|vue))['"]/u)
    }
  })
})
