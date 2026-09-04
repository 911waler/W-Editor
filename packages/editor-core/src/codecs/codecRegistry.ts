import type { Codec, CodecMatch, CodecRecognitionContext, SourceSpan } from './contracts'

export interface ScannedMatch extends CodecMatch {
  readonly codecId: string
}

export class AmbiguousRecognitionError extends Error {
  readonly code = 'AMBIGUOUS_RECOGNITION'
  readonly codecIds: readonly string[]
  readonly offset: number

  constructor(offset: number, codecIds: readonly string[]) {
    super(`Multiple codecs with equal precedence recognized source at offset ${offset}: ${codecIds.join(', ')}.`)
    this.name = 'AmbiguousRecognitionError'
    this.codecIds = Object.freeze([...codecIds])
    this.offset = offset
  }
}

export class InvalidRecognitionError extends Error {
  readonly code = 'INVALID_RECOGNITION'
  readonly codecId: string
  readonly offset: number

  constructor(codecId: string, offset: number, reason: string) {
    super(`Codec ${codecId} returned an invalid match at offset ${offset}: ${reason}.`)
    this.name = 'InvalidRecognitionError'
    this.codecId = codecId
    this.offset = offset
  }
}

interface RecognizedCandidate {
  readonly codec: Codec
  readonly match: CodecMatch
}

export class CodecRegistry {
  readonly #codecs: readonly Codec[]

  constructor(codecs: readonly Codec[]) {
    const ids = new Set<string>()
    for (const codec of codecs) {
      if (ids.has(codec.id)) {
        throw new TypeError(`Duplicate codec id: ${codec.id}.`)
      }
      ids.add(codec.id)
    }
    this.#codecs = Object.freeze([...codecs].sort((left, right) => right.precedence - left.precedence || left.id.localeCompare(right.id)))
  }

  codecs(): readonly Codec[] {
    return this.#codecs
  }

  get(codecId: string): Codec | undefined {
    return this.#codecs.find((codec) => codec.id === codecId)
  }

  scanBlocks(context: CodecRecognitionContext): readonly ScannedMatch[] {
    const matches: ScannedMatch[] = []
    let offset = 0
    while (offset < context.markdown.length) {
      const candidate = this.#recognizeAt('block', context, offset, { from: 0, to: context.markdown.length })
      if (candidate === null) {
        const newline = context.markdown.indexOf('\n', offset)
        if (newline === -1) break
        offset = newline + 1
        continue
      }
      matches.push(this.#scanned(candidate))
      offset = candidate.match.sourceSpan.to
      if (offset > 0 && context.markdown[offset - 1] !== '\n' && offset < context.markdown.length) {
        const newline = context.markdown.indexOf('\n', offset)
        if (newline === -1) break
        offset = newline + 1
      }
    }
    return Object.freeze(matches)
  }

  scanInline(context: CodecRecognitionContext, sourceSpan: SourceSpan): readonly ScannedMatch[] {
    if (!Number.isInteger(sourceSpan.from) || !Number.isInteger(sourceSpan.to) || sourceSpan.from < 0 || sourceSpan.to < sourceSpan.from || sourceSpan.to > context.markdown.length) {
      throw new RangeError('Inline scan span is outside the Markdown source.')
    }
    const matches: ScannedMatch[] = []
    let offset = sourceSpan.from
    while (offset < sourceSpan.to) {
      const candidate = this.#recognizeAt('inline', context, offset, sourceSpan)
      if (candidate === null) {
        offset += 1
        continue
      }
      matches.push(this.#scanned(candidate))
      offset = candidate.match.sourceSpan.to
    }
    return Object.freeze(matches)
  }

  #recognizeAt(
    scope: Codec['scope'],
    context: CodecRecognitionContext,
    offset: number,
    boundary: SourceSpan,
  ): RecognizedCandidate | null {
    const candidates: RecognizedCandidate[] = []
    for (const codec of this.#codecs) {
      if (codec.scope !== scope) continue
      const match = codec.recognize(context, offset)
      if (match === null) continue
      this.#assertValidMatch(codec, match, context.markdown, offset, boundary)
      candidates.push({ codec, match })
    }
    const selected = candidates[0]
    if (selected === undefined) return null
    const ambiguous = candidates.filter((candidate) => candidate.codec.precedence === selected.codec.precedence)
    if (ambiguous.length > 1) {
      throw new AmbiguousRecognitionError(offset, ambiguous.map((candidate) => candidate.codec.id))
    }
    return selected
  }

  #assertValidMatch(
    codec: Codec,
    match: CodecMatch,
    markdown: string,
    offset: number,
    boundary: SourceSpan,
  ): void {
    const { from, to } = match.sourceSpan
    if (!Number.isInteger(from) || !Number.isInteger(to) || from !== offset || to <= from || from < boundary.from || to > boundary.to) {
      throw new InvalidRecognitionError(codec.id, offset, 'source span is empty, displaced, or outside the scan boundary')
    }
    if (match.originalSource !== markdown.slice(from, to)) {
      throw new InvalidRecognitionError(codec.id, offset, 'originalSource does not equal the exact Markdown slice')
    }
  }

  #scanned(candidate: RecognizedCandidate): ScannedMatch {
    return Object.freeze({
      captures: candidate.match.captures,
      codecId: candidate.codec.id,
      originalSource: candidate.match.originalSource,
      sourceSpan: Object.freeze({ ...candidate.match.sourceSpan }),
    })
  }
}
