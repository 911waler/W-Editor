import { describe, expect, it } from 'vitest'

import {
  CODE_LANGUAGE_OPTIONS,
  codeLanguageOptions,
  fencedCodeAtSelection,
  parseFencedCodeAt,
  projectOrdinaryMarkdown,
  serializeFencedCode,
} from '../../src/codecs'

describe('fenced code codec', () => {
  it('offers a stable language selection list while preserving an existing custom language', () => {
    expect(CODE_LANGUAGE_OPTIONS.map((option) => option.value)).toEqual([
      '',
      'bash',
      'c',
      'cpp',
      'csharp',
      'css',
      'dart',
      'diff',
      'dockerfile',
      'go',
      'graphql',
      'html',
      'java',
      'javascript',
      'json',
      'jsx',
      'kotlin',
      'latex',
      'lua',
      'markdown',
      'matlab',
      'php',
      'powershell',
      'python',
      'r',
      'ruby',
      'rust',
      'shell',
      'sql',
      'swift',
      'toml',
      'tsx',
      'typescript',
      'vue',
      'xml',
      'yaml',
    ])
    expect(codeLanguageOptions('haskell').at(-1)).toEqual({ label: 'haskell', value: 'haskell' })
    expect(codeLanguageOptions(' typescript ')).toBe(CODE_LANGUAGE_OPTIONS)
  })

  it.each([
    ['```typescript\nconst answer = 42\n```', '`', 3, 'typescript'],
    ['~~~~text\r\nexact  \r\n~~~~', '~', 4, 'text'],
  ] as const)('parses %s exactly', (source, fenceCharacter, fenceLength, language) => {
    const markdown = `Before\n\n${source}\n\nAfter`
    const from = markdown.indexOf(source)
    expect(parseFencedCodeAt(markdown, from)).toEqual({
      code: source.includes('answer') ? 'const answer = 42' : 'exact  ',
      fenceCharacter,
      fenceLength,
      language,
      source,
      sourceSpan: { from, to: from + source.length },
    })
    expect(fencedCodeAtSelection(markdown, { from: from + 4, to: from + 4 })).toMatchObject({ source })
  })

  it('chooses a fence longer than any backtick run in edited code', () => {
    expect(serializeFencedCode('javascript', 'const sample = ````')).toBe('`````javascript\nconst sample = ````\n`````')
    const trailing = serializeFencedCode('text', 'line\n')
    expect(parseFencedCodeAt(trailing, 0)?.code).toBe('line\n')
    expect(() => serializeFencedCode('java script', 'code')).toThrow('single safe identifier')
  })

  it('projects complete code as a direct editable node and incomplete code as one exact raw node', () => {
    const complete = '```js\nalert(1)\n```'
    const projection = projectOrdinaryMarkdown({ documentId: 'code', markdown: complete, revision: 2 })
    expect(projection.content.content?.[0]).toMatchObject({
      attrs: { language: 'js' },
      content: [{ text: 'alert(1)', type: 'text' }],
      type: 'codeBlock',
    })
    expect(projection.map.entries[0]?.safePatchUnit).toMatchObject({
      expectedSource: complete,
      strategy: { kind: 'direct', scope: 'block' },
      structural: false,
    })
    const incomplete = '```js\nalert(1)'
    expect(projectOrdinaryMarkdown({ documentId: 'raw-code', markdown: incomplete, revision: 0 }).content.content).toEqual([
      expect.objectContaining({ attrs: expect.objectContaining({ source: incomplete }), type: 'rawBlock' }),
    ])
  })
})
