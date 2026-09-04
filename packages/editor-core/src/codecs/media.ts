import type { Codec, CodecMatch, ProjectionNode, ValidationResult } from './contracts'

export const MEDIA_KINDS = Object.freeze(['image', 'audio', 'video'] as const)

export type MediaKind = (typeof MEDIA_KINDS)[number]
export type MediaCommandId = `insert.${MediaKind}`

export interface MediaModel {
  readonly commandId: MediaCommandId
  readonly kind: MediaKind
  readonly name: string
  readonly source: string
  readonly sourceSpan: Readonly<{ from: number; to: number }>
  readonly url: string
}

const PREFIX: Readonly<Record<MediaKind, string>> = Object.freeze({
  audio: '!audio',
  image: '!',
  video: '!video',
})

const INLINE_IMAGE_URL = /^data:image\/(?:avif|gif|jpeg|png|webp);base64,[a-z\d+/]+={0,2}$/iu

function normalizedMediaUrl(kind: MediaKind, value: string): string | null {
  if (kind === 'image' && INLINE_IMAGE_URL.test(value)) return value
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.username.length > 0
      || url.password.length > 0) return null
    return url.href
  } catch {
    return null
  }
}

export function mediaSource(kind: MediaKind, nameInput: string, urlInput: string): string {
  const name = nameInput.trim()
  if (name.length === 0) throw new RangeError('Media name is required.')
  if (/[\]\r\n]/u.test(name)) throw new RangeError('Media name cannot contain a closing bracket or line break.')
  const url = normalizedMediaUrl(kind, urlInput.trim())
  if (url === null) throw new RangeError('Media URL must be a safe inline image or an absolute HTTP or HTTPS URL without credentials.')
  const safeUrl = url.replace(/\(/gu, '%28').replace(/\)/gu, '%29')
  return `${PREFIX[kind]}[${name}](${safeUrl})`
}

export function parseMediaAt(markdown: string, offset: number): MediaModel | null {
  if (offset < 0 || offset > markdown.length || (offset > 0 && markdown[offset - 1] !== '\n')) return null
  const newline = markdown.indexOf('\n', offset)
  const lineEnd = newline === -1 ? markdown.length : newline > offset && markdown[newline - 1] === '\r' ? newline - 1 : newline
  const line = markdown.slice(offset, lineEnd)
  const match = /^!(?:(audio|video))?\[([^\]\r\n]+)\]\(([\s\S]+)\)$/u.exec(line)
  if (match === null) return null
  const kind = (match[1] ?? 'image') as MediaKind
  const name = match[2]?.trim() ?? ''
  const url = normalizedMediaUrl(kind, match[3] ?? '')
  if (name.length === 0 || url === null) return null
  return Object.freeze({
    commandId: `insert.${kind}`,
    kind,
    name,
    source: line,
    sourceSpan: Object.freeze({ from: offset, to: lineEnd }),
    url,
  })
}

export function validateMediaSource(kind: MediaKind, source: string): ValidationResult {
  const parsed = parseMediaAt(source, 0)
  if (parsed === null || parsed.sourceSpan.to !== source.length || parsed.kind !== kind) {
    return Object.freeze({
      code: 'MEDIA_SOURCE_INVALID',
      message: `Expected one valid Cherry ${kind} URL construct.`,
      sourceSpan: Object.freeze({ from: 0, to: source.length }),
      valid: false,
    })
  }
  return Object.freeze({ valid: true })
}

function codec(kind: MediaKind, precedence: number): Codec {
  const codecId = `media-${kind}`
  const definition: Codec = {
    id: codecId,
    precedence,
    project: (match: CodecMatch, revision: number): ProjectionNode => {
      const parsed = parseMediaAt(match.originalSource, 0)
      if (parsed === null || parsed.kind !== kind) throw new TypeError(`Invalid ${kind} media match.`)
      return Object.freeze({
        attributes: Object.freeze({ kind, name: parsed.name, url: parsed.url }),
        children: Object.freeze([]),
        codecId,
        editStrategy: Object.freeze({ editorId: 'media-editor', kind: 'semantic-editor' as const }),
        kind: 'structured' as const,
        nodeType: 'semanticBlock',
        originalSource: match.originalSource,
        projectionId: `${codecId}:${match.sourceSpan.from}:${match.sourceSpan.to}`,
        revision,
        sourceSpan: Object.freeze({ ...match.sourceSpan }),
      })
    },
    recognize: (context, offset): CodecMatch | null => {
      const parsed = parseMediaAt(context.markdown, offset)
      if (parsed === null || parsed.kind !== kind) return null
      return Object.freeze({
        captures: Object.freeze({ kind, name: parsed.name, url: parsed.url }),
        originalSource: parsed.source,
        sourceSpan: parsed.sourceSpan,
      })
    },
    safePatchUnit: (node) => Object.freeze({
      codecId,
      expectedSource: node.originalSource,
      sourceSpan: Object.freeze({ ...node.sourceSpan }),
      strategy: node.editStrategy,
      structural: true,
      unitId: node.projectionId,
    }),
    scope: 'block' as const,
    serialize: ({ node }) => node.originalSource,
    validate: (source) => validateMediaSource(kind, source),
  }
  return Object.freeze(definition)
}

export const mediaCodecs = Object.freeze(MEDIA_KINDS.map((kind, index) => codec(kind, 78 - index)))
