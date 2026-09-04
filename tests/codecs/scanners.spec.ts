import { describe, expect, it } from 'vitest'

import type { Codec, CodecMatch, CodecRecognitionContext } from '../../src/codecs/contracts'
import { AmbiguousRecognitionError, CodecRegistry } from '../../src/codecs/codecRegistry'

function codec(
  id: string,
  scope: Codec['scope'],
  precedence: number,
  recognize: Codec['recognize'],
): Codec {
  return {
    id,
    precedence,
    scope,
    recognize,
    project: () => { throw new Error('not used by scanner tests') },
    safePatchUnit: () => null,
    serialize: ({ node }) => node.originalSource,
    validate: () => ({ valid: true }),
  }
}

function exactMatch(context: CodecRecognitionContext, from: number, to: number): CodecMatch {
  return {
    captures: {},
    originalSource: context.markdown.slice(from, to),
    sourceSpan: { from, to },
  }
}

function delimitedBlock(delimiter: string): Codec['recognize'] {
  return (context, offset) => {
    if (!context.markdown.startsWith(delimiter, offset)) {
      return null
    }
    const closing = context.markdown.indexOf(`\n${delimiter}`, offset + delimiter.length)
    const to = closing === -1 ? context.markdown.length : closing + delimiter.length + 1
    return exactMatch(context, offset, to)
  }
}

describe('precedence-ordered block and inline scanners', () => {
  it('selects the highest-precedence recognizer at an overlapping offset', () => {
    const markdown = '::: info\nbody\n:::'
    const broad = codec('broad-block', 'block', 10, (context, offset) => exactMatch(context, offset, context.markdown.length))
    const container = codec('container', 'block', 50, delimitedBlock(':::'))
    const registry = new CodecRegistry([broad, container])

    expect(registry.scanBlocks({ markdown, revision: 7 })).toEqual([
      {
        captures: {},
        codecId: 'container',
        originalSource: markdown,
        sourceSpan: { from: 0, to: markdown.length },
      },
    ])
  })

  it('keeps container-looking text inside a fenced block', () => {
    const markdown = '```md\n::: info\ninside\n:::\n```'
    const fence = codec('fenced-code', 'block', 100, delimitedBlock('```'))
    const container = codec('container', 'block', 50, delimitedBlock(':::'))
    const registry = new CodecRegistry([container, fence])

    expect(registry.scanBlocks({ markdown, revision: 1 }).map((match) => match.codecId)).toEqual(['fenced-code'])
  })

  it('only invokes block recognizers at line boundaries', () => {
    const markdown = 'paragraph ::: info\nstill paragraph'
    const container = codec('container', 'block', 50, delimitedBlock(':::'))
    const registry = new CodecRegistry([container])

    expect(registry.scanBlocks({ markdown, revision: 1 })).toEqual([])
  })

  it('confines inline recognition to the requested source span', () => {
    const markdown = '**one**\n**two**'
    const strong = codec('strong', 'inline', 20, (context, offset) => {
      if (!context.markdown.startsWith('**', offset)) return null
      const closing = context.markdown.indexOf('**', offset + 2)
      return closing === -1 ? null : exactMatch(context, offset, closing + 2)
    })
    const registry = new CodecRegistry([strong])

    expect(registry.scanInline({ markdown, revision: 1 }, { from: 0, to: 7 })).toEqual([
      {
        captures: {},
        codecId: 'strong',
        originalSource: '**one**',
        sourceSpan: { from: 0, to: 7 },
      },
    ])
  })

  it('rejects same-precedence recognizers that ambiguously overlap', () => {
    const markdown = '::: info\nbody\n:::'
    const first = codec('container-a', 'block', 50, delimitedBlock(':::'))
    const second = codec('container-b', 'block', 50, delimitedBlock(':::'))
    const registry = new CodecRegistry([first, second])

    expect(() => registry.scanBlocks({ markdown, revision: 1 })).toThrowError(AmbiguousRecognitionError)
    expect(() => registry.scanBlocks({ markdown, revision: 1 })).toThrowError(expect.objectContaining({
      code: 'AMBIGUOUS_RECOGNITION',
      offset: 0,
    }))
  })
})
