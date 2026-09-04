import type { Codec, ProjectionMap } from '../../src/codecs/contracts'

export const CODEC_THROW_MARKDOWN = '[[fixture:codec-throw]]'

export const throwingCodecFixture: Codec = {
  id: 'fixture-codec-throw',
  precedence: 10_000,
  scope: 'inline',
  recognize: (context, offset) => {
    if (context.markdown.startsWith(CODEC_THROW_MARKDOWN, offset)) {
      throw new Error(`Injected codec failure at offset ${offset}.`)
    }
    return null
  },
  project: () => { throw new Error('Injected codec projection failure.') },
  safePatchUnit: () => null,
  serialize: () => { throw new Error('Injected codec serialization failure.') },
  validate: () => ({ code: 'INJECTED_CODEC_FAILURE', message: 'Injected codec validation failure.', sourceSpan: null, valid: false }),
}

export const invalidSchemaProjectionFixture = Object.freeze({
  content: [{ type: 'fixture-node-that-is-not-in-the-schema' }],
  type: 'doc',
})

export function staleProjectionMapFixture(markdown: string, revision: number): ProjectionMap {
  return Object.freeze({
    documentLength: markdown.length,
    entries: Object.freeze([]),
    revision: revision - 1,
  })
}

export const resourceLimitFixture = Object.freeze({
  code: 'DECLARED_RESOURCE_LIMIT_EXCEEDED',
  markdown: `# Resource limit fixture\n\n${'0123456789abcdef'.repeat(16)}`,
  maximumCharacters: 128,
})

export class ResourceLimitFixtureError extends Error {
  readonly code = resourceLimitFixture.code
  readonly actualCharacters: number
  readonly maximumCharacters: number

  constructor(actualCharacters: number, maximumCharacters: number) {
    super(`Fixture source contains ${actualCharacters} characters; limit is ${maximumCharacters}.`)
    this.name = 'ResourceLimitFixtureError'
    this.actualCharacters = actualCharacters
    this.maximumCharacters = maximumCharacters
  }
}

export function enforceResourceLimit(markdown: string, maximumCharacters: number): void {
  if (markdown.length > maximumCharacters) {
    throw new ResourceLimitFixtureError(markdown.length, maximumCharacters)
  }
}
