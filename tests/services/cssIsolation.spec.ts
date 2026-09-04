import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('shared CSS isolation contract', () => {
  it('keeps editor styles rooted and vendors transformed instead of global', () => {
    const editorCss = readFileSync('packages/editor-vue/src/ui/styles.css', 'utf8')
    const source = readFileSync('packages/editor-vue/src/adapters/cherrySourceAdapter.ts', 'utf8')
    const entry = readFileSync('packages/editor-vue/src/index.ts', 'utf8')

    expect(editorCss).toContain('.w-editor-instance')
    expect(editorCss).not.toContain(':root {')
    expect(editorCss).not.toMatch(/(?:^|[,{])\s*(?:html|body|#app)/u)
    expect(source).not.toContain("import 'cherry-markdown/dist/cherry-markdown.min.css'")
    expect(entry).toContain('./ui/scopedVendorStyles.css')
  })
})
