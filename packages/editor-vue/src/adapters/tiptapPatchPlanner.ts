import { getChangedRanges, type ChangedRange } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'

import type { ProjectionMapEntry, SafePatchUnit } from '@w-editor/editor-core'
import type { PatchPlan } from '@w-editor/editor-core'
import type { TiptapVisualProjection } from './tiptapVisualAdapter'

export const TIPTAP_EXTERNAL_HYDRATION_META = 'w-editor-external-hydration'

export interface PositionedTiptapProjectionNode {
  readonly node: ProseMirrorNode
  readonly position: number
  readonly projectionId: string
}

export interface TiptapPatchSerializationInput {
  readonly affectedProjectionIds: readonly string[]
  readonly after: ProseMirrorNode
  readonly before: ProseMirrorNode
  readonly changedRanges: readonly ChangedRange[]
  readonly entries: readonly ProjectionMapEntry[]
  readonly projectionEntries: readonly ProjectionMapEntry[]
  readonly projectionSource: string | undefined
  readonly safePatchUnit: SafePatchUnit
  readonly transaction: Transaction
}

export interface TiptapTransactionPatchPlannerOptions {
  readonly createTransactionId: () => string
  readonly serialize: (input: TiptapPatchSerializationInput) => string
}

export class UnmappedTiptapTransactionError extends Error {
  readonly code = 'UNMAPPED_TIPTAP_TRANSACTION'

  constructor() {
    super('A document-changing Tiptap transaction did not map to a declared safe projection unit.')
    this.name = 'UnmappedTiptapTransactionError'
  }
}

export class AmbiguousTiptapPatchUnitError extends Error {
  readonly code = 'AMBIGUOUS_TIPTAP_PATCH_UNIT'

  constructor() {
    super('A Tiptap transaction mapped to overlapping safe patch units.')
    this.name = 'AmbiguousTiptapPatchUnitError'
  }
}

export class InvalidTiptapPatchSerializationError extends Error {
  readonly code = 'INVALID_TIPTAP_PATCH_SERIALIZATION'

  constructor(message: string) {
    super(message)
    this.name = 'InvalidTiptapPatchSerializationError'
  }
}

function nodeProjectionId(node: ProseMirrorNode): string | null {
  const id = node.attrs['projectionId']
  return typeof id === 'string' && id.length > 0 ? id : null
}

function isRuntimeProjectionId(id: string | null): boolean {
  return id?.startsWith('visual-runtime:') === true
}

function projectionIdOccurrenceCount(document: ProseMirrorNode, projectionId: string): number {
  let count = 0
  document.descendants((node) => {
    if (nodeProjectionId(node) === projectionId) count += 1
    return true
  })
  return count
}

function topLevelProjectionContainerPosition(document: ProseMirrorNode, id: string): number | null {
  let position = 0
  for (let index = 0; index < document.childCount; index += 1) {
    const child = document.child(index)
    let contains = nodeProjectionId(child) === id
    if (!contains) {
      child.descendants((descendant) => {
        if (nodeProjectionId(descendant) !== id) return true
        contains = true
        return false
      })
    }
    if (contains) return position
    position += child.nodeSize
  }
  return null
}

export function findTiptapProjectionNode(
  document: ProseMirrorNode,
  projectionId: string,
): PositionedTiptapProjectionNode | null {
  let found: PositionedTiptapProjectionNode | null = null
  document.descendants((node, position) => {
    if (nodeProjectionId(node) !== projectionId) return true
    found = Object.freeze({ node, position, projectionId })
    return false
  })
  return found
}

interface IndexedProjectionNode extends PositionedTiptapProjectionNode {
  readonly entry: ProjectionMapEntry
  readonly to: number
}

function indexProjectionNodes(
  document: ProseMirrorNode,
  entries: readonly ProjectionMapEntry[],
): readonly IndexedProjectionNode[] {
  const entriesById = new Map(entries.map((entry) => [entry.projectionId, entry]))
  const indexed: IndexedProjectionNode[] = []
  const seen = new Set<string>()
  document.descendants((node, position) => {
    const id = nodeProjectionId(node)
    if (id === null) return true
    const entry = entriesById.get(id)
    if (entry === undefined) return true
    if (seen.has(id)) {
      throw new InvalidTiptapPatchSerializationError(`Projection id ${id} occurs more than once in the Tiptap document.`)
    }
    seen.add(id)
    indexed.push(Object.freeze({ entry, node, position, projectionId: id, to: position + node.nodeSize }))
    return true
  })
  return Object.freeze(indexed)
}

function touchesOldRange(node: IndexedProjectionNode, range: ChangedRange['oldRange']): boolean {
  if (range.from === range.to) {
    return range.from >= node.position && range.from <= node.to
  }
  return range.from < node.to && range.to > node.position
}

interface AffectedSafeUnit {
  readonly affectedProjectionIds: ReadonlySet<string>
  readonly entries: readonly ProjectionMapEntry[]
  readonly safePatchUnit: SafePatchUnit
}

function pendingSplitOwner(
  projection: TiptapVisualProjection,
  transaction: Transaction,
  changedRanges: readonly ChangedRange[],
): ProjectionMapEntry | null {
  const entriesById = new Map(projection.map.entries.map((entry) => [entry.projectionId, entry]))
  const topLevel: Array<Readonly<{
    from: number
    index: number
    node: ProseMirrorNode
    projectionIds: readonly string[]
    to: number
  }>> = []
  let position = 0
  for (let index = 0; index < transaction.before.childCount; index += 1) {
    const node = transaction.before.child(index)
    const projectionIds: string[] = []
    const ownProjectionId = nodeProjectionId(node)
    if (ownProjectionId !== null && entriesById.has(ownProjectionId)) projectionIds.push(ownProjectionId)
    node.descendants((descendant) => {
      const id = nodeProjectionId(descendant)
      if (id !== null && entriesById.has(id) && !projectionIds.includes(id)) projectionIds.push(id)
      return true
    })
    topLevel.push(Object.freeze({
      from: position,
      index,
      node,
      projectionIds: Object.freeze(projectionIds),
      to: position + node.nodeSize,
    }))
    position += node.nodeSize
  }

  const changedContainers = topLevel.filter((candidate) =>
    changedRanges.some(({ oldRange }) => oldRange.from === oldRange.to
      ? oldRange.from >= candidate.from && oldRange.from <= candidate.to
      : oldRange.from < candidate.to && oldRange.to > candidate.from),
  )
  if (changedContainers.length === 0) return null

  const owners = new Set<ProjectionMapEntry>()
  for (const changed of changedContainers) {
    let owner = changed.projectionIds.length === 1
      ? entriesById.get(changed.projectionIds[0] ?? '')
      : undefined
    if (changed.projectionIds.length > 1) return null
    if (owner === undefined && changed.projectionIds.length === 0) {
      for (let index = changed.index - 1; index >= 0; index -= 1) {
        const ids = topLevel[index]?.projectionIds ?? []
        if (ids.length === 0) continue
        if (ids.length > 1) return null
        owner = entriesById.get(ids[0] ?? '')
        break
      }
    }
    if (owner === undefined && changed.projectionIds.length === 0) {
      for (let index = changed.index + 1; index < topLevel.length; index += 1) {
        const ids = topLevel[index]?.projectionIds ?? []
        if (ids.length === 0) continue
        if (ids.length > 1) return null
        owner = entriesById.get(ids[0] ?? '')
        break
      }
    }
    if (owner === undefined) return null
    const strategy = owner.safePatchUnit.strategy
    const ownsAdjacentParagraph = strategy.kind === 'semantic-editor'
      || (strategy.kind === 'direct' && (
        strategy.scope === 'block'
        || (strategy.scope === 'joined-blocks' && owner.codecId.startsWith('alignment-'))
      ))
    if (!ownsAdjacentParagraph) return null
    owners.add(owner)
  }
  return owners.size === 1 ? [...owners][0] ?? null : null
}

function topLevelProjectionIndex(document: ProseMirrorNode, projectionId: string): number | null {
  for (let index = 0; index < document.childCount; index += 1) {
    const node = document.child(index)
    if (nodeProjectionId(node) === projectionId) return index
    let contained = false
    node.descendants((descendant) => {
      if (nodeProjectionId(descendant) !== projectionId) return true
      contained = true
      return false
    })
    if (contained) return index
  }
  return null
}

function topLevelProjectionNode(document: ProseMirrorNode, projectionId: string): ProseMirrorNode | null {
  const index = topLevelProjectionIndex(document, projectionId)
  return index === null ? null : document.child(index)
}

function changedTopLevelAlignment(
  document: ProseMirrorNode,
  changedRanges: readonly ChangedRange[],
): ProseMirrorNode | null {
  let position = 0
  let found: ProseMirrorNode | null = null
  for (let index = 0; index < document.childCount; index += 1) {
    const node = document.child(index)
    const to = position + node.nodeSize
    const changed = changedRanges.some(({ newRange }) => newRange.from === newRange.to
      ? newRange.from >= position && newRange.from <= to
      : newRange.from < to && newRange.to > position)
    if (changed && node.type.name === 'alignmentBlock') {
      if (found !== null) return null
      found = node
    }
    position = to
  }
  return found
}

function alignmentWrapUnit(
  projection: TiptapVisualProjection,
  transaction: Transaction,
  changedRanges: readonly ChangedRange[],
  affectedEntries: readonly ProjectionMapEntry[],
): AffectedSafeUnit | null {
  if (projection.source === undefined || affectedEntries.length < 1) return null
  const alignment = changedTopLevelAlignment(transaction.doc, changedRanges)
  if (alignment === null || !['center', 'justify', 'left', 'right'].includes(String(alignment.attrs['alignment']))) return null
  const wrappedProjectionIds = new Set<string>()
  alignment.descendants((node) => {
    const id = nodeProjectionId(node)
    if (id !== null) wrappedProjectionIds.add(id)
    return true
  })
  const scopedEntries = wrappedProjectionIds.size === 0
    ? affectedEntries
    : affectedEntries.filter((entry) => wrappedProjectionIds.has(entry.projectionId))
  if (scopedEntries.length === 0 || scopedEntries.length === affectedEntries.length) return null
  const beforeNodes = scopedEntries.map((entry) => topLevelProjectionNode(transaction.before, entry.projectionId))
  if (beforeNodes.some((node) => node === null)) return null
  const nodes = beforeNodes.filter((node): node is ProseMirrorNode => node !== null)
  if (nodes.length !== alignment.childCount) return null
  for (let index = 0; index < nodes.length; index += 1) {
    const before = nodes[index]
    const after = alignment.child(index)
    if (before === undefined || before.type.name !== after.type.name || before.textContent !== after.textContent) return null
  }
  const first = scopedEntries[0]
  const last = scopedEntries.at(-1)
  if (first === undefined || last === undefined || first.sourceSpan.from > last.sourceSpan.to) return null
  const sourceSpan = Object.freeze({ from: first.sourceSpan.from, to: last.sourceSpan.to })
  const safePatchUnit = Object.freeze({
    codecId: 'alignment-wrap',
    expectedSource: projection.source.slice(sourceSpan.from, sourceSpan.to),
    sourceSpan,
    strategy: Object.freeze({ kind: 'direct' as const, scope: 'joined-blocks' as const }),
    structural: true,
    unitId: `alignment-wrap:${scopedEntries.map((entry) => entry.projectionId).join(':')}`,
  })
  return Object.freeze({
    affectedProjectionIds: new Set(scopedEntries.map((entry) => entry.projectionId)),
    entries: Object.freeze([...scopedEntries]),
    safePatchUnit,
  })
}

function runtimeParagraphTrailingListUnit(
  projection: TiptapVisualProjection,
  transaction: Transaction,
  affectedEntries: readonly ProjectionMapEntry[],
): AffectedSafeUnit | null {
  if (projection.source === undefined || affectedEntries.length !== 1) return null
  const paragraph = affectedEntries[0]
  if (
    paragraph === undefined
    || paragraph.codecId !== 'paragraph'
    || !isRuntimeProjectionId(paragraph.projectionId)
  ) return null
  const paragraphIndex = topLevelProjectionIndex(transaction.before, paragraph.projectionId)
  if (paragraphIndex === null || paragraphIndex === 0) return null
  const listNode = transaction.before.child(paragraphIndex - 1)
  const listId = nodeProjectionId(listNode)
  if (listId === null) return null
  const list = projection.map.entries.find((entry) => (
    entry.projectionId === listId
    && (entry.codecId === 'ordered-list' || entry.codecId === 'bullet-list' || entry.codecId === 'task-list')
  ))
  if (list === undefined || list.sourceSpan.to > paragraph.sourceSpan.from) return null
  const sourceSpan = Object.freeze({ from: list.sourceSpan.from, to: paragraph.sourceSpan.to })
  const entries = [list, paragraph].sort((left, right) => left.sourceSpan.from - right.sourceSpan.from)
  return Object.freeze({
    affectedProjectionIds: new Set(entries.map((entry) => entry.projectionId)),
    entries: Object.freeze(entries),
    safePatchUnit: Object.freeze({
      codecId: 'ordinary-join',
      expectedSource: projection.source.slice(sourceSpan.from, sourceSpan.to),
      sourceSpan,
      strategy: Object.freeze({ kind: 'direct' as const, scope: 'joined-blocks' as const }),
      structural: true,
      unitId: `ordinary-runtime-trailing-join:${list.projectionId}:${paragraph.projectionId}`,
    }),
  })
}

function affectedSafeUnits(
  projection: TiptapVisualProjection,
  transaction: Transaction,
  changedRanges: readonly ChangedRange[],
): readonly AffectedSafeUnit[] {
  const indexed = indexProjectionNodes(transaction.before, projection.map.entries)
  const affectedEntries = indexed
    .filter((node) => changedRanges.some((range) => touchesOldRange(node, range.oldRange)))
    .map((node) => node.entry)
  const pendingOwner = pendingSplitOwner(projection, transaction, changedRanges)
  const runtimeTrailingListUnit = runtimeParagraphTrailingListUnit(projection, transaction, affectedEntries)
  if (runtimeTrailingListUnit !== null) return Object.freeze([runtimeTrailingListUnit])
  const runtimeParagraphAffected = affectedEntries.some((entry) => (
    entry.codecId === 'paragraph' && isRuntimeProjectionId(entry.projectionId)
  ))
  if (
    pendingOwner !== null
    && runtimeParagraphAffected
    && affectedEntries.some((entry) => entry.projectionId !== pendingOwner.projectionId)
  ) {
    return Object.freeze([Object.freeze({
      affectedProjectionIds: new Set([pendingOwner.projectionId]),
      entries: Object.freeze([pendingOwner]),
      safePatchUnit: pendingOwner.safePatchUnit,
    })])
  }
  if (affectedEntries.length === 0) {
    if (pendingOwner === null) throw new UnmappedTiptapTransactionError()
    return Object.freeze([Object.freeze({
      affectedProjectionIds: new Set([pendingOwner.projectionId]),
      entries: Object.freeze([pendingOwner]),
      safePatchUnit: pendingOwner.safePatchUnit,
    })])
  }

  const orderedAffectedEntries = [...affectedEntries].sort((left, right) => left.sourceSpan.from - right.sourceSpan.from)
  if (transaction.doc.childCount > transaction.before.childCount) {
    const projectionIds = new Set(projection.map.entries.map((entry) => entry.projectionId))
    const insertedTopLevel: ProseMirrorNode[] = []
    let position = 0
    for (let index = 0; index < transaction.doc.childCount; index += 1) {
      const node = transaction.doc.child(index)
      const to = position + node.nodeSize
      const inserted = changedRanges.some(({ newRange, oldRange }) => (
        oldRange.from === oldRange.to
        && newRange.from < newRange.to
        && position >= newRange.from
        && to <= newRange.to
      ))
      const id = nodeProjectionId(node)
      if (inserted && (id === null || !projectionIds.has(id))) insertedTopLevel.push(node)
      position = to
    }
    if (
      insertedTopLevel.length > 0
      && insertedTopLevel.every((node) => node.type.name === 'paragraph' && node.content.size === 0)
      && orderedAffectedEntries.length === 2
      && projection.source !== undefined
    ) {
      const left = orderedAffectedEntries[0]
      const right = orderedAffectedEntries[1]
      const leftIndex = projection.map.entries.findIndex((entry) => entry.projectionId === left?.projectionId)
      const rightIndex = projection.map.entries.findIndex((entry) => entry.projectionId === right?.projectionId)
      const separator = left === undefined || right === undefined
        ? ''
        : projection.source.slice(left.sourceSpan.to, right.sourceSpan.from)
      if (
        left !== undefined
        && right !== undefined
        && left.sourceSpan.to <= right.sourceSpan.from
        && rightIndex === leftIndex + 1
        && /^\r?\n[ \t]*\r?\n$/u.test(separator)
      ) {
        const sourceSpan = Object.freeze({ from: right.sourceSpan.from, to: right.sourceSpan.from })
        const joinedUnit = Object.freeze({
          codecId: 'ordinary-paragraph-breaks',
          expectedSource: '',
          sourceSpan,
          strategy: Object.freeze({ kind: 'direct' as const, scope: 'joined-blocks' as const }),
          structural: true,
          unitId: `ordinary-paragraph-break-insert:${left.projectionId}:${right.projectionId}`,
        })
        return Object.freeze([Object.freeze({
          affectedProjectionIds: new Set(orderedAffectedEntries.map((entry) => entry.projectionId)),
          entries: Object.freeze(orderedAffectedEntries),
          safePatchUnit: joinedUnit,
        })])
      }
    }
    if (
      insertedTopLevel.some((node) => node.type.name !== 'paragraph' || node.content.size > 0)
      && orderedAffectedEntries.length === 2
      && projection.source !== undefined
    ) {
      const left = orderedAffectedEntries[0]
      const right = orderedAffectedEntries[1]
      const leftIndex = projection.map.entries.findIndex((entry) => entry.projectionId === left?.projectionId)
      const rightIndex = projection.map.entries.findIndex((entry) => entry.projectionId === right?.projectionId)
      const directOrdinaryBlocks = orderedAffectedEntries.every((entry) => (
        entry.safePatchUnit.strategy.kind === 'direct'
        && entry.safePatchUnit.strategy.scope === 'block'
      ))
      if (
        left !== undefined
        && right !== undefined
        && directOrdinaryBlocks
        && rightIndex === leftIndex + 1
        && left.sourceSpan.to <= right.sourceSpan.from
      ) {
        const sourceSpan = Object.freeze({ from: left.sourceSpan.from, to: right.sourceSpan.to })
        const joinedUnit = Object.freeze({
          codecId: 'ordinary-insert',
          expectedSource: projection.source.slice(sourceSpan.from, sourceSpan.to),
          sourceSpan,
          strategy: Object.freeze({ kind: 'direct' as const, scope: 'joined-blocks' as const }),
          structural: true,
          unitId: `ordinary-insert:${left.projectionId}:${right.projectionId}`,
        })
        return Object.freeze([Object.freeze({
          affectedProjectionIds: new Set(orderedAffectedEntries.map((entry) => entry.projectionId)),
          entries: Object.freeze(orderedAffectedEntries),
          safePatchUnit: joinedUnit,
        })])
      }
    }
    if (pendingOwner !== null) {
      return Object.freeze([Object.freeze({
        affectedProjectionIds: new Set([pendingOwner.projectionId]),
        entries: Object.freeze([pendingOwner]),
        safePatchUnit: pendingOwner.safePatchUnit,
      })])
    }
    const splitOwners = orderedAffectedEntries.filter((entry) => (
      projectionIdOccurrenceCount(transaction.doc, entry.projectionId) > 1
    ))
    const owner = splitOwners.length === 1 ? splitOwners[0] : undefined
    if (owner !== undefined) {
      return Object.freeze([Object.freeze({
        affectedProjectionIds: new Set([owner.projectionId]),
        entries: Object.freeze([owner]),
        safePatchUnit: owner.safePatchUnit,
      })])
    }
  }
  const distinctUnits = new Set(orderedAffectedEntries.map((entry) => entry.safePatchUnit.unitId))
  const removedEntries = orderedAffectedEntries.filter((entry) => findTiptapProjectionNode(transaction.doc, entry.projectionId) === null)
  const removedAlignmentBoundaryParagraph = removedEntries.length === 1
    && removedEntries[0]?.codecId === 'paragraph'
    && removedEntries[0].sourceSpan.from === removedEntries[0].sourceSpan.to
    && topLevelProjectionNode(transaction.before, removedEntries[0].projectionId)?.type.name === 'paragraph'
    ? removedEntries[0]
    : undefined
  const movedAlignmentBoundaryParagraph = orderedAffectedEntries.find((entry) => (
    entry.codecId === 'paragraph'
    && entry.sourceSpan.from === entry.sourceSpan.to
    && topLevelProjectionNode(transaction.before, entry.projectionId)?.type.name === 'paragraph'
    && topLevelProjectionNode(transaction.doc, entry.projectionId)?.type.name === 'alignmentBlock'
  ))
  const alignmentBoundaryParagraph = removedAlignmentBoundaryParagraph
    ?? movedAlignmentBoundaryParagraph
  const survivingAlignmentEntry = orderedAffectedEntries.some((entry) => (
    entry.codecId.startsWith('alignment-')
    && topLevelProjectionNode(transaction.doc, entry.projectionId)?.type.name === 'alignmentBlock'
  ))
  if (
    alignmentBoundaryParagraph !== undefined
    && survivingAlignmentEntry
    && orderedAffectedEntries.length > 1
    && projection.source !== undefined
  ) {
    const projectionIndexes = orderedAffectedEntries.map((entry) => projection.map.entries.findIndex((candidate) => candidate.projectionId === entry.projectionId))
    const orderedProjectionIndexes = [...projectionIndexes].sort((left, right) => left - right)
    const contiguous = orderedProjectionIndexes.every((index, offset) => (
      index >= 0 && index === (orderedProjectionIndexes[0] ?? -1) + offset
    ))
    const survivorIndexes = orderedAffectedEntries
      .filter((entry) => entry.projectionId !== alignmentBoundaryParagraph.projectionId)
      .filter((entry) => findTiptapProjectionNode(transaction.doc, entry.projectionId) !== null)
      .map((entry) => topLevelProjectionIndex(transaction.doc, entry.projectionId))
      .filter((index): index is number => index !== null)
      .filter((index, offset, indexes) => indexes.indexOf(index) === offset)
      .sort((left, right) => left - right)
    const survivorsAreContiguous = survivorIndexes.length > 0
      && survivorIndexes.every((index, offset) => index === (survivorIndexes[0] ?? -1) + offset)
    const first = orderedAffectedEntries[0]
    const last = orderedAffectedEntries.at(-1)
    if (
      contiguous
      && survivorsAreContiguous
      && first !== undefined
      && last !== undefined
      && first.sourceSpan.from <= last.sourceSpan.to
    ) {
      const sourceSpan = Object.freeze({ from: first.sourceSpan.from, to: last.sourceSpan.to })
      const joinedUnit = Object.freeze({
        codecId: 'alignment-boundary-join',
        expectedSource: projection.source.slice(sourceSpan.from, sourceSpan.to),
        sourceSpan,
        strategy: Object.freeze({ kind: 'direct' as const, scope: 'joined-blocks' as const }),
        structural: true,
        unitId: `alignment-boundary-join:${orderedAffectedEntries.map((entry) => entry.projectionId).join(':')}`,
      })
      return Object.freeze([Object.freeze({
        affectedProjectionIds: new Set(orderedAffectedEntries.map((entry) => entry.projectionId)),
        entries: Object.freeze(orderedAffectedEntries),
        safePatchUnit: joinedUnit,
      })])
    }
  }
  const restoredAlignmentUnit = alignmentWrapUnit(projection, transaction, changedRanges, orderedAffectedEntries)
  if (restoredAlignmentUnit !== null) return Object.freeze([restoredAlignmentUnit])
  if (
    orderedAffectedEntries.length > 1
    && distinctUnits.size === orderedAffectedEntries.length
    && removedEntries.length > 0
    && projection.source !== undefined
  ) {
    const projectionIndexes = orderedAffectedEntries.map((entry) => projection.map.entries.findIndex((candidate) => candidate.projectionId === entry.projectionId))
    const orderedProjectionIndexes = [...projectionIndexes].sort((left, right) => left - right)
    const contiguous = orderedProjectionIndexes.every((index, offset) => (
      index >= 0 && index === (orderedProjectionIndexes[0] ?? -1) + offset
    ))
    const survivorContainers = orderedAffectedEntries
      .map((entry) => topLevelProjectionContainerPosition(transaction.doc, entry.projectionId))
      .filter((position): position is number => position !== null)
    const oneSurvivorContainer = survivorContainers.length > 0
      && new Set(survivorContainers).size === 1
    if (contiguous && oneSurvivorContainer) {
      const first = orderedAffectedEntries[0]
      const last = orderedAffectedEntries.at(-1)
      if (first !== undefined && last !== undefined) {
        const sourceSpan = Object.freeze({ from: first.sourceSpan.from, to: last.sourceSpan.to })
        const joinedUnit = Object.freeze({
          codecId: 'ordinary-join',
          expectedSource: projection.source.slice(sourceSpan.from, sourceSpan.to),
          sourceSpan,
          strategy: Object.freeze({ kind: 'direct' as const, scope: 'joined-blocks' as const }),
          structural: true,
          unitId: `ordinary-join:${orderedAffectedEntries.map((entry) => entry.projectionId).join(':')}`,
        })
        return Object.freeze([Object.freeze({
          affectedProjectionIds: new Set(orderedAffectedEntries.map((entry) => entry.projectionId)),
          entries: Object.freeze(orderedAffectedEntries),
          safePatchUnit: joinedUnit,
        })])
      }
    }
  }
  if (orderedAffectedEntries.length > 1 && distinctUnits.size === orderedAffectedEntries.length && projection.source !== undefined) {
    const containerPositions = new Set(orderedAffectedEntries.map((entry) => (
      topLevelProjectionContainerPosition(transaction.doc, entry.projectionId)
    )))
    if (containerPositions.size === 1 && !containerPositions.has(null)) {
      const first = orderedAffectedEntries[0]
      const last = orderedAffectedEntries.at(-1)
      if (first !== undefined && last !== undefined) {
        const sourceSpan = Object.freeze({ from: first.sourceSpan.from, to: last.sourceSpan.to })
        const joinedUnit = Object.freeze({
          codecId: 'ordinary-wrap',
          expectedSource: projection.source.slice(sourceSpan.from, sourceSpan.to),
          sourceSpan,
          strategy: Object.freeze({ kind: 'direct' as const, scope: 'joined-blocks' as const }),
          structural: true,
          unitId: `ordinary-wrap:${orderedAffectedEntries.map((entry) => entry.projectionId).join(':')}`,
        })
        return Object.freeze([Object.freeze({
          affectedProjectionIds: new Set(orderedAffectedEntries.map((entry) => entry.projectionId)),
          entries: Object.freeze(orderedAffectedEntries),
          safePatchUnit: joinedUnit,
        })])
      }
    }
  }
  if (
    orderedAffectedEntries.length === 1
    && removedEntries.length === 1
    && transaction.doc.childCount < transaction.before.childCount
    && projection.source !== undefined
  ) {
    const removed = removedEntries[0]
    const allEntries = [...projection.map.entries].sort((left, right) => left.sourceSpan.from - right.sourceSpan.from)
    const removedIndex = allEntries.findIndex((entry) => entry.projectionId === removed?.projectionId)
    const neighbor = removedIndex > 0 ? allEntries[removedIndex - 1] : allEntries[removedIndex + 1]
    if (removed !== undefined && neighbor !== undefined) {
      const entries = [removed, neighbor].sort((left, right) => left.sourceSpan.from - right.sourceSpan.from)
      const first = entries[0]
      const second = entries[1]
      if (first !== undefined && second !== undefined && first.sourceSpan.to <= second.sourceSpan.from) {
        const sourceSpan = Object.freeze({ from: first.sourceSpan.from, to: second.sourceSpan.to })
        const joinedUnit = Object.freeze({
          codecId: 'ordinary-join',
          expectedSource: projection.source.slice(sourceSpan.from, sourceSpan.to),
          sourceSpan,
          strategy: Object.freeze({ kind: 'direct' as const, scope: 'joined-blocks' as const }),
          structural: true,
          unitId: `ordinary-remove:${first.projectionId}:${second.projectionId}`,
        })
        return Object.freeze([Object.freeze({
          affectedProjectionIds: new Set(entries.map((entry) => entry.projectionId)),
          entries: Object.freeze(entries),
          safePatchUnit: joinedUnit,
        })])
      }
    }
  }
  if (
    orderedAffectedEntries.length === 2
    && distinctUnits.size === 2
    && removedEntries.length === 1
    && projection.source !== undefined
  ) {
    const first = orderedAffectedEntries[0]
    const second = orderedAffectedEntries[1]
    if (first === undefined || second === undefined || first.sourceSpan.to > second.sourceSpan.from) {
      throw new AmbiguousTiptapPatchUnitError()
    }
    const sourceSpan = Object.freeze({ from: first.sourceSpan.from, to: second.sourceSpan.to })
    const joinedUnit = Object.freeze({
      codecId: 'ordinary-join',
      expectedSource: projection.source.slice(sourceSpan.from, sourceSpan.to),
      sourceSpan,
      strategy: Object.freeze({ kind: 'direct' as const, scope: 'joined-blocks' as const }),
      structural: true,
      unitId: `ordinary-join:${first.projectionId}:${second.projectionId}`,
    })
    return Object.freeze([Object.freeze({
      affectedProjectionIds: new Set(orderedAffectedEntries.map((entry) => entry.projectionId)),
      entries: Object.freeze(orderedAffectedEntries),
      safePatchUnit: joinedUnit,
    })])
  }
  if (
    removedEntries.length > 1
    && removedEntries.every((entry) => (
      entry.codecId === 'paragraph'
      && entry.sourceSpan.from === entry.sourceSpan.to
    ))
    && projection.source !== undefined
  ) {
    const projectionIndexById = new Map(
      projection.map.entries.map((entry, index) => [entry.projectionId, index]),
    )
    const removedIndexes = removedEntries.map((entry) => projectionIndexById.get(entry.projectionId) ?? -1)
    const removedContiguous = removedIndexes.every((index, offset) => (
      index >= 0 && index === (removedIndexes[0] ?? -1) + offset
    ))
    let joinedEntries = orderedAffectedEntries
    if (removedContiguous && removedEntries.length === orderedAffectedEntries.length) {
      const firstRemovedIndex = removedIndexes[0] ?? -1
      const lastRemovedIndex = removedIndexes.at(-1) ?? -1
      const neighbor = firstRemovedIndex > 0
        ? projection.map.entries[firstRemovedIndex - 1]
        : projection.map.entries[lastRemovedIndex + 1]
      if (neighbor !== undefined) {
        joinedEntries = [...orderedAffectedEntries, neighbor]
          .sort((left, right) => left.sourceSpan.from - right.sourceSpan.from)
      }
    }
    const affectedIndexes = joinedEntries.map((entry) => projectionIndexById.get(entry.projectionId) ?? -1)
    const contiguous = affectedIndexes.every((index, offset) => (
      index >= 0 && index === (affectedIndexes[0] ?? -1) + offset
    ))
    const first = joinedEntries[0]
    const last = joinedEntries.at(-1)
    if (contiguous && first !== undefined && last !== undefined && first.sourceSpan.from < last.sourceSpan.to) {
      const sourceSpan = Object.freeze({ from: first.sourceSpan.from, to: last.sourceSpan.to })
      const joinedUnit = Object.freeze({
        codecId: 'ordinary-paragraph-breaks',
        expectedSource: projection.source.slice(sourceSpan.from, sourceSpan.to),
        sourceSpan,
        strategy: Object.freeze({ kind: 'direct' as const, scope: 'joined-blocks' as const }),
        structural: true,
        unitId: `ordinary-paragraph-breaks:${joinedEntries.map((entry) => entry.projectionId).join(':')}`,
      })
      return Object.freeze([Object.freeze({
        affectedProjectionIds: new Set(joinedEntries.map((entry) => entry.projectionId)),
        entries: Object.freeze(joinedEntries),
        safePatchUnit: joinedUnit,
      })])
    }
  }

  const affectedIdsByUnit = new Map<string, Set<string>>()
  const unitById = new Map<string, SafePatchUnit>()
  for (const entry of affectedEntries) {
    const unit = entry.safePatchUnit
    unitById.set(unit.unitId, unit)
    const ids = affectedIdsByUnit.get(unit.unitId) ?? new Set<string>()
    ids.add(entry.projectionId)
    affectedIdsByUnit.set(unit.unitId, ids)
  }

  const units = [...unitById.entries()].map(([unitId, safePatchUnit]) => Object.freeze({
    affectedProjectionIds: affectedIdsByUnit.get(unitId) ?? new Set<string>(),
    entries: Object.freeze(projection.map.entries.filter((entry) => entry.safePatchUnit.unitId === unitId)),
    safePatchUnit,
  }))
  units.sort((left, right) => (
    left.safePatchUnit.sourceSpan.from - right.safePatchUnit.sourceSpan.from
    || left.safePatchUnit.sourceSpan.to - right.safePatchUnit.sourceSpan.to
  ))
  for (let index = 1; index < units.length; index += 1) {
    const previous = units[index - 1]
    const current = units[index]
    if (
      previous !== undefined
      && current !== undefined
      && (
        current.safePatchUnit.sourceSpan.from < previous.safePatchUnit.sourceSpan.to
        || current.safePatchUnit.sourceSpan.from === previous.safePatchUnit.sourceSpan.from
      )
    ) {
      throw new AmbiguousTiptapPatchUnitError()
    }
  }
  return Object.freeze(units)
}

export class TiptapTransactionPatchPlanner {
  readonly #createTransactionId: () => string
  readonly #serialize: (input: TiptapPatchSerializationInput) => string

  constructor(options: TiptapTransactionPatchPlannerOptions) {
    this.#createTransactionId = options.createTransactionId
    this.#serialize = options.serialize
  }

  plan(transaction: Transaction, projection: TiptapVisualProjection): PatchPlan | null {
    if (!transaction.docChanged || transaction.getMeta(TIPTAP_EXTERNAL_HYDRATION_META) !== undefined) return null
    if (projection.revision !== projection.map.revision) {
      throw new InvalidTiptapPatchSerializationError('Projection and projection-map revisions do not match.')
    }
    const changedRanges = Object.freeze(getChangedRanges(transaction).map((range) => Object.freeze({
      newRange: Object.freeze({ ...range.newRange }),
      oldRange: Object.freeze({ ...range.oldRange }),
    })))
    if (changedRanges.length === 0) throw new UnmappedTiptapTransactionError()
    const units = affectedSafeUnits(projection, transaction, changedRanges)
    const patches = units.map((unit) => {
      const replacement = this.#serialize(Object.freeze({
        affectedProjectionIds: Object.freeze([...unit.affectedProjectionIds]),
        after: transaction.doc,
        before: transaction.before,
        changedRanges,
        entries: unit.entries,
        projectionEntries: projection.map.entries,
        projectionSource: projection.source,
        safePatchUnit: unit.safePatchUnit,
        transaction,
      }))
      if (typeof replacement !== 'string') {
        throw new InvalidTiptapPatchSerializationError('A Tiptap safe-unit serializer returned a non-string replacement.')
      }
      return Object.freeze({
        codecId: unit.safePatchUnit.codecId,
        expected: unit.safePatchUnit.expectedSource,
        from: unit.safePatchUnit.sourceSpan.from,
        replacement,
        to: unit.safePatchUnit.sourceSpan.to,
      })
    })
    const transactionId = this.#createTransactionId()
    if (typeof transactionId !== 'string' || transactionId.length === 0) {
      throw new InvalidTiptapPatchSerializationError('Tiptap patch plans require a transaction identity.')
    }
    return Object.freeze({
      baseRevision: projection.revision,
      patches: Object.freeze(patches),
      transactionId,
    })
  }
}
