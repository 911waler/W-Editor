import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('responsive workspace contract', () => {
  it('contracts the workspace, toolbar, and continuous canvas below the narrow breakpoint', () => {
    const css = readFileSync('packages/editor-vue/src/ui/styles.css', 'utf8')

    expect(css).toContain('@media (max-width: 680px)')
    expect(css).toContain('.toolbar-region { position: sticky;')
    expect(css).toContain('height: 48px; min-height: 48px;')
    expect(css).toContain('.toolbar-region { min-width: 0; flex-wrap: nowrap; overflow-x: auto; overflow-y: hidden;')
    expect(css).toContain('.toolbar-menu__panel { position: fixed;')
    expect(css).toContain('.toolbar-tooltip { z-index: 70;')
    expect(css).toContain('.dialog-panel.toolbar-popover { z-index: 60;')
    expect(css).toContain('.visual-surface, .preview-surface { width: 100%; min-width: 0; min-height: auto;')
    expect(css).toContain('.continuous-canvas { min-height: auto; }')
    expect(css).not.toContain('width: 8.5in')
    expect(css).not.toContain('height: 11in')
  })
})
