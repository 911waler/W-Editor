import type { Codec, CodecMatch, ProjectionNode, ValidationResult } from './contracts'

export interface DrawioModel {
  readonly commandId: 'insert.drawio'
  readonly name: string
  readonly png: string
  readonly source: string
  readonly sourceSpan: Readonly<{ from: number; to: number }>
  readonly xml: string
}

const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u

function validXml(value: string): boolean {
  return /^\s*<mxfile(?:\s|>)/u.test(value)
}

export function drawioSource(nameInput: string, pngInput: string, xmlInput: string): string {
  const name = nameInput.trim()
  const png = pngInput.trim()
  if (name.length === 0) throw new RangeError('draw.io diagram name is required.')
  if (/[\]\r\n]/u.test(name)) throw new RangeError('draw.io diagram name cannot contain a closing bracket or line break.')
  if (!PNG_DATA_URL.test(png)) throw new RangeError('draw.io preview must be a PNG data URL.')
  if (!validXml(xmlInput)) throw new RangeError('draw.io source must be an mxfile XML document.')
  return `![${name}](${png}){data-type=drawio data-xml=${encodeURI(xmlInput)}}`
}

export function parseDrawioAt(markdown: string, offset: number): DrawioModel | null {
  if (offset < 0 || offset > markdown.length || (offset > 0 && markdown[offset - 1] !== '\n')) return null
  const newline = markdown.indexOf('\n', offset)
  const lineEnd = newline === -1 ? markdown.length : newline > offset && markdown[newline - 1] === '\r' ? newline - 1 : newline
  const source = markdown.slice(offset, lineEnd)
  const match = /^!\[([^\]\r\n]+)\]\((data:image\/png;base64,[A-Za-z0-9+/]+={0,2})\)\{data-type=drawio data-xml=([^}]+)\}$/u.exec(source)
  if (match === null) return null
  let xml: string
  try {
    xml = decodeURI(match[3] ?? '')
  } catch {
    return null
  }
  const name = match[1]?.trim() ?? ''
  const png = match[2] ?? ''
  if (name.length === 0 || !PNG_DATA_URL.test(png) || !validXml(xml)) return null
  return Object.freeze({
    commandId: 'insert.drawio',
    name,
    png,
    source,
    sourceSpan: Object.freeze({ from: offset, to: lineEnd }),
    xml,
  })
}

export function validateDrawioSource(source: string): ValidationResult {
  const parsed = parseDrawioAt(source, 0)
  if (parsed === null || parsed.sourceSpan.to !== source.length) {
    return Object.freeze({
      code: 'DRAWIO_SOURCE_INVALID',
      message: 'Expected one Cherry draw.io PNG data URL with URI-encoded mxfile XML.',
      sourceSpan: Object.freeze({ from: 0, to: source.length }),
      valid: false,
    })
  }
  return Object.freeze({ valid: true })
}

const DRAWIO_CODEC: Codec = {
  id: 'drawio',
  precedence: 80,
  project: (match: CodecMatch, revision: number): ProjectionNode => {
    const parsed = parseDrawioAt(match.originalSource, 0)
    if (parsed === null) throw new TypeError('Invalid draw.io match.')
    return Object.freeze({
      attributes: Object.freeze({ name: parsed.name, png: parsed.png, xml: parsed.xml }),
      children: Object.freeze([]),
      codecId: 'drawio',
      editStrategy: Object.freeze({ editorId: 'drawio-editor', kind: 'semantic-editor' as const }),
      kind: 'structured' as const,
      nodeType: 'semanticBlock',
      originalSource: match.originalSource,
      projectionId: `drawio:${match.sourceSpan.from}:${match.sourceSpan.to}`,
      revision,
      sourceSpan: Object.freeze({ ...match.sourceSpan }),
    })
  },
  recognize: (context, offset): CodecMatch | null => {
    const parsed = parseDrawioAt(context.markdown, offset)
    if (parsed === null) return null
    return Object.freeze({
      captures: Object.freeze({ name: parsed.name, png: parsed.png, xml: parsed.xml }),
      originalSource: parsed.source,
      sourceSpan: parsed.sourceSpan,
    })
  },
  safePatchUnit: (node) => Object.freeze({
    codecId: 'drawio',
    expectedSource: node.originalSource,
    sourceSpan: Object.freeze({ ...node.sourceSpan }),
    strategy: node.editStrategy,
    structural: true,
    unitId: node.projectionId,
  }),
  scope: 'block',
  serialize: ({ node }) => node.originalSource,
  validate: validateDrawioSource,
}

export const drawioCodec: Codec = Object.freeze(DRAWIO_CODEC)
