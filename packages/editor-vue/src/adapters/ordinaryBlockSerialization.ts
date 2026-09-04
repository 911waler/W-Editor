import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

import { INLINE_MARK_SPECS, serializeFencedCode, serializeFormula, type ProjectionMapEntry } from '@w-editor/editor-core'
import { formatRichInlineMark } from '@w-editor/editor-core'
import { InvalidTiptapPatchSerializationError, type TiptapPatchSerializationInput } from './tiptapPatchPlanner'

const MARK_DELIMITERS = new Map<string, (typeof INLINE_MARK_SPECS)[number]>(
  INLINE_MARK_SPECS.map((spec) => [spec.markType, spec]),
)

function serializeInline(node: ProseMirrorNode): string {
  let source = ''
  let activeDelimitedMarks: readonly (typeof INLINE_MARK_SPECS)[number][] = Object.freeze([])
  node.content.forEach((child) => {
    const delimitedMarks = child.marks
      .map((mark) => MARK_DELIMITERS.get(mark.type.name))
      .filter((spec) => spec !== undefined)
    let shared = 0
    while (shared < activeDelimitedMarks.length
      && shared < delimitedMarks.length
      && activeDelimitedMarks[shared]?.markType === delimitedMarks[shared]?.markType) shared += 1
    for (let index = activeDelimitedMarks.length - 1; index >= shared; index -= 1) {
      source += activeDelimitedMarks[index]?.close ?? ''
    }
    for (let index = shared; index < delimitedMarks.length; index += 1) {
      source += delimitedMarks[index]?.open ?? ''
    }
    activeDelimitedMarks = delimitedMarks
    if (child.type.name === 'inlineFormula') {
      source += serializeFormula('inline', String(child.attrs['content'] ?? ''))
      return
    }
    if (child.type.name === 'hardBreak') {
      source += '  \n'
      return
    }
    if (child.type.name === 'rawInline') {
      source += String(child.attrs['source'] ?? '')
      return
    }
    let value = child.isText ? child.text ?? '' : child.textContent
    const textStyle = child.marks.find((mark) => mark.type.name === 'textStyle')
    const highlight = child.marks.find((mark) => mark.type.name === 'highlight')
    const color = textStyle?.attrs['color']
    const fontSize = textStyle?.attrs['fontSize']
    if (typeof color === 'string' && color.length > 0) {
      value = formatRichInlineMark('text.color', value, color)
    }
    const backgroundColor = highlight?.attrs['color']
    if (typeof backgroundColor === 'string' && backgroundColor.length > 0) {
      value = formatRichInlineMark('text.background', value, backgroundColor)
    }
    if (typeof fontSize === 'string' && /^[0-9]{1,2}px$/u.test(fontSize)) {
      value = formatRichInlineMark('text.size', value, fontSize.slice(0, -2))
    }
    for (const mark of [...child.marks].reverse()) {
      if (mark.type.name === 'code') {
        value = `\`${value}\``
      } else if (mark.type.name === 'link') {
        value = `[${value}](${String(mark.attrs['href'] ?? '')})`
      } else if (mark.type.name === 'ruby') {
        value = formatRichInlineMark('text.ruby', value, String(mark.attrs['annotation'] ?? ''))
      }
    }
    source += value
  })
  for (const spec of [...activeDelimitedMarks].reverse()) source += spec.close
  return source
}

function serializeTableCell(node: ProseMirrorNode): string {
  const blocks: string[] = []
  node.forEach((child) => blocks.push(serializeInline(child)))
  return blocks.join('<br>').replace(/\|/gu, '\\|')
}

function tableDelimiterAlignment(source: string): 'center' | 'left' | 'right' | 'unspecified' | null {
  const delimiter = source.trim()
  if (!/^:?-{3,}:?$/u.test(delimiter)) return null
  if (delimiter.startsWith(':') && delimiter.endsWith(':')) return 'center'
  if (delimiter.endsWith(':')) return 'right'
  if (delimiter.startsWith(':')) return 'left'
  return 'unspecified'
}

function serializeTable(node: ProseMirrorNode): string {
  const rows: string[][] = []
  const alignments: string[] = []
  node.forEach((row, _rowOffset, rowIndex) => {
    const cells: string[] = []
    row.forEach((cell, _cellOffset, columnIndex) => {
      cells.push(serializeTableCell(cell))
      if (rowIndex === 0) {
        const alignment = cell.attrs['align']
        alignments[columnIndex] = typeof alignment === 'string' ? alignment : ''
      }
    })
    rows.push(cells)
  })
  const header = rows[0] ?? []
  const storedDelimiters = Array.isArray(node.attrs['markdownDelimiters'])
    ? node.attrs['markdownDelimiters'].map((value: unknown) => typeof value === 'string' ? value : null)
    : []
  const delimiter = header.map((_, index) => {
    const alignment = alignments[index] === 'center' || alignments[index] === 'left' || alignments[index] === 'right'
      ? alignments[index] as 'center' | 'left' | 'right'
      : 'unspecified'
    const stored = storedDelimiters[index]
    if (stored !== null && stored !== undefined && tableDelimiterAlignment(stored) === alignment) return stored
    if (alignment === 'center') return ':---:'
    if (alignment === 'right') return '---:'
    if (alignment === 'left') return ':---'
    return '------'
  })
  const line = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`
  return [line(header), line(delimiter), ...rows.slice(1).map(line)].join('\n')
}

function serializeList(node: ProseMirrorNode, indent = ''): string {
  const lines: string[] = []
  node.forEach((item, _itemOffset, itemIndex) => {
    const paragraph = item.firstChild
    const body = paragraph === null ? '' : serializeInline(paragraph)
    const prefix = node.type.name === 'orderedList'
      ? `${itemIndex + 1}. `
      : node.type.name === 'taskList'
        ? `- [${item.attrs['checked'] === true ? 'x' : ' '}] `
        : '- '
    lines.push(`${indent}${prefix}${body}`)
    const nestedIndent = `${indent}${' '.repeat(prefix.length)}`
    for (let childIndex = 1; childIndex < item.childCount; childIndex += 1) {
      const child = item.child(childIndex)
      if (child.type.name === 'orderedList' || child.type.name === 'bulletList' || child.type.name === 'taskList') {
        lines.push(serializeList(child, nestedIndent))
      }
    }
  })
  return lines.join('\n')
}

function serializeNode(node: ProseMirrorNode): string {
  if (node.type.name === 'rawBlock') return String(node.attrs['source'] ?? '')
  if (node.type.name === 'table') return serializeTable(node)
  if (node.type.name === 'blockquote') {
    const body: string[] = []
    node.forEach((child) => body.push(serializeNode(child)))
    return body.join('\n\n').split('\n').map((line) => line.length === 0 ? '>' : `> ${line}`).join('\n')
  }
  if (node.type.name === 'alignmentBlock') {
    const alignment = String(node.attrs['alignment'] ?? 'left')
    const body: string[] = []
    node.forEach((child) => body.push(serializeNode(child)))
    return `::: ${alignment}\n${body.join('\n\n')}\n:::`
  }
  if (node.type.name === 'horizontalRule') return '---'
  if (node.type.name === 'codeBlock') {
    return serializeFencedCode(String(node.attrs['language'] ?? ''), node.textContent)
  }
  if (node.type.name === 'formulaBlock') return serializeFormula('block', String(node.attrs['content'] ?? ''))
  if (node.type.name === 'tocBlock') return '[[toc]]'
  if (node.type.name === 'semanticBlock' && node.attrs['kind'] === 'table-of-contents') return '[[toc]]'
  if (node.type.name === 'semanticBlock' && node.attrs['kind'] === 'formula') return String(node.attrs['source'] ?? '')
  if (node.type.name === 'semanticBlock') return String(node.attrs['source'] ?? '')
  if (node.type.name === 'orderedList' || node.type.name === 'bulletList' || node.type.name === 'taskList') {
    return serializeList(node)
  }
  const body = serializeInline(node)
  if (node.type.name !== 'heading') return body
  const level = Number(node.attrs['level'] ?? 1)
  const tocAnchor = node.attrs['tocAnchor']
  const anchorSuffix = typeof tocAnchor === 'string' && tocAnchor.length > 0 ? ` {#${tocAnchor}}` : ''
  return `${'#'.repeat(Math.max(1, Math.min(5, level)))} ${body}${anchorSuffix}`
}

export function serializeOrdinaryTiptapDocument(document: ProseMirrorNode): string {
  const blocks: string[] = []
  document.forEach((child) => blocks.push(serializeNode(child)))
  return blocks.join('\n\n')
}

function findTopLevelProjectionContainer(document: ProseMirrorNode, projectionId: string): ProseMirrorNode | null {
  for (let index = 0; index < document.childCount; index += 1) {
    const child = document.child(index)
    if (child.attrs['projectionId'] === projectionId) return child
    let containsProjection = false
    child.descendants((descendant) => {
      if (descendant.attrs['projectionId'] !== projectionId) return true
      containsProjection = true
      return false
    })
    if (containsProjection) return child
  }
  return null
}

function isRuntimeProjectionId(projectionId: string | null): boolean {
  return projectionId?.startsWith('visual-runtime:') === true
}

function hasForeignProjectionIdentity(
  node: ProseMirrorNode,
  projectionId: string,
  activeProjectionIds: ReadonlySet<string>,
  ignoreRuntimeProjectionIds = false,
): boolean {
  const ownProjectionId = node.attrs['projectionId']
  if (
    typeof ownProjectionId === 'string'
    && ownProjectionId !== projectionId
    && (!isRuntimeProjectionId(ownProjectionId) || !ignoreRuntimeProjectionIds)
    && activeProjectionIds.has(ownProjectionId)
  ) return true
  let found = false
  node.descendants((descendant) => {
    const descendantProjectionId = descendant.attrs['projectionId']
    if (
      typeof descendantProjectionId !== 'string'
      || descendantProjectionId === projectionId
      || (isRuntimeProjectionId(descendantProjectionId) && !ignoreRuntimeProjectionIds)
      || !activeProjectionIds.has(descendantProjectionId)
    ) return true
    found = true
    return false
  })
  return found
}

function containsProjectionIdentity(node: ProseMirrorNode, projectionId: string): boolean {
  if (node.attrs['projectionId'] === projectionId) return true
  let found = false
  node.descendants((descendant) => {
    if (descendant.attrs['projectionId'] !== projectionId) return true
    found = true
    return false
  })
  return found
}

function pendingSplitFamily(
  document: ProseMirrorNode,
  projectionId: string,
  projectionEntries: readonly ProjectionMapEntry[],
): readonly ProseMirrorNode[] | null {
  const activeProjectionIds = new Set(projectionEntries.map((entry) => entry.projectionId))
  let ownerIndex = -1
  for (let index = 0; index < document.childCount; index += 1) {
    const child = document.child(index)
    if (containsProjectionIdentity(child, projectionId)) {
      ownerIndex = index
      break
    }
  }
  if (ownerIndex < 0) return null

  const ownerNode = document.child(ownerIndex)
  const ignoreRuntimeProjectionIds = ownerNode.type.name === 'orderedList'
    || ownerNode.type.name === 'bulletList'
    || ownerNode.type.name === 'taskList'

  let from = ownerIndex
  let to = ownerIndex + 1
  while (from > 0) {
    const previous = document.child(from - 1)
    if (hasForeignProjectionIdentity(previous, projectionId, activeProjectionIds, ignoreRuntimeProjectionIds)) break
    from -= 1
  }
  while (to < document.childCount) {
    const next = document.child(to)
    if (hasForeignProjectionIdentity(next, projectionId, activeProjectionIds, ignoreRuntimeProjectionIds)) break
    to += 1
  }
  if (to - from <= 1) return null
  return Object.freeze(Array.from({ length: to - from }, (_, index) => document.child(from + index)))
}

function changedTopLevelNodes(input: TiptapPatchSerializationInput): readonly ProseMirrorNode[] {
  const nodes: ProseMirrorNode[] = []
  let position = 0
  for (let index = 0; index < input.after.childCount; index += 1) {
    const node = input.after.child(index)
    const to = position + node.nodeSize
    const changed = input.changedRanges.some(({ newRange }) => newRange.from === newRange.to
      ? newRange.from >= position && newRange.from <= to
      : newRange.from < to && newRange.to > position)
    if (changed) nodes.push(node)
    position = to
  }
  return Object.freeze(nodes)
}

function topLevelNodeAtPosition(document: ProseMirrorNode, position: number): ProseMirrorNode | null {
  let offset = 0
  for (let index = 0; index < document.childCount; index += 1) {
    const node = document.child(index)
    const to = offset + node.nodeSize
    if (position >= offset && position <= to) return node
    offset = to
  }
  return null
}

function serializeUnwrappedAlignmentChildren(
  previousContainer: ProseMirrorNode,
  document: ProseMirrorNode,
  selectionHead: number,
): string | null {
  if (previousContainer.type.name !== 'alignmentBlock' || previousContainer.childCount === 0) return null
  let selectedIndex = -1
  let offset = 0
  for (let index = 0; index < document.childCount; index += 1) {
    const node = document.child(index)
    const to = offset + node.nodeSize
    if (selectionHead >= offset && selectionHead <= to) {
      selectedIndex = index
      break
    }
    offset = to
  }
  if (selectedIndex < 0) return null

  const childCount = previousContainer.childCount
  const firstCandidate = Math.max(0, selectedIndex - childCount + 1)
  const lastCandidate = Math.min(selectedIndex, document.childCount - childCount)
  for (let start = firstCandidate; start <= lastCandidate; start += 1) {
    const matches = Array.from({ length: childCount }, (_, index) => {
      const before = previousContainer.child(index)
      const after = document.child(start + index)
      return before.type === after.type && before.textContent === after.textContent
    }).every(Boolean)
    if (matches) {
      return Array.from({ length: childCount }, (_, index) => serializeNode(document.child(start + index))).join('\n\n')
    }
  }
  return null
}

export function serializeOrdinaryTiptapPatch(input: TiptapPatchSerializationInput): string {
  if (input.safePatchUnit.codecId === 'alignment-wrap') {
    const alignment = changedTopLevelNodes(input).find((node) => node.type.name === 'alignmentBlock')
    if (alignment !== undefined) return serializeNode(alignment)
  }
  const survivorNodes = input.entries
    .map((entry) => {
      const container = findTopLevelProjectionContainer(input.after, entry.projectionId)
      return container
    })
    .filter((value): value is ProseMirrorNode => value !== null)
  if (input.entries.length === 1 && survivorNodes.length > 0) {
    const family = pendingSplitFamily(
      input.after,
      input.entries[0]?.projectionId ?? '',
      input.projectionEntries,
    )
    if (family !== null) return family.map(serializeNode).join('\n\n')
  }
  const survivors = [...new Set(survivorNodes)].map(serializeNode)
  if (
    input.safePatchUnit.codecId === 'ordinary-paragraph-breaks'
    && input.safePatchUnit.sourceSpan.from === input.safePatchUnit.sourceSpan.to
    && input.after.childCount > input.before.childCount
  ) {
    const insertedParagraphCount = input.after.childCount - input.before.childCount
    const entries = [...input.entries].sort((left, right) => left.sourceSpan.from - right.sourceSpan.from)
    const left = entries[0]
    const right = entries[1]
    if (input.projectionSource !== undefined && left !== undefined && right !== undefined) {
      const separatorFrom = left.sourceSpan.from === left.sourceSpan.to
        ? left.sourceSpan.from
        : left.sourceSpan.to
      const separator = input.projectionSource.slice(separatorFrom, right.sourceSpan.from)
      if (/^\r?\n[ \t]*\r?\n$/u.test(separator)) return separator.repeat(insertedParagraphCount)
    }
    return '\n\n'.repeat(insertedParagraphCount)
  }
  if (
    input.entries.length > 1
    && input.safePatchUnit.strategy.kind === 'direct'
    && input.safePatchUnit.strategy.scope === 'joined-blocks'
  ) {
    const joinedContainers = [...new Set(input.entries
      .map((entry) => findTopLevelProjectionContainer(input.after, entry.projectionId))
      .filter((container): container is ProseMirrorNode => container !== null))]
    const allowRemovedBoundaryEntry = input.safePatchUnit.codecId === 'alignment-boundary-join'
    if ((allowRemovedBoundaryEntry || joinedContainers.length === input.entries.length) && joinedContainers.length > 0) {
      const indexes = joinedContainers.map((container) => {
        for (let index = 0; index < input.after.childCount; index += 1) {
          if (input.after.child(index) === container) return index
        }
        return -1
      })
      if (indexes.every((index) => index >= 0)) {
        const from = Math.min(...indexes)
        const to = Math.max(...indexes)
        return Array.from({ length: to - from + 1 }, (_, index) => input.after.child(from + index))
          .map(serializeNode)
          .join('\n\n')
      }
    }
  }
  if (survivors.length === 0 && input.entries.length === 1) {
    if (input.after.childCount < input.before.childCount) return ''
    const projectionId = input.entries[0]?.projectionId ?? ''
    const previousContainer = findTopLevelProjectionContainer(input.before, projectionId)
    const selectedContainer = topLevelNodeAtPosition(input.after, input.transaction.selection.head)
    if (previousContainer !== null) {
      const unwrappedAlignment = serializeUnwrappedAlignmentChildren(
        previousContainer,
        input.after,
        input.transaction.selection.head,
      )
      if (unwrappedAlignment !== null) return unwrappedAlignment
    }
    if (
      previousContainer !== null
      && ['orderedList', 'bulletList', 'taskList'].includes(previousContainer.type.name)
      && selectedContainer !== null
    ) {
      return serializeNode(selectedContainer)
    }
    const restored = changedTopLevelNodes(input)
    if (restored.length > 0) return restored.map(serializeNode).join('\n\n')
  }
  if (survivors.length !== 1) {
    throw new InvalidTiptapPatchSerializationError('An ordinary block patch must retain exactly one mapped projection node.')
  }
  return survivors[0] as string
}
