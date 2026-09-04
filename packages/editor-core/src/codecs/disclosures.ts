import type { Codec, CodecMatch, ProjectionNode, SafePatchUnit, SourceSpan, ValidationResult } from './contracts'

export type DisclosureKind = 'accordion' | 'tabs'
export type DisclosureCommandId = 'layout.accordion' | 'layout.tabs'

export interface DisclosureItem {
  readonly body: string
  readonly label: string
}

export interface DisclosureModel {
  readonly items: readonly DisclosureItem[]
  readonly kind: DisclosureKind
  readonly source: string
  readonly sourceSpan: SourceSpan
}

const TABS_PATTERN = /^:::[ \t]+tabs[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*:::[ \t]*(?=\r?\n|$)/u
const ACCORDION_PATTERN = /^\+\+\+[ \t]+([^\r\n]+?)\s*\r?\n([\s\S]+?)\r?\n[ \t]*\+\+\+[ \t]*(?=\r?\n|$)/u

function parseTabItems(body: string): readonly DisclosureItem[] {
  const matches = [...body.matchAll(/(?:^|\r?\n)[ \t]*::[ \t]+([^\r\n]+)\r?\n([\s\S]*?)(?=\r?\n[ \t]*::[ \t]+[^\r\n]+\r?\n|$)/gu)]
  return Object.freeze(matches.map((match) => Object.freeze({
    body: (match[2] ?? '').trim(),
    label: (match[1] ?? '').trim(),
  })))
}

export function parseDisclosureAt(markdown: string, offset: number): DisclosureModel | null {
  if (!Number.isInteger(offset) || offset < 0 || offset > markdown.length) {
    throw new RangeError('Disclosure recognition offset is outside the Markdown source.')
  }
  if (offset > 0 && markdown[offset - 1] !== '\n') return null
  const sourceAtOffset = markdown.slice(offset)
  const tabs = TABS_PATTERN.exec(sourceAtOffset)
  if (tabs !== null) {
    return Object.freeze({
      items: parseTabItems(tabs[1] ?? ''),
      kind: 'tabs',
      source: tabs[0],
      sourceSpan: Object.freeze({ from: offset, to: offset + tabs[0].length }),
    })
  }
  const accordion = ACCORDION_PATTERN.exec(sourceAtOffset)
  if (accordion === null) return null
  return Object.freeze({
    items: Object.freeze([Object.freeze({ body: (accordion[2] ?? '').trim(), label: (accordion[1] ?? '').trim() })]),
    kind: 'accordion',
    source: accordion[0],
    sourceSpan: Object.freeze({ from: offset, to: offset + accordion[0].length }),
  })
}

function validItems(kind: DisclosureKind, items: readonly DisclosureItem[]): boolean {
  const expectedCount = kind === 'tabs' ? items.length >= 2 : items.length === 1
  return expectedCount && items.every((item) => (
    item.label.trim().length > 0
    && item.body.trim().length > 0
    && !item.label.includes('\n')
    && !item.body.includes('\0')
    && !/(?:^|\n)[ \t]*(?:::{1}|\+\+\+)[ \t]*(?:\n|$)/u.test(item.body)
  ))
}

export function disclosureSource(kind: DisclosureKind, items: readonly DisclosureItem[]): string {
  const normalized = items.map((item) => Object.freeze({ body: item.body.trim(), label: item.label.trim() }))
  if (!validItems(kind, normalized)) {
    throw new RangeError(kind === 'tabs'
      ? 'Tabs require at least two non-empty labels and bodies.'
      : 'Accordion requires one non-empty title and body.')
  }
  if (kind === 'accordion') {
    const item = normalized[0]!
    return `+++ ${item.label}\n${item.body}\n+++`
  }
  return `::: tabs\n${normalized.map((item) => `:: ${item.label}\n${item.body}`).join('\n')}\n:::`
}

export function disclosureStarterSource(commandId: DisclosureCommandId): string {
  return commandId === 'layout.tabs'
    ? disclosureSource('tabs', [
        { body: 'First tab content', label: 'Tab one' },
        { body: 'Second tab content', label: 'Tab two' },
      ])
    : disclosureSource('accordion', [{ body: 'Expandable content', label: 'Details' }])
}

export function validateDisclosureSource(commandId: DisclosureCommandId, source: string): ValidationResult {
  const expectedKind = commandId === 'layout.tabs' ? 'tabs' : 'accordion'
  const model = parseDisclosureAt(source, 0)
  return model !== null
    && model.sourceSpan.to === source.length
    && model.kind === expectedKind
    && validItems(model.kind, model.items)
    ? Object.freeze({ valid: true })
    : Object.freeze({
        code: 'INVALID_DISCLOSURE_SOURCE',
        message: expectedKind === 'tabs'
          ? 'Tabs require at least two non-empty labeled sections.'
          : 'Accordion requires a non-empty title and body.',
        sourceSpan: null,
        valid: false,
      })
}

function disclosureCodec(kind: DisclosureKind): Codec {
  const commandId: DisclosureCommandId = kind === 'tabs' ? 'layout.tabs' : 'layout.accordion'
  const codecId = `layout-${kind}`
  const definition: Codec = {
    id: codecId,
    precedence: kind === 'tabs' ? 72 : 71,
    project: (match, revision): ProjectionNode => Object.freeze({
      codecId,
      data: Object.freeze({
        items: Object.freeze(JSON.parse(match.captures['items'] ?? '[]') as DisclosureItem[]),
        kind,
      }),
      editStrategy: Object.freeze({ editorId: 'disclosure-editor', kind: 'semantic-editor' as const }),
      kind: 'semantic' as const,
      nodeType: 'disclosure',
      originalSource: match.originalSource,
      projectionId: `${codecId}:${match.sourceSpan.from}:${match.sourceSpan.to}`,
      revision,
      sourceSpan: Object.freeze({ ...match.sourceSpan }),
    }),
    recognize: (context, offset): CodecMatch | null => {
      const model = parseDisclosureAt(context.markdown, offset)
      if (model === null || model.kind !== kind) return null
      return Object.freeze({
        captures: Object.freeze({ items: JSON.stringify(model.items), kind }),
        originalSource: model.source,
        sourceSpan: model.sourceSpan,
      })
    },
    safePatchUnit: (node): SafePatchUnit => Object.freeze({
      codecId,
      expectedSource: node.originalSource,
      sourceSpan: Object.freeze({ ...node.sourceSpan }),
      strategy: node.editStrategy,
      structural: true,
      unitId: node.projectionId,
    }),
    scope: 'block',
    serialize: ({ node }) => {
      if (node.kind !== 'semantic' || node.nodeType !== 'disclosure') {
        throw new TypeError(`${codecId} requires a semantic disclosure projection node.`)
      }
      const items = node.data['items']
      if (!Array.isArray(items)) throw new TypeError(`${codecId} requires disclosure items.`)
      return disclosureSource(kind, items as unknown as readonly DisclosureItem[])
    },
    validate: (source) => validateDisclosureSource(commandId, source),
  }
  return Object.freeze(definition)
}

export const disclosureCodecs: readonly Codec[] = Object.freeze([
  disclosureCodec('tabs'),
  disclosureCodec('accordion'),
])
