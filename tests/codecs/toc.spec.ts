import { describe, expect, it } from 'vitest'

import { createMarkdownOutline } from '../../src/codecs'

describe('Markdown-derived article outline', () => {
  it('derives H1-H5 source positions and Cherry-compatible anchors while skipping fenced code', () => {
    const markdown = [
      '# Alpha',
      '',
      '## 章节 一',
      '',
      '```md',
      '# Hidden',
      '```',
      '',
      '# Alpha',
      '',
      '### **Rich** `code` {#chosen}',
      '',
      '###### Not supported',
    ].join('\n')

    expect(createMarkdownOutline(markdown)).toEqual([
      { anchor: 'alpha', level: 1, sourceFrom: 0, sourceTo: 7, text: 'Alpha' },
      { anchor: '%E7%AB%A0%E8%8A%82-%E4%B8%80', level: 2, sourceFrom: 9, sourceTo: 16, text: '章节 一' },
      { anchor: 'alpha-2', level: 1, sourceFrom: 38, sourceTo: 45, text: 'Alpha' },
      { anchor: 'chosen', level: 3, sourceFrom: 47, sourceTo: 76, text: 'Rich code' },
    ])
  })

  it('returns no fabricated items for an unterminated fenced block', () => {
    expect(createMarkdownOutline('```md\n# Hidden')).toEqual([])
  })
})
