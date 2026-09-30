export interface ImageDimensions {
  readonly width: number | null
  readonly height: number | null
}

export interface InlineImageModel extends ImageDimensions {
  readonly name: string
  readonly url: string
  readonly source: string
  readonly sourceSpan: Readonly<{ from: number; to: number }>
}

const INLINE_IMAGE_URL = /^data:image\/(?:avif|gif|jpeg|png|webp);base64,[a-z\d+/]+={0,2}$/iu
// eslint-disable-next-line no-control-regex -- Reject ASCII controls in untrusted resource addresses.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u
const ESCAPED_CHARACTER = /\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~\\])/gu

function unescapeMarkdown(value: string): string {
  return value.replace(ESCAPED_CHARACTER, '$1')
}

export function normalizeImageUrl(value: string): string | null {
  const candidate = value.trim()
  if (candidate.length === 0 || CONTROL_CHARACTER.test(candidate) || candidate.includes('\\')) return null
  if (INLINE_IMAGE_URL.test(candidate)) return candidate
  if (candidate.startsWith('//')) return null
  if (candidate.startsWith('/')) return candidate.replace(/\s/gu, (character) => encodeURIComponent(character))
  try {
    const url = new URL(candidate)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.username.length > 0
      || url.password.length > 0) return null
    return url.href
  } catch {
    return null
  }
}

function isEscaped(markdown: string, offset: number): boolean {
  let slashes = 0
  for (let i = offset - 1; i >= 0 && markdown[i] === '\\'; i -= 1) slashes += 1
  return slashes % 2 === 1
}

function isInsideCodeSpan(markdown: string, offset: number): boolean {
  const start = markdown.lastIndexOf('\n', offset - 1) + 1
  const newline = markdown.indexOf('\n', offset)
  const end = newline === -1 ? markdown.length : newline
  const runs = [...markdown.slice(start, end).matchAll(/`+/gu)]
  for (let i = 0; i < runs.length; i += 1) {
    const opener = runs[i]
    if (opener === undefined || start + opener.index >= offset) break
    if (isEscaped(markdown, start + opener.index)) continue
    const closerIndex = runs.findIndex((run, index) => index > i && run[0].length === opener[0].length)
    if (closerIndex < 0) continue
    const closer = runs[closerIndex]
    if (closer !== undefined && offset < start + closer.index) return true
    i = closerIndex
  }
  return false
}

function scanAltEnd(markdown: string, from: number): number {
  for (let cursor = from; cursor < markdown.length; cursor += 1) {
    const character = markdown[cursor]
    if (character === '\r' || character === '\n') return -1
    if (character === '\\') cursor += 1
    else if (character === ']') return cursor
  }
  return -1
}

function scanDestinationEnd(markdown: string, from: number): number {
  let depth = 0
  let quote: '"' | "'" | null = null
  for (let cursor = from; cursor < markdown.length; cursor += 1) {
    const character = markdown[cursor]
    if (character === '\r' || character === '\n') return -1
    if (character === '\\') {
      cursor += 1
      continue
    }
    if (quote !== null) {
      if (character === quote) quote = null
      continue
    }
    if ((character === '"' || character === "'") && depth === 0 && /\s/u.test(markdown[cursor - 1] ?? '')) {
      quote = character
      continue
    }
    if (character === '(') depth += 1
    else if (character === ')' && depth === 0) return cursor
    else if (character === ')') depth -= 1
  }
  return -1
}

interface DestinationParts {
  readonly destination: string
  readonly title: string
}

function splitDestination(value: string): DestinationParts | null {
  let depth = 0
  for (let cursor = 0; cursor < value.length; cursor += 1) {
    const character = value[cursor]
    if (character === '\\') {
      cursor += 1
      continue
    }
    if (character === '(') depth += 1
    else if (character === ')') depth -= 1
    else if (/\s/u.test(character ?? '') && depth === 0) {
      const title = value.slice(cursor).trim()
      if (!/^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^)\\])*\))$/u.test(title)) return null
      return { destination: value.slice(0, cursor), title: value.slice(cursor).trim() }
    }
  }
  return { destination: value, title: '' }
}

function dimensionsFromExtension(extension: string): ImageDimensions {
  const body = extension.slice(1, -1).trim()
  const values: { width: number | null; height: number | null } = { width: null, height: null }
  if (body.length === 0) return values
  const parts = body.split(/[ \t]+/u)
  const seen = new Set<string>()
  for (const part of parts) {
    const match = /^(width|height)=([1-9]\d*)$/u.exec(part)
    if (match === null || seen.has(match[1] ?? '')) continue
    const key = match[1] as 'width' | 'height'
    const number = Number(match[2])
    if (!Number.isSafeInteger(number)) continue
    values[key] = number
    seen.add(key)
  }
  return values
}

export function parseInlineImageAt(markdown: string, offset: number): InlineImageModel | null {
  if (!Number.isInteger(offset) || offset < 0 || offset + 2 > markdown.length
    || markdown.slice(offset, offset + 2) !== '![' || isEscaped(markdown, offset) || isInsideCodeSpan(markdown, offset)) return null
  const altEnd = scanAltEnd(markdown, offset + 2)
  if (altEnd < 0 || markdown[altEnd + 1] !== '(') return null
  const destinationEnd = scanDestinationEnd(markdown, altEnd + 2)
  if (destinationEnd < 0) return null
  const destination = splitDestination(markdown.slice(altEnd + 2, destinationEnd).trim())
  if (destination === null) return null
  const url = normalizeImageUrl(unescapeMarkdown(destination.destination))
  if (url === null) return null

  let end = destinationEnd + 1
  let dimensions: ImageDimensions = { width: null, height: null }
  if (markdown[end] === '{') {
    const extensionEnd = markdown.indexOf('}', end + 1)
    const lineEnd = markdown.indexOf('\n', end + 1)
    if (extensionEnd !== -1 && (lineEnd === -1 || extensionEnd < lineEnd)) {
      const extension = markdown.slice(end, extensionEnd + 1)
      dimensions = dimensionsFromExtension(extension)
      end = extensionEnd + 1
    }
  }
  const source = markdown.slice(offset, end)
  return Object.freeze({
    ...dimensions,
    name: unescapeMarkdown(markdown.slice(offset + 2, altEnd)),
    source,
    sourceSpan: Object.freeze({ from: offset, to: end }),
    url,
  })
}

function validateDimension(value: number | null): void {
  if (value !== null && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new RangeError('Image dimensions must be positive integer pixels.')
  }
}

export type SerializableImage = Pick<InlineImageModel, 'name' | 'url' | 'width' | 'height'> & {
  readonly source?: string
}

function sourceParts(source: string): Readonly<{ extension: string; title: string }> | null {
  const parsed = parseInlineImageAt(source, 0)
  if (parsed === null || parsed.sourceSpan.to !== source.length) return null
  const altEnd = scanAltEnd(source, 2)
  const destinationEnd = scanDestinationEnd(source, altEnd + 2)
  const destination = splitDestination(source.slice(altEnd + 2, destinationEnd).trim())
  if (destination === null) return null
  return {
    extension: source.slice(destinationEnd + 1),
    title: destination.title,
  }
}

function updateExtension(extension: string, width: number | null, height: number | null, previous: ImageDimensions | null): string {
  const values = { width, height }
  const changed = new Set((['width', 'height'] as const).filter((key) => previous === null || previous[key] !== values[key]))
  const seen = new Set<'width' | 'height'>()
  let body = extension.startsWith('{') && extension.endsWith('}') ? extension.slice(1, -1) : ''
  body = body.replace(/(^|[ \t]+)(width|height)=[^ \t]+/gu, (token: string, spacing: string, name: string) => {
    const key = name as 'width' | 'height'
    if (!changed.has(key)) return token
    if (seen.has(key)) return ''
    seen.add(key)
    return values[key] === null ? '' : `${spacing}${key}=${values[key]}`
  })
  for (const key of changed) {
    if (!seen.has(key) && values[key] !== null) body += `${body.length === 0 ? '' : ' '}${key}=${values[key]}`
  }
  return body.trim().length === 0 ? '' : `{${body}}`
}

export function serializeImage(model: SerializableImage): string {
  if (/[\r\n]/u.test(model.name)) throw new RangeError('Image name cannot contain a line break.')
  const url = normalizeImageUrl(model.url)
  if (url === null) throw new RangeError('Image URL must be a safe raster data URL, root-relative path, or HTTP(S) URL.')
  validateDimension(model.width)
  validateDimension(model.height)
  const name = model.name.replace(/\\/gu, '\\\\').replace(/\]/gu, '\\]')
  const safeUrl = url.replace(/\(/gu, '%28').replace(/\)/gu, '%29')
  const existing = model.source === undefined ? null : sourceParts(model.source)
  const existingModel = model.source === undefined ? null : parseInlineImageAt(model.source, 0)
  const unchangedDimensions = existingModel !== null && existingModel.width === model.width && existingModel.height === model.height
  if (existingModel !== null && existingModel.sourceSpan.to === model.source?.length
    && existingModel.name === model.name && existingModel.url === url && unchangedDimensions) return model.source!
  const title = existing?.title === '' || existing === null ? '' : ` ${existing.title}`
  const extension = unchangedDimensions && existing !== null ? existing.extension
    : updateExtension(existing?.extension ?? '', model.width, model.height, existingModel)
  return `![${name}](${safeUrl}${title})${extension}`
}
