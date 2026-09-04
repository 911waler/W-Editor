import type { Codec, CodecMatch, ProjectionNode, ValidationResult } from './contracts'

export const ATTACHMENT_KINDS = Object.freeze(['pdf', 'word', 'file'] as const)

export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]
export type AttachmentCommandId = `insert.${AttachmentKind}`

export interface AttachmentDraft {
  readonly kind: AttachmentKind
  readonly mediaType: string
  readonly name: string
  readonly size: number
  readonly url: string
}

export interface AttachmentModel extends AttachmentDraft {
  readonly commandId: AttachmentCommandId
  readonly source: string
  readonly sourceSpan: Readonly<{ from: number; to: number }>
}

const MEDIA_TYPE = /^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/u
const METADATA_PREFIX = 'w-editor-attachment:'

function normalizedUrl(value: string): string | null {
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

export function attachmentSource(draft: AttachmentDraft): string {
  const name = draft.name.trim()
  const mediaType = draft.mediaType.trim().toLowerCase()
  const url = normalizedUrl(draft.url.trim())
  if (name.length === 0) throw new RangeError('Attachment name is required.')
  if (/[\]"\r\n]/u.test(name)) throw new RangeError('Attachment name cannot contain a closing bracket, quote, or line break.')
  if (url === null) throw new RangeError('Attachment URL must be an absolute HTTP or HTTPS URL without credentials.')
  if (!MEDIA_TYPE.test(mediaType)) throw new RangeError('Attachment media type is invalid.')
  if (!Number.isSafeInteger(draft.size) || draft.size < 0) throw new RangeError('Attachment size must be a non-negative safe integer.')
  const metadata = `kind=${draft.kind};mediaType=${encodeURIComponent(mediaType)};size=${draft.size}`
  const safeUrl = url.replace(/\(/gu, '%28').replace(/\)/gu, '%29')
  return `[${name}](${safeUrl} "${METADATA_PREFIX}${metadata}")`
}

export function parseAttachmentAt(markdown: string, offset: number): AttachmentModel | null {
  if (offset < 0 || offset > markdown.length || (offset > 0 && markdown[offset - 1] !== '\n')) return null
  const newline = markdown.indexOf('\n', offset)
  const lineEnd = newline === -1 ? markdown.length : newline > offset && markdown[newline - 1] === '\r' ? newline - 1 : newline
  const source = markdown.slice(offset, lineEnd)
  const match = /^\[([^\]"\r\n]+)\]\((https?:\/\/\S+) "w-editor-attachment:([^"]+)"\)$/u.exec(source)
  if (match === null) return null
  const metadata = new Map((match[3] ?? '').split(';').map((field) => {
    const separator = field.indexOf('=')
    return separator < 1 ? ['', ''] : [field.slice(0, separator), field.slice(separator + 1)]
  }))
  const kind = metadata.get('kind')
  let mediaType: string
  try {
    mediaType = decodeURIComponent(metadata.get('mediaType') ?? '')
  } catch {
    return null
  }
  const size = Number(metadata.get('size'))
  const name = match[1]?.trim() ?? ''
  const url = normalizedUrl(match[2] ?? '')
  if ((kind !== 'pdf' && kind !== 'word' && kind !== 'file')
    || name.length === 0
    || url === null
    || !MEDIA_TYPE.test(mediaType)
    || !Number.isSafeInteger(size)
    || size < 0) return null
  return Object.freeze({
    commandId: `insert.${kind}`,
    kind,
    mediaType,
    name,
    size,
    source,
    sourceSpan: Object.freeze({ from: offset, to: lineEnd }),
    url,
  })
}

export function validateAttachmentSource(kind: AttachmentKind, source: string): ValidationResult {
  const parsed = parseAttachmentAt(source, 0)
  if (parsed === null || parsed.sourceSpan.to !== source.length || parsed.kind !== kind) {
    return Object.freeze({
      code: 'ATTACHMENT_SOURCE_INVALID',
      message: `Expected one valid Cherry ${kind} attachment link with serializable metadata.`,
      sourceSpan: Object.freeze({ from: 0, to: source.length }),
      valid: false,
    })
  }
  return Object.freeze({ valid: true })
}

function codec(kind: AttachmentKind, precedence: number): Codec {
  const codecId = `attachment-${kind}`
  const definition: Codec = {
    id: codecId,
    precedence,
    project: (match: CodecMatch, revision: number): ProjectionNode => {
      const parsed = parseAttachmentAt(match.originalSource, 0)
      if (parsed === null || parsed.kind !== kind) throw new TypeError(`Invalid ${kind} attachment match.`)
      return Object.freeze({
        attributes: Object.freeze({
          attachmentKind: kind,
          mediaType: parsed.mediaType,
          name: parsed.name,
          size: parsed.size,
          url: parsed.url,
        }),
        children: Object.freeze([]),
        codecId,
        editStrategy: Object.freeze({ editorId: 'attachment-editor', kind: 'semantic-editor' as const }),
        kind: 'structured' as const,
        nodeType: 'semanticBlock',
        originalSource: match.originalSource,
        projectionId: `${codecId}:${match.sourceSpan.from}:${match.sourceSpan.to}`,
        revision,
        sourceSpan: Object.freeze({ ...match.sourceSpan }),
      })
    },
    recognize: (context, offset): CodecMatch | null => {
      const parsed = parseAttachmentAt(context.markdown, offset)
      if (parsed === null || parsed.kind !== kind) return null
      return Object.freeze({
        captures: Object.freeze({
          kind,
          mediaType: parsed.mediaType,
          name: parsed.name,
          size: String(parsed.size),
          url: parsed.url,
        }),
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
    scope: 'block',
    serialize: ({ node }) => node.originalSource,
    validate: (source) => validateAttachmentSource(kind, source),
  }
  return Object.freeze(definition)
}

export const attachmentCodecs = Object.freeze(ATTACHMENT_KINDS.map((kind, index) => codec(kind, 75 - index)))
