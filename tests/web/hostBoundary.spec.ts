import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const webSource = resolve(import.meta.dirname, '../../packages/editor-web/src')

describe('Web host dependency boundary', () => {
  it('uses only the editor-vue host bridge and never reaches internal Vue source or state', () => {
    const source = readdirSync(webSource)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => readFileSync(resolve(webSource, file), 'utf8'))
      .join('\n')
    expect(source).not.toContain('/editor-vue/src/')
    expect(source).not.toContain('editor-vue/src/')
    expect(source).not.toMatch(/from ['"](?:\.\.?\/)+editor-vue\/src/iu)
    expect(source).not.toMatch(/from ['"]@w-editor\/editor-vue(?:\/services|\/adapters|\/rendering)['"]/u)
    expect(source).toContain("@w-editor/editor-vue/host")
  })
})
