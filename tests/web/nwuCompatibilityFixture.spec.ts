import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { projectOrdinaryMarkdown } from '../../packages/editor-core/src/index'
import { mountWEditor, mountWRenderer } from '../../packages/editor-web/src/index'

const fixturePath = resolve(import.meta.dirname, '../fixtures/nwu/lagging-copy-sanitized.md')
const matrixPath = resolve(import.meta.dirname, '../fixtures/nwu/compatibility-matrix.json')

describe('sanitized lagging-copy NWU compatibility fixture', () => {
  it('covers the known syntax families and preserves exact Markdown through Reader and Editor', async () => {
    const markdown = readFileSync(fixturePath, 'utf8')
    const matrix = JSON.parse(readFileSync(matrixPath, 'utf8')) as {
      readonly families: Readonly<Record<string, Readonly<Record<string, string>>>>
      readonly sourceKind: string
    }
    expect(matrix.sourceKind).toBe('synthetic-from-lagging-copy-syntax-facts')
    expect(matrix.families['imageAttributes']?.['reader']).toBe('preserved-not-applied')
    expect(matrix.families['scriptComment']?.['genericReader']).toBe('inert-and-preserved')
    expect(markdown).toContain('![脱敏图片](/static/blog_images/sanitized/example.png){width=640 height=360 align=center}')
    expect(markdown).toContain('<span style="color: #b42318; font-size: 18px">脱敏强调文本</span>')
    expect(markdown).toContain('<div style="text-align: center;">脱敏居中文本</div>')
    expect(markdown).toContain('```python')
    expect(markdown).toContain('$$')
    expect(markdown).toContain('[[toc]]')
    expect(markdown).toContain('<!-- script: inspect_gpu.py -->')

    const projection = projectOrdinaryMarkdown({ documentId: 'nwu-sanitized', markdown, revision: 0 })
    expect(projection.source).toBe(markdown)
    for (const entry of projection.map.entries) {
      expect(markdown.slice(entry.sourceSpan.from, entry.sourceSpan.to)).toBe(entry.originalSource)
    }

    const editorContainer = document.createElement('div')
    const editor = mountWEditor(editorContainer, {
      document: { documentId: 'nwu-sanitized', markdown, serverRevision: 'reference-only-1' },
      initialMode: 'source',
    })
    await vi.waitFor(() => expect(editorContainer.querySelector('[data-w-editor-source]')).not.toBeNull())
    expect(editorContainer.querySelector<HTMLTextAreaElement>('[data-w-editor-source]')?.value).toBe(markdown)
    expect(editor.snapshot().markdown).toBe(markdown)
    expect(editor.exportMarkdown()).toBe(markdown)

    const readerContainer = document.createElement('div')
    const reader = mountWRenderer(readerContainer, { markdown, profile: 'reader' })
    await vi.waitFor(() => expect(readerContainer.querySelector('h1')).not.toBeNull())
    expect(reader.snapshot().markdown).toBe(markdown)
    expect(readerContainer.querySelector('[contenteditable="true"]')).toBeNull()
    const image = readerContainer.querySelector<HTMLImageElement>('img[src="/static/blog_images/sanitized/example.png"]')
    expect(image).not.toBeNull()
    expect(image?.getAttribute('data-image-width')).toBeNull()
    expect(image?.getAttribute('data-image-height')).toBeNull()
    expect(image?.getAttribute('data-image-align')).toBeNull()
    expect(readerContainer.querySelector('span[style*="color"]')?.textContent).toBe('脱敏强调文本')
    expect(readerContainer.querySelector('div[style*="text-align: center"]')?.textContent).toContain('脱敏居中文本')
    expect(readerContainer.querySelector('pre code')).not.toBeNull()
    expect(readerContainer.querySelector('.katex')).not.toBeNull()
    expect(readerContainer.querySelector('.toc')).not.toBeNull()
    expect(readerContainer.textContent).not.toContain('<!-- script:')

    await editor.destroy({ confirm: () => true })
    await reader.destroy()
  })
})
