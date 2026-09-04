import type { JSONContent } from '@tiptap/core'

import type { DocumentSnapshot } from '../core/documentSession'
import type {
  Codec,
  CodecMatch,
  ProjectionMap,
  ProjectionMapEntry,
  ProjectionNode,
  SafePatchUnit,
  ValidationResult,
} from './contracts'
import { parseInlineMarkdown } from './inlineMarks'
import { panelCodecs, parsePanelAt, type PanelVariant } from './panels'
import { alignmentCodecs, parseAlignmentAt, type AlignmentValue } from './alignment'
import { columnLayoutCodecs, parseColumnLayoutAt, type ColumnLayoutKind } from './columnLayouts'
import { disclosureCodecs, parseDisclosureAt, type DisclosureItem, type DisclosureKind } from './disclosures'
import { parseTimelineAt, timelineCodec, type TimelineItem } from './timeline'
import { parseOrdinaryTableAt, type OrdinaryTableMatch } from './ordinaryTables'
import { parseFencedCodeAt, rawFencedCodeCandidateAt, type FencedCodeMatch } from './fencedCode'
import { parseBlockFormulaAt } from './formulas'
import { createTocHeadingItems, parseHeadingAnchor } from './toc'
import { mermaidCodecs, parseMermaidAt, type MermaidDiagramType, type MermaidModel } from './mermaid'
import { chartTableCodecs, parseChartTableAt, type ChartTableModel, type ChartTableType } from './chartTables'
import { mediaCodecs, parseMediaAt, type MediaKind, type MediaModel } from './media'
import { attachmentCodecs, parseAttachmentAt, type AttachmentKind, type AttachmentModel } from './attachments'
import { drawioCodec, parseDrawioAt, type DrawioModel } from './drawio'

type OrdinaryListCodecId = 'bullet-list' | 'ordered-list' | 'task-list'

interface OrdinaryListBlock {
  readonly codecId: OrdinaryListCodecId
  readonly items: readonly OrdinaryListItem[]
}

interface OrdinaryListItem {
  readonly body: string
  readonly checked?: boolean
  readonly children: readonly OrdinaryListBlock[]
}

interface ParsedListLine {
  readonly body: string
  readonly checked?: boolean
  readonly codecId: OrdinaryListCodecId
  readonly indent: number
}

interface OrdinaryBlock {
  readonly alignment?: AlignmentValue
  readonly attachment?: AttachmentModel
  readonly body: string
  readonly chart?: ChartTableModel
  readonly code?: FencedCodeMatch
  readonly codecId: `alignment-${AlignmentValue}` | `attachment-${AttachmentKind}` | 'blockquote' | 'bullet-list' | `chart-${ChartTableType}` | 'drawio' | 'fenced-code' | 'formula' | 'heading' | 'horizontal-rule' | `layout-${ColumnLayoutKind | DisclosureKind}` | 'layout-timeline' | `media-${MediaKind}` | `mermaid-${MermaidDiagramType | 'unknown'}` | 'ordered-list' | 'ordinary-table' | 'paragraph' | `panel-${PanelVariant}` | 'raw-block' | 'table-of-contents' | 'task-list'
  readonly disclosure?: Readonly<{ readonly items: readonly DisclosureItem[]; readonly kind: DisclosureKind }>
  readonly drawio?: DrawioModel
  readonly from: number
  readonly items?: readonly OrdinaryListItem[]
  readonly level: 1 | 2 | 3 | 4 | 5 | null
  readonly layout?: Readonly<{ readonly columns: readonly string[]; readonly kind: ColumnLayoutKind; readonly title: string }>
  readonly mermaid?: MermaidModel
  readonly media?: MediaModel
  readonly panel?: Readonly<{ readonly title: string; readonly variant: PanelVariant }>
  readonly source: string
  readonly table?: OrdinaryTableMatch
  readonly timeline?: Readonly<{ readonly items: readonly TimelineItem[]; readonly title: string }>
  readonly tocAnchor?: string
  readonly to: number
}

function parseListLine(line: string): ParsedListLine | null {
  const leading = /^([ \t]*)/u.exec(line)?.[1] ?? ''
  const indent = leading.replace(/\t/gu, '    ').length
  const body = line.slice(leading.length)
  const task = /^-[ \t]+\[([ xX])\][ \t]+(.*)$/u.exec(body)
  if (task !== null) return Object.freeze({ body: task[2] ?? '', checked: (task[1] ?? '').toLowerCase() === 'x', codecId: 'task-list', indent })
  const ordered = /^[0-9]+\.[ \t]+(.*)$/u.exec(body)
  if (ordered !== null) return Object.freeze({ body: ordered[1] ?? '', codecId: 'ordered-list', indent })
  const bullet = /^-[ \t]+(.*)$/u.exec(body)
  if (bullet !== null) return Object.freeze({ body: bullet[1] ?? '', codecId: 'bullet-list', indent })
  return null
}

function parseBlockquoteLine(line: string): string | null {
  const match = /^>[ \t]?(.*)$/u.exec(line)
  return match === null ? null : match[1] ?? ''
}

function parseListLevel(
  lines: readonly ParsedListLine[],
  startIndex: number,
  indent: number,
  codecId: OrdinaryListCodecId,
): Readonly<{ block: OrdinaryListBlock; nextIndex: number }> {
  const items: OrdinaryListItem[] = []
  let index = startIndex
  while (index < lines.length) {
    const line = lines[index]
    if (line === undefined || line.indent !== indent || line.codecId !== codecId) break
    index += 1
    const children: OrdinaryListBlock[] = []
    while (index < lines.length && (lines[index]?.indent ?? 0) > indent) {
      const child = lines[index]
      if (child === undefined) break
      const parsed = parseListLevel(lines, index, child.indent, child.codecId)
      if (parsed.nextIndex === index) break
      children.push(parsed.block)
      index = parsed.nextIndex
    }
    items.push(Object.freeze({
      body: line.body,
      ...(line.checked === undefined ? {} : { checked: line.checked }),
      children: Object.freeze(children),
    }))
  }
  return Object.freeze({
    block: Object.freeze({ codecId, items: Object.freeze(items) }),
    nextIndex: index,
  })
}

export interface OrdinaryMarkdownProjection {
  readonly content: JSONContent
  readonly map: ProjectionMap
  readonly revision: number
  readonly source: string
}

function lineEnd(markdown: string, offset: number): number {
  const newline = markdown.indexOf('\n', offset)
  if (newline === -1) return markdown.length
  return newline > offset && markdown[newline - 1] === '\r' ? newline - 1 : newline
}

function nextLineOffset(markdown: string, end: number): number {
  if (end >= markdown.length) return markdown.length
  return markdown[end] === '\r' && markdown[end + 1] === '\n' ? end + 2 : end + 1
}

interface ParagraphSeparator {
  readonly from: number
  readonly to: number
}

function paragraphSeparators(markdown: string, from: number, to: number): readonly ParagraphSeparator[] {
  const separators: ParagraphSeparator[] = []
  const gap = markdown.slice(from, to)
  const pattern = /\r?\n[ \t]*\r?\n/gu
  let match = pattern.exec(gap)
  while (match !== null) {
    separators.push(Object.freeze({
      from: from + match.index,
      to: from + match.index + match[0].length,
    }))
    match = pattern.exec(gap)
  }
  return Object.freeze(separators)
}

function emptyParagraph(position: number): OrdinaryBlock {
  return Object.freeze({
    body: '',
    codecId: 'paragraph',
    from: position,
    level: null,
    source: '',
    to: position,
  })
}

function preserveExplicitEmptyParagraphs(
  markdown: string,
  parsedBlocks: readonly OrdinaryBlock[],
): readonly OrdinaryBlock[] {
  if (parsedBlocks.length === 0) {
    return Object.freeze([
      emptyParagraph(0),
      ...paragraphSeparators(markdown, 0, markdown.length).map((separator) => emptyParagraph(separator.to)),
    ])
  }

  const blocks: OrdinaryBlock[] = []
  const first = parsedBlocks[0]
  if (first !== undefined) {
    for (const separator of paragraphSeparators(markdown, 0, first.from)) {
      blocks.push(emptyParagraph(separator.from))
    }
  }
  for (const [index, block] of parsedBlocks.entries()) {
    blocks.push(block)
    const next = parsedBlocks[index + 1]
    const gapTo = next?.from ?? markdown.length
    const separators = paragraphSeparators(markdown, block.to, gapTo)
    if (next === undefined) {
      for (const separator of separators) blocks.push(emptyParagraph(separator.to))
      continue
    }
    for (const separator of separators.slice(1)) blocks.push(emptyParagraph(separator.from))
  }
  return Object.freeze(blocks)
}

function rawContainerAt(markdown: string, offset: number): Readonly<{ source: string; to: number }> | null {
  const openerEnd = lineEnd(markdown, offset)
  if (!/^:::[ \t]+\S/u.test(markdown.slice(offset, openerEnd))) return null
  let cursor = nextLineOffset(markdown, openerEnd)
  while (cursor < markdown.length) {
    const candidateEnd = lineEnd(markdown, cursor)
    if (markdown.slice(cursor, candidateEnd) === ':::') {
      return Object.freeze({ source: markdown.slice(offset, candidateEnd), to: candidateEnd })
    }
    cursor = nextLineOffset(markdown, candidateEnd)
  }
  return Object.freeze({ source: markdown.slice(offset), to: markdown.length })
}

function rawTableCandidateAt(markdown: string, offset: number): Readonly<{ source: string; to: number }> | null {
  const headerEnd = lineEnd(markdown, offset)
  const delimiterFrom = nextLineOffset(markdown, headerEnd)
  if (!markdown.slice(offset, headerEnd).includes('|') || delimiterFrom >= markdown.length) return null
  const delimiterEnd = lineEnd(markdown, delimiterFrom)
  const delimiter = markdown.slice(delimiterFrom, delimiterEnd)
  if (!delimiter.includes('|') || !/^[ \t|:]*-[ \t|:-]*$/u.test(delimiter)) return null
  let to = delimiterEnd
  let cursor = nextLineOffset(markdown, delimiterEnd)
  while (cursor < markdown.length) {
    const candidateEnd = lineEnd(markdown, cursor)
    const candidate = markdown.slice(cursor, candidateEnd)
    if (candidate.trim().length === 0 || !candidate.includes('|')) break
    to = candidateEnd
    cursor = nextLineOffset(markdown, candidateEnd)
  }
  return Object.freeze({ source: markdown.slice(offset, to), to })
}

function parseOrdinaryBlocks(markdown: string): readonly OrdinaryBlock[] {
  const blocks: OrdinaryBlock[] = []
  let offset = 0
  while (offset < markdown.length) {
    const end = lineEnd(markdown, offset)
    const line = markdown.slice(offset, end)
    if (line.trim().length === 0) {
      offset = nextLineOffset(markdown, end)
      continue
    }
    const container = line.startsWith(':::') || line.startsWith('+++')
    const timeline = container ? parseTimelineAt(markdown, offset) : null
    if (timeline !== null) {
      blocks.push(Object.freeze({
        body: timeline.source,
        codecId: 'layout-timeline',
        from: timeline.sourceSpan.from,
        level: null,
        source: timeline.source,
        timeline: Object.freeze({ items: timeline.items, title: timeline.title }),
        to: timeline.sourceSpan.to,
      }))
      offset = nextLineOffset(markdown, timeline.sourceSpan.to)
      continue
    }
    const disclosure = container ? parseDisclosureAt(markdown, offset) : null
    if (disclosure !== null) {
      blocks.push(Object.freeze({
        body: disclosure.source,
        codecId: `layout-${disclosure.kind}` as OrdinaryBlock['codecId'],
        disclosure: Object.freeze({ items: disclosure.items, kind: disclosure.kind }),
        from: disclosure.sourceSpan.from,
        level: null,
        source: disclosure.source,
        to: disclosure.sourceSpan.to,
      }))
      offset = nextLineOffset(markdown, disclosure.sourceSpan.to)
      continue
    }
    const columnLayout = container ? parseColumnLayoutAt(markdown, offset) : null
    if (columnLayout !== null) {
      blocks.push(Object.freeze({
        body: columnLayout.columns.join('\n::\n'),
        codecId: `layout-${columnLayout.kind}` as OrdinaryBlock['codecId'],
        from: columnLayout.sourceSpan.from,
        layout: Object.freeze({
          columns: columnLayout.columns,
          kind: columnLayout.kind,
          title: columnLayout.title,
        }),
        level: null,
        source: columnLayout.source,
        to: columnLayout.sourceSpan.to,
      }))
      offset = nextLineOffset(markdown, columnLayout.sourceSpan.to)
      continue
    }
    const alignment = container ? parseAlignmentAt(markdown, offset) : null
    if (alignment !== null) {
      blocks.push(Object.freeze({
        alignment: alignment.alignment,
        body: alignment.body,
        codecId: `alignment-${alignment.alignment}`,
        from: alignment.sourceSpan.from,
        level: null,
        source: alignment.source,
        to: alignment.sourceSpan.to,
      }))
      offset = nextLineOffset(markdown, alignment.sourceSpan.to)
      continue
    }
    const panel = container ? parsePanelAt(markdown, offset) : null
    if (panel !== null) {
      blocks.push(Object.freeze({
        body: panel.body,
        codecId: `panel-${panel.variant}`,
        from: panel.sourceSpan.from,
        level: null,
        panel: Object.freeze({ title: panel.title, variant: panel.variant }),
        source: panel.source,
        to: panel.sourceSpan.to,
      }))
      offset = nextLineOffset(markdown, panel.sourceSpan.to)
      continue
    }
    const rawContainer = container ? rawContainerAt(markdown, offset) : null
    if (rawContainer !== null) {
      blocks.push(Object.freeze({
        body: rawContainer.source,
        codecId: 'raw-block',
        from: offset,
        level: null,
        source: rawContainer.source,
        to: rawContainer.to,
      }))
      offset = nextLineOffset(markdown, rawContainer.to)
      continue
    }
    const mermaid = parseMermaidAt(markdown, offset)
    if (mermaid !== null) {
      blocks.push(Object.freeze({
        body: mermaid.code,
        codecId: `mermaid-${mermaid.diagramType ?? 'unknown'}`,
        from: mermaid.sourceSpan.from,
        level: null,
        mermaid,
        source: mermaid.source,
        to: mermaid.sourceSpan.to,
      }))
      offset = nextLineOffset(markdown, mermaid.sourceSpan.to)
      continue
    }
    const fencedCode = parseFencedCodeAt(markdown, offset)
    if (fencedCode !== null) {
      blocks.push(Object.freeze({
        body: fencedCode.code,
        code: fencedCode,
        codecId: 'fenced-code',
        from: fencedCode.sourceSpan.from,
        level: null,
        source: fencedCode.source,
        to: fencedCode.sourceSpan.to,
      }))
      offset = nextLineOffset(markdown, fencedCode.sourceSpan.to)
      continue
    }
    const rawFence = rawFencedCodeCandidateAt(markdown, offset)
    if (rawFence !== null) {
      blocks.push(Object.freeze({
        body: rawFence.source,
        codecId: 'raw-block',
        from: offset,
        level: null,
        source: rawFence.source,
        to: rawFence.to,
      }))
      offset = rawFence.to
      continue
    }
    const drawio = parseDrawioAt(markdown, offset)
    if (drawio !== null) {
      blocks.push(Object.freeze({
        body: drawio.source,
        codecId: 'drawio',
        drawio,
        from: drawio.sourceSpan.from,
        level: null,
        source: drawio.source,
        to: drawio.sourceSpan.to,
      }))
      offset = nextLineOffset(markdown, drawio.sourceSpan.to)
      continue
    }
    const media = parseMediaAt(markdown, offset)
    if (media !== null) {
      blocks.push(Object.freeze({
        body: media.source,
        codecId: `media-${media.kind}`,
        from: media.sourceSpan.from,
        level: null,
        media,
        source: media.source,
        to: media.sourceSpan.to,
      }))
      offset = nextLineOffset(markdown, media.sourceSpan.to)
      continue
    }
    const attachment = parseAttachmentAt(markdown, offset)
    if (attachment !== null) {
      blocks.push(Object.freeze({
        attachment,
        body: attachment.source,
        codecId: `attachment-${attachment.kind}`,
        from: attachment.sourceSpan.from,
        level: null,
        source: attachment.source,
        to: attachment.sourceSpan.to,
      }))
      offset = nextLineOffset(markdown, attachment.sourceSpan.to)
      continue
    }
    const chart = parseChartTableAt(markdown, offset)
    if (chart !== null) {
      blocks.push(Object.freeze({
        body: chart.source,
        chart,
        codecId: `chart-${chart.chartType}`,
        from: chart.sourceSpan.from,
        level: null,
        source: chart.source,
        to: chart.sourceSpan.to,
      }))
      offset = nextLineOffset(markdown, chart.sourceSpan.to)
      continue
    }
    const table = parseOrdinaryTableAt(markdown, offset)
    if (table !== null) {
      blocks.push(Object.freeze({
        body: table.source,
        codecId: 'ordinary-table',
        from: table.sourceSpan.from,
        level: null,
        source: table.source,
        table,
        to: table.sourceSpan.to,
      }))
      offset = nextLineOffset(markdown, table.sourceSpan.to)
      continue
    }
    const rawTable = rawTableCandidateAt(markdown, offset)
    if (rawTable !== null) {
      blocks.push(Object.freeze({
        body: rawTable.source,
        codecId: 'raw-block',
        from: offset,
        level: null,
        source: rawTable.source,
        to: rawTable.to,
      }))
      offset = nextLineOffset(markdown, rawTable.to)
      continue
    }
    const formula = line.startsWith('$$') ? parseBlockFormulaAt(markdown, offset) : null
    if (formula !== null) {
      blocks.push(Object.freeze({
        body: formula.content,
        codecId: 'formula',
        from: formula.from,
        level: null,
        source: formula.source,
        to: formula.to,
      }))
      offset = nextLineOffset(markdown, formula.to)
      continue
    }
    if (line === '---' || line === '[[toc]]') {
      blocks.push(Object.freeze({
        body: '',
        codecId: line === '---' ? 'horizontal-rule' : 'table-of-contents',
        from: offset,
        level: null,
        source: line,
        to: end,
      }))
      offset = nextLineOffset(markdown, end)
      continue
    }
    const firstBlockquoteLine = parseBlockquoteLine(line)
    if (firstBlockquoteLine !== null) {
      const from = offset
      const body: string[] = []
      let to = end
      let cursor = offset
      while (cursor < markdown.length) {
        const candidateEnd = lineEnd(markdown, cursor)
        const candidate = parseBlockquoteLine(markdown.slice(cursor, candidateEnd))
        if (candidate === null) break
        body.push(candidate)
        to = candidateEnd
        cursor = nextLineOffset(markdown, candidateEnd)
      }
      const source = markdown.slice(from, to)
      blocks.push(Object.freeze({ body: body.join('\n'), codecId: 'blockquote', from, level: null, source, to }))
      offset = cursor
      continue
    }
    const firstListItem = parseListLine(line)
    if (firstListItem !== null && firstListItem.indent === 0) {
      const from = offset
      const lines: ParsedListLine[] = []
      const lineEnds: number[] = []
      const lineOffsets: number[] = []
      let candidateOffset = offset
      while (candidateOffset < markdown.length) {
        const candidateEnd = lineEnd(markdown, candidateOffset)
        const candidate = parseListLine(markdown.slice(candidateOffset, candidateEnd))
        if (candidate === null) break
        lines.push(candidate)
        lineEnds.push(candidateEnd)
        lineOffsets.push(candidateOffset)
        candidateOffset = nextLineOffset(markdown, candidateEnd)
      }
      const parsed = parseListLevel(lines, 0, 0, firstListItem.codecId)
      const consumed = parsed.nextIndex
      const to = lineEnds[consumed - 1] ?? end
      const cursor = lineOffsets[consumed] ?? nextLineOffset(markdown, to)
      const source = markdown.slice(from, to)
      blocks.push(Object.freeze({
        body: source,
        codecId: firstListItem.codecId,
        from,
        items: parsed.block.items,
        level: null,
        source,
        to,
      }))
      offset = cursor
      continue
    }
    const heading = /^(#{1,5})[ \t]+(.*)$/u.exec(line)
    if (heading !== null) {
      const parsedHeading = parseHeadingAnchor(heading[2] ?? '')
      blocks.push(Object.freeze({
        body: parsedHeading.body,
        codecId: 'heading',
        from: offset,
        level: heading[1]?.length as 1 | 2 | 3 | 4 | 5,
        source: line,
        ...(parsedHeading.explicitAnchor === null ? {} : { tocAnchor: parsedHeading.explicitAnchor }),
        to: end,
      }))
      offset = nextLineOffset(markdown, end)
      continue
    }
    const from = offset
    let to = end
    let cursor = nextLineOffset(markdown, end)
    while (cursor < markdown.length) {
      const candidateEnd = lineEnd(markdown, cursor)
      const candidate = markdown.slice(cursor, candidateEnd)
      const candidateContainer = candidate.startsWith(':::') || candidate.startsWith('+++')
      if (candidate.trim().length === 0
        || (candidateContainer && parseTimelineAt(markdown, cursor) !== null)
        || (candidateContainer && parseDisclosureAt(markdown, cursor) !== null)
        || (candidateContainer && parseColumnLayoutAt(markdown, cursor) !== null)
        || (candidateContainer && parseAlignmentAt(markdown, cursor) !== null)
        || (candidateContainer && parsePanelAt(markdown, cursor) !== null)
        || (candidateContainer && rawContainerAt(markdown, cursor) !== null)
        || parseFencedCodeAt(markdown, cursor) !== null
        || rawFencedCodeCandidateAt(markdown, cursor) !== null
        || parseDrawioAt(markdown, cursor) !== null
        || parseMediaAt(markdown, cursor) !== null
        || parseAttachmentAt(markdown, cursor) !== null
        || parseOrdinaryTableAt(markdown, cursor) !== null
        || rawTableCandidateAt(markdown, cursor) !== null
        || candidate === '---'
        || candidate === '[[toc]]'
        || parseBlockquoteLine(candidate) !== null
        || /^(#{1,5})[ \t]+/u.test(candidate)
        || parseListLine(candidate) !== null) break
      to = candidateEnd
      cursor = nextLineOffset(markdown, candidateEnd)
    }
    const source = markdown.slice(from, to)
    blocks.push(Object.freeze({ body: source, codecId: 'paragraph', from, level: null, source, to }))
    offset = cursor
  }
  return preserveExplicitEmptyParagraphs(markdown, blocks)
}

function inlineContent(text: string): JSONContent[] | undefined {
  if (text.length === 0) return undefined
  const lines = text.split(/\r?\n/u)
  const content: JSONContent[] = []
  for (const [index, line] of lines.entries()) {
    if (index > 0) content.push(Object.freeze({ type: 'hardBreak' }))
    const inlineLine = index < lines.length - 1 && line.endsWith('  ') ? line.slice(0, -2) : line
    if (inlineLine.length > 0) content.push(...parseInlineMarkdown(inlineLine))
  }
  return content
}

function projectListBlock(block: OrdinaryListBlock, attrs?: Readonly<Record<string, unknown>>): JSONContent {
  const itemType = block.codecId === 'task-list' ? 'taskItem' : 'listItem'
  const listType = block.codecId === 'bullet-list'
    ? 'bulletList'
    : block.codecId === 'ordered-list' ? 'orderedList' : 'taskList'
  return Object.freeze({
    ...(attrs === undefined ? {} : { attrs }),
    content: block.items.map((item): JSONContent => {
      const paragraphContent = inlineContent(item.body)
      const paragraph: JSONContent = Object.freeze({
        ...(paragraphContent === undefined ? {} : { content: paragraphContent }),
        type: 'paragraph',
      })
      return Object.freeze({
        ...(block.codecId === 'task-list' ? { attrs: { checked: item.checked === true } } : {}),
        content: [paragraph, ...item.children.map((child) => projectListBlock(child))],
        type: itemType,
      })
    }),
    type: listType,
  })
}

function safePatchUnit(block: OrdinaryBlock): SafePatchUnit {
  const semantic = block.panel !== undefined || block.layout !== undefined || block.disclosure !== undefined || block.timeline !== undefined || block.mermaid !== undefined || block.chart !== undefined || block.drawio !== undefined || block.media !== undefined || block.attachment !== undefined
  const aligned = block.alignment !== undefined
  return Object.freeze({
    codecId: block.codecId,
    expectedSource: block.source,
    sourceSpan: Object.freeze({ from: block.from, to: block.to }),
    strategy: semantic
      ? Object.freeze({
          editorId: block.layout !== undefined
            ? 'column-layout-editor'
            : block.chart !== undefined
              ? 'chart-table-editor'
            : block.drawio !== undefined
              ? 'drawio-editor'
            : block.attachment !== undefined
              ? 'attachment-editor'
            : block.media !== undefined
              ? 'media-editor'
            : block.code !== undefined
              ? 'code-block-editor'
              : block.mermaid !== undefined
                ? 'mermaid-editor'
            : block.disclosure !== undefined
              ? 'disclosure-editor'
              : block.timeline !== undefined ? 'timeline-editor' : 'panel-editor',
          kind: 'semantic-editor' as const,
        })
      : Object.freeze({ kind: 'direct' as const, scope: aligned ? 'joined-blocks' as const : 'block' as const }),
    structural: semantic || aligned,
    unitId: `${block.codecId}:${block.from}:${block.to}`,
  })
}

function projectionNode(block: OrdinaryBlock, revision: number): JSONContent {
  const projectionId = `${block.codecId}:${block.from}:${block.to}`
  const attrs = Object.freeze({
    codecId: block.codecId,
    ordinaryClass: true,
    originalSource: block.source,
    projectionId,
    revision,
    sourceFrom: block.from,
    sourceTo: block.to,
    ...(block.level === null ? {} : { level: block.level }),
    ...(block.tocAnchor === undefined ? {} : { tocAnchor: block.tocAnchor }),
  })
  if (block.codecId === 'horizontal-rule') return Object.freeze({ attrs, type: 'horizontalRule' })
  if (block.codecId === 'raw-block') {
    return Object.freeze({ attrs: Object.freeze({ ...attrs, source: block.source }), type: 'rawBlock' })
  }
  if (block.chart !== undefined) {
    return Object.freeze({
      attrs: Object.freeze({
        ...attrs,
        chartType: block.chart.chartType,
        columns: block.chart.columns,
        editorId: 'chart-table-editor',
        identity: `${block.chart.chartType[0]?.toUpperCase() ?? ''}${block.chart.chartType.slice(1)} chart`,
        kind: 'chart-table',
        options: block.chart.options,
        rows: block.chart.rows,
        source: block.chart.source,
        title: block.chart.title,
      }),
      type: 'semanticBlock',
    })
  }
  if (block.drawio !== undefined) {
    return Object.freeze({
      attrs: Object.freeze({
        ...attrs,
        editorId: 'drawio-editor',
        identity: `draw.io · ${block.drawio.name}`,
        kind: 'drawio',
        name: block.drawio.name,
        png: block.drawio.png,
        source: block.drawio.source,
        xml: block.drawio.xml,
      }),
      type: 'semanticBlock',
    })
  }
  if (block.media !== undefined) {
    const label = `${block.media.kind[0]?.toUpperCase() ?? ''}${block.media.kind.slice(1)}`
    return Object.freeze({
      attrs: Object.freeze({
        ...attrs,
        editorId: 'media-editor',
        identity: `${label} · ${block.media.name}`,
        kind: 'media',
        mediaKind: block.media.kind,
        name: block.media.name,
        source: block.media.source,
        url: block.media.url,
      }),
      type: 'semanticBlock',
    })
  }
  if (block.attachment !== undefined) {
    const label = block.attachment.kind === 'pdf' ? 'PDF' : block.attachment.kind === 'word' ? 'Word document' : 'File'
    return Object.freeze({
      attrs: Object.freeze({
        ...attrs,
        attachmentKind: block.attachment.kind,
        editorId: 'attachment-editor',
        identity: `${label} · ${block.attachment.name}`,
        kind: 'attachment',
        mediaType: block.attachment.mediaType,
        name: block.attachment.name,
        size: block.attachment.size,
        source: block.attachment.source,
        url: block.attachment.url,
      }),
      type: 'semanticBlock',
    })
  }
  if (block.table !== undefined) {
    const rows = [block.table.headers, ...block.table.rows]
    return Object.freeze({
      attrs: Object.freeze({ ...attrs, markdownDelimiters: block.table.delimiters }),
      content: rows.map((cells, rowIndex): JSONContent => Object.freeze({
        content: cells.map((cell, columnIndex): JSONContent => {
          const content = inlineContent(cell)
          const alignment = block.table?.alignments[columnIndex] ?? 'unspecified'
          return Object.freeze({
            attrs: Object.freeze({ align: alignment === 'unspecified' ? null : alignment }),
            content: [Object.freeze({ ...(content === undefined ? {} : { content }), type: 'paragraph' })],
            type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
          })
        }),
        type: 'tableRow',
      })),
      type: 'table',
    })
  }
  if (block.mermaid !== undefined) {
    const descriptor = block.mermaid.diagramType === null
      ? 'Mermaid diagram'
      : `${block.mermaid.diagramType.charAt(0).toUpperCase()}${block.mermaid.diagramType.slice(1)} Mermaid`
    return Object.freeze({
      attrs: Object.freeze({
        ...attrs,
        body: block.mermaid.code,
        code: block.mermaid.code,
        diagramType: block.mermaid.diagramType,
        editorId: 'mermaid-editor',
        identity: descriptor,
        kind: 'mermaid',
        source: block.mermaid.source,
      }),
      type: 'semanticBlock',
    })
  }
  if (block.code !== undefined) {
    return Object.freeze({
      attrs: Object.freeze({
        ...attrs,
        language: block.code.language,
        localError: null,
      }),
      ...(block.code.code.length === 0 ? {} : { content: [Object.freeze({ text: block.code.code, type: 'text' })] }),
      type: 'codeBlock',
    })
  }
  if (block.timeline !== undefined) {
    return Object.freeze({
      attrs: Object.freeze({
        ...attrs,
        editorId: 'timeline-editor',
        identity: 'Timeline',
        items: block.timeline.items,
        kind: 'timeline',
        source: block.source,
        title: block.timeline.title,
      }),
      type: 'semanticBlock',
    })
  }
  if (block.disclosure !== undefined) {
    return Object.freeze({
      attrs: Object.freeze({
        ...attrs,
        editorId: 'disclosure-editor',
        identity: block.disclosure.kind === 'tabs' ? 'Tabs' : 'Accordion',
        items: block.disclosure.items,
        kind: 'disclosure',
        layoutKind: block.disclosure.kind,
        source: block.source,
      }),
      type: 'semanticBlock',
    })
  }
  if (block.layout !== undefined) {
    return Object.freeze({
      attrs: Object.freeze({
        ...attrs,
        editorId: 'column-layout-editor',
        identity: block.layout.kind === 'two-column' ? 'Two-column layout' : 'Multi-column layout',
        items: block.layout.columns,
        kind: 'column-layout',
        layoutKind: block.layout.kind,
        source: block.source,
        title: block.layout.title,
      }),
      type: 'semanticBlock',
    })
  }
  if (block.alignment !== undefined) {
    const children = block.body
      .split(/\r?\n[ \t]*\r?\n/u)
      .filter((source) => source.length > 0)
      .map((source): JSONContent => {
        const heading = /^(#{1,5})[ \t]+([\s\S]*)$/u.exec(source)
        const body = heading?.[2] ?? source
        const content = inlineContent(body)
        return Object.freeze({
          attrs: Object.freeze({ textAlign: block.alignment }),
          ...(content === undefined ? {} : { content }),
          ...(heading === null ? {} : { attrs: Object.freeze({ level: heading[1]!.length, textAlign: block.alignment }) }),
          type: heading === null ? 'paragraph' : 'heading',
        })
      })
    return Object.freeze({
      attrs: Object.freeze({ ...attrs, alignment: block.alignment }),
      content: children,
      type: 'alignmentBlock',
    })
  }
  if (block.codecId === 'formula') {
    return Object.freeze({
      attrs: Object.freeze({
        ...attrs,
        content: block.body,
        formulaMode: 'block',
        localError: null,
      }),
      type: 'formulaBlock',
    })
  }
  if (block.panel !== undefined) {
    return Object.freeze({
      attrs: Object.freeze({
        ...attrs,
        body: block.body,
        editorId: 'panel-editor',
        identity: `${block.panel.variant[0]?.toUpperCase() ?? ''}${block.panel.variant.slice(1)} panel`,
        kind: 'panel',
        previewRole: block.panel.variant === 'primary' || block.panel.variant === 'info' ? 'note' : 'status',
        source: block.source,
        title: block.panel.title,
        variant: block.panel.variant,
      }),
      type: 'semanticBlock',
    })
  }
  if (block.codecId === 'table-of-contents') {
    return Object.freeze({
      attrs: Object.freeze({ ...attrs, source: block.source }),
      type: 'tocBlock',
    })
  }
  if (block.codecId === 'blockquote') {
    const quoteContent = inlineContent(block.body)
    return Object.freeze({
      attrs,
      content: [Object.freeze({ ...(quoteContent === undefined ? {} : { content: quoteContent }), type: 'paragraph' })],
      type: 'blockquote',
    })
  }
  if (block.items !== undefined) {
    return projectListBlock(Object.freeze({
      codecId: block.codecId as OrdinaryListCodecId,
      items: block.items,
    }), attrs)
  }
  const content = inlineContent(block.body)
  return Object.freeze({
    attrs,
    ...(content === undefined ? {} : { content }),
    type: block.codecId,
  })
}

export function projectOrdinaryMarkdown(snapshot: DocumentSnapshot): OrdinaryMarkdownProjection {
  const blocks = parseOrdinaryBlocks(snapshot.markdown)
  const entries: ProjectionMapEntry[] = blocks.map((block) => Object.freeze({
    codecId: block.codecId,
    originalSource: block.source,
    projectionId: `${block.codecId}:${block.from}:${block.to}`,
    safePatchUnit: safePatchUnit(block),
    sourceSpan: Object.freeze({ from: block.from, to: block.to }),
  }))
  return Object.freeze({
    content: Object.freeze({
      content: blocks.map((block) => projectionNode(block, snapshot.revision)),
      type: 'doc',
    }),
    map: Object.freeze({
      documentLength: snapshot.markdown.length,
      entries: Object.freeze(entries),
      revision: snapshot.revision,
    }),
    revision: snapshot.revision,
    source: snapshot.markdown,
  })
}

export interface MarkdownOutlineItem {
  readonly anchor: string
  readonly level: number
  readonly sourceFrom: number
  readonly sourceTo: number
  readonly text: string
}

function projectedInlineText(node: JSONContent): string {
  if (typeof node.text === 'string') return node.text
  if (node.type === 'inlineFormula' && typeof node.attrs?.['content'] === 'string') {
    return node.attrs['content'] as string
  }
  if (node.type === 'hardBreak') return ' '
  return node.content?.map(projectedInlineText).join('') ?? ''
}

export function createMarkdownOutline(markdown: string): readonly MarkdownOutlineItem[] {
  const headings = parseOrdinaryBlocks(markdown).filter((block) => block.codecId === 'heading' && block.level !== null)
  const items = createTocHeadingItems(headings.map((heading) => Object.freeze({
    explicitAnchor: heading.tocAnchor ?? null,
    level: heading.level ?? 1,
    text: parseInlineMarkdown(heading.body).map(projectedInlineText).join(''),
  })))
  return Object.freeze(items.map((item, index) => Object.freeze({
    ...item,
    sourceFrom: headings[index]?.from ?? 0,
    sourceTo: headings[index]?.to ?? 0,
  })))
}

function matchAt(markdown: string, offset: number, kind: OrdinaryBlock['codecId']): CodecMatch | null {
  const block = parseOrdinaryBlocks(markdown).find((candidate) => candidate.from === offset && candidate.codecId === kind)
  if (block === undefined || block.source.length === 0) return null
  return Object.freeze({
    captures: Object.freeze({
      body: block.body,
      ...(block.level === null ? {} : { level: String(block.level) }),
    }),
    originalSource: block.source,
    sourceSpan: Object.freeze({ from: block.from, to: block.to }),
  })
}

function projectMatch(codecId: OrdinaryBlock['codecId'], match: CodecMatch, revision: number): ProjectionNode {
  const level = Number(match.captures['level'] ?? 0)
  const editStrategy = Object.freeze({ kind: 'direct' as const, scope: 'block' as const })
  return Object.freeze({
    attributes: Object.freeze({ body: match.captures['body'] ?? '', ...(level === 0 ? {} : { level }) }),
    children: Object.freeze([]),
    codecId,
    editStrategy,
    kind: 'structured' as const,
    nodeType: codecId,
    originalSource: match.originalSource,
    projectionId: `${codecId}:${match.sourceSpan.from}:${match.sourceSpan.to}`,
    revision,
    sourceSpan: Object.freeze({ ...match.sourceSpan }),
  })
}

function codec(codecId: OrdinaryBlock['codecId'], precedence: number): Codec {
  const definition: Codec = {
    id: codecId,
    precedence,
    project: (match: CodecMatch, revision: number) => projectMatch(codecId, match, revision),
    recognize: (context, offset) => matchAt(context.markdown, offset, codecId),
    safePatchUnit: (node) => Object.freeze({
      codecId,
      expectedSource: node.originalSource,
      sourceSpan: Object.freeze({ ...node.sourceSpan }),
      strategy: node.editStrategy,
      structural: false,
      unitId: node.projectionId,
    }),
    scope: 'block' as const,
    serialize: ({ node }) => {
      if (node.kind !== 'structured') throw new TypeError(`${codecId} codec requires a structured projection node.`)
      const body = String(node.attributes['body'] ?? '')
      if (codecId.endsWith('-list')) return body
      if (codecId === 'formula' || codecId === 'horizontal-rule' || codecId === 'table-of-contents') return node.originalSource
      if (codecId === 'paragraph') return body
      const level = Number(node.attributes['level'] ?? 1)
      return `${'#'.repeat(Math.max(1, Math.min(5, level)))} ${body}`
    },
    validate: (source: string): ValidationResult => {
      if (source.includes('\0')) {
        return Object.freeze({ code: 'ORDINARY_BLOCK_NUL', message: 'Ordinary blocks cannot contain NUL.', sourceSpan: null, valid: false })
      }
      return Object.freeze({ valid: true })
    },
  }
  return Object.freeze(definition)
}

export const ordinaryBlockCodecs = Object.freeze([
  drawioCodec,
  ...mediaCodecs,
  ...attachmentCodecs,
  ...chartTableCodecs,
  ...mermaidCodecs,
  ...panelCodecs,
  ...alignmentCodecs,
  ...columnLayoutCodecs,
  ...disclosureCodecs,
  timelineCodec,
  codec('formula', 45),
  codec('table-of-contents', 42),
  codec('horizontal-rule', 41),
  codec('task-list', 35),
  codec('ordered-list', 34),
  codec('bullet-list', 33),
  codec('heading', 20),
  codec('paragraph', 10),
])
