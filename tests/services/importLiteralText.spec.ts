import { describe, expect, it, vi } from 'vitest'

import { createSharedRendererPipeline } from '../../packages/editor-vue/src/rendering/sharedRendererPipeline'

describe('host import literal fallback', () => {
  it.each([
    '[local](/home/example/paper.docx)',
    '![figure](/home/example/image.png)',
    '[unsafe](javascript:alert(1))',
    '<file:///etc/passwd>',
    '[reference]: /home/example/paper.md',
    '![label with `code` and <b>HTML</b>](file:///tmp/a)',
    '[encoded](javascript&#58;alert(1))',
    '[windows](C:\\Users\\example\\paper.md)',
  ])('retains %s as visible text while rendering supported neighbors', async (source) => {
    vi.useRealTimers()
    // The host escapes ASCII punctuation in rejected source spans.
    const literal = source.replace(/[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/g, (character) => character === '&' ? '&amp;' : `\\${character}`)
    const markdown = `# Heading\n\n**Before** ${literal} [good](https://example.invalid) *after*\n`
    const pipeline = createSharedRendererPipeline()
    try {
      for (const profile of ['author-preview', 'reader'] as const) {
        const rendered = pipeline.render({ documentId: 'import-test', markdown, revision: 0 }, profile, document)
        const host = document.createElement('div')
        host.innerHTML = rendered.html
        expect(host.textContent).toContain(source)
        expect(host.querySelector('h1')?.textContent).toBe('Heading')
        expect(host.querySelector('strong')?.textContent).toBe('Before')
        expect(host.querySelector('em')?.textContent).toBe('after')
        expect([...host.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))).toEqual(['https://example.invalid'])
        expect(host.querySelectorAll('img, script, iframe')).toHaveLength(0)
      }
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 20))
      pipeline.destroy()
    }
  })
})
