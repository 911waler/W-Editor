import type {
  Codec,
  CodecMatch,
  ProjectionNode,
  SafePatchUnit,
  SourceSpan,
  ValidationResult,
} from './contracts'

export const PANEL_VARIANTS = Object.freeze([
  'primary',
  'info',
  'warning',
  'danger',
  'success',
] as const)

export type PanelVariant = (typeof PANEL_VARIANTS)[number]
export type PanelCommandId = `panel.${PanelVariant}`

export interface PanelDescriptor {
  readonly commandId: PanelCommandId
  readonly icon: string
  readonly labels: Readonly<{ en: string; ru: string; zh: string }>
  readonly previewRole: 'note' | 'status'
  readonly variant: PanelVariant
}

export interface PanelModel {
  readonly body: string
  readonly source: string
  readonly sourceSpan: SourceSpan
  readonly title: string
  readonly variant: PanelVariant
}

export const PANEL_DESCRIPTORS: readonly PanelDescriptor[] = Object.freeze([
  Object.freeze({
    commandId: 'panel.primary',
    icon: 'P',
    labels: Object.freeze({ en: 'Primary panel', ru: 'Основная панель', zh: '主要面板' }),
    previewRole: 'note',
    variant: 'primary',
  }),
  Object.freeze({
    commandId: 'panel.info',
    icon: 'i',
    labels: Object.freeze({ en: 'Info panel', ru: 'Информационная панель', zh: '信息面板' }),
    previewRole: 'note',
    variant: 'info',
  }),
  Object.freeze({
    commandId: 'panel.warning',
    icon: '!',
    labels: Object.freeze({ en: 'Warning panel', ru: 'Панель предупреждения', zh: '警告面板' }),
    previewRole: 'status',
    variant: 'warning',
  }),
  Object.freeze({
    commandId: 'panel.danger',
    icon: '!',
    labels: Object.freeze({ en: 'Danger panel', ru: 'Панель опасности', zh: '危险面板' }),
    previewRole: 'status',
    variant: 'danger',
  }),
  Object.freeze({
    commandId: 'panel.success',
    icon: '✓',
    labels: Object.freeze({ en: 'Success panel', ru: 'Панель успеха', zh: '成功面板' }),
    previewRole: 'status',
    variant: 'success',
  }),
])

const PANEL_PATTERN = /^:::[ \t]+(primary|info|warning|danger|success)(?:[ \t]+([^\r\n]*?))?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*:::[ \t]*(?=\r?\n|$)/u

export function panelDescriptor(commandId: string): PanelDescriptor | null {
  return PANEL_DESCRIPTORS.find((descriptor) => descriptor.commandId === commandId) ?? null
}

export function parsePanelAt(markdown: string, offset: number): PanelModel | null {
  if (!Number.isInteger(offset) || offset < 0 || offset > markdown.length) {
    throw new RangeError('Panel recognition offset is outside the Markdown source.')
  }
  if (offset > 0 && markdown[offset - 1] !== '\n') return null
  const match = PANEL_PATTERN.exec(markdown.slice(offset))
  if (match === null) return null
  const variant = match[1] as PanelVariant
  const source = match[0]
  return Object.freeze({
    body: match[3] ?? '',
    source,
    sourceSpan: Object.freeze({ from: offset, to: offset + source.length }),
    title: match[2] ?? '',
    variant,
  })
}

export function panelSource(input: Pick<PanelModel, 'body' | 'title' | 'variant'>): string {
  if (!PANEL_VARIANTS.includes(input.variant)) throw new RangeError(`Unsupported panel variant: ${String(input.variant)}.`)
  const title = input.title.trim()
  const body = input.body.replace(/\r\n/gu, '\n').trim()
  if (title.length === 0) throw new RangeError('Panel title must not be empty.')
  if (body.length === 0) throw new RangeError('Panel body must not be empty.')
  if (title.includes('\n') || body.includes('\0') || /(?:^|\n)[ \t]*:::[ \t]*(?:\n|$)/u.test(body)) {
    throw new RangeError('Panel content contains an invalid title, NUL, or closing delimiter.')
  }
  return `::: ${input.variant} ${title}\n${body}\n:::`
}

export function panelStarterSource(commandId: PanelCommandId): string {
  const descriptor = panelDescriptor(commandId)
  if (descriptor === null) throw new RangeError(`Unknown panel command: ${commandId}.`)
  const starter = {
    danger: { body: 'Describe the critical risk or failure.', title: 'Danger' },
    info: { body: 'Add supporting information here.', title: 'Information' },
    primary: { body: 'Add helpful guidance here.', title: 'Tips' },
    success: { body: 'Describe the successful outcome.', title: 'Success' },
    warning: { body: 'Describe what needs attention.', title: 'Warning' },
  }[descriptor.variant]
  return panelSource({ ...starter, variant: descriptor.variant })
}

function matchForVariant(markdown: string, offset: number, variant: PanelVariant): CodecMatch | null {
  const panel = parsePanelAt(markdown, offset)
  if (panel === null || panel.variant !== variant) return null
  return Object.freeze({
    captures: Object.freeze({ body: panel.body, title: panel.title, variant }),
    originalSource: panel.source,
    sourceSpan: panel.sourceSpan,
  })
}

function projectPanel(match: CodecMatch, revision: number, variant: PanelVariant): ProjectionNode {
  const descriptor = panelDescriptor(`panel.${variant}`)
  if (descriptor === null) throw new RangeError(`Missing descriptor for panel variant ${variant}.`)
  return Object.freeze({
    codecId: `panel-${variant}`,
    data: Object.freeze({
      body: match.captures['body'] ?? '',
      previewRole: descriptor.previewRole,
      title: match.captures['title'] ?? '',
      variant,
    }),
    editStrategy: Object.freeze({ editorId: 'panel-editor', kind: 'semantic-editor' as const }),
    kind: 'semantic' as const,
    nodeType: 'panel',
    originalSource: match.originalSource,
    projectionId: `panel-${variant}:${match.sourceSpan.from}:${match.sourceSpan.to}`,
    revision,
    sourceSpan: Object.freeze({ ...match.sourceSpan }),
  })
}

function panelSafePatchUnit(node: ProjectionNode): SafePatchUnit {
  return Object.freeze({
    codecId: node.codecId,
    expectedSource: node.originalSource,
    sourceSpan: Object.freeze({ ...node.sourceSpan }),
    strategy: node.editStrategy,
    structural: true,
    unitId: node.projectionId,
  })
}

function validatePanelVariantSource(source: string, variant: PanelVariant): ValidationResult {
  const parsed = parsePanelAt(source, 0)
  if (parsed === null
    || parsed.sourceSpan.to !== source.length
    || parsed.variant !== variant
    || parsed.title.trim().length === 0
    || parsed.body.trim().length === 0) {
    return Object.freeze({
      code: 'INVALID_PANEL_SOURCE',
      message: `Source must be one complete Cherry ${variant} panel.`,
      sourceSpan: null,
      valid: false,
    })
  }
  return Object.freeze({ valid: true })
}

export function validatePanelSource(commandId: PanelCommandId, source: string): ValidationResult {
  const descriptor = panelDescriptor(commandId)
  return descriptor === null
    ? Object.freeze({
        code: 'INVALID_PANEL_COMMAND',
        message: `Unknown panel command: ${commandId}.`,
        sourceSpan: null,
        valid: false,
      })
    : validatePanelVariantSource(source, descriptor.variant)
}

function panelCodec(variant: PanelVariant, index: number): Codec {
  const codecId = `panel-${variant}`
  const definition: Codec = {
    id: codecId,
    precedence: 80 - index,
    project: (match, revision) => projectPanel(match, revision, variant),
    recognize: (context, offset) => matchForVariant(context.markdown, offset, variant),
    safePatchUnit: panelSafePatchUnit,
    scope: 'block' as const,
    serialize: ({ node }) => {
      if (node.kind !== 'semantic' || node.nodeType !== 'panel') {
        throw new TypeError(`${codecId} requires a semantic panel projection node.`)
      }
      const nodeVariant = String(node.data['variant'] ?? '') as PanelVariant
      if (nodeVariant !== variant) throw new TypeError(`${codecId} cannot serialize a ${nodeVariant} panel.`)
      return panelSource({
        body: String(node.data['body'] ?? ''),
        title: String(node.data['title'] ?? ''),
        variant,
      })
    },
    validate: (source) => validatePanelVariantSource(source, variant),
  }
  return Object.freeze(definition)
}

export const panelCodecs: readonly Codec[] = Object.freeze(
  PANEL_VARIANTS.map((variant, index) => panelCodec(variant, index)),
)
