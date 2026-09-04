import type { Codec, CodecMatch, ProjectionNode, SafePatchUnit, SourceSpan, ValidationResult } from './contracts'

export const TIMELINE_STATUSES = Object.freeze(['done', 'doing', 'todo', 'error', 'milestone'] as const)
export type TimelineStatus = (typeof TIMELINE_STATUSES)[number]

export interface TimelineItem {
  readonly body: string
  readonly status: TimelineStatus
  readonly time: string
  readonly title: string
}

export interface TimelineModel {
  readonly items: readonly TimelineItem[]
  readonly source: string
  readonly sourceSpan: SourceSpan
  readonly title: string
}

const TIMELINE_PATTERN = /^:::[ \t]+timeline(?:[ \t]+([^\r\n]*?))?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*:::[ \t]*(?=\r?\n|$)/u

function parseTimelineItems(body: string): readonly TimelineItem[] {
  const matches = [...body.matchAll(/(?:^|\r?\n)[ \t]*::[ \t]+\[([^\]\r\n]+)\][ \t]+(\S+)[ \t]+([^\r\n]+)(?:\r?\n([\s\S]*?))?(?=\r?\n[ \t]*::[ \t]+\[|$)/gu)]
  return Object.freeze(matches.map((match) => Object.freeze({
    body: (match[4] ?? '').trim(),
    status: (match[1] ?? '') as TimelineStatus,
    time: (match[2] ?? '').trim(),
    title: (match[3] ?? '').trim(),
  })))
}

export function parseTimelineAt(markdown: string, offset: number): TimelineModel | null {
  if (!Number.isInteger(offset) || offset < 0 || offset > markdown.length) {
    throw new RangeError('Timeline recognition offset is outside the Markdown source.')
  }
  if (offset > 0 && markdown[offset - 1] !== '\n') return null
  const match = TIMELINE_PATTERN.exec(markdown.slice(offset))
  if (match === null) return null
  const source = match[0]
  return Object.freeze({
    items: parseTimelineItems(match[2] ?? ''),
    source,
    sourceSpan: Object.freeze({ from: offset, to: offset + source.length }),
    title: (match[1] ?? '').trim(),
  })
}

function validTimeline(model: Pick<TimelineModel, 'items' | 'title'>): boolean {
  return model.title.length > 0
    && model.items.length > 0
    && model.items.every((item) => (
      TIMELINE_STATUSES.includes(item.status)
      && item.time.trim().length > 0
      && item.title.trim().length > 0
      && !item.body.includes('\0')
      && !/(?:^|\n)[ \t]*:::[ \t]*(?:\n|$)/u.test(item.body)
    ))
}

export function timelineSource(input: Pick<TimelineModel, 'items' | 'title'>): string {
  const normalized = {
    items: input.items.map((item) => Object.freeze({
      body: item.body.trim(),
      status: item.status,
      time: item.time.trim(),
      title: item.title.trim(),
    })),
    title: input.title.trim(),
  }
  if (!validTimeline(normalized)) throw new RangeError('Timeline requires a title and valid status, time, and title for every item.')
  const body = normalized.items.map((item) => (
    `:: [${item.status}] ${item.time} ${item.title}${item.body.length === 0 ? '' : `\n  ${item.body.replace(/\n/gu, '\n  ')}`}`
  )).join('\n')
  return `::: timeline ${normalized.title}\n${body}\n:::`
}

export function timelineStarterSource(): string {
  return timelineSource({
    items: [
      { body: 'Requirements review completed', status: 'done', time: '2026-01-15', title: 'Project kickoff' },
      { body: 'Integration testing in progress', status: 'doing', time: '2026-03-20', title: 'Alpha release' },
      { body: 'Prepare the production rollout', status: 'todo', time: '2026-06-01', title: 'Go live' },
    ],
    title: 'Timeline',
  })
}

export function validateTimelineSource(source: string): ValidationResult {
  const model = parseTimelineAt(source, 0)
  return model !== null && model.sourceSpan.to === source.length && validTimeline(model)
    ? Object.freeze({ valid: true })
    : Object.freeze({
        code: 'INVALID_TIMELINE_SOURCE',
        message: 'Timeline requires a title and one or more valid [status] time title items.',
        sourceSpan: null,
        valid: false,
      })
}

const timelineCodecDefinition: Codec = {
  id: 'layout-timeline',
  precedence: 70,
  project: (match, revision): ProjectionNode => Object.freeze({
    codecId: 'layout-timeline',
    data: Object.freeze({
      items: Object.freeze(JSON.parse(match.captures['items'] ?? '[]') as TimelineItem[]),
      title: match.captures['title'] ?? '',
    }),
    editStrategy: Object.freeze({ editorId: 'timeline-editor', kind: 'semantic-editor' as const }),
    kind: 'semantic' as const,
    nodeType: 'timeline',
    originalSource: match.originalSource,
    projectionId: `layout-timeline:${match.sourceSpan.from}:${match.sourceSpan.to}`,
    revision,
    sourceSpan: Object.freeze({ ...match.sourceSpan }),
  }),
  recognize: (context, offset): CodecMatch | null => {
    const model = parseTimelineAt(context.markdown, offset)
    if (model === null) return null
    return Object.freeze({
      captures: Object.freeze({ items: JSON.stringify(model.items), title: model.title }),
      originalSource: model.source,
      sourceSpan: model.sourceSpan,
    })
  },
  safePatchUnit: (node): SafePatchUnit => Object.freeze({
    codecId: 'layout-timeline',
    expectedSource: node.originalSource,
    sourceSpan: Object.freeze({ ...node.sourceSpan }),
    strategy: node.editStrategy,
    structural: true,
    unitId: node.projectionId,
  }),
  scope: 'block',
  serialize: ({ node }) => {
    if (node.kind !== 'semantic' || node.nodeType !== 'timeline') {
      throw new TypeError('Timeline codec requires a semantic timeline projection node.')
    }
    const items = node.data['items']
    if (!Array.isArray(items)) throw new TypeError('Timeline codec requires timeline items.')
    return timelineSource({ items: items as unknown as readonly TimelineItem[], title: String(node.data['title'] ?? '') })
  },
  validate: validateTimelineSource,
}

export const timelineCodec: Codec = Object.freeze(timelineCodecDefinition)
